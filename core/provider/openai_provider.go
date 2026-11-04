package provider

import (
	"artifex/core/types"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/responses"
)

// One connection, with endpoint routing derived from the selected model.
type OpenAIProvider struct {
	client     openai.Client
	settings   types.AISettings
	httpClient *http.Client
}

func NewOpenAIProvider(ctx context.Context, settings types.AISettings) (*OpenAIProvider, error) {
	settings = types.NormalizeOpenAISettings(settings)
	if err := types.ValidateModelDefinitions(settings.OpenAIModels); err != nil {
		return nil, err
	}
	if strings.TrimSpace(settings.OpenAIAPIKey) == "" {
		return nil, fmt.Errorf("请配置 OpenAI API Key")
	}
	base := strings.TrimRight(strings.TrimSpace(settings.OpenAIBaseURL), "/")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || !oneOf(parsed.Scheme, "http", "https") || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return nil, fmt.Errorf("Base URL 必须为有效的 HTTP(S) 服务地址，不应包含密钥、查询参数或片段")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	client := &http.Client{Timeout: 10 * time.Minute, Transport: transport}
	return &OpenAIProvider{
		client:   openai.NewClient(option.WithAPIKey(settings.OpenAIAPIKey), option.WithBaseURL(base+"/"), option.WithHTTPClient(client), option.WithMaxRetries(0)),
		settings: settings, httpClient: client,
	}, nil
}

func (p *OpenAIProvider) Name() string { return "openai" }
func (p *OpenAIProvider) Close() error { p.httpClient.CloseIdleConnections(); return nil }
func isReasoning(model string) bool {
	return strings.HasPrefix(model, "gpt-5") || strings.HasPrefix(model, "gpt-6")
}
func isLegacyImage(model string) bool {
	return strings.Contains(strings.ToLower(model), "dall-e") || strings.Contains(strings.ToLower(model), "dalle")
}
func (p *OpenAIProvider) GetCapabilities() ProviderCapabilities {
	return ProviderCapabilities{GenerateImage: true, EditImage: true, RemoveBackground: true, ReferenceImage: true}
}

// Model discovery verifies the configured connection and model visibility without
// incurring an image generation charge. It is not a generation smoke test.
func (p *OpenAIProvider) CheckAvailability(ctx context.Context) (bool, error) {
	_, err := p.ListModels(ctx)
	return err == nil, err
}

func (p *OpenAIProvider) GenerateImage(ctx context.Context, params types.GenerateImageParams) (string, error) {
	selected, err := p.forImageModel(params.Model, params.ImageToolModel)
	if err != nil {
		return "", err
	}
	p = selected
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
		prompt += "\nThe first input is a composition sketch. Preserve its layout and silhouette; use subsequent images only as visual references unless explicitly requested otherwise."
	}
	return p.runImage(ctx, prompt, images, "", params.ImageSize, params.AspectRatio, "", params.ThinkingLevel, operation)
}

func (p *OpenAIProvider) EditMultiImages(ctx context.Context, params types.MultiImageEditParams) (string, error) {
	selected, err := p.forImageModel(params.Model, params.ImageToolModel)
	if err != nil {
		return "", err
	}
	p = selected
	if len(params.Images) == 0 {
		return "", fmt.Errorf("至少需要一张输入图片")
	}
	if isLegacyImage(p.settings.OpenAIImageModel) {
		return "", fmt.Errorf("模型 %s 不支持编辑，请选择 GPT Image 或多模态模型", p.settings.OpenAIImageModel)
	}
	operation := params.Operation
	if operation == "" {
		operation = "edit"
	}
	switch operation {
	case "edit", "reference", "extract_subject", "extract_mid", "extract_bg", "enhance", "expand":
	default:
		return "", fmt.Errorf("不支持的图片操作: %s", operation)
	}
	if operation == "expand" && params.MaskImage == "" {
		return "", fmt.Errorf("扩图需要区域蒙版，请重新选择扩图区域")
	}
	return p.runImage(ctx, imageTaskPrompt(operation, params.Prompt, len(params.Images)), params.Images, params.MaskImage, params.ImageSize, params.AspectRatio, params.OutputSize, params.ThinkingLevel, operation)
}

