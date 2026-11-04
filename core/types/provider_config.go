package types

import (
	"fmt"
	"regexp"
	"strings"
)

// ProviderConfig is a user-created connection. Type selects an adapter, while ID
// identifies this particular connection (including when model IDs are identical).
type ProviderConfig struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Type              string            `json:"type"`
	Enabled           bool              `json:"enabled"`
	BaseURL           string            `json:"baseUrl"`
	APIKey            string            `json:"apiKey"`
	Models            []ModelDefinition `json:"models"`
	ImageModel        string            `json:"imageModel"`
	IntentModel       string            `json:"intentModel"`
	ImageToolModel    string            `json:"imageToolModel,omitempty"`
	ImageQuality      string            `json:"imageQuality,omitempty"`
	ImageBackground   string            `json:"imageBackground,omitempty"`
	ImageOutputFormat string            `json:"imageOutputFormat,omitempty"`
	ImageCompression  *int64            `json:"imageCompression,omitempty"`
}

func (p ProviderConfig) AdapterSettings() AISettings {
	models := p.Models
	if models == nil {
		models = []ModelDefinition{}
	}
	if p.Type == "gemini" {
		return AISettings{APIKey: p.APIKey, GeminiBaseURL: p.BaseURL, GeminiModels: models, ImageModel: p.ImageModel, TextModel: p.IntentModel}
	}
	return AISettings{OpenAIConfigVersion: 2, OpenAIAPIKey: p.APIKey, OpenAIBaseURL: p.BaseURL, OpenAIModels: models, OpenAIImageModel: p.ImageModel, OpenAITextModel: p.IntentModel, OpenAIImageToolModel: p.ImageToolModel, OpenAIImageQuality: p.ImageQuality, OpenAIImageBackground: p.ImageBackground, OpenAIImageOutputFormat: p.ImageOutputFormat, OpenAIImageCompression: p.ImageCompression}
}

// Reading migrates in memory only. An explicitly empty catalog remains empty.
// Stable legacy IDs also preserve previously saved per-request choices.
func NormalizeAISettings(s AISettings) AISettings {
	if s.Providers != nil {
		return AISettings{Providers: s.Providers, DefaultProviderID: s.DefaultProviderID}
	}
	old := NormalizeGeminiSettings(NormalizeOpenAISettings(s))
	providers := []ProviderConfig{
		{ID: "openai", Name: "OpenAI", Type: "openai", Enabled: true, BaseURL: old.OpenAIBaseURL, APIKey: old.OpenAIAPIKey, Models: old.OpenAIModels, ImageModel: old.OpenAIImageModel, IntentModel: old.OpenAITextModel, ImageToolModel: old.OpenAIImageToolModel, ImageQuality: old.OpenAIImageQuality, ImageBackground: old.OpenAIImageBackground, ImageOutputFormat: old.OpenAIImageOutputFormat, ImageCompression: old.OpenAIImageCompression},
		{ID: "gemini", Name: "Gemini", Type: "gemini", Enabled: true, BaseURL: old.GeminiBaseURL, APIKey: old.APIKey, Models: old.GeminiModels, ImageModel: old.ImageModel, IntentModel: old.TextModel},
	}
	defaultID := old.Provider
	if defaultID != "openai" && defaultID != "gemini" {
		defaultID = "gemini"
	}
	return AISettings{Providers: providers, DefaultProviderID: defaultID}
}

var providerIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

func ValidateProviderConfigs(s AISettings) error {
	seen := map[string]bool{}
	for _, p := range s.Providers {
		if !providerIDPattern.MatchString(p.ID) || seen[p.ID] {
			return fmt.Errorf("服务商 ID 无效或重复: %s", p.ID)
		}
		seen[p.ID] = true
		if strings.TrimSpace(p.Name) == "" {
			return fmt.Errorf("服务商名称不能为空")
		}
		if p.Type != "openai" && p.Type != "gemini" {
			return fmt.Errorf("服务商 %s 的类型无效", p.Name)
		}
		if err := ValidateModelDefinitions(p.Models); err != nil {
			return fmt.Errorf("%s: %w", p.Name, err)
		}
		if p.ImageCompression != nil && (*p.ImageCompression < 0 || *p.ImageCompression > 100) {
			return fmt.Errorf("%s: 压缩质量必须为 0–100", p.Name)
		}
	}
	if s.DefaultProviderID != "" && !seen[s.DefaultProviderID] {
		return fmt.Errorf("默认服务商不存在，请重新选择")
	}
	return nil
}
