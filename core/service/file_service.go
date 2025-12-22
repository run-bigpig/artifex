package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// FileService 文件管理服务
// 提供图片导出功能
type FileService struct {
	ctx context.Context
}

// NewFileService 创建文件服务实例
func NewFileService() *FileService {
	return &FileService{}
}

// Startup 在应用启动时调用
func (f *FileService) Startup(ctx context.Context) {
	f.ctx = ctx
}

// ExportImage 导出图像到文件
// imageDataURL: base64 编码的图像数据 (data:image/png;base64,...)
// suggestedName: 建议的文件名
// format: 导出格式 ("png", "jpeg", "webp")，如果为空则从文件名推断
// exportDir: 导出目录（可选），如果为空则显示文件保存对话框
func (f *FileService) ExportImage(imageDataURL string, suggestedName string, format string, exportDir string) (string, error) {
	if f.ctx == nil {
		return "", fmt.Errorf("service not initialized")
	}

	// 确定文件名
	defaultFilename := suggestedName
	if defaultFilename == "" {
		ext := ".png"
		if format != "" {
			switch format {
			case "jpeg":
				ext = ".jpg"
			case "webp":
				ext = ".webp"
			}
		}
		defaultFilename = fmt.Sprintf("artifexBot-export-%d%s", time.Now().Unix(), ext)
	}

	var filePath string
	var err error

	// 如果指定了导出目录，直接保存到该目录
	if exportDir != "" {
		// 确保目录存在
		if err := os.MkdirAll(exportDir, 0755); err != nil {
			return "", fmt.Errorf("failed to create export directory: %w", err)
		}
		filePath = filepath.Join(exportDir, defaultFilename)
	} else {
		// 显示保存对话框
		// 构建文件过滤器
		filters := []runtime.FileFilter{
			{
				DisplayName: "PNG Image (*.png)",
				Pattern:     "*.png",
			},
			{
				DisplayName: "JPEG Image (*.jpg)",
				Pattern:     "*.jpg;*.jpeg",
			},
			{
				DisplayName: "WebP Image (*.webp)",
				Pattern:     "*.webp",
			},
			{
				DisplayName: "All Images",
				Pattern:     "*.png;*.jpg;*.jpeg;*.webp",
			},
		}

		filePath, err = runtime.SaveFileDialog(f.ctx, runtime.SaveDialogOptions{
			DefaultFilename: defaultFilename,
			Title:           "Export Image",
			Filters:         filters,
		})

		if err != nil {
			return "", fmt.Errorf("save dialog error: %w", err)
		}

		// 用户取消了保存
		if filePath == "" {
			return "", nil
		}
	}

	// 解析 base64 数据
	// 格式: data:image/png;base64,iVBORw0KGgo...
	const base64Prefix = "data:image/"
	if len(imageDataURL) < len(base64Prefix) {
		return "", fmt.Errorf("invalid image data URL")
	}

	// 找到 base64 数据的起始位置
	base64Start := 0
	for i, c := range imageDataURL {
		if c == ',' {
			base64Start = i + 1
			break
		}
	}

	if base64Start == 0 {
		return "", fmt.Errorf("invalid image data URL format")
	}

	// 解码 base64
	imageData, err := base64.StdEncoding.DecodeString(imageDataURL[base64Start:])
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 image: %w", err)
	}

	// 写入文件
	if err := os.WriteFile(filePath, imageData, 0644); err != nil {
		return "", fmt.Errorf("failed to write image file: %w", err)
	}

	return filePath, nil
}

// ExportSliceImages 批量导出切片图像到指定目录
// slicesJSON: 包含切片数据的 JSON 字符串，格式为 [{"dataUrl": "...", "id": 0}, ...]
// 返回保存的文件路径列表的 JSON 字符串
func (f *FileService) ExportSliceImages(slicesJSON string) (string, error) {
	if f.ctx == nil {
		return "", fmt.Errorf("service not initialized")
	}

	// 解析切片数据
	var slices []struct {
		DataURL string `json:"dataUrl"`
		ID      int    `json:"id"`
	}
	if err := json.Unmarshal([]byte(slicesJSON), &slices); err != nil {
		return "", fmt.Errorf("invalid slices data: %w", err)
	}

	if len(slices) == 0 {
		return "", fmt.Errorf("no slices to export")
	}

	// 让用户选择保存目录
	dirPath, err := runtime.OpenDirectoryDialog(f.ctx, runtime.OpenDialogOptions{
		Title: "选择保存切片图像的目录",
	})
	if err != nil {
		return "", fmt.Errorf("directory dialog error: %w", err)
	}

	// 用户取消了选择
	if dirPath == "" {
		return "", nil
	}

	// 保存的文件路径列表
	savedPaths := make([]string, 0, len(slices))

	// 保存每个切片
	for _, slice := range slices {
		// 解析 base64 数据
		const base64Prefix = "data:image/"
		if len(slice.DataURL) < len(base64Prefix) {
			continue // 跳过无效的数据
		}

		// 找到 base64 数据的起始位置
		base64Start := 0
		for i, c := range slice.DataURL {
			if c == ',' {
				base64Start = i + 1
				break
			}
		}

		if base64Start == 0 {
			continue // 跳过无效格式
		}

		// 解码 base64
		imageData, err := base64.StdEncoding.DecodeString(slice.DataURL[base64Start:])
		if err != nil {
			continue // 跳过解码失败的数据
		}

		// 生成文件名
		fileName := fmt.Sprintf("slice-%d.png", slice.ID+1)
		filePath := filepath.Join(dirPath, fileName)

		// 写入文件
		if err := os.WriteFile(filePath, imageData, 0644); err != nil {
			continue // 跳过写入失败的文件
		}

		savedPaths = append(savedPaths, filePath)
	}

	// 返回保存的文件路径列表
	result := struct {
		Directory string   `json:"directory"`
		Files     []string `json:"files"`
		Count     int      `json:"count"`
	}{
		Directory: dirPath,
		Files:     savedPaths,
		Count:     len(savedPaths),
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("failed to serialize result: %w", err)
	}

	return string(resultJSON), nil
}
