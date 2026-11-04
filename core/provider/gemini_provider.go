package provider

import (
	"artifex/core/types"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"google.golang.org/genai"
)

// Gemini API only. Models are selected from the user's catalog per operation.
type GeminiProvider struct {
	client     *genai.Client
	settings   types.AISettings
	httpClient *http.Client
}

func NewGeminiProvider(ctx context.Context, s types.AISettings) (*GeminiProvider, error) {
	s = types.NormalizeGeminiSettings(s)
	if err := types.ValidateModelDefinitions(s.GeminiModels); err != nil {
		return nil, err
	}
	if strings.TrimSpace(s.APIKey) == "" {
		return nil, fmt.Errorf("请配置 Gemini API Key")
	}
	base := strings.TrimRight(strings.TrimSpace(s.GeminiBaseURL), "/")
	version := "v1beta"
	for _, v := range []string{"v1beta", "v1"} {
		if strings.HasSuffix(base, "/"+v) {
			base = strings.TrimSuffix(base, "/"+v)
			version = v
		}
	}
	if base != "" {
		u, err := url.Parse(base)
		if err != nil || u.Host == "" || !oneOf(u.Scheme, "http", "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return nil, fmt.Errorf("Gemini Base URL 无效")
		}
	}
	hc := &http.Client{Timeout: 10 * time.Minute, Transport: http.DefaultTransport.(*http.Transport).Clone()}
	attempts := int32(1)
	client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: s.APIKey, Backend: genai.BackendGeminiAPI, HTTPClient: hc, HTTPOptions: genai.HTTPOptions{BaseURL: base, APIVersion: version, RetryOptions: &genai.HTTPRetryOptions{Attempts: &attempts}}})
	if err != nil {
		return nil, err
	}
	return &GeminiProvider{client: client, settings: s, httpClient: hc}, nil
}
func (p *GeminiProvider) Name() string { return "gemini" }
func (p *GeminiProvider) Close() error { p.httpClient.CloseIdleConnections(); return nil }
func (p *GeminiProvider) GetCapabilities() ProviderCapabilities {
	return ProviderCapabilities{GenerateImage: true, EditImage: true, ReferenceImage: true, RemoveBackground: true}
}
func (p *GeminiProvider) CheckAvailability(ctx context.Context) (bool, error) {
	_, err := p.ListModels(ctx)
	return err == nil, err
}
func (p *GeminiProvider) ListModels(ctx context.Context) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	page, err := p.client.Models.List(ctx, &genai.ListModelsConfig{PageSize: 100})
	if err != nil {
		return nil, err
	}
	result := []string{}
	for {
		for _, m := range page.Items {
			result = append(result, strings.TrimPrefix(m.Name, "models/"))
		}
		if page.NextPageToken == "" {
			break
		}
		page, err = page.Next(ctx)
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}
func (p *GeminiProvider) selectModel(id, kind string) (string, error) {
	if id == "" {
		if kind == "image" {
			id = p.settings.ImageModel
		} else {
			id = p.settings.TextModel
		}
	}
	for _, m := range p.settings.GeminiModels {
		if m.ModelID == id && m.Enabled && m.Modality == kind {
			return id, nil
		}
	}
	return "", fmt.Errorf("请选择已启用的%s模型", map[string]string{"image": "生图", "vision": "多模态"}[kind])
}
func (p *GeminiProvider) GenerateImage(ctx context.Context, params types.GenerateImageParams) (string, error) {
	images := []string{}
	if params.SketchImage != "" {
		images = append(images, params.SketchImage)
	}
	if params.ReferenceImage != "" {
		images = append(images, params.ReferenceImage)
	}
	operation := "generate"
	if len(images) > 0 {
		operation = "reference"
	}
	prompt := imageTaskPrompt(operation, params.Prompt, len(images))
	if params.SketchImage != "" {
		prompt += "\nThe first input is a composition sketch: preserve its layout and silhouette. Later inputs are visual references."
	}
	return p.generate(ctx, params.Model, prompt, images, params.ImageSize, params.AspectRatio, params.ThinkingLevel, operation)
}
func (p *GeminiProvider) EditMultiImages(ctx context.Context, params types.MultiImageEditParams) (string, error) {
	if len(params.Images) == 0 {
		return "", fmt.Errorf("至少需要一张输入图片")
	}
	operation := params.Operation
	if operation == "" {
		operation = "edit"
	}
	if !oneOf(operation, "edit", "reference", "extract_subject", "extract_mid", "extract_bg", "enhance", "expand") {
		return "", fmt.Errorf("不支持的编辑操作")
	}
	prompt := imageTaskPrompt(operation, params.Prompt, len(params.Images))
	images := append([]string(nil), params.Images...)
	if operation == "expand" {
		if params.MaskImage == "" {
			return "", fmt.Errorf("扩图需要区域蒙版")
		}
		if err := validateMask(images[0], params.MaskImage); err != nil {
			return "", err
		}
		guide, err := geminiMaskGuide(params.MaskImage)
		if err != nil {
			return "", err
		}
		images = append(images, guide)
		prompt += "\nThe FINAL input is a region guide, not visual content. WHITE marks the original area to preserve and BLACK marks the new area to fill. Do not reproduce the guide in the result."
		if params.OutputSize != "" {
			var w, h int
			if _, err := fmt.Sscanf(params.OutputSize, "%dx%d", &w, &h); err != nil || w <= 0 || h <= 0 {
				return "", fmt.Errorf("扩图尺寸无效")
			}
			params.AspectRatio = nearestGeminiRatio(w, h)
		}
	}
	return p.generate(ctx, params.Model, prompt, images, params.ImageSize, params.AspectRatio, params.ThinkingLevel, operation)
}
func geminiThinking(model, level string) *genai.ThinkingConfig {
	if strings.Contains(model, "gemini-3.1-flash") && strings.Contains(model, "image") {
		effort := genai.ThinkingLevelMinimal
		if level == "high" {
			effort = genai.ThinkingLevelHigh
		}
		return &genai.ThinkingConfig{ThinkingLevel: effort}
	}
	// Other image models do not expose a documented configurable thinking level.
	return nil
}
func (p *GeminiProvider) generate(ctx context.Context, selection, prompt string, images []string, size, ratio, thinking, operation string) (string, error) {
	model, err := p.selectModel(selection, "image")
	if err != nil {
		return "", err
	}
	maxImages := 14
	if strings.Contains(model, "gemini-2.5") {
		maxImages = 3
	}
	if len(images) > maxImages {
		return "", fmt.Errorf("当前模型最多支持 %d 张输入图片（含扩图区域引导图）", maxImages)
	}
	if size != "" && !oneOf(size, "1K", "2K", "4K") {
		return "", fmt.Errorf("不支持的图片尺寸")
	}
	if ratio != "" && !oneOf(ratio, "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9") {
		return "", fmt.Errorf("不支持的宽高比")
	}
	if strings.Contains(model, "gemini-2.5") || strings.Contains(model, "flash-lite-image") {
		if size != "" && size != "1K" {
			return "", fmt.Errorf("当前模型仅支持 1K，请选择支持 2K/4K 的 Gemini 图片模型")
		}
		size = ""
	}
	parts, err := geminiParts(prompt, images)
	if err != nil {
		return "", err
	}
	// Image models default to text + image output. Omit the optional modality
	// override: some Gemini-compatible gateways reject it during translation.
	config := &genai.GenerateContentConfig{ThinkingConfig: geminiThinking(model, thinking)}
	if size != "" || ratio != "" {
		config.ImageConfig = &genai.ImageConfig{ImageSize: size, AspectRatio: ratio}
	}
	contents := []*genai.Content{{Role: genai.RoleUser, Parts: parts}}
	response, err := p.client.Models.GenerateContent(ctx, model, contents, config)
	if err != nil {
		return "", err
	}
	result, err := extractImageFromGeminiResponse(response)
	if err != nil {
		return "", err
	}
	if operation == "extract_subject" || operation == "extract_mid" {
		if !hasTransparency(result) {
			return "", fmt.Errorf("Gemini 未返回真实透明背景；请改用支持透明输出的 GPT Image 模型完成抠图")
		}
	}
	return result, nil
}
func geminiParts(prompt string, images []string) ([]*genai.Part, error) {
	parts := []*genai.Part{{Text: prompt}}
	total := len(prompt)
	for i, src := range images {
		data, format, err := decodeImageData(src)
		if err != nil {
			return nil, fmt.Errorf("图片 %d: %w", i+1, err)
		}
		total += base64.StdEncoding.EncodedLen(len(data))
		if total > 20*1024*1024 {
			return nil, fmt.Errorf("Gemini 内联请求过大，请压缩图片后重试（总计小于 20 MB）")
		}
		parts = append(parts, &genai.Part{InlineData: &genai.Blob{MIMEType: "image/" + format, Data: data}})
	}
	return parts, nil
}
func extractImageFromGeminiResponse(response *genai.GenerateContentResponse) (string, error) {
	if response == nil {
		return "", fmt.Errorf("Gemini 未返回内容")
	}
	for _, c := range response.Candidates {
		if c.FinishReason != "" && c.FinishReason != genai.FinishReasonStop {
			return "", fmt.Errorf("Gemini 请求未完成: %s", c.FinishReason)
		}
		if c.Content == nil {
			continue
		}
		for _, part := range c.Content.Parts {
			if !part.Thought && part.InlineData != nil && strings.HasPrefix(part.InlineData.MIMEType, "image/") {
				return imageDataURL(base64.StdEncoding.EncodeToString(part.InlineData.Data), "")
			}
		}
	}
	if response.PromptFeedback != nil {
		return "", fmt.Errorf("Gemini 未生成图片: %s", response.PromptFeedback.BlockReason)
	}
	return "", fmt.Errorf("Gemini 未返回图片；请确认选择的是支持图片输出的模型")
}
func (p *GeminiProvider) RecognizeIntent(ctx context.Context, params types.IntentRecognitionParams) (string, error) {
	model, err := p.selectModel(params.Model, "vision")
	if err != nil {
		return "", err
	}
	parts, err := geminiParts(intentInstructions+"\n用户输入：\n"+params.Message, params.ReferenceImages)
	if err != nil {
		return "", err
	}

	config := &genai.GenerateContentConfig{ResponseMIMEType: "application/json", ResponseJsonSchema: intentSchema()}
	contents := []*genai.Content{{Role: genai.RoleUser, Parts: parts}}
	response, err := p.client.Models.GenerateContent(ctx, model, contents, config)
	if err != nil {
		return "", err
	}
	text := response.Text()

	var result types.IntentRecognitionResponse
	if err = json.Unmarshal([]byte(text), &result); err != nil {
		return "", fmt.Errorf("意图识别返回格式错误: %w", err)
	}
	if len(result.Intents) != 3 {
		return "", fmt.Errorf("意图识别应返回 3 个候选方向")
	}
	for _, item := range result.Intents {
		if strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Prompt) == "" || strings.TrimSpace(item.Description) == "" {
			return "", fmt.Errorf("意图识别返回内容不完整")
		}
	}
	data, err := json.Marshal(result)
	return string(data), err
}
func geminiMaskGuide(mask string) (string, error) {
	data, _, err := decodeImageData(mask)
	if err != nil {
		return "", err
	}
	im, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	guide := image.NewGray(im.Bounds())
	for y := im.Bounds().Min.Y; y < im.Bounds().Max.Y; y++ {
		for x := im.Bounds().Min.X; x < im.Bounds().Max.X; x++ {
			_, _, _, a := im.At(x, y).RGBA()
			guide.SetGray(x, y, color.Gray{Y: uint8(a >> 8)})
		}
	}
	var out bytes.Buffer
	if err = png.Encode(&out, guide); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(out.Bytes()), nil
}
func hasTransparency(src string) bool {
	data, _, err := decodeImageData(src)
	if err != nil {
		return false
	}
	im, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return false
	}
	for y := im.Bounds().Min.Y; y < im.Bounds().Max.Y; y++ {
		for x := im.Bounds().Min.X; x < im.Bounds().Max.X; x++ {
			_, _, _, a := im.At(x, y).RGBA()
			if a < 65535 {
				return true
			}
		}
	}
	return false
}
func nearestGeminiRatio(w, h int) string {
	result := "1:1"
	best := math.MaxFloat64
	for _, ratio := range []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"} {
		var a, b float64
		fmt.Sscanf(ratio, "%f:%f", &a, &b)
		delta := math.Abs(math.Log((float64(w) / float64(h)) / (a / b)))
		if delta < best {
			best = delta
			result = ratio
		}
	}
	return result
}
