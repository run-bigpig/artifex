package provider

import (
	"artifex/core/types"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	openai "github.com/openai/openai-go/v3"
)

func fixture(t *testing.T, transparent bool) string {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	if !transparent {
		for y := 0; y < 32; y++ {
			for x := 0; x < 32; x++ {
				im.Set(x, y, color.NRGBA{R: 255, A: 255})
			}
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(b.Bytes())
}
func testProvider(t *testing.T, handler http.HandlerFunc, change func(*types.AISettings)) *OpenAIProvider {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	s := types.NormalizeOpenAISettings(types.AISettings{OpenAIAPIKey: "test-key", OpenAIBaseURL: server.URL + "/v1"})
	if change != nil {
		change(&s)
	}
	p, err := NewOpenAIProvider(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { p.Close() })
	return p
}
func imageResponse(w http.ResponseWriter, b64 string) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"data":[{"b64_json":%q}]}`, b64)
}

func TestGPTImageGenerateWireContract(t *testing.T) {
	b64 := fixture(t, false)
	p := testProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("wrong endpoint/auth: %s", r.URL.Path)
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		for _, key := range []string{"style", "response_format", "input_fidelity", "stream", "partial_images"} {
			if _, ok := body[key]; ok {
				t.Errorf("legacy field %s leaked", key)
			}
		}
		if body["model"] != "gpt-image-2.5-sunburst" || body["quality"] != "max" || body["size"] != "3840x2160" || body["n"] != float64(1) {
			t.Errorf("unexpected request: %#v", body)
		}
		if !strings.Contains(body["prompt"].(string), "文字保留：你好") {
			t.Error("lost user constraint")
		}
		imageResponse(w, b64)
	}, func(s *types.AISettings) { s.OpenAIImageQuality = "max" })
	got, err := p.GenerateImage(context.Background(), types.GenerateImageParams{Prompt: "文字保留：你好", ImageSize: "4K", AspectRatio: "16:9"})
	if err != nil || got != "data:image/png;base64,"+b64 {
		t.Fatalf("%s %v", got, err)
	}
}

func TestGPTImageMultipartEditAndCutout(t *testing.T) {
	b64 := fixture(t, false)
	src := "data:image/png;base64," + b64
	p := testProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Errorf("wrong route: %s", r.URL.Path)
		}
		if err := r.ParseMultipartForm(2 << 20); err != nil {
			t.Error(err)
			return
		}
		defer r.MultipartForm.RemoveAll()
		count := 0
		for key, files := range r.MultipartForm.File {
			if strings.HasPrefix(key, "image") {
				count += len(files)
			}
		}
		if count != 2 {
			t.Errorf("image count: %d; keys: %#v", count, r.MultipartForm.File)
		}
		for key, want := range map[string]string{"model": "gpt-image-2.5-sunburst", "background": "transparent", "output_format": "png", "quality": "auto"} {
			if r.FormValue(key) != want {
				t.Errorf("%s = %q", key, r.FormValue(key))
			}
		}
		if r.FormValue("response_format") != "" {
			t.Error("legacy response_format")
		}
		if !strings.Contains(r.FormValue("prompt"), "real alpha transparency") {
			t.Error("cutout constraints missing")
		}
		imageResponse(w, b64)
	}, func(s *types.AISettings) { s.OpenAIImageOutputFormat = "jpeg" })
	if _, err := p.EditMultiImages(context.Background(), types.MultiImageEditParams{Images: []string{src, src}, Prompt: "保留主体", Operation: "extract_subject"}); err != nil {
		t.Fatal(err)
	}
}

func TestResponsesUsesConfiguredModelRole(t *testing.T) {
	b64 := fixture(t, false)
	src := "data:image/png;base64," + b64
	mask := "data:image/png;base64," + fixture(t, true)
	p := testProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("wrong route: %s", r.URL.Path)
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "vision-alias" {
			t.Errorf("model: %v", body["model"])
		}
		tool := body["tools"].([]any)[0].(map[string]any)
		if body["stream"] == true || tool["partial_images"] != nil {
			t.Error("image response must be non-streaming")
		}
		if tool["model"] != "image-alias" || tool["action"] != "edit" {
			t.Errorf("tool: %#v", tool)
		}
		if tool["input_image_mask"].(map[string]any)["image_url"] != mask {
			t.Error("mask missing")
		}
		if body["tool_choice"].(map[string]any)["type"] != "image_generation" {
			t.Error("tool not forced")
		}
		if _, ok := body["reasoning"]; ok {
			t.Error("unknown models must not receive reasoning settings")
		}
		if body["store"] != false {
			t.Error("unexpected server persistence")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"id":"resp_1","status":"completed","output":[{"type":"image_generation_call","status":"completed","result":%q}]}`, b64)
	}, func(s *types.AISettings) {
		s.OpenAIModels = append(s.OpenAIModels, types.ModelDefinition{ModelID: "vision-alias", Modality: "vision", Enabled: true}, types.ModelDefinition{ModelID: "image-alias", Modality: "image", Enabled: true})
	})
	if _, err := p.EditMultiImages(context.Background(), types.MultiImageEditParams{Model: "vision-alias", ImageToolModel: "image-alias", Images: []string{src}, MaskImage: mask, Operation: "expand", Prompt: "向四周扩展"}); err != nil {
		t.Fatal(err)
	}
	// Per-request choices must not mutate shared defaults.
	if p.settings.OpenAIImageModel != "gpt-image-2.5-sunburst" {
		t.Error("request mutated provider settings")
	}
}

