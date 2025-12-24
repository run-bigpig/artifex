package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/blang/semver"
	"github.com/run-bigpig/go-github-selfupdate/selfupdate"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
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
	Percent int    `json:"percent"` // 进度百分比 (0-100)
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
	// 启动时清理旧文件
	if err := u.CleanupOldFiles(); err != nil {
		fmt.Printf("[UpdateService] Warning: 清理旧文件失败: %v\n", err)
		// 不阻塞启动，继续执行
	}
}

// CheckForUpdate 检查是否有可用更新
func (u *UpdateService) CheckForUpdate() (UpdateInfo, error) {
	repo := fmt.Sprintf("%s/%s", u.repoOwner, u.repoName)

	// 添加调试信息：打印仓库信息和当前版本
	fmt.Printf("[UpdateService] Checking for updates from repo: %s, current version: %s\n", repo, u.currentVersion)

	// 获取当前可执行文件名，用于调试
	exe, err := os.Executable()
	if err == nil {
		fmt.Printf("[UpdateService] Current executable: %s\n", exe)
	}

	latest, found, err := selfupdate.DetectLatest(repo)
	if err != nil {
		fmt.Printf("[UpdateService] DetectLatest error: %v\n", err)
		return UpdateInfo{
			HasUpdate:      false,
			CurrentVersion: u.currentVersion,
			Error:          fmt.Sprintf("检测更新失败: %v", err),
		}, nil // 返回错误信息但不返回 error，让前端可以显示
	}

	if !found {
		fmt.Printf("[UpdateService] No release found (found=%v)\n", found)
		return UpdateInfo{
			HasUpdate:      false,
			CurrentVersion: u.currentVersion,
			LatestVersion:  u.currentVersion,
			Error:          "未找到 GitHub Release，请检查仓库配置或网络连接",
		}, nil
	}

	// 添加调试信息：打印检测到的最新版本
	fmt.Printf("[UpdateService] Found latest version: %s, URL: %s, AssetURL: %s\n",
		latest.Version.String(), latest.URL, latest.AssetURL)

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

	fmt.Printf("[UpdateService] Version comparison: current=%s, latest=%s, hasUpdate=%v\n",
		currentVer.String(), latest.Version.String(), hasUpdate)

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

	// 如果没有更新但版本不同，可能是版本号格式问题，添加警告信息
	if !hasUpdate && latest.Version.String() != u.currentVersion {
		info.Error = fmt.Sprintf("检测到版本 %s，但版本比较显示无需更新。当前版本: %s",
			latest.Version.String(), u.currentVersion)
		fmt.Printf("[UpdateService] Warning: %s\n", info.Error)
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

// emitProgress 发送更新进度事件
func (u *UpdateService) emitProgress(status, message string, percent int) {
	if u.ctx == nil {
		return
	}
	progress := UpdateProgress{
		Status:  status,
		Message: message,
		Percent: percent,
	}
	progressJSON, err := json.Marshal(progress)
	if err != nil {
		fmt.Printf("[UpdateService] Warning: 序列化进度信息失败: %v\n", err)
		return
	}
	wailsruntime.EventsEmit(u.ctx, "update:progress", string(progressJSON))
}

// Update 执行更新（下载并替换当前可执行文件）
// 通过 Wails Event 系统实时推送更新进度
// 注意：在 Wails 应用中，更新完成后需要重启应用才能生效
func (u *UpdateService) Update() error {
	// 发送初始进度
	u.emitProgress("checking", "正在检查更新...", 0)

	repo := fmt.Sprintf("%s/%s", u.repoOwner, u.repoName)

	// 检测最新版本
	u.emitProgress("checking", "正在检测最新版本...", 10)
	latest, found, err := selfupdate.DetectLatest(repo)
	if err != nil {
		u.emitProgress("error", fmt.Sprintf("检测更新失败: %v", err), 0)
		return fmt.Errorf("检测更新失败: %w", err)
	}

	if !found {
		u.emitProgress("error", "未找到更新", 0)
		return fmt.Errorf("未找到更新")
	}

	// 解析当前版本并检查是否需要更新
	currentVer, err := semver.ParseTolerant(u.currentVersion)
	if err != nil {
		u.emitProgress("error", fmt.Sprintf("版本格式解析失败: %v", err), 0)
		return fmt.Errorf("版本格式解析失败: %w", err)
	}

	if !latest.Version.GT(currentVer) {
		u.emitProgress("error", "已是最新版本", 0)
		return fmt.Errorf("已是最新版本")
	}

	// 获取当前可执行文件路径
	exe, err := os.Executable()
	if err != nil {
		u.emitProgress("error", fmt.Sprintf("获取可执行文件路径失败: %v", err), 0)
		return fmt.Errorf("获取可执行文件路径失败: %w", err)
	}

	// 执行更新（使用带进度回调的版本）
	// 下载进度范围：30% - 70%（下载阶段），70% - 90%（安装阶段）
	downloadStartPercent := 30
	downloadEndPercent := 70
	installEndPercent := 90

	// 创建进度回调函数
	progressCallback := func(downloaded, total int64) {
		if total > 0 {
			// 计算下载进度百分比（在 30% - 70% 之间）
			downloadPercent := float64(downloaded) / float64(total)
			currentPercent := downloadStartPercent + int(downloadPercent*float64(downloadEndPercent-downloadStartPercent))

			// 格式化下载大小信息
			downloadedMB := float64(downloaded) / (1024 * 1024)
			totalMB := float64(total) / (1024 * 1024)

			u.emitProgress("downloading",
				fmt.Sprintf("正在下载版本 %s... (%.2f MB / %.2f MB, %d%%)",
					latest.Version.String(), downloadedMB, totalMB, int(downloadPercent*100)),
				currentPercent)
		} else {
			// 如果无法获取总大小（total <= 0 或 -1），只显示已下载大小
			downloadedMB := float64(downloaded) / (1024 * 1024)
			// 使用动态进度，在下载范围内递增
			// 基于已下载字节数估算进度（假设每 10MB 增加 5%）
			estimatedPercent := downloadStartPercent + int(downloadedMB/10*5)
			if estimatedPercent > downloadEndPercent {
				estimatedPercent = downloadEndPercent
			}

			u.emitProgress("downloading",
				fmt.Sprintf("正在下载版本 %s... (已下载 %.2f MB)",
					latest.Version.String(), downloadedMB),
				estimatedPercent)
		}
	}

	// 开始下载
	u.emitProgress("downloading", fmt.Sprintf("正在下载版本 %s...", latest.Version.String()), downloadStartPercent)

	// 执行更新（带进度回调）
	if err := selfupdate.UpdateToWithProcess(latest.AssetURL, exe, progressCallback); err != nil {
		u.emitProgress("error", fmt.Sprintf("更新失败: %v", err), 0)
		return fmt.Errorf("更新失败: %w", err)
	}

	// 安装阶段
	u.emitProgress("installing", "正在安装更新...", installEndPercent)

	// 更新完成
	u.emitProgress("completed", fmt.Sprintf("更新完成！新版本 %s 已安装，应用将在几秒后自动重启...", latest.Version.String()), 100)

	return nil
}

// RestartApplication 重启应用程序
// 通过启动新进程并退出当前进程来实现重启
// 支持 Windows、Linux、macOS 跨平台
func (u *UpdateService) RestartApplication() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取可执行文件路径失败: %w", err)
	}

	exePath, err := filepath.Abs(exe)
	if err != nil {
		return fmt.Errorf("获取可执行文件绝对路径失败: %w", err)
	}

	fmt.Printf("[UpdateService] 准备重启应用: %s\n", exePath)

	// 根据操作系统选择不同的启动方式
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// Windows: 直接执行可执行文件
		cmd = exec.Command(exePath)
	case "darwin", "linux":
		// macOS/Linux: 使用 sh 启动新进程
		cmd = exec.Command("sh", "-c", fmt.Sprintf("sleep 2 && %s", exePath))
		// 在 Unix 系统上，不设置 SysProcAttr，让系统默认处理
		// 注意：如果需要进程组控制，可以使用条件编译
	default:
		return fmt.Errorf("不支持的操作系统: %s", runtime.GOOS)
	}

	// 设置工作目录为可执行文件所在目录
	exeDir := filepath.Dir(exePath)
	cmd.Dir = exeDir

	// 启动新进程（不等待其完成）
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动新进程失败: %w", err)
	}

	fmt.Printf("[UpdateService] 新进程已启动，当前进程将在 2 秒后退出\n")

	// 延迟退出，给新进程时间启动
	go func() {
		time.Sleep(2 * time.Second)
		fmt.Printf("[UpdateService] 退出当前进程\n")
		os.Exit(0)
	}()

	return nil
}

