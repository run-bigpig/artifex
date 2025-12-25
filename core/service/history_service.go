package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// saveRequest 保存请求结构
type saveRequest struct {
	saveType   string     // "chat" 或 "canvas"
	data       string     // JSON 格式的数据
	timestamp  int64      // 请求时间戳，用于合并策略
	resultChan chan error // 用于同步返回结果的 channel，nil 表示异步请求
}

// HistoryService 历史记录服务
// 提供聊天历史记录和画布记录的保存、加载、删除功能
// 使用异步队列机制处理保存操作，避免阻塞主进程
// ✅ 性能优化：图片分离存储 + JSON 压缩
type HistoryService struct {
	ctx        context.Context
	dataDir    string
	chatFile   string
	canvasFile string
	mu         sync.Mutex // 用于保护共享状态

	// ✅ 性能优化：图片存储管理器（图片分离存储）
	imageStorage *ImageStorage

	// ✅ 性能优化：保存队列处理器启动控制
	saveQueueOnce sync.Once
	shutdownChan  chan struct{}

	// ✅ 性能优化：最新待保存数据的缓存，用于合并短时间内的多次保存
	pendingSaveMu     sync.Mutex
	pendingChatSave   *saveRequest  // 待保存的聊天历史（用于合并策略）
	pendingCanvasSave *saveRequest  // 待保存的画布历史（用于合并策略）
	saveNotifyChan    chan struct{} // 通知有新的保存请求

	// 事件监听器管理 - 使用 sync.Once 确保只注册一次
	eventHandlersOnce sync.Once
}

// NewHistoryService 创建历史记录服务实例
func NewHistoryService() *HistoryService {
	return &HistoryService{
		shutdownChan: make(chan struct{}),
		// ✅ 性能优化：增加 channel 缓冲长度到 20，减少快速操作时的卡顿
		// 缓冲足够多的通知，避免事件处理被阻塞
		saveNotifyChan: make(chan struct{}, 20),
	}
}

// Startup 在应用启动时调用
func (h *HistoryService) Startup(ctx context.Context) error {
	h.ctx = ctx

	// 获取执行文件所在目录
	exeDir, err := getExecutableDir()
	if err != nil {
		return fmt.Errorf("failed to get executable dir: %w", err)
	}

	// 创建应用数据目录（在执行文件所在目录下）
	h.dataDir = filepath.Join(exeDir, "config")
	if err := os.MkdirAll(h.dataDir, 0755); err != nil {
		return fmt.Errorf("failed to create app data dir: %w", err)
	}

	// ✅ 性能优化：初始化图片存储管理器
	h.imageStorage = NewImageStorage(h.dataDir)
	if err := h.imageStorage.Initialize(); err != nil {
		return fmt.Errorf("failed to initialize image storage: %w", err)
	}

	// 设置文件路径
	h.chatFile = filepath.Join(h.dataDir, "chat_history.json")
	h.canvasFile = filepath.Join(h.dataDir, "canvas_history.json")

	// ✅ 数据迁移：检查并迁移旧格式文件
	if err := h.migrateOldFormat(); err != nil {
		fmt.Printf("[HistoryService] Warning: failed to migrate old format: %v\n", err)
		// 不阻塞启动，继续使用新格式
	}
	// Normalize history images (convert base64 to refs)
	if err := h.normalizeHistoryImages(); err != nil {
		fmt.Printf("[HistoryService] Warning: failed to normalize history images: %v\n", err)
	}


	// ✅ 启动保存队列处理器（只启动一次）
	h.saveQueueOnce.Do(func() {
		go h.processSaveQueue()
	})

	// ✅ 事件驱动：注册事件监听器，支持基于事件的异步保存
	h.eventHandlersOnce.Do(func() {
		h.registerEventHandlers(ctx)
	})

	return nil
}

