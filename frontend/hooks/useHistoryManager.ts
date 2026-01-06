/**
 * 历史记录管理 Hook
 * 
 * 设计理念：参考 Photoshop 历史记录面板
 * - 每个操作记录名称、时间戳、状态快照
 * - 支持撤销/重做/跳转到任意历史点
 * - 内存优化：限制历史记录数量
 * 
 * @author Canvas History Manager
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { CanvasImage } from '../types';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 操作类型枚举
 * 用于标识不同的画布操作
 */
export type HistoryActionType = 
  | 'initial'           // 初始状态
  | 'add_image'         // 添加图片
  | 'delete_image'      // 删除图片
  | 'move_image'        // 移动图片
  | 'resize_image'      // 调整大小
  | 'copy_image'        // 复制图片
  | 'paste_image'       // 粘贴图片
  | 'import_image'      // 导入图片
  | 'batch_delete'      // 批量删除
  | 'batch_move'        // 批量移动
  | 'edit_image'        // 编辑图片
  | 'transform'         // 变换操作
  | 'unknown';          // 未知操作

/**
 * 操作类型对应的中文名称
 */
export const ACTION_NAMES: Record<HistoryActionType, string> = {
  initial: '初始状态',
  add_image: '添加图片',
  delete_image: '删除图片',
  move_image: '移动图片',
  resize_image: '调整大小',
  copy_image: '复制图片',
  paste_image: '粘贴图片',
  import_image: '导入图片',
  batch_delete: '批量删除',
  batch_move: '批量移动',
  edit_image: '编辑图片',
  transform: '变换',
  unknown: '操作',
};

/**
 * 历史记录条目
 */
export interface HistoryRecord {
  /** 唯一标识 */
  id: string;
  /** 操作类型 */
  actionType: HistoryActionType;
  /** 操作名称（用于显示） */
  actionName: string;
  /** 操作详情（可选，如受影响的图片数量） */
  detail?: string;
  /** 时间戳 */
  timestamp: number;
  /** 状态快照（深拷贝的图片数组） */
  state: CanvasImage[];
  /** 状态哈希（用于去重） */
  hash: string;
}

/**
 * Hook 配置选项
 */
export interface HistoryManagerOptions {
  /** 最大历史记录数量，默认 50 */
  maxSize?: number;
  /** 是否启用去重，默认 true */
  enableDedup?: boolean;
}

/**
 * Hook 返回值
 */
export interface UseHistoryManagerReturn {
  // ====== 状态 ======
  /** 历史记录列表 */
  historyList: HistoryRecord[];
  /** 当前历史位置索引 */
  currentIndex: number;
  /** 是否可以撤销 */
  canUndo: boolean;
  /** 是否可以重做 */
  canRedo: boolean;
  /** 可撤销步数 */
  undoSteps: number;
  /** 可重做步数 */
  redoSteps: number;
  
  // ====== 操作 ======
  /** 
   * 记录一个操作到历史
   * @param actionType 操作类型
   * @param state 当前状态快照
   * @param detail 操作详情（可选）
   * @returns 是否成功记录（如果状态相同则返回 false）
   */
  pushHistory: (actionType: HistoryActionType, state: CanvasImage[], detail?: string) => boolean;
  
  /**
   * 撤销操作
   * @returns 撤销后的状态，如果无法撤销则返回 null
   */
  undo: () => CanvasImage[] | null;
  
  /**
   * 重做操作
   * @returns 重做后的状态，如果无法重做则返回 null
   */
  redo: () => CanvasImage[] | null;
  
  /**
   * 跳转到指定历史位置
   * @param index 目标索引
   * @returns 跳转后的状态，如果索引无效则返回 null
   */
  jumpTo: (index: number) => CanvasImage[] | null;
  
  /**
   * 清空历史记录
   */
  clear: () => void;
  
  /**
   * 初始化历史记录（首次加载时调用）
   * @param initialState 初始状态
   */
  initialize: (initialState: CanvasImage[]) => void;
  