// GetExecutableName 获取当前平台的可执行文件名
func GetExecutableName() string {
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	return fmt.Sprintf("artifexBot-%s-%s%s", runtime.GOOS, runtime.GOARCH, ext)
}

// CleanupOldFiles 清理工作目录下的旧文件
// 清理以下类型的文件：
// - *.old: 旧版本备份文件
// - *.bak: 备份文件
// - *.tmp: 临时文件（但保留正在使用的 .tmp 文件）
// - 旧版本的二进制文件（artifexBot-*.exe 等，但排除当前可执行文件）
func (u *UpdateService) CleanupOldFiles() error {
	exeDir, err := getExecutableDir()
	if err != nil {
		return fmt.Errorf("获取可执行文件目录失败: %w", err)
	}

	currentExe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取当前可执行文件路径失败: %w", err)
	}
	currentExeAbs, _ := filepath.Abs(currentExe)

	fmt.Printf("[UpdateService] 开始清理旧文件，工作目录: %s\n", exeDir)

	// 定义要清理的文件模式
	patterns := []string{
		"*.old", // 旧版本备份
		"*.bak", // 备份文件
		"*.tmp", // 临时文件（注意：可能正在使用）
	}

	// 清理匹配模式的文件
	cleanedCount := 0
	for _, pattern := range patterns {
		matches, err := filepath.Glob(filepath.Join(exeDir, pattern))
		if err != nil {
			fmt.Printf("[UpdateService] Warning: 匹配模式 %s 失败: %v\n", pattern, err)
			continue
		}

		for _, match := range matches {
			// 检查文件是否存在且不是当前可执行文件
			info, err := os.Stat(match)
			if err != nil {
				continue
			}

			// 跳过目录
			if info.IsDir() {
				continue
			}

			// 对于 .tmp 文件，检查是否正在使用（文件修改时间在 1 小时内，可能是正在使用的临时文件）
			if filepath.Ext(match) == ".tmp" {
				if time.Since(info.ModTime()) < time.Hour {
					fmt.Printf("[UpdateService] 跳过可能正在使用的临时文件: %s\n", match)
					continue
				}
			}

			// 删除文件
			if err := os.Remove(match); err != nil {
				fmt.Printf("[UpdateService] Warning: 删除文件失败 %s: %v\n", match, err)
			} else {
				fmt.Printf("[UpdateService] 已清理旧文件: %s\n", match)
				cleanedCount++
			}
		}
	}

	// 清理旧版本的二进制文件
	// 查找所有可能的旧版本二进制文件（artifexBot-*.exe 等）
	exePattern := "artifexBot-*"
	if runtime.GOOS == "windows" {
		exePattern += ".exe"
	}
	exeMatches, err := filepath.Glob(filepath.Join(exeDir, exePattern))
	if err == nil {
		for _, match := range exeMatches {
			matchAbs, _ := filepath.Abs(match)
			// 跳过当前可执行文件
			if matchAbs == currentExeAbs {
				continue
			}

			// 检查文件是否可执行
			info, err := os.Stat(match)
			if err != nil {
				continue
			}

			// 只删除可执行文件
			if !info.IsDir() {
				// 检查文件修改时间，如果超过 7 天，可能是旧版本
				if time.Since(info.ModTime()) > 7*24*time.Hour {
					if err := os.Remove(match); err != nil {
						fmt.Printf("[UpdateService] Warning: 删除旧版本文件失败 %s: %v\n", match, err)
					} else {
						fmt.Printf("[UpdateService] 已清理旧版本文件: %s\n", match)
						cleanedCount++
					}
				}
			}
		}
	}

	fmt.Printf("[UpdateService] 清理完成，共清理 %d 个文件\n", cleanedCount)
	return nil
}
