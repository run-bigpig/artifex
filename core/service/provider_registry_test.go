package service

import (
	"artifex/core/types"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenAIEditJSONResultStored(t *testing.T) {
	const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNl8AAAAASUVORK5CYII="
	want, _ := base64.StdEncoding.DecodeString(b64)
	for _, useURL := range []bool{false, true} {
		t.Run(fmt.Sprintf("url=%t", useURL), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/result.png" {
					w.Header().Set("Content-Type", "image/png")
					w.Write(want)
					return
				}
				calls++
				if r.URL.Path != "/v1/images/edits" {
					t.Errorf("unexpected route %s", r.URL.Path)
				}
				if err := r.ParseMultipartForm(2 << 20); err != nil {
					t.Error(err)
					return
				}
				defer r.MultipartForm.RemoveAll()
				if r.FormValue("stream") != "" || r.FormValue("partial_images") != "" {
					t.Error("obsolete stream configuration reached API")
				}
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				if useURL {
					fmt.Fprintf(w, `{"data":[{"url":%q}]}`, "http://"+r.Host+"/result.png")
				} else {
					fmt.Fprintf(w, `{"data":[{"b64_json":%q}]}`, b64)
				}
			}))
			defer server.Close()
			c := registryConfig(t)
			connection := registryConnection("edit", "test-key", server.URL)
			saveRegistry(t, c, types.Settings{AI: types.AISettings{DefaultProviderID: "edit", Providers: []types.ProviderConfig{connection}}})
			// Reproduce a previously saved provider with both removed switches on.
			raw, err := os.ReadFile(c.configFile)
			if err != nil {
				t.Fatal(err)
			}
			raw = bytes.ReplaceAll(raw, []byte(`"imageModel":`), []byte(`"imageStream":true,"textStream":true,"imageModel":`))
			if err := os.WriteFile(c.configFile, raw, 0600); err != nil {
				t.Fatal(err)
			}
			a := NewAIService(c)
			a.ctx = context.Background()
			a.contextManager = NewContextManager(a.ctx)
			a.imageStorage = NewImageStorage(t.TempDir())
			if err := a.imageStorage.Initialize(); err != nil {
				t.Fatal(err)
			}
			defer a.Close()
			params := fmt.Sprintf(`{"images":["data:image/png;base64,%s"],"prompt":"edit"}`, b64)
			ref, err := a.EditMultiImages(params, "edit-request")
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(ref, "images/") {
				t.Fatalf("not persisted: %s", ref)
			}
			stored, err := a.imageStorage.LoadImage(ref)
			if err != nil || stored != "data:image/png;base64,"+b64 {
				t.Fatalf("saved image mismatch: %v", err)
			}
			if calls != 1 {
				t.Fatalf("edit submitted %d times", calls)
			}
		})
	}
}

func TestImageStorageFailureIdentifiesPostProcessing(t *testing.T) {
	a := NewAIService(nil)
	a.imageStorage = NewImageStorage(filepath.Join(t.TempDir(), "missing"))
	_, err := a.storeImageResult("data:image/png;base64,aGVsbG8=")
	if err == nil || !strings.Contains(err.Error(), "已收到模型图片，但下载或保存失败") {
		t.Fatalf("missing storage error context: %v", err)
	}
}

func registryConfig(t *testing.T) *ConfigService {
	t.Helper()
	return &ConfigService{configFile: filepath.Join(t.TempDir(), "config.json"), encryptionKey: bytes.Repeat([]byte{17}, 32)}
}
func registryConnection(id, key, url string) types.ProviderConfig {
	return types.ProviderConfig{ID: id, Name: id, Type: "openai", Enabled: true, BaseURL: url + "/v1", APIKey: key, ImageModel: "gpt-image-2.5-sunburst", IntentModel: "gpt-6.1-sol", ImageToolModel: "gpt-image-2.5-sunburst", Models: []types.ModelDefinition{{ModelID: "gpt-image-2.5-sunburst", Modality: "image", Enabled: true}, {ModelID: "gpt-6.1-sol", Modality: "vision", Enabled: true}}}
}
func saveRegistry(t *testing.T, c *ConfigService, s types.Settings) {
	t.Helper()
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	if err = c.SaveSettings(string(data)); err != nil {
		t.Fatal(err)
	}
}

