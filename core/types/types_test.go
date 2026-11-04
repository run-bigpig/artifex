package types

import "testing"

func TestOpenAISettingsMigration(t *testing.T) {
	s := NormalizeOpenAISettings(AISettings{Provider: "cloud", OpenAIAPIKey: "general", OpenAIImageAPIKey: "image", OpenAIBaseURL: "https://text.example/v1", OpenAIImageBaseURL: "https://image.example/v1", OpenAIImageModel: "gpt-image-2.5-flare", OpenAITextModel: "gpt-6.1-sol"})
	if s.Provider != "openai" || s.OpenAIAPIKey != "image" || s.OpenAIBaseURL != "https://image.example/v1" || s.OpenAIImageAPIKey != "" || s.OpenAIImageBaseURL != "" {
		t.Fatalf("migration failed: %#v", s)
	}
	if s.OpenAIModels[0].ModelID != "gpt-image-2.5-flare" || s.OpenAIModels[0].Modality != "image" || s.OpenAIModels[1].Modality != "vision" {
		t.Fatalf("model migration failed: %#v", s.OpenAIModels)
	}
	if err := ValidateModelDefinitions(s.OpenAIModels); err != nil {
		t.Fatal(err)
	}
	s.OpenAIImageAPIKey = "stale"
	if NormalizeOpenAISettings(s).OpenAIAPIKey != "image" {
		t.Fatal("obsolete key overrode unified connection")
	}
}
func TestDeletedModelsAreNotRecreated(t *testing.T) {
	s := NormalizeOpenAISettings(AISettings{OpenAIConfigVersion: 2, OpenAIModels: []ModelDefinition{}})
	if len(s.OpenAIModels) != 0 {
		t.Fatal("deleted models recreated")
	}
}
func TestDuplicateModelsRejected(t *testing.T) {
	s := AISettings{OpenAIModels: []ModelDefinition{{ModelID: "same", Modality: "image"}, {ModelID: "same", Modality: "vision"}}}
	if ValidateModelDefinitions(s.OpenAIModels) == nil {
		t.Fatal("duplicate model IDs accepted")
	}
}
