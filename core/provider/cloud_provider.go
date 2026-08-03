package provider

import (
	"artifex/core/types"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ==================== Cloud 能力声明 ====================

// cloudCapabilities Cloud 提供商的功能支持矩阵
var cloudCapabilities = ProviderCapabilities{
	GenerateImage:    true,
	EditImage:        true,
	RemoveBackground: true,
	ReferenceImage:   true,
}

// ==================== CloudProvider 实现 ====================

// CloudProvider 云 AI 提供商
// 通过 HTTP 调用配置的云服务端点，直接转发参数
type CloudProvider struct {
	ctx         context.Context
	endpointURL string
	httpClient  *http.Client
	settings    types.AISettings
}

// NewCloudProvider 创建云提供商实例
func NewCloudProvider(ctx context.Context, settings types.AISettings) (*CloudProvider, error) {
	if settings.CloudEndpointURL == "" {
		return nil, fmt.Errorf("cloud endpoint URL not configured")
	}

	// 创建 HTTP 客户端，设置合理的超时时间
	httpClient := &http.Client{
		Timeout: 5 * time.Minute, // 图像生成可能需要较长时间
	}

	return &CloudProvider{
		ctx:         ctx,
		endpointURL: settings.CloudEndpointURL,
		httpClient:  httpClient,
		settings:    settings,
	}, nil
}

// Name 返回提供商名称
func (p *CloudProvider) Name() string {
	return "cloud"
}

// GetCapabilities 返回提供商支持的功能
func (p *CloudProvider) GetCapabilities() ProviderCapabilities {
	return cloudCapabilities
}

// CheckAvailability 检测服务可用性
func (p *CloudProvider) CheckAvailability(ctx context.Context) (bool, error) {
	if p.endpointURL == "" {
		return false, fmt.Errorf("cloud endpoint URL not configured")
	}

	// 创建一个带超时的上下文
	testCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	url := buildCloudURL(p.endpointURL, "health")

	// 创建 HTTP 请求
	req, err := http.NewRequestWithContext(testCtx, "GET", url, nil)
	if err != nil {
		return false, fmt.Errorf("failed to create request: %w", err)
	}

	// 设置请求头
	req.Header.Set("Content-Type", "application/json")

	// 如果配置了 Token，添加到 Authorization 头
	if p.settings.CloudToken != "" {
		req.Header.Set("Authorization", "Bearer "+p.settings.CloudToken)
	}

	// 发送请求
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("cloud service unavailable: %w", err)
	}
	defer resp.Body.Close()

	// 检查 HTTP 状态码
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return false, fmt.Errorf("cloud service returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return true, nil
}

// Close 清理资源
func (p *CloudProvider) Close() error {
	if p.httpClient != nil {
		p.httpClient.CloseIdleConnections()
	}
	return nil
}

// ==================== API 方法实现 ====================

// GenerateImage 生成图像
func (p *CloudProvider) GenerateImage(ctx context.Context, params types.GenerateImageParams) (string, error) {
	return p.callCloudAPI(ctx, "generateImage", params)
}

// EditMultiImages 多图编辑/融合
// 支持单图或多图编辑（单图时也使用此方法）
func (p *CloudProvider) EditMultiImages(ctx context.Context, params types.MultiImageEditParams) (string, error) {
	if len(params.Images) < 1 {
		return "", fmt.Errorf("at least 1 image is required")
	}
	return p.callCloudAPI(ctx, "editMultiImages", params)
}

func (p *CloudProvider) RecognizeIntent(ctx context.Context, params types.IntentRecognitionParams) (string, error) {
	return p.callCloudAPI(ctx, "recognizeIntent", params)
}

// ==================== 辅助函数 ====================

// callCloudAPI 调用云服务 API，直接转发参数
func (p *CloudProvider) callCloudAPI(ctx context.Context, endpoint string, requestData interface{}) (string, error) {
	url := buildCloudURL(p.endpointURL, endpoint)

	// 序列化请求数据
	requestBody, err := json.Marshal(requestData)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	// 创建 HTTP 请求
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(requestBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	// 设置请求头
	req.Header.Set("Content-Type", "application/json")

	// 如果配置了 Token，添加到 Authorization 头
	if p.settings.CloudToken != "" {
		req.Header.Set("Authorization", "Bearer "+p.settings.CloudToken)
	}

	// 发送请求
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	// 检查 HTTP 状态码
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("cloud API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	// 读取响应
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	// 解析响应
	var response map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &response); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	// 根据端点类型提取结果
	switch endpoint {
	case "recognizeIntent":
		var intentResponse types.IntentRecognitionResponse
		if err := json.Unmarshal(bodyBytes, &intentResponse); err != nil {
			return "", fmt.Errorf("invalid response format: expected 'intents' field")
		}
		if len(intentResponse.Intents) < 3 || len(intentResponse.Intents) > 5 {
			return "", fmt.Errorf("invalid response format: expected 3 to 5 intents")
		}
		return string(bodyBytes), nil
	default:
		// 图像操作返回图像数据（data URI 格式）
		if imageData, ok := response["image"].(string); ok {
			return imageData, nil
		}
		if imageData, ok := response["imageData"].(string); ok {
			return imageData, nil
		}
		return "", fmt.Errorf("invalid response format: expected 'image' or 'imageData' field")
	}
}

func buildCloudURL(rawURL string, endpoint string) string {
	baseURL := strings.TrimSuffix(rawURL, "/")
	for _, operation := range []string{"generateImage", "editImage", "editMultiImages", "recognizeIntent"} {
		baseURL = strings.TrimSuffix(baseURL, "/"+operation)
	}
	return fmt.Sprintf("%s/%s", baseURL, endpoint)
}
