package types

import (
	"fmt"
	"strings"
)

// ==================== 应用设置结构 ====================

// Settings 应用设置结构
type Settings struct {
	Version string     `json:"version"`
	AI      AISettings `json:"ai"`
}

// AISettings AI 服务设置
type ModelDefinition struct {
	ModelID  string `json:"modelId"`
	Modality string `json:"modality"` // image or vision
	Name     string `json:"name"`
	Enabled  bool   `json:"enabled"`
}

type AISettings struct {
	Providers         []ProviderConfig `json:"providers"`
	DefaultProviderID string           `json:"defaultProviderId"`
	// Legacy fields are read only for migration and adapter construction.
	OpenAIModels []ModelDefinition `json:"openaiModels,omitempty"`
	Provider     string            `json:"provider,omitempty"`
	APIKey       string            `json:"apiKey,omitempty"` // 加密存储
	TextModel    string            `json:"textModel,omitempty"`
	ImageModel   string            `json:"imageModel,omitempty"`

	GeminiModels  []ModelDefinition `json:"geminiModels,omitempty"`
	GeminiBaseURL string            `json:"geminiBaseUrl,omitempty"`

	// OpenAI 配置
	OpenAIAPIKey            string `json:"openaiApiKey,omitempty"`      // 加密存储
	OpenAIImageAPIKey       string `json:"openaiImageApiKey,omitempty"` // 仅用于旧配置迁移
	OpenAIBaseURL           string `json:"openaiBaseUrl,omitempty"`
	OpenAIImageBaseURL      string `json:"openaiImageBaseUrl,omitempty"`
	OpenAITextModel         string `json:"openaiTextModel,omitempty"`
	OpenAIImageModel        string `json:"openaiImageModel,omitempty"`
	OpenAIImageToolModel    string `json:"openaiImageToolModel,omitempty"`
	OpenAIImageQuality      string `json:"openaiImageQuality,omitempty"`
	OpenAIImageBackground   string `json:"openaiImageBackground,omitempty"`
	OpenAIImageOutputFormat string `json:"openaiImageOutputFormat,omitempty"`
	OpenAIImageCompression  *int64 `json:"openaiImageCompression,omitempty"`
	OpenAIConfigVersion     int    `json:"openaiConfigVersion,omitempty"`
}

// ==================== AI 服务参数结构体 ====================

// GenerateImageParams 图像生成参数
type GenerateImageParams struct {
	Provider       string `json:"provider,omitempty"`
	Model          string `json:"model,omitempty"`
	ImageToolModel string `json:"imageToolModel,omitempty"`
	Prompt         string `json:"prompt"`
	ReferenceImage string `json:"referenceImage,omitempty"` // base64 编码的参考图像
	SketchImage    string `json:"sketchImage,omitempty"`    // base64 编码的草图图像
	ImageSize      string `json:"imageSize"`                // "1K", "2K", "4K"
	AspectRatio    string `json:"aspectRatio"`              // "1:1", "16:9", "9:16", "3:4", "4:3"
	ThinkingLevel  string `json:"thinkingLevel,omitempty"`  // 思考强度：low、medium、high
}

// MultiImageEditParams 多图编辑参数
type MultiImageEditParams struct {
	Provider       string   `json:"provider,omitempty"`
	Model          string   `json:"model,omitempty"`
	ImageToolModel string   `json:"imageToolModel,omitempty"`
	Operation      string   `json:"operation,omitempty"`
	MaskImage      string   `json:"maskImage,omitempty"`
	OutputSize     string   `json:"outputSize,omitempty"`
	Images         []string `json:"images"`                  // base64 编码的图像数组（支持单图或多图）
	Prompt         string   `json:"prompt"`                  // 编辑提示词
	ImageSize      string   `json:"imageSize,omitempty"`     // 图片尺寸，可选值："1K", "2K", "4K"（可选）
	AspectRatio    string   `json:"aspectRatio,omitempty"`   // 宽高比，可选值："1:1", "16:9", "9:16", "3:4", "4:3"（可选）
	ThinkingLevel  string   `json:"thinkingLevel,omitempty"` // 思考强度：low、medium、high
}

