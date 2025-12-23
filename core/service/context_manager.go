package service

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ContextManager 管理每个请求的 context，支持主动取消
type ContextManager struct {
	// 存储每个请求 ID 对应的 context 和 cancel 函数
	contexts map[string]contextWithCancel
	mu       sync.RWMutex
	// 基础 context（应用启动时的 context）
	baseCtx context.Context
}

// contextWithCancel 存储 context 和 cancel 函数
type contextWithCancel struct {
	ctx    context.Context
	cancel context.CancelFunc
	// 创建时间，用于清理过期请求
	createdAt time.Time
}

// NewContextManager 创建 Context 管理器
func NewContextManager(baseCtx context.Context) *ContextManager {
	return &ContextManager{
		contexts: make(map[string]contextWithCancel),
		baseCtx:  baseCtx,
	}
}

// CreateRequestContext 为请求创建新的 context
// 返回请求 ID 和对应的 context
func (cm *ContextManager) CreateRequestContext(requestID string) (context.Context, error) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// 如果请求 ID 已存在，先取消旧的 context
	if existing, ok := cm.contexts[requestID]; ok {
		existing.cancel()
	}

	// 创建新的 context（基于 baseCtx）
	ctx, cancel := context.WithCancel(cm.baseCtx)

	cm.contexts[requestID] = contextWithCancel{
		ctx:        ctx,
		cancel:     cancel,
		createdAt:  time.Now(),
	}

	return ctx, nil
}

// GetRequestContext 获取请求的 context
func (cm *ContextManager) GetRequestContext(requestID string) (context.Context, bool) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	ctxWithCancel, ok := cm.contexts[requestID]
	if !ok {
		return nil, false
	}

	return ctxWithCancel.ctx, true
}

// CancelRequest 取消指定请求的 context
func (cm *ContextManager) CancelRequest(requestID string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	ctxWithCancel, ok := cm.contexts[requestID]
	if !ok {
		return fmt.Errorf("request ID %s not found", requestID)
	}

	ctxWithCancel.cancel()
	delete(cm.contexts, requestID)

	return nil
}

// CleanupRequest 清理指定请求的 context（请求完成后调用）
func (cm *ContextManager) CleanupRequest(requestID string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if ctxWithCancel, ok := cm.contexts[requestID]; ok {
		// 确保 cancel 函数被调用
		ctxWithCancel.cancel()
		delete(cm.contexts, requestID)
	}
}

// CleanupExpiredRequests 清理过期的请求（超过 1 小时未清理的请求）
func (cm *ContextManager) CleanupExpiredRequests() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	now := time.Now()
	expiredThreshold := 1 * time.Hour

	for requestID, ctxWithCancel := range cm.contexts {
		if now.Sub(ctxWithCancel.createdAt) > expiredThreshold {
			ctxWithCancel.cancel()
			delete(cm.contexts, requestID)
		}
	}
}

// StartCleanupRoutine 启动定期清理协程
func (cm *ContextManager) StartCleanupRoutine() {
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()

		for range ticker.C {
			cm.CleanupExpiredRequests()
		}
	}()
}

