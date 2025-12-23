package service

import (
	"artifex/core/provider"
	"artifex/core/types"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

// ==================== AIService 提供商管理器 ====================

// AIService AI 服务管理器
// 管理多个 AI 提供商，根据配置动态选择提供商
// 保持现有的公共接口签名不变，内部委托给具体提供商
type AIService struct {
	ctx           context.Context
	configService *ConfigService

	// 提供商管理
	providers map[string]provider.AIProvider
	mu        sync.RWMutex

	// Context 管理器，用于管理每个请求的 context
	contextManager *ContextManager
}

// NewAIService 创建 AI 服务实例
func NewAIService(configService *ConfigService) *AIService {
	return &AIService{
		configService: configService,
		providers:     make(map[string]provider.AIProvider),
	}
}

// Startup 在应用启动时调用
func (a *AIService) Startup(ctx context.Context) {
	a.ctx = ctx
	// 初始化 Context 管理器
	a.contextManager = NewContextManager(ctx)
	// 启动定期清理协程
	a.contextManager.StartCleanupRoutine()
}

// ==================== 提供商管理方法 ====================

// RegisterProvider 注册提供商
func (a *AIService) RegisterProvider(name string, provider provider.AIProvider) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.providers[name] = provider
}

// GetProvider 获取提供商
// 如果提供商不存在，会尝试根据配置创建
func (a *AIService) GetProvider(name string) (provider.AIProvider, error) {
	a.mu.RLock()
	aiProvider, ok := a.providers[name]
	a.mu.RUnlock()

	if ok {
		return aiProvider, nil
	}

	// 提供商不存在，尝试创建
	return a.createProvider(name)
}

// GetProviderCapabilities 获取提供商能力
func (a *AIService) GetProviderCapabilities(providerName string) (*provider.ProviderCapabilities, error) {
	aiProvider, err := a.GetProvider(providerName)
	if err != nil {
		return nil, err
	}
	caps := aiProvider.GetCapabilities()
	return &caps, nil
}

// CheckProviderAvailability 检测提供商可用性
func (a *AIService) CheckProviderAvailability(providerName string) (bool, string, error) {
	aiProvider, err := a.GetProvider(providerName)
	if err != nil {
		return false, "", fmt.Errorf("failed to get provider: %w", err)
	}

	available, err := aiProvider.CheckAvailability(a.ctx)
	if err != nil {
		return false, err.Error(), nil
	}

	if !available {
		return false, "服务不可用", nil
	}

	return true, "", nil
}

// createProvider 创建提供商（内部方法）
func (a *AIService) createProvider(name string) (provider.AIProvider, error) {
	// 加载配置
	aiSettings, err := a.loadAISettings()
	if err != nil {
		return nil, err
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	// 双重检查，避免并发创建
	if aiProvider, ok := a.providers[name]; ok {
		return aiProvider, nil
	}

	var aiProvider provider.AIProvider

	switch name {
	case "gemini":
		aiProvider, err = provider.NewGeminiProvider(a.ctx, aiSettings)
	case "openai":
		aiProvider, err = provider.NewOpenAIProvider(a.ctx, aiSettings)
	case "cloud":
		aiProvider, err = provider.NewCloudProvider(a.ctx, aiSettings)
	default:
		return nil, fmt.Errorf("unsupported AI provider: %s", name)
	}

	if err != nil {
		return nil, err
	}

	a.providers[name] = aiProvider
	return aiProvider, nil
}

// loadAISettings 加载 AI 配置（内部方法）
func (a *AIService) loadAISettings() (types.AISettings, error) {
	settingsJSON, err := a.configService.LoadSettings()
	if err != nil {
		return types.AISettings{}, fmt.Errorf("failed to load settings: %w", err)
	}

	var settings types.Settings
	if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
		return types.AISettings{}, fmt.Errorf("failed to parse settings: %w", err)
	}

	return settings.AI, nil
}

// getCurrentProvider 获取当前配置的提供商（内部方法）
func (a *AIService) getCurrentProvider() (provider.AIProvider, error) {
	aiSettings, err := a.loadAISettings()
	if err != nil {
		return nil, err
	}
	return a.GetProvider(aiSettings.Provider)
}