type IntentRecognitionParams struct {
	Provider        string   `json:"provider,omitempty"`
	Model           string   `json:"model,omitempty"`
	Message         string   `json:"message"`
	ReferenceImages []string `json:"referenceImages,omitempty"`
}

type IntentOption struct {
	Title       string `json:"title"`
	Prompt      string `json:"prompt"`
	Description string `json:"description"`
}

type IntentRecognitionResponse struct {
	Intents []IntentOption `json:"intents"`
}

// NormalizeOpenAISettings migrates the former separate image connection to a single
// connection. Explicit model choices are retained; only missing values get defaults.
func NormalizeOpenAISettings(s AISettings) AISettings {
	if s.Provider == "cloud" {
		s.Provider = "openai"
	}
	if s.OpenAIConfigVersion < 2 {
		if s.OpenAIImageAPIKey != "" {
			s.OpenAIAPIKey = s.OpenAIImageAPIKey
		}
		if s.OpenAIImageBaseURL != "" {
			s.OpenAIBaseURL = s.OpenAIImageBaseURL
		}
	}
	s.OpenAIConfigVersion = 2
	s.OpenAIImageAPIKey = ""
	s.OpenAIImageBaseURL = ""
	if s.OpenAITextModel == "" {
		s.OpenAITextModel = "gpt-6.1-sol"
	}
	if s.OpenAIImageModel == "" {
		s.OpenAIImageModel = "gpt-image-2.5-sunburst"
	}
	if s.OpenAIImageToolModel == "" {
		s.OpenAIImageToolModel = "gpt-image-2.5-sunburst"
	}
	if s.OpenAIImageQuality == "" {
		s.OpenAIImageQuality = "auto"
	}
	if s.OpenAIImageBackground == "" {
		s.OpenAIImageBackground = "auto"
	}
	if s.OpenAIImageOutputFormat == "" {
		s.OpenAIImageOutputFormat = "png"
	}
	if s.OpenAIModels == nil {
		kind := "image"
		if !strings.Contains(s.OpenAIImageModel, "image") && !strings.Contains(s.OpenAIImageModel, "dall") {
			kind = "vision"
		}
		s.OpenAIModels = []ModelDefinition{{ModelID: s.OpenAIImageModel, Modality: kind, Enabled: true}}
		if s.OpenAITextModel != s.OpenAIImageModel {
			s.OpenAIModels = append(s.OpenAIModels, ModelDefinition{ModelID: s.OpenAITextModel, Modality: "vision", Enabled: true})
		}
		found := false
		for _, m := range s.OpenAIModels {
			if m.ModelID == s.OpenAIImageToolModel {
				found = true
			}
		}
		if !found {
			s.OpenAIModels = append(s.OpenAIModels, ModelDefinition{ModelID: s.OpenAIImageToolModel, Modality: "image", Enabled: true})
		}
	}
	return s
}

func ValidateModelDefinitions(models []ModelDefinition) error {
	seen := map[string]bool{}
	for _, m := range models {
		if strings.TrimSpace(m.ModelID) == "" || m.ModelID != strings.TrimSpace(m.ModelID) {
			return fmt.Errorf("模型 ID 不能为空或包含首尾空格")
		}
		if seen[m.ModelID] {
			return fmt.Errorf("模型 ID 重复: %s", m.ModelID)
		}
		seen[m.ModelID] = true
		if m.Modality != "image" && m.Modality != "vision" {
			return fmt.Errorf("无效的模型类别: %s", m.Modality)
		}
	}
	return nil
}

func NormalizeGeminiSettings(s AISettings) AISettings {
	if s.TextModel == "" {
		s.TextModel = "gemini-2.5-flash"
	}
	if s.ImageModel == "" {
		s.ImageModel = "gemini-3.1-flash-image"
	}
	if s.GeminiModels == nil {
		s.GeminiModels = []ModelDefinition{{ModelID: s.ImageModel, Modality: "image", Enabled: true}}
		if s.TextModel != s.ImageModel {
			s.GeminiModels = append(s.GeminiModels, ModelDefinition{ModelID: s.TextModel, Modality: "vision", Enabled: true})
		}
	}
	return s
}
