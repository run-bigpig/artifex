package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"

	"github.com/blang/semver"
	"github.com/run-bigpig/go-github-selfupdate/selfupdate"
)

// UpdateService 更新检测服务
// 负责从 GitHub Releases 检测和下载更新
type UpdateService struct {
	ctx            context.Context
	repoOwner      string // GitHub 仓库所有者
	repoName       string // GitHub 仓库名称
	currentVersion string // 当前版本号
}

// UpdateInfo 更新信息
type UpdateInfo struct {
	HasUpdate      bool   `json:"hasUpdate"`
	LatestVersion  string `json:"latestVersion"`
	CurrentVersion string `json:"currentVersion"`
	ReleaseURL     string `json:"releaseUrl"`
	ReleaseNotes   string `json:"releaseNotes"`
	Error          string `json:"error,omitempty"`
}

// UpdateProgress 更新进度信息
type UpdateProgress struct {
	Status  string `json:"status"`  // "checking", "downloading", "installing", "completed", "error"
	Message string `json:"message"` // 状态消息
	Percent int    `json:"percent"`  // 进度百分比 (0-100)
}

// NewUpdateService 创建更新服务实例
func NewUpdateService(repoOwner, repoName, currentVersion string) *UpdateService {
	return &UpdateService{
		repoOwner:      repoOwner,
		repoName:       repoName,
		currentVersion: currentVersion,
	}
}

// Startup 在应用启动时调用
func (u *UpdateService) Startup(ctx context.Context) {
	u.ctx = ctx
}

// CheckForUpdate 检查是否有可用更新
func (u *UpdateService) CheckForUpdate() (UpdateInfo, error) {
	repo := fmt.Sprintf("%s/%s", u.repoOwner, u.repoName)
	latest, found, err := selfupdate.DetectLatest(repo)
	if err != nil {
		return UpdateInfo{
			HasUpdate:      false,
			CurrentVersion: u.currentVersion,
			Error:          fmt.Sprintf("检测更新失败: %v", err),
		}, nil // 返回错误信息但不返回 error，让前端可以显示
	}

	if !found {
		return UpdateInfo{
			HasUpdate:      false,
			CurrentVersion: u.currentVersion,
			LatestVersion:  u.currentVersion,
		}, nil
	}

	// 解析当前版本并比较
	currentVer, err := semver.ParseTolerant(u.currentVersion)
	if err != nil {
		// 如果解析失败，使用字符串比较
		hasUpdate := latest.Version.String() != u.currentVersion
		return UpdateInfo{
			HasUpdate:      hasUpdate,
			CurrentVersion: u.currentVersion,
			LatestVersion:  latest.Version.String(),
			ReleaseURL:     latest.URL,
			Error:          fmt.Sprintf("版本格式解析失败: %v", err),
		}, nil
	}

	// 使用 semver 比较版本
	hasUpdate := latest.Version.GT(currentVer)

	info := UpdateInfo{
		HasUpdate:      hasUpdate,
		CurrentVersion: u.currentVersion,
		LatestVersion:  latest.Version.String(),
		ReleaseURL:     latest.URL,
	}

	// 始终返回发布说明（如果存在），无论是否有更新
	if latest.ReleaseNotes != "" {
		info.ReleaseNotes = latest.ReleaseNotes
	}

	return info, nil
}

// CheckForUpdateJSON 检查更新并返回 JSON 格式
func (u *UpdateService) CheckForUpdateJSON() (string, error) {
	info, err := u.CheckForUpdate()
	if err != nil {
		return "", err
	}

	data, err := json.Marshal(info)
	if err != nil {
		return "", fmt.Errorf("failed to serialize update info: %w", err)
	}

	return string(data), nil
}

// GetCurrentVersion 获取当前版本
func (u *UpdateService) GetCurrentVersion() string {
	return u.currentVersion
}