func TestMultipleOpenAIProvidersDoNotShareConnections(t *testing.T) {
	calls := make(chan string, 8)
	server := func(id, key string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+key {
				t.Errorf("%s received wrong API key", id)
			}
			if r.URL.Path != "/v1/images/generations" {
				t.Errorf("unexpected path %s", r.URL.Path)
			}
			calls <- id
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNl8AAAAASUVORK5CYII="}]}`)
		}))
	}
	first, second := server("first", "first-secret"), server("second", "second-secret")
	defer first.Close()
	defer second.Close()
	c := registryConfig(t)
	s := types.Settings{AI: types.AISettings{DefaultProviderID: "official", Providers: []types.ProviderConfig{registryConnection("official", "first-secret", first.URL), registryConnection("backup", "second-secret", second.URL)}}}
	saveRegistry(t, c, s)
	a := NewAIService(c)
	a.ctx = context.Background()
	a.contextManager = NewContextManager(a.ctx)
	defer a.Close()
	for i, id := range []string{"official", "backup", "official"} {
		if _, err := a.GenerateImage(fmt.Sprintf(`{"provider":%q,"model":"gpt-image-2.5-sunburst","prompt":"cat"}`, id), fmt.Sprint(i)); err != nil {
			t.Fatal(err)
		}
	}
	for _, want := range []string{"first", "second", "first"} {
		if got := <-calls; got != want {
			t.Fatalf("wrong connection %q, want %q", got, want)
		}
	}
	if len(a.providers) != 2 {
		t.Fatal("cache collapsed same-type providers")
	}
	s.AI.Providers[1].Enabled = false
	saveRegistry(t, c, s)
	a.ReloadProviders()
	if _, err := a.GenerateImage(`{"provider":"backup","prompt":"cat"}`, "disabled"); err == nil {
		t.Fatal("disabled connection accepted")
	}
	s.AI.Providers = s.AI.Providers[:1]
	saveRegistry(t, c, s)
	a.ReloadProviders()
	if _, err := a.GenerateImage(`{"provider":"backup","prompt":"cat"}`, "removed"); err == nil {
		t.Fatal("removed provider silently fell back")
	}
	if len(calls) != 0 {
		t.Fatal("disabled/removed provider reached network")
	}
}
func TestProviderKeysEncryptedIndependently(t *testing.T) {
	c := registryConfig(t)
	one := registryConnection("one", "secret-one", "https://one.example")
	two := registryConnection("two", "secret-two", "https://two.example")
	two.Type = "gemini"
	s := types.Settings{AI: types.AISettings{DefaultProviderID: "one", Providers: []types.ProviderConfig{one, two}}}
	saveRegistry(t, c, s)
	raw, err := os.ReadFile(c.configFile)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("secret-one")) || bytes.Contains(raw, []byte("secret-two")) {
		t.Fatal("plaintext key saved")
	}
	result, err := c.LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	var loaded types.Settings
	json.Unmarshal([]byte(result), &loaded)
	if loaded.AI.Providers[0].APIKey != "secret-one" || loaded.AI.Providers[1].APIKey != "secret-two" {
		t.Fatal("provider keys/options crossed connections")
	}
	saveRegistry(t, c, loaded)
	again, _ := c.LoadSettings()
	if again != result {
		t.Fatal("save/load changed registry")
	}
}
func TestLegacyConfigurationMigratesWithoutRewritingFile(t *testing.T) {
	c := registryConfig(t)
	key, _ := c.encrypt("old-key")
	legacy := types.Settings{AI: types.AISettings{Provider: "openai", OpenAIAPIKey: key, OpenAIBaseURL: "https://old.example/v1", OpenAIImageModel: "image-alias", OpenAITextModel: "vision-alias"}}
	raw, _ := json.Marshal(legacy)
	if err := os.WriteFile(c.configFile, raw, 0600); err != nil {
		t.Fatal(err)
	}
	got, err := c.LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	var migrated types.Settings
	json.Unmarshal([]byte(got), &migrated)
	if migrated.AI.DefaultProviderID != "openai" || len(migrated.AI.Providers) != 2 || migrated.AI.Providers[0].APIKey != "old-key" || migrated.AI.Providers[0].ImageModel != "image-alias" {
		t.Fatal("legacy values not preserved")
	}
	after, _ := os.ReadFile(c.configFile)
	if !bytes.Equal(raw, after) {
		t.Fatal("read rewrote configuration file")
	}
	saveRegistry(t, c, migrated)
	saved, _ := os.ReadFile(c.configFile)
	if bytes.Contains(saved, []byte(`"openaiApiKey"`)) {
		t.Fatal("legacy credential field retained")
	}
}
func TestEmptyProviderCatalogStaysEmpty(t *testing.T) {
	c := registryConfig(t)
	saveRegistry(t, c, types.Settings{AI: types.AISettings{Providers: []types.ProviderConfig{}}})
	got, _ := c.LoadSettings()
	var s types.Settings
	json.Unmarshal([]byte(got), &s)
	if s.AI.Providers == nil || len(s.AI.Providers) != 0 || s.AI.DefaultProviderID != "" {
		t.Fatal("deleted providers resurrected")
	}
}

