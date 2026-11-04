package service

import (
	"artifex/core/provider"
	"artifex/core/types"
	"context"
	"testing"
)

type routingProvider struct {
	name   string
	calls  int
	params types.MultiImageEditParams
}

func (p *routingProvider) Name() string { return p.name }
func (p *routingProvider) GetCapabilities() provider.ProviderCapabilities {
	return provider.ProviderCapabilities{GenerateImage: true, EditImage: true, ReferenceImage: true}
}
func (p *routingProvider) CheckAvailability(context.Context) (bool, error) { return true, nil }
func (p *routingProvider) Close() error                                    { return nil }
func (p *routingProvider) GenerateImage(context.Context, types.GenerateImageParams) (string, error) {
	p.calls++
	return "images/generated.png", nil
}
func (p *routingProvider) EditMultiImages(_ context.Context, params types.MultiImageEditParams) (string, error) {
	p.calls++
	p.params = params
	return "images/edited.png", nil
}
func TestPerRequestProviderSelection(t *testing.T) {
	a := NewAIService(nil)
	a.contextManager = NewContextManager(context.Background())
	o, g := &routingProvider{name: "openai"}, &routingProvider{name: "gemini"}
	a.RegisterProvider("openai", o)
	a.RegisterProvider("gemini", g)
	if _, err := a.GenerateImage(`{"provider":"gemini","model":"configured-image","prompt":"cat"}`, "generate"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.EditMultiImages(`{"provider":"openai","model":"gpt-6.1-sol","imageToolModel":"gpt-image-2.5-flare","images":["data:image/png;base64,abc"],"operation":"expand","maskImage":"data:image/png;base64,mask","outputSize":"1536x864"}`, "edit"); err != nil {
		t.Fatal(err)
	}
	if o.calls != 1 || g.calls != 1 || o.params.Operation != "expand" || o.params.MaskImage == "" || o.params.ImageToolModel != "gpt-image-2.5-flare" {
		t.Fatalf("request routing/options lost: %+v %+v", o, g)
	}
	if _, err := a.GenerateImage(`{"provider":"cloud","prompt":"cat"}`, "removed"); err == nil {
		t.Fatal("removed provider still accepted")
	}
}