// Update 执行更新（下载并替换当前可执行文件）
// 注意：在 Wails 应用中，更新完成后需要重启应用才能生效
func (u *UpdateService) Update() error {
	repo := fmt.Sprintf("%s/%s", u.repoOwner, u.repoName)
	
	// 检测最新版本
	latest, found, err := selfupdate.DetectLatest(repo)
	if err != nil {
		return fmt.Errorf("检测更新失败: %w", err)
	}

	if !found {
		return fmt.Errorf("未找到更新")
	}

	// 解析当前版本并检查是否需要更新
	currentVer, err := semver.ParseTolerant(u.currentVersion)
	if err != nil {
		return fmt.Errorf("版本格式解析失败: %w", err)
	}

	if !latest.Version.GT(currentVer) {
		return fmt.Errorf("已是最新版本")
	}

	// 获取当前可执行文件路径
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取可执行文件路径失败: %w", err)
	}

	// 执行更新（下载并替换可执行文件）
	// 注意：selfupdate.UpdateTo 会下载新版本并替换当前可执行文件
	// 更新完成后，应用需要重启才能使用新版本
	if err := selfupdate.UpdateTo(latest.AssetURL, exe); err != nil {
		return fmt.Errorf("更新失败: %w", err)
	}

	return nil
}

// UpdateWithProgress 执行更新并返回进度信息（JSON格式）
// 由于 selfupdate 库不支持进度回调，这里返回状态信息
func (u *UpdateService) UpdateWithProgress() (string, error) {
	progress := UpdateProgress{
		Status:  "checking",
		Message: "正在检查更新...",
		Percent: 0,
	}

	repo := fmt.Sprintf("%s/%s", u.repoOwner, u.repoName)
	
	// 检测最新版本
	progress.Status = "checking"
	progress.Message = "正在检测最新版本..."
	progress.Percent = 10
	
	latest, found, err := selfupdate.DetectLatest(repo)
	if err != nil {
		progress.Status = "error"
		progress.Message = fmt.Sprintf("检测更新失败: %v", err)
		progress.Percent = 0
		data, _ := json.Marshal(progress)
		return string(data), fmt.Errorf("检测更新失败: %w", err)
	}

	if !found {
		progress.Status = "error"
		progress.Message = "未找到更新"
		progress.Percent = 0
		data, _ := json.Marshal(progress)
		return string(data), fmt.Errorf("未找到更新")
	}

	// 解析当前版本并检查是否需要更新
	currentVer, err := semver.ParseTolerant(u.currentVersion)
	if err != nil {
		progress.Status = "error"
		progress.Message = fmt.Sprintf("版本格式解析失败: %v", err)
		progress.Percent = 0
		data, _ := json.Marshal(progress)
		return string(data), fmt.Errorf("版本格式解析失败: %w", err)
	}

	if !latest.Version.GT(currentVer) {
		progress.Status = "error"
		progress.Message = "已是最新版本"
		progress.Percent = 0
		data, _ := json.Marshal(progress)
		return string(data), fmt.Errorf("已是最新版本")
	}

	// 获取当前可执行文件路径
	progress.Status = "downloading"
	progress.Message = fmt.Sprintf("正在下载版本 %s...", latest.Version.String())
	progress.Percent = 30
	
	exe, err := os.Executable()
	if err != nil {
		progress.Status = "error"
		progress.Message = fmt.Sprintf("获取可执行文件路径失败: %v", err)
		progress.Percent = 0
		data, _ := json.Marshal(progress)
		return string(data), fmt.Errorf("获取可执行文件路径失败: %w", err)
	}

	// 执行更新
	progress.Status = "installing"
	progress.Message = "正在安装更新..."
	progress.Percent = 70
	
	if err := selfupdate.UpdateTo(latest.AssetURL, exe); err != nil {
		progress.Status = "error"
		progress.Message = fmt.Sprintf("更新失败: %v", err)
		progress.Percent = 0
		data, _ := json.Marshal(progress)
		return string(data), fmt.Errorf("更新失败: %w", err)
	}

	// 更新完成
	progress.Status = "completed"
	progress.Message = fmt.Sprintf("更新完成！新版本 %s 已安装，请重启应用以使用新版本。", latest.Version.String())
	progress.Percent = 100
	
	data, err := json.Marshal(progress)
	if err != nil {
		return "", fmt.Errorf("序列化进度信息失败: %w", err)
	}

	return string(data), nil
}

// GetExecutableName 获取当前平台的可执行文件名
func GetExecutableName() string {
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	return fmt.Sprintf("artifex-%s-%s%s", runtime.GOOS, runtime.GOARCH, ext)
}
