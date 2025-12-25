package service

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type ImageStorage struct {
	imagesDir string
	mu        sync.RWMutex // 保护文件操作
}

func NewImageStorage(dataDir string) *ImageStorage {
	return &ImageStorage{
		imagesDir: filepath.Join(dataDir, "images"),
	}
}

func (s *ImageStorage) Initialize() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(s.imagesDir, 0755); err != nil {
		return fmt.Errorf("failed to create images directory: %w", err)
	}

	return nil
}

func extractBase64Data(dataURL string) string {
	parts := strings.Split(dataURL, ",")
	if len(parts) == 2 {
		return parts[1]
	}
	return dataURL
}

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

func getFileExtension(mimeType string) string {
	mimeType = strings.TrimSpace(strings.Split(mimeType, ";")[0])
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

// saveImageBytes stores raw bytes and returns an image ref.
func (s *ImageStorage) saveImageBytes(imageData []byte, mimeType string) (string, error) {
	if len(imageData) == 0 {
		return "", fmt.Errorf("empty image data")
	}

	if mimeType == "" {
		mimeType = http.DetectContentType(imageData)
	}

	hash := sha256.Sum256(imageData)
	hashHex := hex.EncodeToString(hash[:])

	ext := getFileExtension(mimeType)

	fileName := hashHex + ext
	filePath := filepath.Join(s.imagesDir, fileName)

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := os.Stat(filePath); err == nil {
		return s.getImageRef(fileName), nil
	}

	if err := os.WriteFile(filePath, imageData, 0644); err != nil {
		return "", fmt.Errorf("failed to write image file: %w", err)
	}

	return s.getImageRef(fileName), nil
}

// SaveImage stores a data URL and returns an image ref.
func (s *ImageStorage) SaveImage(dataURL string) (string, error) {
	if dataURL == "" {
		return "", nil
	}

	// Extract base64 payload
	base64Data := extractBase64Data(dataURL)
	if base64Data == "" {
		return "", fmt.Errorf("invalid image data URL")
	}

	// Decode base64
	imageData, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 image: %w", err)
	}

	// Determine MIME type
	mimeType := extractMimeType(dataURL)
	return s.saveImageBytes(imageData, mimeType)
}


func (s *ImageStorage) LoadImage(imageRef string) (string, error) {
	if imageRef == "" {
		return "", nil
	}

	fileName := s.parseImageRef(imageRef)
	if fileName == "" {
		return "", fmt.Errorf("invalid image reference: %s", imageRef)
	}

	filePath := filepath.Join(s.imagesDir, fileName)

	s.mu.RLock()
	defer s.mu.RUnlock()

	imageData, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read image file: %w", err)
	}

	base64Data := base64.StdEncoding.EncodeToString(imageData)

	mimeType := "image/png"
	if strings.HasSuffix(fileName, ".jpg") || strings.HasSuffix(fileName, ".jpeg") {
		mimeType = "image/jpeg"
	} else if strings.HasSuffix(fileName, ".webp") {
		mimeType = "image/webp"
	} else if strings.HasSuffix(fileName, ".gif") {
		mimeType = "image/gif"
	}

	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
}

// SaveImageFromURL fetches an image by URL and stores it locally.
func (s *ImageStorage) SaveImageFromURL(imageURL string) (string, error) {
	if imageURL == "" {
		return "", nil
	}

	resp, err := http.Get(imageURL)
	if err != nil {
		return "", fmt.Errorf("failed to fetch image url: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("failed to fetch image url: status %d", resp.StatusCode)
	}

	imageData, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read image body: %w", err)
	}

	mimeType := resp.Header.Get("Content-Type")
	return s.saveImageBytes(imageData, mimeType)
}


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

func (s *ImageStorage) getImageRef(fileName string) string {
	return fmt.Sprintf("images/%s", fileName)
}

// GetImagePath returns the absolute path for an image ref.
func (s *ImageStorage) GetImagePath(imageRef string) (string, error) {
	if imageRef == "" {
		return "", nil
	}

	fileName := s.parseImageRef(imageRef)
	if fileName == "" {
		return "", fmt.Errorf("invalid image reference: %s", imageRef)
	}

	cleaned := filepath.Clean(fileName)
	if cleaned == "." || cleaned == ".." || cleaned != filepath.Base(cleaned) {
		return "", fmt.Errorf("invalid image reference: %s", imageRef)
	}

	return filepath.Join(s.imagesDir, cleaned), nil
}


func (s *ImageStorage) parseImageRef(imageRef string) string {
	if strings.HasPrefix(imageRef, "/images/") {
		return strings.TrimPrefix(imageRef, "/images/")
	}
	if strings.HasPrefix(imageRef, "images/") {
		return strings.TrimPrefix(imageRef, "images/")
	}
	return imageRef
}

func (s *ImageStorage) CleanupUnusedImages(usedRefs map[string]bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.imagesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 目录不存在，无需清理
		}
		return fmt.Errorf("failed to read images directory: %w", err)
	}

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

