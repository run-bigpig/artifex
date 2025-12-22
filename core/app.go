package core

import (
	"context"
	"encoding/json"
	"fmt"
	"artifex/core/service"
)

// App struct - 主应用结构
type App struct {
	ctx             context.Context
	fileService     *service.FileService
	configService   *service.ConfigService
	aiService       *service.AIService
	updateService   *service.UpdateService
	historyService  *service.HistoryService
}

// NewApp creates a new App application struct
func NewApp() *App {
	// 创建服务实例
	configService := service.NewConfigService()
	fileService := service.NewFileService()
	aiService := service.NewAIService(configService)
	historyService := service.NewHistoryService()

	// 创建更新服务
	updateService := service.NewUpdateService(RepoOwner, RepoName, Version)

	return &App{
		fileService:     fileService,
		configService:   configService,
		aiService:       aiService,
		updateService:   updateService,
		historyService:  historyService,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	// 初始化各个服务
	a.fileService.Startup(ctx)
	if err := a.configService.Startup(ctx); err != nil {
		fmt.Printf("Failed to initialize config service: %v\n", err)
	}
	if err := a.historyService.Startup(ctx); err != nil {
		fmt.Printf("Failed to initialize history service: %v\n", err)
	}
	a.aiService.Startup(ctx)
	a.updateService.Startup(ctx)
}

// Shutdown 在应用关闭时调用，优雅地停止各个服务
func (a *App) Shutdown(ctx context.Context) {
	// 停止历史记录服务的后台 goroutine，确保所有待保存的数据都被写入
	if err := a.historyService.Shutdown(); err != nil {
		fmt.Printf("Failed to shutdown history service: %v\n", err)
	}
}

// ===== 文件管理服务方法 =====

// ExportImage 导出图像
// imageDataURL: base64 编码的图像数据
// suggestedName: 建议的文件名
// format: 导出格式 ("png", "jpeg", "webp")，如果为空则从文件名推断
// exportDir: 导出目录（可选），如果为空则显示文件保存对话框
func (a *App) ExportImage(imageDataURL string, suggestedName string, format string, exportDir string) (string, error) {
	return a.fileService.ExportImage(imageDataURL, suggestedName, format, exportDir)
}

// ExportSliceImages 批量导出切片图像
func (a *App) ExportSliceImages(slicesJSON string) (string, error) {
	return a.fileService.ExportSliceImages(slicesJSON)
}

// ===== 配置管理服务方法 =====

// SaveSettings 保存设置
func (a *App) SaveSettings(settingsJSON string) error {
	if err := a.configService.SaveSettings(settingsJSON); err != nil {
		return err
	}

	// 配置变更后，重新加载 AI 提供商以应用新配置
	if err := a.aiService.ReloadProviders(); err != nil {
		fmt.Printf("[App] Warning: failed to reload AI providers: %v\n", err)
		// 不返回错误，因为配置已成功保存
	}

	return nil
}

// LoadSettings 加载设置
func (a *App) LoadSettings() (string, error) {
	return a.configService.LoadSettings()
}

// ===== AI 服务方法 =====

// GenerateImage 生成图像
func (a *App) GenerateImage(paramsJSON string) (string, error) {
	return a.aiService.GenerateImage(paramsJSON)
}

// EditMultiImages 编辑图像（支持单图或多图）
// 统一使用多图编辑方法，即使只有一张图也使用此方法
func (a *App) EditMultiImages(paramsJSON string) (string, error) {
	return a.aiService.EditMultiImages(paramsJSON)
}

// RemoveBackground 移除背景
func (a *App) RemoveBackground(imageData string) (string, error) {
	return a.aiService.RemoveBackground(imageData)
}


// EnhancePrompt 增强提示词
// paramsJSON: JSON 格式的 EnhancePromptParams，包含 prompt 和可选的 referenceImages
func (a *App) EnhancePrompt(paramsJSON string) (string, error) {
	return a.aiService.EnhancePrompt(paramsJSON)
}

// CheckAIProviderAvailability 检测 AI 提供商可用性
// 返回 JSON 格式：{"available": bool, "message": string}
func (a *App) CheckAIProviderAvailability(providerName string) (string, error) {
	available, message, err := a.aiService.CheckProviderAvailability(providerName)
	if err != nil {
		return "", err
	}

	result := map[string]interface{}{
		"available": available,
		"message":   message,
	}

	data, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("failed to serialize result: %w", err)
	}

	return string(data), nil
}

// ===== 更新服务方法 =====

// CheckForUpdate 检查是否有可用更新
// 返回 JSON 格式：{"hasUpdate": bool, "latestVersion": string, "currentVersion": string, "releaseUrl": string, "releaseNotes": string, "error": string}
func (a *App) CheckForUpdate() (string, error) {
	return a.updateService.CheckForUpdateJSON()
}

// GetCurrentVersion 获取当前版本号
func (a *App) GetCurrentVersion() string {
	return a.updateService.GetCurrentVersion()
}

// ===== 历史记录服务方法 =====

// LoadChatHistory 加载聊天历史记录
// 返回 JSON 格式的聊天记录数组
func (a *App) LoadChatHistory() (string, error) {
	return a.historyService.LoadChatHistory()
}

// ClearChatHistory 清除聊天历史记录
func (a *App) ClearChatHistory() error {
	return a.historyService.ClearChatHistory()
}

// LoadCanvasHistory 加载画布历史记录
// 返回 JSON 格式的画布记录，包含 viewport 和 images
func (a *App) LoadCanvasHistory() (string, error) {
	return a.historyService.LoadCanvasHistory()
}

// ClearCanvasHistory 清除画布历史记录
func (a *App) ClearCanvasHistory() error {
	return a.historyService.ClearCanvasHistory()
}

// Update 执行程序内更新（下载并替换当前可执行文件）
// 返回错误信息字符串，如果成功则返回空字符串
func (a *App) Update() (string, error) {
	if err := a.updateService.Update(); err != nil {
		return "", fmt.Errorf("更新失败: %w", err)
	}
	return "", nil
}

// UpdateWithProgress 执行更新并返回进度信息（JSON格式）
// 返回 JSON 格式的 UpdateProgress
func (a *App) UpdateWithProgress() (string, error) {
	return a.updateService.UpdateWithProgress()
}