func TestMultipleGeminiProvidersDoNotShareConnections(t *testing.T) {
	calls := make(chan string, 2)
	server := func(id, key string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("x-goog-api-key") != key {
				t.Errorf("%s received wrong API key", id)
			}
			calls <- id
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"candidates":[{"finishReason":"STOP","content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNl8AAAAASUVORK5CYII="}}]}}]}`)
		}))
	}
	first, second := server("g1", "key-g1"), server("g2", "key-g2")
	defer first.Close()
	defer second.Close()
	providers := []types.ProviderConfig{}
	for i, url := range []string{first.URL, second.URL} {
		id := fmt.Sprintf("g%d", i+1)
		providers = append(providers, types.ProviderConfig{ID: id, Name: id, Type: "gemini", Enabled: true, APIKey: "key-" + id, BaseURL: url, ImageModel: "gemini-3.1-flash-image", Models: []types.ModelDefinition{{ModelID: "gemini-3.1-flash-image", Modality: "image", Enabled: true}}})
	}
	c := registryConfig(t)
	saveRegistry(t, c, types.Settings{AI: types.AISettings{Providers: providers, DefaultProviderID: "g1"}})
	a := NewAIService(c)
	a.ctx = context.Background()
	a.contextManager = NewContextManager(a.ctx)
	defer a.Close()
	for _, id := range []string{"g1", "g2"} {
		if _, err := a.GenerateImage(fmt.Sprintf(`{"provider":%q,"prompt":"cat"}`, id), id); err != nil {
			t.Fatal(err)
		}
		if got := <-calls; got != id {
			t.Fatalf("wrong Gemini connection %s", got)
		}
	}
}
func TestInvalidRegistryDoesNotOverwriteConfiguration(t *testing.T) {
	c := registryConfig(t)
	p := registryConnection("one", "secret", "https://one.example")
	saveRegistry(t, c, types.Settings{AI: types.AISettings{Providers: []types.ProviderConfig{p}, DefaultProviderID: p.ID}})
	before, _ := os.ReadFile(c.configFile)
	invalid, _ := json.Marshal(types.Settings{AI: types.AISettings{Providers: []types.ProviderConfig{p, p}, DefaultProviderID: p.ID}})
	if err := c.SaveSettings(string(invalid)); err == nil {
		t.Fatal("duplicate provider IDs accepted")
	}
	after, _ := os.ReadFile(c.configFile)
	if !bytes.Equal(before, after) {
		t.Fatal("invalid save overwrote existing configuration")
	}
}
func TestNewConfigurationStartsWithEmptyCatalog(t *testing.T) {
	c := registryConfig(t)
	raw, err := c.LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	var s types.Settings
	json.Unmarshal([]byte(raw), &s)
	if s.AI.Providers == nil || len(s.AI.Providers) != 0 || s.AI.DefaultProviderID != "" {
		t.Fatal("new installation injected providers")
	}
}

func TestRemovedStreamingConfigIsIgnoredWithoutRewriting(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprintf("legacy=%t", legacy), func(t *testing.T) {
			c := registryConfig(t)
			key, _ := c.encrypt("saved-key")
			raw := fmt.Sprintf(`{"version":"1.0.0","ai":{"defaultProviderId":"saved","providers":[{"id":"saved","name":"Saved connection","type":"openai","enabled":true,"apiKey":%q,"baseUrl":"https://saved.example/v1","models":[],"imageStream":true,"textStream":true}]}}`, key)
			if legacy {
				raw = fmt.Sprintf(`{"version":"1.0.0","ai":{"provider":"openai","openaiApiKey":%q,"openaiBaseUrl":"https://saved.example/v1","openaiImageStream":true,"openaiTextStream":true,"geminiImageStream":true,"geminiTextStream":true}}`, key)
			}
			if err := os.WriteFile(c.configFile, []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
			loaded, err := c.LoadSettings()
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(strings.ToLower(loaded), "stream") {
				t.Fatal("removed options exposed to frontend")
			}
			var settings types.Settings
			if err := json.Unmarshal([]byte(loaded), &settings); err != nil {
				t.Fatal(err)
			}
			p := settings.AI.Providers[0]
			if p.APIKey != "saved-key" || p.BaseURL != "https://saved.example/v1" {
				t.Fatal("connection changed during migration")
			}
			after, _ := os.ReadFile(c.configFile)
			if string(after) != raw {
				t.Fatal("loading rewrote existing file")
			}
			if err := c.SaveSettings(loaded); err != nil {
				t.Fatal(err)
			}
			after, _ = os.ReadFile(c.configFile)
			if strings.Contains(strings.ToLower(string(after)), "stream") {
				t.Fatal("obsolete stream options persisted")
			}
		})
	}
}
