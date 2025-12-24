//go:build !windows

package service

import "os/exec"

// setSysProcAttr 在非 Windows 系统下不需要设置特殊属性
// Linux/macOS 系统通常不需要隐藏窗口，保持为 nil 即可
func setSysProcAttr(cmd *exec.Cmd) {
	// Unix 系统不需要特殊处理，SysProcAttr 保持为 nil
	cmd.SysProcAttr = nil
}

