package provider

import (
	"artifex/core/types"
	"context"
)

// ==================== AI 功能枚举 ====================

// AIFeature AI 功能类型
type AIFeature string

const (
	// FeatureGenerateImage 图像生成功能
	FeatureGenerateImage AIFeature = "generateImage"
	// FeatureEditImage 图像编辑功能
	FeatureEditImage AIFeature = "editImage"
	// FeatureRemoveBackground 背景移除功能
	FeatureRemoveBackground AIFeature = "removeBackground"
	// FeatureReferenceImage 参考图像功能
	FeatureReferenceImage AIFeature = "referenceImage"
)

// ==================== 提供商能力声明 ====================

// ProviderCapabilities 提供商能力声明
// 用于声明 AI 提供商支持的功能
type ProviderCapabilities struct {
	// GenerateImage 是否支持图像生成
	GenerateImage bool `json:"generateImage"`
	// EditImage 是否支持图像编辑
	EditImage bool `json:"editImage"`
	// RemoveBackground 是否支持背景移除
	RemoveBackground bool `json:"removeBackground"`
	// ReferenceImage 是否支持参考图像
	ReferenceImage bool `json:"referenceImage"`
}

// IsSupported 检查指定功能是否支持
func (c ProviderCapabilities) IsSupported(feature AIFeature) bool {
	switch feature {
	case FeatureGenerateImage:
		return c.GenerateImage
	case FeatureEditImage:
		return c.EditImage
	case FeatureRemoveBackground:
		return c.RemoveBackground
	case FeatureReferenceImage:
		return c.ReferenceImage
	default:
		return false
	}
}

// ==================== AI 提供商接口 ====================

// AIProvider AI 提供商接口
// 所有 AI 提供商（Gemini、OpenAI 等）都需要实现此接口
type AIProvider interface {
	// Name 返回提供商名称
	Name() string

	// GenerateImage 生成图像
	// 参数：
	//   - ctx: 上下文
	//   - params: 图像生成参数
	// 返回：
	//   - base64 编码的图像数据（含 data URI 前缀）
	//   - 错误信息
	GenerateImage(ctx context.Context, params types.GenerateImageParams) (string, error)

	// EditMultiImages 多图编辑/融合
	// 参数：
	//   - ctx: 上下文
	//   - params: 多图编辑参数（支持单图或多图，单图时也使用此方法）
	// 返回：
	//   - base64 编码的图像数据（含 data URI 前缀）
	//   - 错误信息
	EditMultiImages(ctx context.Context, params types.MultiImageEditParams) (string, error)

	// GetCapabilities 返回提供商支持的功能
	GetCapabilities() ProviderCapabilities

	// CheckAvailability 检测服务可用性
	// 参数：
	//   - ctx: 上下文
	// 返回：
	//   - 是否可用
	//   - 错误信息（如果不可用）
	CheckAvailability(ctx context.Context) (bool, error)

	// Close 清理资源
	// 在提供商不再使用时调用，用于释放连接、清理缓存等
	Close() error
}

// IntentRecognizer 是支持当前输入框多模态意图识别的可选提供商接口。
type IntentRecognizer interface {
	RecognizeIntent(ctx context.Context, params types.IntentRecognitionParams) (string, error)
}