// ReloadProviders 重新加载所有提供商（配置变更时调用）
// 关闭现有提供商并清除缓存，下次调用时会使用新配置重新创建
func (a *AIService) ReloadProviders() error {
	a.mu.Lock()
	defer a.mu.Unlock()

	fmt.Printf("[AIService] Reloading providers due to configuration change\n")

	var lastErr error
	for name, aiProvider := range a.providers {
		if err := aiProvider.Close(); err != nil {
			lastErr = fmt.Errorf("failed to close provider %s: %w", name, err)
			fmt.Printf("[AIService] Error closing provider %s: %v\n", name, err)
		}
	}

	// 清除缓存
	a.providers = make(map[string]provider.AIProvider)

	return lastErr
}

// Close 关闭所有提供商，释放资源
func (a *AIService) Close() error {
	return a.ReloadProviders()
}

// ==================== 公共 API 方法 ====================

// GenerateImage 生成图像
// 返回 base64 编码的图像数据
// requestID: 请求 ID，用于管理 context 和取消请求
func (a *AIService) GenerateImage(paramsJSON string, requestID string) (string, error) {
	var params types.GenerateImageParams
	if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
		return "", fmt.Errorf("invalid parameters: %w", err)
	}

	// 为请求创建独立的 context
	reqCtx, err := a.contextManager.CreateRequestContext(requestID)
	if err != nil {
		return "", fmt.Errorf("failed to create request context: %w", err)
	}
	// 请求完成后清理 context
	defer a.contextManager.CleanupRequest(requestID)

	// 获取当前提供商
	aiProvider, err := a.getCurrentProvider()
	if err != nil {
		return "", err
	}

	// 检查功能支持
	caps := aiProvider.GetCapabilities()
	if !caps.GenerateImage {
		return "", fmt.Errorf("aiProvider %s does not support image generation", aiProvider.Name())
	}

	// 如果有参考图像，检查是否支持
	if params.ReferenceImage != "" && !caps.ReferenceImage {
		return "", fmt.Errorf("aiProvider %s does not support reference image", aiProvider.Name())
	}

	// 委托给提供商，使用请求的 context
	return aiProvider.GenerateImage(reqCtx, params)
}

// rewritePromptIfNeeded 检测提示词并重写（支持变清晰和扩图）
// 如果提示词包含相关关键词，则返回重写后的提示词；否则返回原提示词
func rewritePromptIfNeeded(prompt string) string {
	// 转换为小写以便进行不区分大小写的匹配
	lowerPrompt := strings.ToLower(prompt)

	// 定义变清晰关键词列表
	enhanceKeywords := []string{
		"变清晰",
		"清晰",
		"upscale",
		"enhance",
		"sharpen",
		"提高清晰度",
		"增强清晰度",
		"超分辨率",
		"super resolution",
		"放大",
		"enlarge",
	}

	// 定义扩图关键词列表
	expandKeywords := []string{
		"扩图",
		"扩展",
		"expand",
		"outpaint",
		"outpainting",
		"extend",
		"extend image",
		"extend canvas",
		"画布扩展",
		"图片扩展",
	}

	// 检查是否包含变清晰关键词
	for _, keyword := range enhanceKeywords {
		if strings.Contains(lowerPrompt, strings.ToLower(keyword)) {
			// 追加 upscale 提示
			upscalePrompt := "High-quality upscale and remaster of the original source image. Apply strong deblurring and denoising functions to achieve pristine clarity. Focus on sharpening edges and enhancing the definition of textures and structural details. Restore intricate fine details appropriate to the subject matter (e.g., skin texture in portraits, foliage in landscapes, brushstrokes in artwork). Ensure the image is clean with no grain or JPEG artifacts, strictly preserving the integrity of the original visual style (photographic, painterly, or rendered), rendered in extremely clear 4K resolution"
			return upscalePrompt
		}
	}

	// 检查是否包含扩图关键词
	for _, keyword := range expandKeywords {
		if strings.Contains(lowerPrompt, strings.ToLower(keyword)) {
			// 扩图提示词重写：强调扩展画布并保持原图内容
			expandPrompt := "Perform universal image outpainting. Ignore the surrounding white borders, treating them as blank areas to be filled. Automatically analyze and match the visual style, texture, grain, and lighting conditions of the core image. Whether photorealistic, digital painting, or artistic, strictly maintain consistency with the source. Seamlessly extend the background and environment outwards, ensuring the newly generated parts blend perfectly with the original, with no visible seams or style mismatch."
			return expandPrompt
		}
	}

	// 没有匹配的关键词，返回原提示词
	return prompt
}

