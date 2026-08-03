package provider

import (
	"artifex/core/types"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCloudProviderRecognizeIntent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/recognizeIntent" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		var params types.IntentRecognitionParams
		if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if params.Message != "更高级一点" || len(params.ReferenceImages) != 1 {
			t.Fatalf("unexpected params: %#v", params)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"intents":[
			{"title":"材质升级","prompt":"使用高级金属与玻璃材质","description":"增强质感"},
			{"title":"极简高级","prompt":"减少杂乱并增加留白","description":"强化秩序"},
			{"title":"电影氛围","prompt":"增加电影级光影","description":"强化氛围"}
		]}`))
	}))
	defer server.Close()

	provider, err := NewCloudProvider(context.Background(), types.AISettings{CloudEndpointURL: server.URL})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	result, err := provider.RecognizeIntent(context.Background(), types.IntentRecognitionParams{
		Message:         "更高级一点",
		ReferenceImages: []string{"data:image/png;base64,aW1hZ2U="},
	})
	if err != nil {
		t.Fatalf("recognize intent: %v", err)
	}
	if result == "" {
		t.Fatal("expected serialized intent response")
	}
}

func TestCloudProviderRecognizeIntentNormalizesConfiguredOperationPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/recognizeIntent" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"intents":[
			{"title":"候选一","prompt":"完整提示词一","description":"说明一"},
			{"title":"候选二","prompt":"完整提示词二","description":"说明二"},
			{"title":"候选三","prompt":"完整提示词三","description":"说明三"}
		]}`))
	}))
	defer server.Close()

	provider, err := NewCloudProvider(context.Background(), types.AISettings{
		CloudEndpointURL: server.URL + "/generateImage",
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if _, err := provider.RecognizeIntent(context.Background(), types.IntentRecognitionParams{Message: "测试"}); err != nil {
		t.Fatalf("recognize intent: %v", err)
	}
}

func TestCloudProviderCheckAvailabilityUsesHealthEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/health" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()

	provider, err := NewCloudProvider(context.Background(), types.AISettings{
		CloudEndpointURL: server.URL + "/editMultiImages",
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	available, err := provider.CheckAvailability(context.Background())
	if err != nil {
		t.Fatalf("check availability: %v", err)
	}
	if !available {
		t.Fatal("expected provider to be available")
	}
}
