/**
 * 历史记录面板组件
 * 
 * 设计理念：参考 Photoshop 历史记录面板
 * - 显示操作历史列表
 * - 支持点击跳转到任意历史状态
 * - 可折叠/展开
 * - 显示操作名称和时间
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { History, ChevronDown, ChevronUp, Undo2, Redo2, Trash2 } from 'lucide-react';
import { HistoryRecord, formatTimestamp, HistoryActionType } from '../hooks/useHistoryManager';

// ============================================================================
// 操作类型图标映射
// ============================================================================

/**
 * 获取操作类型对应的图标样式
 */
const getActionIcon = (actionType: HistoryActionType): string => {
  switch (actionType) {
    case 'initial':
      return '🎨';
    case 'add_image':
    case 'import_image':
      return '➕';
    case 'delete_image':
    case 'batch_delete':
      return '🗑️';
    case 'move_image':
    case 'batch_move':
      return '↔️';
    case 'resize_image':
      return '📐';
    case 'copy_image':
      return '📋';
    case 'paste_image':
      return '📄';
    case 'edit_image':
      return '✏️';
    case 'transform':
      return '🔄';
    default:
      return '•';
  }
};

// ============================================================================
// 类型定义
// ============================================================================

interface HistoryPanelProps {
  /** 历史记录列表 */
  historyList: HistoryRecord[];
  /** 当前历史位置索引 */
  currentIndex: number;
  /** 是否可以撤销 */
  canUndo: boolean;
  /** 是否可以重做 */
  canRedo: boolean;
  /** 撤销回调 */
  onUndo: () => void;
  /** 重做回调 */
  onRedo: () => void;
  /** 跳转到指定历史位置 */
  onJumpTo: (index: number) => void;
  /** 清空历史记录 */
  onClear: () => void;
  /** 默认是否展开，默认 false */
  defaultExpanded?: boolean;
}

// ============================================================================
// 组件实现
// ============================================================================

const HistoryPanel: React.FC<HistoryPanelProps> = ({
  historyList,
  currentIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onJumpTo,
  onClear,
  defaultExpanded = false,
}) => {
  // 面板展开状态
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  // 列表容器引用，用于自动滚动
  const listRef = useRef<HTMLDivElement>(null);

  // 当前索引变化时，自动滚动到当前位置
  useEffect(() => {
    if (isExpanded && listRef.current && currentIndex >= 0) {
      const listElement = listRef.current;
      const itemHeight = 36; // 每个条目的大约高度
      const scrollPosition = currentIndex * itemHeight;
      const listHeight = listElement.clientHeight;
      
      // 如果当前位置不在可视区域内，滚动到可见位置
      if (scrollPosition < listElement.scrollTop || 
          scrollPosition > listElement.scrollTop + listHeight - itemHeight) {
        listElement.scrollTo({
          top: Math.max(0, scrollPosition - listHeight / 2 + itemHeight / 2),
          behavior: 'smooth'
        });
      }
    }
  }, [currentIndex, isExpanded]);

  // 切换展开状态
  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  // 处理条目点击
  const handleItemClick = useCallback((index: number) => {
    if (index !== currentIndex) {
      onJumpTo(index);
    }
  }, [currentIndex, onJumpTo]);

  // 处理清空确认
  const handleClear = useCallback(() => {
    if (historyList.length > 1) {
      onClear();
    }
  }, [historyList.length, onClear]);

  return (
    <div 
      className="absolute top-4 left-4 bg-slate-800/95 backdrop-blur-sm border border-slate-700 rounded-lg shadow-xl pointer-events-auto select-none"
      style={{ 
        minWidth: isExpanded ? '260px' : '120px',
        maxWidth: '320px',
        transition: 'min-width 0.2s ease-out'
      }}
    >
      {/* 头部：标题和控制按钮 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-700/50">
        {/* 左侧：标题和展开按钮 */}
        <button
          onClick={toggleExpanded}
          className="flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors"
        >
          <History size={14} className="text-slate-400" />
          <span className="text-xs font-medium">历史记录</span>
          {historyList.length > 0 && (
            <span className="text-[10px] text-slate-500">
              ({currentIndex + 1}/{historyList.length})
            </span>
          )}
          {isExpanded ? (
            <ChevronUp size={14} className="text-slate-500" />
          ) : (
            <ChevronDown size={14} className="text-slate-500" />
          )}
        </button>

        {/* 右侧：撤销/重做按钮 */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUndo();
            }}
            disabled={!canUndo}
            className={`p-1.5 rounded transition-colors ${
              canUndo
                ? 'hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer'
                : 'text-slate-600 cursor-not-allowed'
            }`}
            title={`撤销 (Ctrl+Z)`}
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRedo();
            }}
            disabled={!canRedo}
            className={`p-1.5 rounded transition-colors ${
              canRedo
                ? 'hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer'
                : 'text-slate-600 cursor-not-allowed'
            }`}
            title={`重做 (Ctrl+Y)`}
          >
            <Redo2 size={14} />
          </button>
        </div>
      </div>

      {/* 展开时显示历史列表 */}
      {isExpanded && (
        <>
          {/* 历史记录列表 */}
          <div 
            ref={listRef}
            className="max-h-64 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent"
          >
            {historyList.length === 0 ? (
              <div className="px-3 py-4 text-center text-slate-500 text-xs">
                暂无历史记录
              </div>
            ) : (
              <div className="py-1">
                {historyList.map((record, index) => {
                  // 判断当前位置状态
                  const isCurrent = index === currentIndex;
                  const isPast = index < currentIndex;
                  const isFuture = index > currentIndex;

                  return (
                    <button
                      key={record.id}
                      onClick={() => handleItemClick(index)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                        isCurrent
                          ? 'bg-blue-600/30 text-white'
                          : isPast
                          ? 'text-slate-300 hover:bg-slate-700/50'
                          : 'text-slate-500 hover:bg-slate-700/30'
                      }`}
                    >
                      {/* 状态指示器 */}
                      <span className="flex-shrink-0 w-4 text-center">
                        {isCurrent ? (
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                        ) : isPast ? (
                          <span className="inline-block w-2 h-2 rounded-full bg-slate-500"></span>
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full border border-slate-600"></span>
                        )}
                      </span>

                      {/* 操作图标 */}
                      <span className="flex-shrink-0 text-xs">
                        {getActionIcon(record.actionType)}
                      </span>

                      {/* 操作名称 */}
                      <span className={`flex-1 text-xs truncate ${isFuture ? 'opacity-60' : ''}`}>
                        {record.actionName}
                        {record.detail && (
                          <span className="text-slate-500 ml-1">({record.detail})</span>
                        )}
                      </span>

                      {/* 时间戳 */}
                      <span className={`flex-shrink-0 text-[10px] ${
                        isCurrent ? 'text-blue-300' : 'text-slate-500'
                      }`}>
                        {formatTimestamp(record.timestamp)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部：清空按钮 */}
          {historyList.length > 1 && (
            <div className="border-t border-slate-700/50 px-2 py-1.5">
              <button
                onClick={handleClear}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              >
                <Trash2 size={12} />
                <span>清空历史</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HistoryPanel;

