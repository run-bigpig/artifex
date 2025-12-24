/**
 * 基于用户活动检测的防抖函数
 * 只有在用户停止鼠标和键盘活动一段时间后，才执行函数
 * 
 * @param func 要防抖的函数
 * @param idleDelay 无活动延迟时间（毫秒），默认 2500ms
 * @returns 防抖后的函数，包含 cancel 和 flush 方法
 */

import { activityDetector } from '../services/activityDetector';

type ActivityCallback = () => void;

export interface ActivityDebouncedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  cancel: () => void;
  flush: () => void;
}

/**
 * 基于用户活动的防抖函数
 * @param func 要防抖的函数
 * @param idleDelay 无活动延迟时间（毫秒），默认 2500ms
 */
export function activityDebounce<T extends (...args: any[]) => any>(
  func: T,
  idleDelay: number = 2500
): ActivityDebouncedFunction<T> {
  let lastArgs: Parameters<T> | null = null;
  let unregisterCallback: (() => void) | null = null;
  let isPending = false;
  let callbackId: ActivityCallback | null = null;

  // 确保活动检测器已启动
  activityDetector.start();

  const debounced = function debounced(...args: Parameters<T>) {
    lastArgs = args;
    isPending = true;

    // 取消之前的回调注册
    if (unregisterCallback) {
      unregisterCallback();
      unregisterCallback = null;
      callbackId = null;
    }

    // 创建新的回调函数
    const newCallback: ActivityCallback = () => {
      if (isPending && lastArgs !== null) {
        func(...lastArgs);
        lastArgs = null;
        isPending = false;
      }
      // 执行后自动取消注册
      if (unregisterCallback) {
        unregisterCallback();
        unregisterCallback = null;
        callbackId = null;
      }
    };

    callbackId = newCallback;

    // 注册回调，在用户停止活动后执行
    unregisterCallback = activityDetector.onIdle(newCallback, idleDelay);
  } as ActivityDebouncedFunction<T>;

  // 取消待执行的函数
  debounced.cancel = () => {
    if (unregisterCallback) {
      unregisterCallback();
      unregisterCallback = null;
    }
    lastArgs = null;
    isPending = false;
  };

  // 立即执行待执行的函数
  debounced.flush = () => {
    if (isPending && lastArgs !== null) {
      func(...lastArgs);
      lastArgs = null;
      isPending = false;
    }
    if (unregisterCallback) {
      unregisterCallback();
      unregisterCallback = null;
    }
  };

  return debounced;
}

