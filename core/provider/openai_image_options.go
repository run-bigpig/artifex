package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
	"github.com/openai/openai-go/v3/shared"
	_ "golang.org/x/image/webp"
)

type imageOptions struct{ size, quality, background, format string }

func setReasoning(req *responses.ResponseNewParams, model, effort string) {
	if isReasoning(model) {
		if !oneOf(effort, "low", "medium", "high") && !(strings.HasPrefix(model, "gpt-6.1") && oneOf(effort, "xhigh", "max")) {
			effort = "medium"
		}
		req.Reasoning = shared.ReasoningParam{Effort: shared.ReasoningEffort(effort)}
	}
}

func (p *OpenAIProvider) imageOptions(model, level, ratio, explicit, operation string, images []string) (imageOptions, error) {
	o := imageOptions{quality: p.settings.OpenAIImageQuality, background: p.settings.OpenAIImageBackground, format: p.settings.OpenAIImageOutputFormat}
	if o.quality == "" {
		o.quality = "auto"
	}
	if o.background == "" {
		o.background = "auto"
	}
	if o.format == "" {
		o.format = "png"
	}
	if !oneOf(o.quality, "auto", "low", "medium", "high", "xhigh", "max") {
		return o, fmt.Errorf("无效的图片质量: %s", o.quality)
	}
	if (o.quality == "xhigh" || o.quality == "max") && !strings.Contains(model, "gpt-image-2.5") {
		return o, fmt.Errorf("质量 %s 需要 GPT Image 2.5；请在设置中降低质量或更换模型", o.quality)
	}
	if !oneOf(o.background, "auto", "opaque", "transparent") {
		return o, fmt.Errorf("无效的背景设置")
	}
	if !oneOf(o.format, "png", "jpeg", "webp") {
		return o, fmt.Errorf("无效的图片格式")
	}
	if operation == "extract_subject" || operation == "extract_mid" {
		o.background = "transparent"
		if o.format == "jpeg" {
			o.format = "png"
		}
	}
	if operation == "extract_bg" {
		o.background = "opaque"
	}
	if o.background == "transparent" && o.format == "jpeg" {
		return o, fmt.Errorf("透明背景请使用 PNG 或 WebP 格式")
	}
	if c := p.settings.OpenAIImageCompression; c != nil && (*c < 0 || *c > 100) {
		return o, fmt.Errorf("压缩质量必须在 0–100 之间")
	}
	if isLegacyImage(model) {
		if o.background == "transparent" || o.format != "png" {
			return o, fmt.Errorf("旧图像模型不支持此背景或输出格式，请选择 GPT Image")
		}
		o.size = "1024x1024"
		if strings.Contains(model, "3") {
			if oneOf(ratio, "16:9", "4:3") {
				o.size = "1792x1024"
			}
			if oneOf(ratio, "9:16", "3:4") {
				o.size = "1024x1792"
			}
		}
		if level != "" && level != "1K" {
			return o, fmt.Errorf("旧图像模型不支持所选分辨率")
		}
		return o, nil
	}
	flexible := !strings.Contains(model, "gpt-image-1")
	// Preserve input proportions when the user leaves edit dimensions automatic.
	if ratio == "" && len(images) > 0 {
		if data, _, err := decodeImageData(images[0]); err == nil {
			if cfg, _, e := image.DecodeConfig(bytes.NewReader(data)); e == nil {
				if level == "" && explicit == "" && flexible {
					if cfg.Width > 3*cfg.Height || cfg.Height > 3*cfg.Width {
						return o, fmt.Errorf("输入图片比例超出 1:3–3:1，请指定输出比例")
					}
					o.size = fitImageSize(float64(cfg.Width), float64(cfg.Height))
					return o, nil
				}
				ratio = fmt.Sprintf("%d:%d", cfg.Width, cfg.Height)
			}
		}
	}
	size, err := resolveImageSize(level, ratio, explicit, flexible)
	o.size = size
	return o, err
}
func oneOf(value string, values ...string) bool {
	for _, s := range values {
		if value == s {
			return true
		}
	}
	return false
}

