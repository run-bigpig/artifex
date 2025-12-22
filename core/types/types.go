package types

// ==================== 应用设置结构 ====================

// Settings 应用设置结构
type Settings struct {
	Version string     `json:"version"`
	AI      AISettings `json:"ai"`
}

// AISettings AI 服务设置
type AISettings struct {
	Provider   string `json:"provider"`
	APIKey     string `json:"apiKey"` // 加密存储
	TextModel  string `json:"textModel"`
	ImageModel string `json:"imageModel"`

	// Vertex AI 配置
	UseVertexAI       bool   `json:"useVertexAI"`       // 是否使用 Vertex AI
	VertexProject     string `json:"vertexProject"`     // GCP 项目 ID
	VertexLocation    string `json:"vertexLocation"`    // GCP 区域（如 us-central1）
	VertexCredentials string `json:"vertexCredentials"` // GCP 服务账号 JSON（加密存储）

	// OpenAI 配置
	OpenAIAPIKey       string `json:"openaiApiKey"`      // 加密存储
	OpenAIImageAPIKey  string `json:"openaiImageApiKey"` // 加密存储
	OpenAIBaseURL      string `json:"openaiBaseUrl"`
	OpenAIImageBaseURL string `json:"openaiImageBaseUrl"`
	OpenAITextModel    string `json:"openaiTextModel"`
	OpenAIImageModel   string `json:"openaiImageModel"`

	// OpenAI 图像模式配置
	// "image_api" - 使用专用的 Image API（/v1/images/*），适用于 DALL-E 和 GPT Image 1
	// "chat"      - 使用 Chat Completion API，适用于第三方多模态 API（类似 Gemini）
	// "auto"      - 根据模型名称自动判断（默认）
	OpenAIImageMode string `json:"openaiImageMode"`

	// OpenAI 流式模式配置
	// 某些第三方 OpenAI 中继服务仅提供流式接口
	OpenAITextStream  bool `json:"openaiTextStream"`  // 文本/聊天模型是否使用流式请求（默认 false）
	OpenAIImageStream bool `json:"openaiImageStream"` // 图像模型是否使用流式请求（默认 false）

	// Cloud 云服务配置
	CloudEndpointURL string `json:"cloudEndpointUrl"` // 云服务端点 URL
	CloudToken       string `json:"cloudToken"`       // 云服务认证 Token（加密存储）
}

// OpenAI 图像模式常量
const (
	OpenAIImageModeAuto     = "auto"      // 自动判断（默认）
	OpenAIImageModeImageAPI = "image_api" // 使用专用 Image API
	OpenAIImageModeChat     = "chat"      // 使用 Chat Completion API
)

// ==================== AI 服务参数结构体 ====================

// GenerateImageParams 图像生成参数
type GenerateImageParams struct {
	Prompt         string `json:"prompt"`
	ReferenceImage string `json:"referenceImage,omitempty"` // base64 编码的参考图像
	SketchImage    string `json:"sketchImage,omitempty"`    // base64 编码的草图图像
	ImageSize      string `json:"imageSize"`                // "1K", "2K", "4K"
	AspectRatio    string `json:"aspectRatio"`              // "1:1", "16:9", "9:16", "3:4", "4:3"
}

// MultiImageEditParams 多图编辑参数
type MultiImageEditParams struct {
	Images      []string `json:"images"`                // base64 编码的图像数组（支持单图或多图）
	Prompt      string   `json:"prompt"`                // 编辑提示词
	ImageSize   string   `json:"imageSize,omitempty"`   // 图片尺寸，可选值："1K", "2K", "4K"（可选）
	AspectRatio string   `json:"aspectRatio,omitempty"` // 宽高比，可选值："1:1", "16:9", "9:16", "3:4", "4:3"（可选）
}

// EnhancePromptParams 增强提示词参数
type EnhancePromptParams struct {
	Prompt          string   `json:"prompt"`                    // 原始提示词
	ReferenceImages []string `json:"referenceImages,omitempty"` // base64 编码的参考图像数组（可选）
}