// registerEventHandlers 注册事件处理器
// 监听前端通过 EventsEmit 发送的保存请求事件
func (h *HistoryService) registerEventHandlers(ctx context.Context) {
	// 监听聊天历史保存请求事件
	runtime.EventsOn(ctx, "history:save-chat", func(data ...interface{}) {
		eventTime := time.Now()
		dataSize := 0

		if len(data) == 0 {
			return // 静默忽略无效请求，避免频繁发送错误事件
		}

		chatHistoryJSON, ok := data[0].(string)
		if !ok || len(chatHistoryJSON) == 0 {
			return // 静默忽略无效数据
		}

		dataSize = len(chatHistoryJSON)

		// 限制数据大小，防止内存溢出（例如：100MB 限制）
		const maxDataSize = 100 * 1024 * 1024 // 100MB
		if len(chatHistoryJSON) > maxDataSize {
			fmt.Printf("[HistoryService] [ERROR] 聊天历史数据过大: %d bytes (%.2f MB)，超过限制 %d MB\n",
				dataSize, float64(dataSize)/(1024*1024), maxDataSize/(1024*1024))
			return // 数据过大，静默忽略，避免内存问题
		}

		// ✅ 将请求加入队列（保持顺序性），不阻塞事件处理
		// 使用 nil resultChan 表示这是事件驱动的请求，不需要同步返回结果
		// ✅ 合并策略：新请求覆盖旧请求，只保存最新的数据（静默合并，不通知）
		h.pendingSaveMu.Lock()
		// 释放旧数据的引用
		if h.pendingChatSave != nil {
			h.pendingChatSave.data = ""
		}
		// 设置新的待保存请求（覆盖旧的请求，实现合并策略）
		h.pendingChatSave = &saveRequest{
			saveType:   "chat",
			data:       chatHistoryJSON,
			timestamp:  eventTime.UnixNano(),
			resultChan: nil, // nil 表示事件驱动，完成后通过事件通知
		}
		h.pendingSaveMu.Unlock()

		// 通知队列处理器
		h.notifySaveQueue()
	})

	// 监听画布历史保存请求事件
	runtime.EventsOn(ctx, "history:save-canvas", func(data ...interface{}) {
		eventTime := time.Now()
		dataSize := 0

		if len(data) == 0 {
			return // 静默忽略无效请求，避免频繁发送错误事件
		}

		canvasHistoryJSON, ok := data[0].(string)
		if !ok || len(canvasHistoryJSON) == 0 {
			return // 静默忽略无效数据
		}

		dataSize = len(canvasHistoryJSON)

		// 限制数据大小，防止内存溢出（例如：100MB 限制）
		const maxDataSize = 100 * 1024 * 1024 // 100MB
		if len(canvasHistoryJSON) > maxDataSize {
			fmt.Printf("[HistoryService] [ERROR] 画布历史数据过大: %d bytes (%.2f MB)，超过限制 %d MB\n",
				dataSize, float64(dataSize)/(1024*1024), maxDataSize/(1024*1024))
			return // 数据过大，静默忽略，避免内存问题
		}

		// ✅ 将请求加入队列（保持顺序性），不阻塞事件处理
		// 使用 nil resultChan 表示这是事件驱动的请求，不需要同步返回结果
		// ✅ 合并策略：新请求覆盖旧请求，只保存最新的数据（静默合并，不通知）
		h.pendingSaveMu.Lock()
		// 释放旧数据的引用
		if h.pendingCanvasSave != nil {
			h.pendingCanvasSave.data = ""
		}
		// 设置新的待保存请求（覆盖旧的请求，实现合并策略）
		h.pendingCanvasSave = &saveRequest{
			saveType:   "canvas",
			data:       canvasHistoryJSON,
			timestamp:  eventTime.UnixNano(),
			resultChan: nil, // nil 表示事件驱动，完成后通过事件通知
		}
		h.pendingSaveMu.Unlock()

		// 通知队列处理器
		h.notifySaveQueue()
	})
}

// Shutdown 在应用关闭时调用，优雅地停止后台 goroutine
func (h *HistoryService) Shutdown() error {
	close(h.shutdownChan)
	// 等待队列处理器完成（如果有的话）
	// 注意：由于使用 sync.Once，队列处理器可能没有启动，所以不需要 WaitGroup
	return nil
}