// EditMultiImages 编辑图像（支持单图或多图）
// 统一使用多图编辑方法，即使只有一张图也使用此方法
// requestID: 请求 ID，用于管理 context 和取消请求
func (a *AIService) EditMultiImages(paramsJSON string, requestID string) (string, error) {
	var params types.MultiImageEditParams
	if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
		return "", fmt.Errorf("invalid parameters: %w", err)
	}

	// 验证图片数量
	if len(params.Images) < 1 {
		return "", fmt.Errorf("at least 1 image is required")
	}

	// 为请求创建独立的 context
	reqCtx, err := a.contextManager.CreateRequestContext(requestID)
	if err != nil {
		return "", fmt.Errorf("failed to create request context: %w", err)
	}
	// 请求完成后清理 context
	defer a.contextManager.CleanupRequest(requestID)

	// 获取当前提供商
	aiProvider, err := a.getCurrentProvider()
	if err != nil {
		return "", err
	}

	// 检查功能支持
	caps := aiProvider.GetCapabilities()
	if !caps.EditImage {
		return "", fmt.Errorf("aiProvider %s does not support image editing", aiProvider.Name())
	}

	// 检测提示词并重写（支持变清晰和扩图）
	params.Prompt = rewritePromptIfNeeded(params.Prompt)

	// 使用多图编辑方法，使用请求的 context
	return aiProvider.EditMultiImages(reqCtx, params)
}

// RemoveBackground 移除背景
// requestID: 请求 ID，用于管理 context 和取消请求
func (a *AIService) RemoveBackground(imageData string, requestID string) (string, error) {
	// 为请求创建独立的 context
	reqCtx, err := a.contextManager.CreateRequestContext(requestID)
	if err != nil {
		return "", fmt.Errorf("failed to create request context: %w", err)
	}
	// 请求完成后清理 context
	defer a.contextManager.CleanupRequest(requestID)

	// 获取当前提供商
	aiProvider, err := a.getCurrentProvider()
	if err != nil {
		return "", err
	}

	// 检查功能支持
	caps := aiProvider.GetCapabilities()
	if !caps.RemoveBackground {
		return "", fmt.Errorf("aiProvider %s does not support background removal", aiProvider.Name())
	}

	// 使用多图编辑功能实现背景移除
	multiParams := types.MultiImageEditParams{
		Images: []string{imageData},
		Prompt: "Remove the background from this image. Keep the main subject intact with high quality. Return the image with transparent background.",
	}

	return aiProvider.EditMultiImages(reqCtx, multiParams)
}

// EnhancePrompt 增强提示词
// paramsJSON: JSON 格式的 EnhancePromptParams，包含 prompt 和可选的 referenceImages
// requestID: 请求 ID，用于管理 context 和取消请求
func (a *AIService) EnhancePrompt(paramsJSON string, requestID string) (string, error) {
	var params types.EnhancePromptParams
	if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
		return "", fmt.Errorf("invalid parameters: %w", err)
	}

	// 为请求创建独立的 context
	reqCtx, err := a.contextManager.CreateRequestContext(requestID)
	if err != nil {
		return "", fmt.Errorf("failed to create request context: %w", err)
	}
	// 请求完成后清理 context
	defer a.contextManager.CleanupRequest(requestID)

	// 获取当前提供商
	aiProvider, err := a.getCurrentProvider()
	if err != nil {
		return "", err
	}

	// 检查功能支持
	caps := aiProvider.GetCapabilities()
	if !caps.EnhancePrompt {
		return "", fmt.Errorf("aiProvider %s does not support prompt enhancement", aiProvider.Name())
	}

	// 如果有参考图像，检查是否支持
	if len(params.ReferenceImages) > 0 && !caps.ReferenceImage {
		return "", fmt.Errorf("aiProvider %s does not support reference images for prompt enhancement", aiProvider.Name())
	}

	// 委托给提供商，使用请求的 context
	return aiProvider.EnhancePrompt(reqCtx, params)
}

// CancelRequest 取消指定请求
func (a *AIService) CancelRequest(requestID string) error {
	if a.contextManager == nil {
		return fmt.Errorf("context manager not initialized")
	}
	return a.contextManager.CancelRequest(requestID)
}
