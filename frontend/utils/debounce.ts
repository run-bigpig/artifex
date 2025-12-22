/**
 * 防抖工具函数
 * 延迟执行函数，如果在延迟期间再次调用，则重新计时
 * 
 * @param func 要防抖的函数
 * @param wait 延迟时间（毫秒）
 * @returns 防抖后的函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function debounced(...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, wait);
  };
}

/**
 * 节流工具函数
 * 限制函数执行频率，在指定时间间隔内最多执行一次
 * 
 * @param func 要节流的函数
 * @param wait 时间间隔（毫秒）
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let lastCallTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function throttled(...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    if (timeSinceLastCall >= wait) {
      // 如果距离上次调用已经超过 wait 时间，立即执行
      lastCallTime = now;
      func(...args);
    } else {
      // 否则，延迟执行，确保在 wait 时间后执行
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        lastCallTime = Date.now();
        func(...args);
        timeoutId = null;
      }, wait - timeSinceLastCall);
    }
  };
}