// notifySaveQueue 通知保存队列有新请求
// ✅ 性能优化：使用非阻塞方式发送通知，避免阻塞事件处理
// 由于 channel 有足够大的缓冲（20），正常情况下不会阻塞
// 如果 channel 已满，说明后台处理较慢，此时丢弃通知是安全的（因为合并策略会确保最新数据被保存）
func (h *HistoryService) notifySaveQueue() {
	select {
	case h.saveNotifyChan <- struct{}{}:
		// 成功发送通知
	default:
		// 通道已满（说明后台处理较慢），丢弃通知
		// 这是安全的，因为合并策略会确保最新的数据被保存
		// 定时器（200ms）也会定期处理待保存的数据
	}
}

// ✅ 性能优化：保存队列处理器
// 使用合并策略处理保存请求，短时间内的多次保存只执行最后一次
func (h *HistoryService) processSaveQueue() {
	fmt.Printf("[HistoryService] [GOROUTINE] 历史记录保存队列处理 goroutine 启动\n")

	// ✅ 性能优化：增加批处理间隔到 200ms，减少文件写入频率
	// 前端已经有防抖机制（500ms），这里可以适当增加间隔
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	tickerCount := 0

	for {
		select {
		case <-ticker.C:
			// 定时处理待保存的请求
			tickerCount++
			if tickerCount%20 == 0 { // 每 1 秒打印一次
				fmt.Printf("[HistoryService] [TICKER] 保存队列 ticker 触发 (第 %d 次)\n", tickerCount)
			}
			h.flushPendingSaves()
		case <-h.saveNotifyChan:
			// ✅ 性能优化：批量处理通知，减少锁竞争
			// 快速消费 channel 中的所有通知（最多 10 个），然后统一处理
			// 这样可以减少频繁的锁获取和释放，提高性能
			notifyCount := 1
			done := false
			for !done && notifyCount < 10 {
				select {
				case <-h.saveNotifyChan:
					notifyCount++
				default:
					// 没有更多通知，跳出循环
					done = true
				}
			}
			// ✅ 性能优化：增加等待时间到 150ms，让更多请求合并
			// 前端已经有防抖机制（300ms/500ms），这里适当增加等待时间可以合并更多请求
			time.Sleep(150 * time.Millisecond)
			h.flushPendingSaves()
		case <-h.shutdownChan:
			// 关闭前处理所有待保存的请求
			fmt.Printf("[HistoryService] [GOROUTINE] 历史记录保存队列处理 goroutine 停止\n")
			h.flushPendingSaves()
			return
		}
	}
}

// flushPendingSaves 执行所有待保存的请求
// ✅ 支持事件驱动的保存请求，完成后通过事件通知前端
func (h *HistoryService) flushPendingSaves() {
	h.pendingSaveMu.Lock()

	// 获取并清除待保存的聊天历史请求
	chatSaveReq := h.pendingChatSave
	h.pendingChatSave = nil

	// 获取并清除待保存的画布历史请求
	canvasSaveReq := h.pendingCanvasSave
	h.pendingCanvasSave = nil

	h.pendingSaveMu.Unlock()

	// 执行聊天历史保存
	if chatSaveReq != nil {
		startTime := time.Now()
		dataSize := len(chatSaveReq.data)
		err := h.saveChatHistorySync(chatSaveReq.data)
		saveDuration := time.Since(startTime)

		// ✅ 性能监控：记录保存耗时和数据大小
		if saveDuration > 100*time.Millisecond {
			fmt.Printf("[HistoryService] [PERF] 聊天历史保存耗时: %v, 数据大小: %.2f KB\n",
				saveDuration, float64(dataSize)/(1024))
		}

		if chatSaveReq.resultChan != nil {
			// 同步调用，通过 channel 返回结果
			chatSaveReq.resultChan <- err
		} else {
			// ✅ 事件驱动：通过事件通知前端
			if err != nil && h.ctx != nil {
				runtime.EventsEmit(h.ctx, "history:chat-save-error", map[string]interface{}{
					"error": err.Error(),
				})
			}
		}
		// 清空数据，帮助 GC
		chatSaveReq.data = ""
	}

	// 执行画布历史保存
	if canvasSaveReq != nil {
		startTime := time.Now()
		dataSize := len(canvasSaveReq.data)
		err := h.saveCanvasHistorySync(canvasSaveReq.data)
		saveDuration := time.Since(startTime)

		// ✅ 性能监控：记录保存耗时和数据大小
		if saveDuration > 200*time.Millisecond {
			fmt.Printf("[HistoryService] [PERF] 画布历史保存耗时: %v, 数据大小: %.2f KB\n",
				saveDuration, float64(dataSize)/(1024))
		}

		if canvasSaveReq.resultChan != nil {
			// 同步调用，通过 channel 返回结果
			canvasSaveReq.resultChan <- err
		} else {
			// ✅ 事件驱动：通过事件通知前端
			if err != nil && h.ctx != nil {
				runtime.EventsEmit(h.ctx, "history:canvas-save-error", map[string]interface{}{
					"error": err.Error(),
				})
			}
		}
		// 清空数据，帮助 GC
		canvasSaveReq.data = ""
	}
}