// Sizes use a pixel budget: 1K ≈ 1 MP, 2K ≈ 4 MP, 4K ≤ 8.3 MP.
// Integer ratio units preserve selected aspect ratios while meeting the API's
// multiples-of-16 requirement (including exact 16:9 and 4:3).
func resolveImageSize(level, ratio, explicit string, flexible bool) (string, error) {
	if explicit != "" {
		var w, h int
		if _, err := fmt.Sscanf(explicit, "%dx%d", &w, &h); err != nil || fmt.Sprintf("%dx%d", w, h) != explicit || w <= 0 || h <= 0 || w > 32768 || h > 32768 || float64(w)/float64(h) > 3 || float64(h)/float64(w) > 3 {
			return "", fmt.Errorf("无效的输出尺寸")
		}
		if !flexible {
			return "", fmt.Errorf("此模型不支持自定义扩图尺寸")
		}
		return fitImageSize(float64(w), float64(h)), nil
	}
	if level == "" && ratio == "" {
		return "auto", nil
	}
	if level == "" {
		level = "1K"
	}
	if !oneOf(level, "1K", "2K", "4K") {
		return "", fmt.Errorf("不支持的分辨率: %s", level)
	}
	if ratio == "" {
		ratio = "1:1"
	}
	parts := strings.Split(ratio, ":")
	if len(parts) != 2 {
		return "", fmt.Errorf("无效的宽高比")
	}
	a, e1 := strconv.Atoi(parts[0])
	b, e2 := strconv.Atoi(parts[1])
	if e1 != nil || e2 != nil || a <= 0 || b <= 0 {
		return "", fmt.Errorf("无效的宽高比")
	}
	r := float64(a) / float64(b)
	if r < 1.0/3 || r > 3 {
		return "", fmt.Errorf("宽高比须在 1:3 至 3:1 之间")
	}
	if !flexible {
		if level != "1K" {
			return "", fmt.Errorf("此模型仅支持标准尺寸，请使用 1K 或 GPT Image 2/2.5")
		}
		if r > 1 {
			return "1536x1024", nil
		}
		if r < 1 {
			return "1024x1536", nil
		}
		return "1024x1024", nil
	}
	pixels := 1048576.0
	if level == "2K" {
		pixels = 4194304
	}
	if level == "4K" {
		pixels = 8294400
	}
	g := gcd(a, b)
	a /= g
	b /= g
	step := int(math.Floor(math.Sqrt(pixels/float64(a*b)) / 16))
	if step > 0 && a <= 32 && b <= 32 {
		w, h := a*step*16, b*step*16
		if w <= 3840 && h <= 3840 && w*h >= 655360 {
			return fmt.Sprintf("%dx%d", w, h), nil
		}
	}
	return fitImageSize(math.Sqrt(pixels*r), math.Sqrt(pixels/r)), nil
}
func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}
func fitImageSize(w, h float64) string {
	if w <= 0 || h <= 0 {
		return "auto"
	}
	r := w / h
	if r > 3 {
		w = h * 3
	}
	if r < 1.0/3 {
		h = w * 3
	}
	scale := math.Min(1, math.Min(3840/math.Max(w, h), math.Sqrt(8294400/(w*h))))
	w *= scale
	h *= scale
	if w*h < 700000 {
		scale = math.Sqrt(700000 / (w * h))
		w *= scale
		h *= scale
	}
	wi, hi := int(w/16)*16, int(h/16)*16
	// Rounding at the 3:1 boundary must not widen the aspect ratio.
	if wi > hi*3 {
		wi = hi * 3
	}
	if hi > wi*3 {
		hi = wi * 3
	}
	return fmt.Sprintf("%dx%d", wi, hi)
}