func (p *OpenAIProvider) runImage(ctx context.Context, prompt string, images []string, mask, level, ratio, size, thinking, operation string) (string, error) {
	if len(images) > 16 {
		return "", fmt.Errorf("一次最多支持 16 张输入图片")
	}
	if len([]rune(prompt)) > 32000 {
		return "", fmt.Errorf("提示词过长，请缩短到 30000 字符以内")
	}
	normalized, err := normalizeOpenAIInputs(images)
	if err != nil {
		return "", err
	}
	images = normalized
	model := p.settings.OpenAIImageModel

	imageModel := model
	if p.modelKind(model) == "multimodal" {
		imageModel = p.settings.OpenAIImageToolModel
		if p.modelKind(imageModel) != "image" {
			return "", fmt.Errorf("图片工具模型须使用 GPT Image，当前为 %s", imageModel)
		}
	}
	opts, err := p.imageOptions(imageModel, level, ratio, size, operation, images)
	if err != nil {
		return "", err
	}
	if mask != "" {
		if err = validateMask(images[0], mask); err != nil {
			return "", err
		}
	}
	if p.modelKind(model) == "multimodal" {
		return p.responseImage(ctx, model, imageModel, prompt, images, mask, thinking, opts)
	}
	if len(images) > 0 {
		return p.editImage(ctx, imageModel, prompt, images, mask, opts)
	}
	req := openai.ImageGenerateParams{Model: openai.ImageModel(imageModel), Prompt: prompt, N: openai.Int(1), Size: openai.ImageGenerateParamsSize(opts.size)}
	if isLegacyImage(imageModel) {
		req.ResponseFormat = "b64_json"
		if strings.Contains(imageModel, "3") {
			req.Quality = "hd"
			req.Style = "vivid"
		}
	} else {
		req.Quality = openai.ImageGenerateParamsQuality(opts.quality)
		req.Background = openai.ImageGenerateParamsBackground(opts.background)
		req.OutputFormat = openai.ImageGenerateParamsOutputFormat(opts.format)
		if opts.format != "png" && p.settings.OpenAIImageCompression != nil {
			req.OutputCompression = openai.Int(*p.settings.OpenAIImageCompression)
		}
	}
	resp, err := p.client.Images.Generate(ctx, req)
	if err != nil {
		return "", err
	}
	return imageResult(resp, opts.format)
}

func (p *OpenAIProvider) editImage(ctx context.Context, model, prompt string, images []string, mask string, o imageOptions) (string, error) {
	readers := make([]io.Reader, 0, len(images))
	for _, src := range images {
		reader, err := imageFile(ctx, src, p.httpClient)
		if err != nil {
			return "", err
		}
		readers = append(readers, reader)
	}
	req := openai.ImageEditParams{Model: openai.ImageModel(model), Prompt: prompt, Image: openai.ImageEditParamsImageUnion{OfFileArray: readers}, N: openai.Int(1), Size: openai.ImageEditParamsSize(o.size), Quality: openai.ImageEditParamsQuality(o.quality), Background: openai.ImageEditParamsBackground(o.background), OutputFormat: openai.ImageEditParamsOutputFormat(o.format)}
	if mask != "" {
		reader, err := imageFile(ctx, mask, p.httpClient)
		if err != nil {
			return "", err
		}
		req.Mask = reader
	}
	if o.format != "png" && p.settings.OpenAIImageCompression != nil {
		req.OutputCompression = openai.Int(*p.settings.OpenAIImageCompression)
	}
	resp, err := p.client.Images.Edit(ctx, req)
	if err != nil {
		return "", err
	}
	return imageResult(resp, o.format)
}

func responseInput(prompt string, images []string) responses.ResponseNewParamsInputUnion {
	content := responses.ResponseInputMessageContentListParam{{OfInputText: &responses.ResponseInputTextParam{Text: prompt}}}
	for _, src := range images {
		content = append(content, responses.ResponseInputContentUnionParam{OfInputImage: &responses.ResponseInputImageParam{ImageURL: openai.String(src), Detail: "high"}})
	}
	return responses.ResponseNewParamsInputUnion{OfInputItemList: responses.ResponseInputParam{{OfMessage: &responses.EasyInputMessageParam{Role: "user", Content: responses.EasyInputMessageContentUnionParam{OfInputItemContentList: content}}}}}
}