// saveChatHistorySync 同步保存聊天历史（内部方法，在后台 goroutine 中调用）
// ✅ 性能优化：图片分离存储 + JSON 压缩
func (h *HistoryService) saveChatHistorySync(chatHistoryJSON string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	// 验证 JSON 格式
	var messages []ChatRecord
	if err := json.Unmarshal([]byte(chatHistoryJSON), &messages); err != nil {
		return fmt.Errorf("invalid chat history format: %w", err)
	}

	// ✅ 性能优化：提取图片数据并分离存储
	for i := range messages {
		if len(messages[i].Images) == 0 {
			continue
		}

		refs := make([]string, 0, len(messages[i].Images))
		for _, img := range messages[i].Images {
			if img == "" {
				refs = append(refs, "")
				continue
			}
			if strings.HasPrefix(img, "/images/") {
				refs = append(refs, strings.TrimPrefix(img, "/"))
				continue
			}
			if strings.HasPrefix(img, "images/") {
				refs = append(refs, img)
				continue
			}
			ref, err := h.imageStorage.SaveImage(img)
			if err != nil {
				return fmt.Errorf("failed to save image for message %s: %w", messages[i].ID, err)
			}
			refs = append(refs, ref)
		}
		messages[i].Images = refs
	}
	history := ChatHistory{
		Version:   "2.0", // 版本号升级，表示使用新格式
		UpdatedAt: time.Now().Unix(),
		Messages:  messages,
	}

	// ✅ 性能优化：使用紧凑 JSON 格式（不使用 MarshalIndent），减少序列化时间和文件大小
	data, err := json.Marshal(history)
	if err != nil {
		return fmt.Errorf("failed to serialize chat history: %w", err)
	}

	// ✅ 性能优化：使用临时文件 + 原子性重命名，避免写入过程中的数据损坏
	tempFile := h.chatFile + ".tmp"
	if err := os.WriteFile(tempFile, data, 0644); err != nil {
		return fmt.Errorf("failed to write temp chat history file: %w", err)
	}

	// 原子性重命名，确保文件完整性
	if err := os.Rename(tempFile, h.chatFile); err != nil {
		os.Remove(tempFile) // 清理临时文件
		return fmt.Errorf("failed to rename chat history file: %w", err)
	}

	return nil
}

