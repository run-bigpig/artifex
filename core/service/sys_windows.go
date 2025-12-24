//go:build windows

package service

import (
	"os/exec"
	"syscall"
)

// CREATE_NO_WINDOW 是 Windows API 常量，用于创建不显示控制台窗口的进程
// 值 0x08000000 来自 Windows API 定义
const CREATE_NO_WINDOW = 0x08000000

// setSysProcAttr 在 Windows 下设置隐藏窗口属性
// 用于隐藏 PowerShell 窗口，避免出现弹窗
func setSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: CREATE_NO_WINDOW,
	}
}