func (p *OpenAIProvider) responseImage(ctx context.Context, model, imageModel, prompt string, images []string, mask, thinking string, o imageOptions) (string, error) {
	tool := responses.ToolImageGenerationParam{Model: imageModel, Size: o.size, Quality: o.quality, Background: o.background, OutputFormat: o.format, Action: "generate"}
	if len(images) > 0 {
		tool.Action = "edit"
	}
	if mask != "" {
		tool.InputImageMask = responses.ToolImageGenerationInputImageMaskParam{ImageURL: openai.String(mask)}
	}
	if o.format != "png" && p.settings.OpenAIImageCompression != nil {
		tool.OutputCompression = openai.Int(*p.settings.OpenAIImageCompression)
	}
	req := responses.ResponseNewParams{Model: model, Input: responseInput(prompt, images), Store: openai.Bool(false), Tools: []responses.ToolUnionParam{{OfImageGeneration: &tool}}, Instructions: openai.String(imageAgentInstructions)}
	req.SetExtraFields(map[string]any{"tool_choice": map[string]string{"type": "image_generation"}})
	setReasoning(&req, model, thinking)
	result, err := p.response(ctx, req)
	if err != nil {
		return "", err
	}
	for _, item := range result.Output {
		if item.Type == "image_generation_call" {
			return imageDataURL(item.AsImageGenerationCall().Result, o.format)
		}
	}
	return "", fmt.Errorf("模型未返回图片：%s", truncateString(result.OutputText(), 300))
}

func (p *OpenAIProvider) response(ctx context.Context, req responses.ResponseNewParams) (*responses.Response, error) {
	resp, err := p.client.Responses.New(ctx, req)
	if err != nil {
		return nil, err
	}
	return checkedResponse(resp)
}
func checkedResponse(resp *responses.Response) (*responses.Response, error) {
	if resp.Status != "completed" {
		return nil, fmt.Errorf("模型未完成请求 (%s): %s %s", resp.Status, resp.Error.Message, resp.IncompleteDetails.Reason)
	}
	return resp, nil
}

func (p *OpenAIProvider) RecognizeIntent(ctx context.Context, params types.IntentRecognitionParams) (string, error) {
	if len(params.ReferenceImages) > 16 {
		return "", fmt.Errorf("最多支持 16 张参考图")
	}
	model := params.Model
	if model == "" {
		model = p.settings.OpenAITextModel
	}
	if p.modelKind(model) != "multimodal" {
		return "", fmt.Errorf("意图识别请选择已配置的多模态模型")
	}
	normalized, err := normalizeOpenAIInputs(params.ReferenceImages)
	if err != nil {
		return "", err
	}
	params.ReferenceImages = normalized
	prompt := intentInstructions + "\n用户输入：\n" + params.Message
	var text string
	if p.modelKind(model) == "multimodal" {
		req := responses.ResponseNewParams{Model: model, Input: responseInput(prompt, params.ReferenceImages), Store: openai.Bool(false)}
		req.SetExtraFields(map[string]any{"text": map[string]any{"format": map[string]any{"type": "json_schema", "name": "image_intents", "strict": true, "schema": intentSchema()}}})
		setReasoning(&req, model, "low")
		resp, err := p.response(ctx, req)
		if err != nil {
			return "", err
		}
		text = resp.OutputText()

	}
	var result types.IntentRecognitionResponse
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		return "", fmt.Errorf("意图识别返回格式不正确: %w", err)
	}
	if len(result.Intents) != 3 {
		return "", fmt.Errorf("意图识别应返回 3 个候选方向")
	}
	for _, item := range result.Intents {
		if strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Prompt) == "" || strings.TrimSpace(item.Description) == "" {
			return "", fmt.Errorf("意图识别返回了不完整的候选方向")
		}
	}
	data, err := json.Marshal(result)
	return string(data), err
}
func truncateString(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

func (p *OpenAIProvider) modelKind(id string) string {
	for _, m := range p.settings.OpenAIModels {
		if m.ModelID == id && m.Enabled {
			if m.Modality == "vision" {
				return "multimodal"
			}
			return m.Modality
		}
	}
	return ""
}
func (p *OpenAIProvider) forImageModel(model, tool string) (*OpenAIProvider, error) {
	next := *p
	if model != "" {
		next.settings.OpenAIImageModel = model
	}
	kind := next.modelKind(next.settings.OpenAIImageModel)
	if kind != "image" && kind != "multimodal" {
		return nil, fmt.Errorf("请选择已配置的生图或多模态模型")
	}
	if tool != "" {
		next.settings.OpenAIImageToolModel = tool
	}
	if kind == "multimodal" && next.modelKind(next.settings.OpenAIImageToolModel) != "image" {
		return nil, fmt.Errorf("请为多模态模型选择一个生图工具模型")
	}
	return &next, nil
}

func (p *OpenAIProvider) ListModels(ctx context.Context) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	page, err := p.client.Models.List(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(page.Data))
	for _, m := range page.Data {
		result = append(result, m.ID)
	}
	return result, nil
}