// saveCanvasHistorySync 同步保存画布历史（内部方法，在后台 goroutine 中调用）
// ✅ 性能优化：图片分离存储 + JSON 压缩
func (h *HistoryService) saveCanvasHistorySync(canvasHistoryJSON string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	// 解析画布数据
	var canvasData struct {
		Viewport ViewportRecord `json:"viewport"`
		Images   []ImageRecord  `json:"images"`
	}
	if err := json.Unmarshal([]byte(canvasHistoryJSON), &canvasData); err != nil {
		return fmt.Errorf("invalid canvas history format: %w", err)
	}

	// ✅ 性能优化：提取图片数据并分离存储
	for i := range canvasData.Images {
		if canvasData.Images[i].Src == "" {
			continue
		}
		if strings.HasPrefix(canvasData.Images[i].Src, "/images/") {
			canvasData.Images[i].Src = strings.TrimPrefix(canvasData.Images[i].Src, "/")
			continue
		}
		if strings.HasPrefix(canvasData.Images[i].Src, "images/") {
			continue
		}
		imageRef, err := h.imageStorage.SaveImage(canvasData.Images[i].Src)
		if err != nil {
			return fmt.Errorf("failed to save image %s: %w", canvasData.Images[i].ID, err)
		}
		canvasData.Images[i].Src = imageRef
	}
	history := CanvasHistory{
		Version:   "2.0", // 版本号升级，表示使用新格式
		UpdatedAt: time.Now().Unix(),
		Viewport:  canvasData.Viewport,
		Images:    canvasData.Images,
	}

	// ✅ 性能优化：使用紧凑 JSON 格式（不使用 MarshalIndent），减少序列化时间和文件大小
	data, err := json.Marshal(history)
	if err != nil {
		return fmt.Errorf("failed to serialize canvas history: %w", err)
	}

	// ✅ 性能优化：使用临时文件 + 原子性重命名，避免写入过程中的数据损坏
	tempFile := h.canvasFile + ".tmp"
	if err := os.WriteFile(tempFile, data, 0644); err != nil {
		return fmt.Errorf("failed to write temp canvas history file: %w", err)
	}

	// 原子性重命名，确保文件完整性
	if err := os.Rename(tempFile, h.canvasFile); err != nil {
		os.Remove(tempFile) // 清理临时文件
		return fmt.Errorf("failed to rename canvas history file: %w", err)
	}

	return nil
}

// StoreImage persists a data URL and returns an image ref.
func (h *HistoryService) StoreImage(dataURL string) (string, error) {
	if dataURL == "" {
		return "", nil
	}
	if strings.HasPrefix(dataURL, "/images/") {
		return strings.TrimPrefix(dataURL, "/"), nil
	}
	if strings.HasPrefix(dataURL, "images/") {
		return dataURL, nil
	}
	if h.imageStorage == nil {
		return "", fmt.Errorf("image storage not initialized")
	}
	return h.imageStorage.SaveImage(dataURL)
}

// ==================== 同步保存 API（用于应用关闭时）====================

// SaveChatHistorySync 同步保存聊天历史记录（公共方法，直接保存，不走事件队列）
// 用于应用关闭时确保数据已保存
// @param chatHistoryJSON JSON 格式的聊天记录数组
// @return error 保存失败时返回错误
func (h *HistoryService) SaveChatHistorySync(chatHistoryJSON string) error {
	return h.saveChatHistorySync(chatHistoryJSON)
}

// SaveCanvasHistorySync 同步保存画布历史记录（公共方法，直接保存，不走事件队列）
// 用于应用关闭时确保数据已保存
// @param canvasHistoryJSON JSON 格式的画布记录，包含 viewport 和 images
// @return error 保存失败时返回错误
func (h *HistoryService) SaveCanvasHistorySync(canvasHistoryJSON string) error {
	return h.saveCanvasHistorySync(canvasHistoryJSON)
}

// ==================== 聊天历史记录 API ====================

// ChatHistory 聊天历史记录数据结构
type ChatHistory struct {
	Version   string       `json:"version"`
	UpdatedAt int64        `json:"updatedAt"`
	Messages  []ChatRecord `json:"messages"`
}

// ChatRecord 单条聊天记录
type ChatRecord struct {
	ID        string   `json:"id"`
	Role      string   `json:"role"` // "user" 或 "model"
	Type      string   `json:"type"` // "text", "system", "error"
	Text      string   `json:"text"`
	Images    []string `json:"images,omitempty"` // image refs (images/{hash}.{ext})
	Timestamp int64    `json:"timestamp"`
}

