package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	defaultProjectID      = "default"
	projectsDirName       = "projects"
	activeProjectFileName = "active_project.json"
)

var projectIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type activeProjectState struct {
	ID string `json:"id"`
}

// ProjectInfo 项目信息
type ProjectInfo struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

// ProjectService 项目管理服务
// 负责项目目录创建、切换与当前项目状态维护
type ProjectService struct {
	ctx               context.Context
	configDir         string
	projectsDir       string
	activeProjectFile string
}

// NewProjectService 创建项目管理服务实例
func NewProjectService() *ProjectService {
	return &ProjectService{}
}

// Startup 初始化项目服务
func (p *ProjectService) Startup(ctx context.Context) error {
	p.ctx = ctx

	configDir, err := resolveConfigRoot()
	if err != nil {
		return fmt.Errorf("failed to resolve config root: %w", err)
	}
	p.configDir = configDir
	p.projectsDir = filepath.Join(configDir, projectsDirName)
	p.activeProjectFile = filepath.Join(configDir, activeProjectFileName)

	if err := ensureActiveProject(p.configDir, p.projectsDir, p.activeProjectFile); err != nil {
		return fmt.Errorf("failed to initialize active project: %w", err)
	}

	if err := mergeProjectImagesToGlobal(p.configDir, p.projectsDir); err != nil {
		fmt.Printf("[ProjectService] Warning: failed to merge project images: %v\n", err)
	}

	return nil
}

// GetActiveProject 获取当前项目
func (p *ProjectService) GetActiveProject() (ProjectInfo, error) {
	if err := ensureActiveProject(p.configDir, p.projectsDir, p.activeProjectFile); err != nil {
		return ProjectInfo{}, err
	}

	projectID, err := readActiveProjectID(p.activeProjectFile)
	if err != nil {
		return ProjectInfo{}, err
	}

	return ProjectInfo{
		ID:   projectID,
		Path: filepath.Join(p.projectsDir, projectID),
	}, nil
}

// ListProjects 获取项目列表
func (p *ProjectService) ListProjects() ([]ProjectInfo, error) {
	if err := ensureActiveProject(p.configDir, p.projectsDir, p.activeProjectFile); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(p.projectsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read projects dir: %w", err)
	}

	projects := make([]ProjectInfo, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !isValidProjectID(name) {
			continue
		}
		projects = append(projects, ProjectInfo{
			ID:   name,
			Path: filepath.Join(p.projectsDir, name),
		})
	}

	sort.Slice(projects, func(i, j int) bool {
		return projects[i].ID < projects[j].ID
	})

	return projects, nil
}

// CreateProject 创建项目并设为当前项目
func (p *ProjectService) CreateProject(projectID string) (ProjectInfo, error) {
	if err := ensureActiveProject(p.configDir, p.projectsDir, p.activeProjectFile); err != nil {
		return ProjectInfo{}, err
	}

	if err := validateProjectID(projectID); err != nil {
		return ProjectInfo{}, err
	}

	projectDir := filepath.Join(p.projectsDir, projectID)
	if _, err := os.Stat(projectDir); err == nil {
		return ProjectInfo{}, fmt.Errorf("project already exists: %s", projectID)
	} else if !os.IsNotExist(err) {
		return ProjectInfo{}, fmt.Errorf("failed to check project: %w", err)
	}

	if err := os.MkdirAll(projectDir, 0755); err != nil {
		return ProjectInfo{}, fmt.Errorf("failed to create project dir: %w", err)
	}

	if err := writeActiveProjectID(p.activeProjectFile, projectID); err != nil {
		return ProjectInfo{}, err
	}

	return ProjectInfo{
		ID:   projectID,
		Path: projectDir,
	}, nil
}

// SelectProjectDirectory 打开目录选择对话框
func (p *ProjectService) SelectProjectDirectory() (string, error) {
	if p.ctx == nil {
		return "", fmt.Errorf("service not initialized")
	}

	if err := ensureActiveProject(p.configDir, p.projectsDir, p.activeProjectFile); err != nil {
		return "", err
	}

	return runtime.OpenDirectoryDialog(p.ctx, runtime.OpenDialogOptions{
		Title:            "选择项目目录",
		DefaultDirectory: p.projectsDir,
	})
}

// OpenProject 打开已存在项目并设为当前项目
func (p *ProjectService) OpenProject(projectPath string) (ProjectInfo, error) {
	if err := ensureActiveProject(p.configDir, p.projectsDir, p.activeProjectFile); err != nil {
		return ProjectInfo{}, err
	}

	if strings.TrimSpace(projectPath) == "" {
		return ProjectInfo{}, fmt.Errorf("project path is empty")
	}

	absPath, err := filepath.Abs(projectPath)
	if err != nil {
		return ProjectInfo{}, fmt.Errorf("failed to resolve project path: %w", err)
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return ProjectInfo{}, fmt.Errorf("project path not found: %w", err)
	}
	if !info.IsDir() {
		return ProjectInfo{}, fmt.Errorf("project path is not a directory")
	}

	projectID := filepath.Base(absPath)
	if err := validateProjectID(projectID); err != nil {
		return ProjectInfo{}, err
	}

	if !isDirectProjectChild(p.projectsDir, absPath) {
		return ProjectInfo{}, fmt.Errorf("project path must be inside %s", p.projectsDir)
	}

	if err := writeActiveProjectID(p.activeProjectFile, projectID); err != nil {
		return ProjectInfo{}, err
	}

	return ProjectInfo{
		ID:   projectID,
		Path: absPath,
	}, nil
}