  /**
   * 检查是否已初始化
   */
  isInitialized: boolean;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID
 */
const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * 深拷贝状态
 * 使用 JSON 序列化实现深拷贝，确保状态快照的独立性
 */
const deepCloneState = (state: CanvasImage[]): CanvasImage[] => {
  return JSON.parse(JSON.stringify(state));
};

/**
 * 生成状态哈希
 * 基于图片的关键属性生成唯一标识，用于状态去重
 * 不包含 zIndex，因为层级变化是附带操作
 */
const generateStateHash = (state: CanvasImage[]): string => {
  if (state.length === 0) return 'empty';
  
  return state
    .map(img => `${img.id}:${img.x.toFixed(2)},${img.y.toFixed(2)},${img.width.toFixed(2)},${img.height.toFixed(2)}`)
    .sort()
    .join('|');
};

/**
 * 格式化时间戳为可读字符串
 */
export const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 历史记录管理 Hook
 * 
 * 使用示例：
 * ```tsx
 * const {
 *   historyList,
 *   currentIndex,
 *   canUndo,
 *   canRedo,
 *   pushHistory,
 *   undo,
 *   redo,
 *   jumpTo,
 * } = useHistoryManager({ maxSize: 50 });
 * 
 * // 记录操作
 * pushHistory('move_image', currentImages, '移动了 1 个图片');
 * 
 * // 撤销
 * const prevState = undo();
 * if (prevState) setImages(prevState);
 * ```
 */
export function useHistoryManager(
  options: HistoryManagerOptions = {}
): UseHistoryManagerReturn {
  const { maxSize = 50, enableDedup = true } = options;

  // ====== 状态存储 ======
  // 使用 ref 存储历史记录，避免每次更新都触发重渲染
  const historyRef = useRef<HistoryRecord[]>([]);
  const currentIndexRef = useRef<number>(-1);
  const isInitializedRef = useRef<boolean>(false);

  // 用于触发 UI 更新的状态
  const [updateTrigger, setUpdateTrigger] = useState(0);
  
  // 强制更新 UI
  const forceUpdate = useCallback(() => {
    setUpdateTrigger(prev => prev + 1);
  }, []);

  // ====== 计算属性 ======
  const historyList = historyRef.current;
  const currentIndex = currentIndexRef.current;
  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < historyList.length - 1;
  const undoSteps = currentIndex > 0 ? currentIndex : 0;
  const redoSteps = canRedo ? historyList.length - currentIndex - 1 : 0;
  const isInitialized = isInitializedRef.current;

  // ====== 核心操作 ======

  /**
   * 记录操作到历史
   */
  const pushHistory = useCallback((
    actionType: HistoryActionType,
    state: CanvasImage[],
    detail?: string
  ): boolean => {
    const currentHash = generateStateHash(state);
    
    // 去重检查：如果与当前状态相同，跳过记录
    if (enableDedup && currentIndexRef.current >= 0) {
      const currentRecord = historyRef.current[currentIndexRef.current];
      if (currentRecord && currentRecord.hash === currentHash) {
        return false;
      }
    }

    // 创建新的历史记录
    const newRecord: HistoryRecord = {
      id: generateId(),
      actionType,
      actionName: ACTION_NAMES[actionType] || ACTION_NAMES.unknown,
      detail,
      timestamp: Date.now(),
      state: deepCloneState(state),
      hash: currentHash,
    };

    // 如果当前不在最新位置，移除后面的历史记录（分支切断）
    if (currentIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, currentIndexRef.current + 1);
    }

    // 添加新记录
    historyRef.current.push(newRecord);
    currentIndexRef.current = historyRef.current.length - 1;

    // 如果超出最大限制，移除最早的记录（但保留初始状态）
    while (historyRef.current.length > maxSize) {
      // 移除第二个记录（保留初始状态）
      if (historyRef.current.length > 1) {
        historyRef.current.splice(1, 1);
        currentIndexRef.current = Math.max(0, currentIndexRef.current - 1);
      } else {
        break;
      }
    }

    // 标记已初始化
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
    }

    forceUpdate();
    return true;
  }, [enableDedup, maxSize, forceUpdate]);

  /**
   * 撤销操作
   */
  const undo = useCallback((): CanvasImage[] | null => {
    if (currentIndexRef.current <= 0) {
      return null;
    }

    currentIndexRef.current--;
    const record = historyRef.current[currentIndexRef.current];
    
    forceUpdate();
    return deepCloneState(record.state);
  }, [forceUpdate]);

  /**
   * 重做操作
   */
  const redo = useCallback((): CanvasImage[] | null => {
    if (currentIndexRef.current >= historyRef.current.length - 1) {
      return null;
    }

    currentIndexRef.current++;
    const record = historyRef.current[currentIndexRef.current];
    
    forceUpdate();
    return deepCloneState(record.state);
  }, [forceUpdate]);

  /**
   * 跳转到指定历史位置
   */
  const jumpTo = useCallback((index: number): CanvasImage[] | null => {
    if (index < 0 || index >= historyRef.current.length) {
      return null;
    }

    currentIndexRef.current = index;
    const record = historyRef.current[index];
    
    forceUpdate();
    return deepCloneState(record.state);
  }, [forceUpdate]);

  /**
   * 清空历史记录
   */
  const clear = useCallback(() => {
    historyRef.current = [];
    currentIndexRef.current = -1;
    isInitializedRef.current = false;
    forceUpdate();
  }, [forceUpdate]);

  /**
   * 初始化历史记录
   */
  const initialize = useCallback((initialState: CanvasImage[]) => {
    // 如果已有历史记录且不为空，不重复初始化
    if (historyRef.current.length > 0) {
      return;
    }

    // 创建初始状态记录
    const initialRecord: HistoryRecord = {
      id: generateId(),
      actionType: 'initial',
      actionName: ACTION_NAMES.initial,
      timestamp: Date.now(),
      state: deepCloneState(initialState),
      hash: generateStateHash(initialState),
    };

    historyRef.current = [initialRecord];
    currentIndexRef.current = 0;
    isInitializedRef.current = true;
    
    forceUpdate();
  }, [forceUpdate]);

  // ====== 返回值 ======
  return useMemo(() => ({
    // 状态
    historyList,
    currentIndex,
    canUndo,
    canRedo,
    undoSteps,
    redoSteps,
    isInitialized,
    // 操作
    pushHistory,
    undo,
    redo,
    jumpTo,
    clear,
    initialize,
  }), [
    // 注意：这里我们依赖 updateTrigger 来确保状态变化时返回新的对象
    // eslint-disable-next-line react-hooks/exhaustive-deps
    updateTrigger,
    pushHistory,
    undo,
    redo,
    jumpTo,
    clear,
    initialize,
  ]);
}

export default useHistoryManager;