// LoadChatHistory 加载聊天历史记录
// 返回 JSON 格式的聊天记录数组
// ✅ 性能优化：支持压缩格式和图片引用加载
func (h *HistoryService) LoadChatHistory() (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// 检查文件是否存在
	var data []byte
	var err error

	if _, err := os.Stat(h.chatFile); err == nil {
		// 读取文件
		data, err = os.ReadFile(h.chatFile)
		if err != nil {
			return "", fmt.Errorf("failed to read chat history file: %w", err)
		}
	} else {
		// 文件不存在，返回空数组
		return "[]", nil
	}

	// 解析历史记录结构
	var history ChatHistory
	if err := json.Unmarshal(data, &history); err != nil {
		// 如果解析失败，尝试直接返回原始数据（兼容旧格式）
		return string(data), nil
	}

	// image refs only
	for i := range history.Messages {
		if len(history.Messages[i].Images) == 0 {
			continue
		}

		filtered := history.Messages[i].Images[:0]
		for _, ref := range history.Messages[i].Images {
			if strings.HasPrefix(ref, "/images/") {
				filtered = append(filtered, strings.TrimPrefix(ref, "/"))
				continue
			}
			if strings.HasPrefix(ref, "images/") {
				filtered = append(filtered, ref)
				continue
			}
			if ref != "" {
				fmt.Printf("[HistoryService] Warning: drop non-image reference for message %s\n", history.Messages[i].ID)
			}
		}
		history.Messages[i].Images = filtered
	}
	messagesJSON, err := json.Marshal(history.Messages)
	if err != nil {
		return "", fmt.Errorf("failed to serialize messages: %w", err)
	}

	return string(messagesJSON), nil
}

// ClearChatHistory 清除聊天历史记录
func (h *HistoryService) ClearChatHistory() error {
	h.mu.Lock()
	defer h.mu.Unlock()

	// 删除文件（如果存在）
	if err := os.Remove(h.chatFile); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove chat history file: %w", err)
	}

	return nil
}

// ==================== 画布记录 API ====================

// CanvasHistory 画布历史记录数据结构
type CanvasHistory struct {
	Version   string         `json:"version"`
	UpdatedAt int64          `json:"updatedAt"`
	Viewport  ViewportRecord `json:"viewport"`
	Images    []ImageRecord  `json:"images"`
}

// ViewportRecord 视口记录
type ViewportRecord struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}

// ImageRecord 图像记录
type ImageRecord struct {
	ID       string  `json:"id"`
	Src      string  `json:"src"` // image refs (images/{hash}.{ext})
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	ZIndex   int     `json:"zIndex"`
	Prompt   string  `json:"prompt"`
	Rotation float64 `json:"rotation,omitempty"` // 旋转角度（度），默认 0
}

// LoadCanvasHistory 加载画布历史记录
// 返回 JSON 格式的画布记录，包含 viewport 和 images
// ✅ 性能优化：支持压缩格式和图片引用加载
func (h *HistoryService) LoadCanvasHistory() (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// 检查文件是否存在
	var data []byte
	var err error

	if _, err := os.Stat(h.canvasFile); err == nil {
		// 读取文件
		data, err = os.ReadFile(h.canvasFile)
		if err != nil {
			return "", fmt.Errorf("failed to read canvas history file: %w", err)
		}
	} else {
		// 文件不存在，返回默认空记录
		defaultData := struct {
			Viewport ViewportRecord `json:"viewport"`
			Images   []ImageRecord  `json:"images"`
		}{
			Viewport: ViewportRecord{X: 0, Y: 0, Zoom: 1.0},
			Images:   []ImageRecord{},
		}
		data, _ := json.Marshal(defaultData)
		return string(data), nil
	}

	// 解析历史记录结构
	var history CanvasHistory
	if err := json.Unmarshal(data, &history); err != nil {
		// 如果解析失败，尝试直接返回原始数据（兼容旧格式）
		return string(data), nil
	}

	// image refs only
	for i := range history.Images {
		if history.Images[i].Src == "" {
			continue
		}
		if strings.HasPrefix(history.Images[i].Src, "/images/") {
			history.Images[i].Src = strings.TrimPrefix(history.Images[i].Src, "/")
			continue
		}
		if !strings.HasPrefix(history.Images[i].Src, "images/") {
			fmt.Printf("[HistoryService] Warning: drop non-image reference for image %s\n", history.Images[i].ID)
			history.Images[i].Src = ""
		}
	}
	result := struct {
		Viewport ViewportRecord `json:"viewport"`
		Images   []ImageRecord  `json:"images"`
	}{
		Viewport: history.Viewport,
		Images:   history.Images,
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("failed to serialize canvas data: %w", err)
	}

	return string(resultJSON), nil
}

// ClearCanvasHistory 清除画布历史记录
func (h *HistoryService) ClearCanvasHistory() error {
	h.mu.Lock()
	defer h.mu.Unlock()

	// 删除文件（如果存在）
	if err := os.Remove(h.canvasFile); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove canvas history file: %w", err)
	}

	// 同时删除旧格式文件（如果存在）
	oldFile := filepath.Join(h.dataDir, "canvas_history.json")
	os.Remove(oldFile) // 忽略错误

	return nil
}

