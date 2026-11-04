package provider

import (
	"artifex/core/types"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testGemini(t *testing.T, handler http.HandlerFunc, change func(*types.AISettings)) *GeminiProvider {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	s := types.NormalizeGeminiSettings(types.AISettings{APIKey: "test-gemini", GeminiBaseURL: server.URL + "/v1beta"})
	if change != nil {
		change(&s)
	}
	p, err := NewGeminiProvider(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { p.Close() })
	return p
}
func geminiImageResponse(w http.ResponseWriter, b64 string) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"candidates":[{"finishReason":"STOP","content":{"role":"model","parts":[{"inlineData":{"mimeType":"image/png","data":%q}}]}}]}`, b64)
}
func TestGeminiGenerateAndReferenceContract(t *testing.T) {
	t.Setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
	b64 := fixture(t, false)
	calls := 0
	p := testGemini(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if !strings.HasSuffix(r.URL.Path, "/models/gemini-3.1-flash-image:generateContent") || r.Header.Get("x-goog-api-key") != "test-gemini" {
			t.Errorf("invalid Gemini endpoint/auth: %s", r.URL.Path)
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		config := body["generationConfig"].(map[string]any)
		if config["imageConfig"].(map[string]any)["imageSize"] != "4K" || config["thinkingConfig"].(map[string]any)["thinkingLevel"] != "HIGH" {
			t.Errorf("config: %#v", config)
		}
		parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
		if calls == 2 && (len(parts) != 3 || parts[1].(map[string]any)["inlineData"].(map[string]any)["mimeType"] != "image/png") {
			t.Errorf("reference images lost: %#v", parts)
		}
		geminiImageResponse(w, b64)
	}, nil)
	params := types.GenerateImageParams{Prompt: "中文文字", ImageSize: "4K", AspectRatio: "16:9", ThinkingLevel: "high"}
	if _, err := p.GenerateImage(context.Background(), params); err != nil {
		t.Fatal(err)
	}
	params.ReferenceImage = "data:image/png;base64," + b64
	params.SketchImage = params.ReferenceImage
	if _, err := p.GenerateImage(context.Background(), params); err != nil {
		t.Fatal(err)
	}
}
func TestGeminiModelSelectionAndIntent(t *testing.T) {
	p := testGemini(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "vision-alias:generateContent") {
			t.Errorf("wrong selected model: %s", r.URL.Path)
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		config := body["generationConfig"].(map[string]any)
		if config["responseMimeType"] != "application/json" || config["responseJsonSchema"] == nil {
			t.Errorf("missing schema: %#v", config)
		}
		if config["responseModalities"] != nil || config["response_modalities"] != nil {
			t.Error("image output configuration leaked into intent recognition")
		}
		output := `{"intents":[{"title":"一","prompt":"p1","description":"d1"},{"title":"二","prompt":"p2","description":"d2"},{"title":"三","prompt":"p3","description":"d3"}]}`
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":%q}]}}]}`, output)
	}, func(s *types.AISettings) {
		s.GeminiModels = append(s.GeminiModels, types.ModelDefinition{ModelID: "vision-alias", Modality: "vision", Enabled: true})
	})
	if _, err := p.RecognizeIntent(context.Background(), types.IntentRecognitionParams{Model: "vision-alias", Message: "更好看"}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.GenerateImage(context.Background(), types.GenerateImageParams{Model: "vision-alias", Prompt: "cat"}); err == nil {
		t.Fatal("vision model used for image output")
	}
}
func TestGeminiOutpaintGuideAndTransparency(t *testing.T) {
	b64 := fixture(t, false)
	src := "data:image/png;base64," + b64
	mask := "data:image/png;base64," + fixture(t, true)
	p := testGemini(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
		if strings.Contains(parts[0].(map[string]any)["text"].(string), "Outpaint") && len(parts) != 3 {
			t.Error("missing region guide")
		}
		geminiImageResponse(w, b64)
	}, nil)
	if _, err := p.EditMultiImages(context.Background(), types.MultiImageEditParams{Images: []string{src}, MaskImage: mask, OutputSize: "1536x864", Operation: "expand"}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.EditMultiImages(context.Background(), types.MultiImageEditParams{Images: []string{src}, Operation: "extract_subject"}); err == nil || !strings.Contains(err.Error(), "透明背景") {
		t.Fatal("opaque output accepted as transparent cutout")
	}
}

