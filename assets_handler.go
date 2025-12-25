package main

import (
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const imageURLPrefix = "/images/"

// newImageAssetHandler 处理 images 目录下的静态图片请求
func newImageAssetHandler() http.Handler {
	imagesDir, err := resolveImagesDir()
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "image assets unavailable", http.StatusInternalServerError)
		})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cleaned := path.Clean(r.URL.Path)
		if !strings.HasPrefix(cleaned, imageURLPrefix) {
			http.NotFound(w, r)
			return
		}

		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		rel := strings.TrimPrefix(cleaned, imageURLPrefix)
		if rel == "" || strings.Contains(rel, "/") || strings.Contains(rel, "\\") {
			http.NotFound(w, r)
			return
		}

		filePath := filepath.Join(imagesDir, rel)
		info, err := os.Stat(filePath)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("ETag", fmt.Sprintf("\"%s\"", rel))
		http.ServeFile(w, r, filePath)
	})
}

func resolveImagesDir() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}

	return filepath.Join(filepath.Dir(exePath), "config", "images"), nil
}