// ResolveActiveProjectDir 获取当前项目目录路径
func ResolveActiveProjectDir() (string, error) {
	configDir, err := resolveConfigRoot()
	if err != nil {
		return "", err
	}

	projectsDir := filepath.Join(configDir, projectsDirName)
	activeProjectFile := filepath.Join(configDir, activeProjectFileName)

	if err := ensureActiveProject(configDir, projectsDir, activeProjectFile); err != nil {
		return "", err
	}

	projectID, err := readActiveProjectID(activeProjectFile)
	if err != nil {
		return "", err
	}

	return filepath.Join(projectsDir, projectID), nil
}

func resolveConfigRoot() (string, error) {
	exeDir, err := getExecutableDir()
	if err != nil {
		return "", fmt.Errorf("failed to get executable dir: %w", err)
	}
	return filepath.Join(exeDir, "config"), nil
}

func ensureActiveProject(configDir, projectsDir, activeProjectFile string) error {
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("failed to create config dir: %w", err)
	}
	if err := os.MkdirAll(projectsDir, 0755); err != nil {
		return fmt.Errorf("failed to create projects dir: %w", err)
	}

	if _, err := os.Stat(activeProjectFile); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to stat active project file: %w", err)
	}

	entries, err := os.ReadDir(projectsDir)
	if err == nil && len(entries) > 0 {
		for _, entry := range entries {
			if entry.IsDir() && isValidProjectID(entry.Name()) {
				return writeActiveProjectID(activeProjectFile, entry.Name())
			}
		}
	}

	defaultDir := filepath.Join(projectsDir, defaultProjectID)
	if legacyDataExists(configDir) {
		if err := os.MkdirAll(defaultDir, 0755); err != nil {
			return fmt.Errorf("failed to create default project dir: %w", err)
		}
		if err := migrateLegacyData(configDir, defaultDir); err != nil {
			return err
		}
	} else if err := os.MkdirAll(defaultDir, 0755); err != nil {
		return fmt.Errorf("failed to create default project dir: %w", err)
	}

	return writeActiveProjectID(activeProjectFile, defaultProjectID)
}

func legacyDataExists(configDir string) bool {
	legacyFiles := []string{
		"chat_history.json",
		"canvas_history.json",
		"chat_history.json.zst",
		"canvas_history.json.zst",
	}

	for _, name := range legacyFiles {
		if _, err := os.Stat(filepath.Join(configDir, name)); err == nil {
			return true
		}
	}

	return false
}

func migrateLegacyData(configDir, projectDir string) error {
	legacyFiles := []string{
		"chat_history.json",
		"canvas_history.json",
		"chat_history.json.zst",
		"canvas_history.json.zst",
	}

	for _, name := range legacyFiles {
		src := filepath.Join(configDir, name)
		if _, err := os.Stat(src); err != nil {
			continue
		}

		dst := filepath.Join(projectDir, name)
		if _, err := os.Stat(dst); err == nil {
			continue
		}

		if err := os.Rename(src, dst); err != nil {
			return fmt.Errorf("failed to migrate %s: %w", name, err)
		}
	}

	return nil
}

func readActiveProjectID(activeProjectFile string) (string, error) {
	data, err := os.ReadFile(activeProjectFile)
	if err != nil {
		if os.IsNotExist(err) {
			return defaultProjectID, nil
		}
		return "", fmt.Errorf("failed to read active project file: %w", err)
	}

	var state activeProjectState
	if err := json.Unmarshal(data, &state); err != nil || state.ID == "" {
		return defaultProjectID, nil
	}

	if !isValidProjectID(state.ID) {
		return defaultProjectID, nil
	}

	return state.ID, nil
}

func writeActiveProjectID(activeProjectFile, projectID string) error {
	if err := validateProjectID(projectID); err != nil {
		return err
	}

	state := activeProjectState{ID: projectID}
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("failed to serialize active project: %w", err)
	}

	if err := os.WriteFile(activeProjectFile, data, 0644); err != nil {
		return fmt.Errorf("failed to write active project file: %w", err)
	}

	return nil
}

func validateProjectID(projectID string) error {
	if strings.TrimSpace(projectID) == "" {
		return fmt.Errorf("project id is empty")
	}
	if !isValidProjectID(projectID) {
		return fmt.Errorf("project id must match [a-zA-Z0-9_-]")
	}
	return nil
}

func isValidProjectID(projectID string) bool {
	return projectIDPattern.MatchString(projectID)
}

func isDirectProjectChild(projectsDir, projectPath string) bool {
	rel, err := filepath.Rel(projectsDir, projectPath)
	if err != nil {
		return false
	}
	if rel == "." || strings.HasPrefix(rel, "..") {
		return false
	}
	return !strings.Contains(rel, string(os.PathSeparator))
}

// mergeProjectImagesToGlobal 将项目目录中的图片迁移到全局 images 目录
// 用于从旧的“按项目存图”过渡到“全局图片目录”
func mergeProjectImagesToGlobal(configDir, projectsDir string) error {
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to read projects dir: %w", err)
	}

	globalImagesDir := filepath.Join(configDir, "images")
	if err := os.MkdirAll(globalImagesDir, 0755); err != nil {
		return fmt.Errorf("failed to create global images dir: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		projectImagesDir := filepath.Join(projectsDir, entry.Name(), "images")
		imagesEntries, err := os.ReadDir(projectImagesDir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return fmt.Errorf("failed to read project images: %w", err)
		}

		for _, imgEntry := range imagesEntries {
			if imgEntry.IsDir() {
				continue
			}
			src := filepath.Join(projectImagesDir, imgEntry.Name())
			dst := filepath.Join(globalImagesDir, imgEntry.Name())

			if _, err := os.Stat(dst); err == nil {
				continue
			}
			if err := os.Rename(src, dst); err != nil {
				return fmt.Errorf("failed to move image %s: %w", imgEntry.Name(), err)
			}
		}
	}

	return nil
}