func TestGeminiImageThoughtFiltering(t *testing.T) {
	b64, thought := fixture(t, false), fixture(t, true)
	p := testGemini(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"candidates":[{"finishReason":"STOP","content":{"parts":[{"thought":true,"inlineData":{"mimeType":"image/png","data":%q}},{"inlineData":{"mimeType":"image/png","data":%q}}]}}]}`, thought, b64)
	}, nil)
	got, err := p.GenerateImage(context.Background(), types.GenerateImageParams{Prompt: "cat"})
	if err != nil || got != "data:image/png;base64,"+b64 {
		t.Fatalf("final image not selected: %v", err)
	}
}

// Reproduce gateways which reject the optional output modality override while
// still supporting image generation using the model's default output modes.
func TestGeminiGatewayWithoutResponseModalities(t *testing.T) {
	b64 := fixture(t, false)
	for _, edit := range []bool{false, true} {
		t.Run(fmt.Sprintf("edit=%t", edit), func(t *testing.T) {
			calls := 0
			p := testGemini(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if !strings.HasSuffix(r.URL.Path, "/models/gemini-3.1-flash-image:generateContent") {
					t.Errorf("wrong route: %s", r.URL.Path)
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				config, ok := body["generationConfig"].(map[string]any)
				if !ok {
					t.Error("image settings lost")
					return
				}
				if config["responseModalities"] != nil || config["response_modalities"] != nil {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusBadRequest)
					fmt.Fprint(w, `{"error":{"message":"Unknown parameter 'response_modalities' at 'generation_config'.","type":"upstream_error","param":"","code":"invalid_request"}}`)
					return
				}
				imageConfig := config["imageConfig"].(map[string]any)
				if imageConfig["imageSize"] != "2K" || imageConfig["aspectRatio"] != "16:9" || config["thinkingConfig"].(map[string]any)["thinkingLevel"] != "HIGH" {
					t.Errorf("settings changed: %#v", config)
				}
				parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
				if !strings.Contains(parts[0].(map[string]any)["text"].(string), "保留中文文字") {
					t.Error("prompt lost")
				}
				if edit && (len(parts) != 2 || parts[1].(map[string]any)["inlineData"].(map[string]any)["data"] != b64) {
					t.Error("edit image lost")
				}
				geminiImageResponse(w, b64)
			}, nil)
			var got string
			var err error
			if edit {
				got, err = p.EditMultiImages(context.Background(), types.MultiImageEditParams{Images: []string{"data:image/png;base64," + b64}, Prompt: "保留中文文字", ImageSize: "2K", AspectRatio: "16:9", ThinkingLevel: "high"})
			} else {
				got, err = p.GenerateImage(context.Background(), types.GenerateImageParams{Prompt: "保留中文文字", ImageSize: "2K", AspectRatio: "16:9", ThinkingLevel: "high"})
			}
			if err != nil || got != "data:image/png;base64,"+b64 {
				t.Fatalf("gateway generation failed: %v", err)
			}
			if calls != 1 {
				t.Fatalf("request sent %d times", calls)
			}
		})
	}
}

func TestGeminiTextOnlyResultIsNotImageSuccess(t *testing.T) {
	calls := 0
	p := testGemini(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"Only text returned"}]}}]}`)
	}, nil)
	got, err := p.GenerateImage(context.Background(), types.GenerateImageParams{Prompt: "image"})
	if err == nil || got != "" || !strings.Contains(err.Error(), "未返回图片") {
		t.Fatalf("text accepted as image: %v", err)
	}
	if calls != 1 {
		t.Fatalf("text result triggered another generation: %d", calls)
	}
}
