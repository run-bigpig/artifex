package service

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// ImageStorage 图片存储管理器
// 负责将图片数据从 JSON 中分离出来，存储到独立文件中
// 使用 SHA256 哈希作为文件名，实现去重
type ImageStorage struct {
	imagesDir string
	mu        sync.RWMutex // 保护文件操作
}

// NewImageStorage 创建图片存储管理器
func NewImageStorage(dataDir string) *ImageStorage {
	return &ImageStorage{
		imagesDir: filepath.Join(dataDir, "images"),
	}
}

// Initialize 初始化图片存储目录
func (s *ImageStorage) Initialize() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(s.imagesDir, 0755); err != nil {
		return fmt.Errorf("failed to create images directory: %w", err)
	}

	return nil
}

// extractBase64Data 从 data URL 中提取 base64 数据
func extractBase64Data(dataURL string) string {
	parts := strings.Split(dataURL, ",")
	if len(parts) == 2 {
		return parts[1]
	}
	return dataURL
}

// extractMimeType 从 data URL 中提取 MIME 类型
func extractMimeType(dataURL string) string {
	if !strings.HasPrefix(dataURL, "data:") {
		return "image/png" // 默认类型
	}

	parts := strings.Split(dataURL, ";")
	if len(parts) > 0 {
		mimeType := strings.TrimPrefix(parts[0], "data:")
		if mimeType != "" {
			return mimeType
		}
	}

	return "image/png" // 默认类型
}

// getFileExtension 根据 MIME 类型获取文件扩展名
func getFileExtension(mimeType string) string {
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".png" // 默认扩展名
	}
}

// SaveImage 保存图片数据，返回图片引用（文件路径）
// 如果图片已存在，直接返回现有路径（去重）
func (s *ImageStorage) SaveImage(dataURL string) (string, error) {
	if dataURL == "" {
		return "", nil
	}

	// 提取 base64 数据
	base64Data := extractBase64Data(dataURL)
	if base64Data == "" {
		return "", fmt.Errorf("invalid image data URL")
	}

	// 解码 base64
	imageData, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 image: %w", err)
	}

	// 计算 SHA256 哈希
	hash := sha256.Sum256(imageData)
	hashHex := hex.EncodeToString(hash[:])

	// 获取文件扩展名
	mimeType := extractMimeType(dataURL)
	ext := getFileExtension(mimeType)

	// 构建文件路径
	fileName := hashHex + ext
	filePath := filepath.Join(s.imagesDir, fileName)

	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查文件是否已存在（去重）
	if _, err := os.Stat(filePath); err == nil {
		// 文件已存在，返回引用
		return s.getImageRef(fileName), nil
	}

	// 写入文件
	if err := os.WriteFile(filePath, imageData, 0644); err != nil {
		return "", fmt.Errorf("failed to write image file: %w", err)
	}

	return s.getImageRef(fileName), nil
}

// LoadImage 加载图片数据，返回 data URL
func (s *ImageStorage) LoadImage(imageRef string) (string, error) {
	if imageRef == "" {
		return "", nil
	}

	// 解析图片引用（格式：images/{hash}.{ext}）
	fileName := s.parseImageRef(imageRef)
	if fileName == "" {
		return "", fmt.Errorf("invalid image reference: %s", imageRef)
	}

	filePath := filepath.Join(s.imagesDir, fileName)

	s.mu.RLock()
	defer s.mu.RUnlock()

	// 读取文件
	imageData, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read image file: %w", err)
	}

	// 编码为 base64
	base64Data := base64.StdEncoding.EncodeToString(imageData)

	// 根据文件扩展名确定 MIME 类型
	mimeType := "image/png"
	if strings.HasSuffix(fileName, ".jpg") || strings.HasSuffix(fileName, ".jpeg") {
		mimeType = "image/jpeg"
	} else if strings.HasSuffix(fileName, ".webp") {
		mimeType = "image/webp"
	} else if strings.HasSuffix(fileName, ".gif") {
		mimeType = "image/gif"
	}

	// 构建 data URL
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
}

// SaveImages 批量保存图片，返回图片引用数组
func (s *ImageStorage) SaveImages(dataURLs []string) ([]string, error) {
	if len(dataURLs) == 0 {
		return nil, nil
	}

	refs := make([]string, 0, len(dataURLs))
	for _, dataURL := range dataURLs {
		if dataURL == "" {
			refs = append(refs, "")
			continue
		}

		ref, err := s.SaveImage(dataURL)
		if err != nil {
			return nil, fmt.Errorf("failed to save image: %w", err)
		}
		refs = append(refs, ref)
	}

	return refs, nil
}

// LoadImages 批量加载图片，返回 data URL 数组
func (s *ImageStorage) LoadImages(imageRefs []string) ([]string, error) {
	if len(imageRefs) == 0 {
		return nil, nil
	}

	dataURLs := make([]string, 0, len(imageRefs))
	for _, ref := range imageRefs {
		if ref == "" {
			dataURLs = append(dataURLs, "")
			continue
		}

		dataURL, err := s.LoadImage(ref)
		if err != nil {
			return nil, fmt.Errorf("failed to load image: %w", err)
		}
		dataURLs = append(dataURLs, dataURL)
	}

	return dataURLs, nil
}

// getImageRef 生成图片引用（相对路径）
func (s *ImageStorage) getImageRef(fileName string) string {
	return fmt.Sprintf("images/%s", fileName)
}

// parseImageRef 解析图片引用，返回文件名
func (s *ImageStorage) parseImageRef(imageRef string) string {
	// 移除 "images/" 前缀
	if strings.HasPrefix(imageRef, "/images/") {
		return strings.TrimPrefix(imageRef, "/images/")
	}
	if strings.HasPrefix(imageRef, "images/") {
		return strings.TrimPrefix(imageRef, "images/")
	}
	return imageRef
}

// CleanupUnusedImages 清理未使用的图片文件
// 需要传入当前使用的所有图片引用
func (s *ImageStorage) CleanupUnusedImages(usedRefs map[string]bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 读取图片目录中的所有文件
	entries, err := os.ReadDir(s.imagesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 目录不存在，无需清理
		}
		return fmt.Errorf("failed to read images directory: %w", err)
	}

	// 删除未使用的文件
	deletedCount := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		fileName := entry.Name()
		ref := s.getImageRef(fileName)

		if !usedRefs[ref] {
			filePath := filepath.Join(s.imagesDir, fileName)
			if err := os.Remove(filePath); err != nil {
				fmt.Printf("[ImageStorage] Warning: failed to delete unused image %s: %v\n", fileName, err)
				continue
			}
			deletedCount++
		}
	}

	if deletedCount > 0 {
		fmt.Printf("[ImageStorage] Cleaned up %d unused image files\n", deletedCount)
	}

	return nil
}

// GetStorageSize 获取图片存储目录的总大小（字节）
func (s *ImageStorage) GetStorageSize() (int64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var totalSize int64

	err := filepath.Walk(s.imagesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			totalSize += info.Size()
		}
		return nil
	})

	return totalSize, err
}