// ==================== 数据迁移 ====================

// migrateOldFormat 迁移旧格式数据到新格式
// 将旧格式的 JSON 文件（包含 base64 图片）迁移为新格式（图片分离存储）
func (h *HistoryService) migrateOldFormat() error {
	oldChatFile := filepath.Join(h.dataDir, "chat_history.json")
	oldCanvasFile := filepath.Join(h.dataDir, "canvas_history.json")

	// 检查并删除旧的压缩文件（压缩服务已移除，无法读取）
	oldCompressedChatFile := filepath.Join(h.dataDir, "chat_history.json.zst")
	oldCompressedCanvasFile := filepath.Join(h.dataDir, "canvas_history.json.zst")
	if _, err := os.Stat(oldCompressedChatFile); err == nil {
		fmt.Printf("[HistoryService] Removing old compressed chat history file (compression service removed)\n")
		os.Remove(oldCompressedChatFile)
	}
	if _, err := os.Stat(oldCompressedCanvasFile); err == nil {
		fmt.Printf("[HistoryService] Removing old compressed canvas history file (compression service removed)\n")
		os.Remove(oldCompressedCanvasFile)
	}

	// 迁移聊天历史
	if _, err := os.Stat(oldChatFile); err == nil {
		// 检查新文件是否已存在
		if _, err := os.Stat(h.chatFile); os.IsNotExist(err) {
			fmt.Printf("[HistoryService] Migrating chat history from old format...\n")
			// 读取旧文件
			data, err := os.ReadFile(oldChatFile)
			if err != nil {
				return fmt.Errorf("failed to read old chat history: %w", err)
			}

			// 解析并保存为新格式（会自动提取图片）
			var messages []ChatRecord
			var history ChatHistory
			if err := json.Unmarshal(data, &history); err == nil {
				messages = history.Messages
			} else if err := json.Unmarshal(data, &messages); err != nil {
				// 尝试直接解析为消息数组
				return fmt.Errorf("failed to parse old chat history: %w", err)
			}

			// 保存为新格式
			messagesJSON, _ := json.Marshal(messages)
			if err := h.saveChatHistorySync(string(messagesJSON)); err != nil {
				return fmt.Errorf("failed to save migrated chat history: %w", err)
			}

			// 备份旧文件
			backupFile := oldChatFile + ".backup"
			if err := os.Rename(oldChatFile, backupFile); err != nil {
				fmt.Printf("[HistoryService] Warning: failed to backup old chat history: %v\n", err)
			} else {
				fmt.Printf("[HistoryService] Migrated chat history, old file backed up to %s\n", backupFile)
			}
		}
	}

	// 迁移画布历史
	if _, err := os.Stat(oldCanvasFile); err == nil {
		// 检查新文件是否已存在
		if _, err := os.Stat(h.canvasFile); os.IsNotExist(err) {
			fmt.Printf("[HistoryService] Migrating canvas history from old format...\n")
			// 读取旧文件
			data, err := os.ReadFile(oldCanvasFile)
			if err != nil {
				return fmt.Errorf("failed to read old canvas history: %w", err)
			}

			// 解析并保存为新格式（会自动提取图片）
			var canvasData struct {
				Viewport ViewportRecord `json:"viewport"`
				Images   []ImageRecord  `json:"images"`
			}
			var history CanvasHistory
			if err := json.Unmarshal(data, &history); err == nil {
				canvasData.Viewport = history.Viewport
				canvasData.Images = history.Images
			} else if err := json.Unmarshal(data, &canvasData); err != nil {
				return fmt.Errorf("failed to parse old canvas history: %w", err)
			}

			// 保存为新格式
			canvasJSON, _ := json.Marshal(canvasData)
			if err := h.saveCanvasHistorySync(string(canvasJSON)); err != nil {
				return fmt.Errorf("failed to save migrated canvas history: %w", err)
			}

			// 备份旧文件
			backupFile := oldCanvasFile + ".backup"
			if err := os.Rename(oldCanvasFile, backupFile); err != nil {
				fmt.Printf("[HistoryService] Warning: failed to backup old canvas history: %v\n", err)
			} else {
				fmt.Printf("[HistoryService] Migrated canvas history, old file backed up to %s\n", backupFile)
			}
		}
	}

	return nil
}