func TestSolIntentStructuredMultimodal(t *testing.T) {
	b64 := fixture(t, false)
	p := testProvider(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "gpt-6.1-sol" || body["reasoning"].(map[string]any)["effort"] != "low" {
			t.Errorf("invalid model/reasoning: %#v", body)
		}
		if body["text"].(map[string]any)["format"].(map[string]any)["type"] != "json_schema" {
			t.Error("not structured")
		}
		if body["stream"] == true {
			t.Error("intent response must be non-streaming")
		}
		contents := body["input"].([]any)[0].(map[string]any)["content"].([]any)
		if len(contents) != 2 || contents[1].(map[string]any)["type"] != "input_image" {
			t.Error("lost image input")
		}
		output := `{"intents":[{"title":"一","prompt":"保留主体","description":"透明"},{"title":"二","prompt":"增强材质","description":"质感"},{"title":"三","prompt":"调整光影","description":"光影"}]}`
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":%q}]}]}`, output)
	}, nil)
	if _, err := p.RecognizeIntent(context.Background(), types.IntentRecognitionParams{Message: "更高级", ReferenceImages: []string{"data:image/png;base64," + b64}}); err != nil {
		t.Fatal(err)
	}
}

func TestImageHTTPFailurePreserved(t *testing.T) {
	p := testProvider(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, `{"error":{"message":"model access denied","type":"permission_error","code":"denied"}}`)
	}, nil)
	_, err := p.GenerateImage(context.Background(), types.GenerateImageParams{Prompt: "generate"})
	var apiErr *openai.Error
	if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusForbidden || apiErr.Message != "model access denied" {
		t.Fatalf("HTTP error lost: %v", err)
	}
}

func TestModelValidationAndCancellation(t *testing.T) {
	requests := 0
	p := testProvider(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		io.Copy(io.Discard, r.Body)
		select {
		case <-r.Context().Done():
		case <-time.After(time.Second):
		}
	}, func(s *types.AISettings) {
		s.OpenAIModels = append(s.OpenAIModels, types.ModelDefinition{ModelID: "disabled", Modality: "image", Enabled: false})
	})
	for _, model := range []string{"missing", "disabled"} {
		if _, err := p.GenerateImage(context.Background(), types.GenerateImageParams{Model: model, Prompt: "cat"}); err == nil {
			t.Error("invalid model accepted")
		}
	}
	if requests != 0 {
		t.Fatal("invalid model reached network")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := p.GenerateImage(ctx, types.GenerateImageParams{Prompt: "cat"}); err == nil {
		t.Error("cancellation ignored")
	}
}

func TestImageSizeConstraints(t *testing.T) {
	for _, level := range []string{"1K", "2K", "4K"} {
		for _, ratio := range []string{"1:1", "16:9", "9:16", "4:3", "3:4", "3:1", "1:3"} {
			s, err := resolveImageSize(level, ratio, "", true)
			if err != nil {
				t.Fatal(err)
			}
			var w, h int
			fmt.Sscanf(s, "%dx%d", &w, &h)
			if w%16 != 0 || h%16 != 0 || w > 3840 || h > 3840 || w*h < 655360 || w*h > 8294400 || w > 3*h || h > 3*w {
				t.Errorf("invalid %s %s: %s", level, ratio, s)
			}
		}
	}
	for _, size := range []string{"0x0", "4096x4096junk", "999999x2", "-1x2"} {
		if _, err := resolveImageSize("", "", size, true); err == nil {
			t.Errorf("accepted invalid size %s", size)
		}
	}
	if _, err := resolveImageSize("4K", "1:1", "", false); err == nil {
		t.Error("legacy model size silently downgraded")
	}
}

func TestSolImageToolAdvancedOptions(t *testing.T) {
	b64 := fixture(t, false)
	zero := int64(0)
	p := testProvider(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "gpt-6.1-sol" || body["reasoning"].(map[string]any)["effort"] != "max" {
			t.Errorf("model/effort lost: %#v", body)
		}
		tool := body["tools"].([]any)[0].(map[string]any)
		if tool["output_compression"] != float64(0) || tool["output_format"] != "webp" || tool["quality"] != "xhigh" || tool["action"] != "generate" {
			t.Errorf("advanced image options lost: %#v", tool)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"completed","output":[{"type":"image_generation_call","status":"completed","result":%q}]}`, b64)
	}, func(s *types.AISettings) {
		s.OpenAIImageOutputFormat = "webp"
		s.OpenAIImageQuality = "xhigh"
		s.OpenAIImageCompression = &zero
	})
	if _, err := p.GenerateImage(context.Background(), types.GenerateImageParams{Model: "gpt-6.1-sol", ThinkingLevel: "max", Prompt: "cat"}); err != nil {
		t.Fatal(err)
	}
}