func decodeImageData(src string) ([]byte, string, error) {
	format := ""
	encoded := src
	if strings.HasPrefix(src, "data:") {
		parts := strings.SplitN(src, ",", 2)
		if len(parts) != 2 || !strings.HasSuffix(parts[0], ";base64") {
			return nil, "", fmt.Errorf("图片必须为 base64 data URL")
		}
		encoded = parts[1]
		format = strings.TrimSuffix(strings.TrimPrefix(parts[0], "data:image/"), ";base64")
	}
	if len(encoded) > 70*1024*1024 {
		return nil, "", fmt.Errorf("单张输入图片不能超过 50 MB")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, "", fmt.Errorf("无效的图片编码")
	}
	if len(data) >= 50*1024*1024 {
		return nil, "", fmt.Errorf("单张输入图片不能超过 50 MB")
	}
	mime := http.DetectContentType(data)
	switch mime {
	case "image/png":
		format = "png"
	case "image/jpeg":
		format = "jpeg"
	case "image/webp":
		format = "webp"
	default:
		return nil, "", fmt.Errorf("图片必须为 PNG、JPEG 或 WebP")
	}
	return data, format, nil
}
func imageFile(ctx context.Context, src string, client *http.Client) (io.Reader, error) {
	var data []byte
	var format string
	var err error
	if strings.HasPrefix(src, "https://") || strings.HasPrefix(src, "http://") {
		req, e := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
		if e != nil {
			return nil, e
		}
		resp, e := client.Do(req)
		if e != nil {
			return nil, e
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("读取图片失败: HTTP %d", resp.StatusCode)
		}
		data, e = io.ReadAll(io.LimitReader(resp.Body, 50*1024*1024))
		if e != nil {
			return nil, e
		}
		src = base64.StdEncoding.EncodeToString(data)
	}
	data, format, err = decodeImageData(src)
	if err != nil {
		return nil, err
	}
	return openai.File(bytes.NewReader(data), "input."+format, "image/"+format), nil
}
func validateMask(src, mask string) error {
	data, format, err := decodeImageData(mask)
	if err != nil {
		return err
	}
	if format != "png" || len(data) >= 4*1024*1024 {
		return fmt.Errorf("蒙版必须为小于 4 MB 的 PNG")
	}
	maskImg, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("无法读取蒙版")
	}
	original, _, err := decodeImageData(src)
	if err != nil {
		return err
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(original))
	if err != nil {
		return err
	}
	if maskImg.Bounds().Dx() != cfg.Width || maskImg.Bounds().Dy() != cfg.Height {
		return fmt.Errorf("蒙版与第一张图片尺寸必须一致")
	}
	transparent := false
	bounds := maskImg.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y && !transparent; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, a := maskImg.At(x, y).RGBA()
			if a == 0 {
				transparent = true
				break
			}
		}
	}
	if !transparent {
		return fmt.Errorf("蒙版需要透明区域以指定待编辑的位置")
	}
	return nil
}
func imageDataURL(b64, format string) (string, error) {
	if b64 == "" {
		return "", fmt.Errorf("模型未返回有效图片")
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", fmt.Errorf("模型返回的图片编码无效")
	}
	// MIME comes from bytes, so intermediaries cannot accidentally label JPEG as PNG.
	mime := http.DetectContentType(data)
	if !oneOf(mime, "image/png", "image/jpeg", "image/webp") {
		return "", fmt.Errorf("模型返回的内容不是支持的图片格式")
	}
	return "data:" + mime + ";base64," + b64, nil
}
func imageResult(resp *openai.ImagesResponse, format string) (string, error) {
	if len(resp.Data) == 0 {
		return "", fmt.Errorf("模型未返回图片")
	}
	if resp.Data[0].B64JSON != "" {
		return imageDataURL(resp.Data[0].B64JSON, format)
	}
	if resp.Data[0].URL != "" {
		return resp.Data[0].URL, nil
	}
	return "", fmt.Errorf("模型返回空图片")
}

func normalizeOpenAIInputs(images []string) ([]string, error) {
	result := make([]string, len(images))
	for i, src := range images {
		if strings.HasPrefix(src, "https://") || strings.HasPrefix(src, "http://") {
			result[i] = src
			continue
		}
		data, format, err := decodeImageData(src)
		if err != nil {
			return nil, fmt.Errorf("输入图片 %d: %w", i+1, err)
		}
		result[i] = "data:image/" + format + ";base64," + base64.StdEncoding.EncodeToString(data)
	}
	return result, nil
}