// normalizeHistoryImages 将历史中的 base64 图片转换为图片引用（不保留兼容）
func (h *HistoryService) normalizeHistoryImages() error {
	if err := h.normalizeChatHistoryImages(); err != nil {
		return err
	}
	if err := h.normalizeCanvasHistoryImages(); err != nil {
		return err
	}
	return nil
}

func (h *HistoryService) normalizeChatHistoryImages() error {
	if _, err := os.Stat(h.chatFile); err != nil {
		return nil
	}

	data, err := os.ReadFile(h.chatFile)
	if err != nil {
		return fmt.Errorf("failed to read chat history file: %w", err)
	}

	var messages []ChatRecord
	var history ChatHistory
	if err := json.Unmarshal(data, &history); err == nil {
		messages = history.Messages
	} else if err := json.Unmarshal(data, &messages); err != nil {
		return nil
	}

	for i := range messages {
		filtered := messages[i].Images[:0]
		for _, img := range messages[i].Images {
			if img == "" {
				continue
			}
			if strings.HasPrefix(img, "data:") || strings.HasPrefix(img, "images/") || strings.HasPrefix(img, "/images/") {
				filtered = append(filtered, img)
				continue
			}
			fmt.Printf("[HistoryService] Warning: drop unsupported image for message %s\n", messages[i].ID)
		}
		messages[i].Images = filtered
	}

	if !needsChatImageNormalization(messages) {
		return nil
	}

	messagesJSON, _ := json.Marshal(messages)
	if err := h.saveChatHistorySync(string(messagesJSON)); err != nil {
		return fmt.Errorf("failed to normalize chat history images: %w", err)
	}

	return nil
}

func (h *HistoryService) normalizeCanvasHistoryImages() error {
	if _, err := os.Stat(h.canvasFile); err != nil {
		return nil
	}

	data, err := os.ReadFile(h.canvasFile)
	if err != nil {
		return fmt.Errorf("failed to read canvas history file: %w", err)
	}

	var canvasData struct {
		Viewport ViewportRecord `json:"viewport"`
		Images   []ImageRecord  `json:"images"`
	}
	var history CanvasHistory
	if err := json.Unmarshal(data, &history); err == nil {
		canvasData.Viewport = history.Viewport
		canvasData.Images = history.Images
	} else if err := json.Unmarshal(data, &canvasData); err != nil {
		return nil
	}

	for i := range canvasData.Images {
		if canvasData.Images[i].Src == "" {
			continue
		}
		if strings.HasPrefix(canvasData.Images[i].Src, "data:") || strings.HasPrefix(canvasData.Images[i].Src, "images/") || strings.HasPrefix(canvasData.Images[i].Src, "/images/") {
			continue
		}
		fmt.Printf("[HistoryService] Warning: drop unsupported image for image %s\n", canvasData.Images[i].ID)
		canvasData.Images[i].Src = ""
	}

	if !needsCanvasImageNormalization(canvasData.Images) {
		return nil
	}

	canvasJSON, _ := json.Marshal(canvasData)
	if err := h.saveCanvasHistorySync(string(canvasJSON)); err != nil {
		return fmt.Errorf("failed to normalize canvas history images: %w", err)
	}

	return nil
}

func needsChatImageNormalization(messages []ChatRecord) bool {
	for _, msg := range messages {
		for _, img := range msg.Images {
			if img == "" {
				continue
			}
			if strings.HasPrefix(img, "images/") {
				continue
			}
			if strings.HasPrefix(img, "/images/") {
				return true
			}
			return true
		}
	}
	return false
}

func needsCanvasImageNormalization(images []ImageRecord) bool {
	for _, img := range images {
		if img.Src == "" {
			continue
		}
		if strings.HasPrefix(img.Src, "images/") {
			continue
		}
		if strings.HasPrefix(img.Src, "/images/") {
			return true
		}
		return true
	}
	return false
}
