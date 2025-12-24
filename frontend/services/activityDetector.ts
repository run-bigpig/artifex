/**
 * 用户活动检测服务
 * 监听鼠标和键盘事件，跟踪用户活动状态
 * 用于在用户停止操作后触发保存等操作
 */

type ActivityCallback = () => void;

interface CallbackEntry {
  callback: ActivityCallback;
  idleDelay: number;
  lastTriggerTime: number;
}

class ActivityDetector {
  private lastActivityTime: number = Date.now();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private callbacks: Map<ActivityCallback, CallbackEntry> = new Map();
  private isActive: boolean = false;
  private updateActivityHandler: (() => void) | null = null;
  private eventListeners: Array<{ event: string; handler: () => void }> = [];

  /**
   * 启动活动检测
   */
  start(): void {
    if (this.isActive) {
      return; // 已经启动
    }

    this.isActive = true;
    this.lastActivityTime = Date.now();

    // 创建活动更新处理器
    this.updateActivityHandler = () => {
      this.lastActivityTime = Date.now();
    };

    // 监听鼠标和键盘事件
    const events = ['mousedown', 'mousemove', 'keydown', 'keyup', 'click', 'scroll', 'touchstart', 'touchmove'];
    
    events.forEach(event => {
      window.addEventListener(event, this.updateActivityHandler, { passive: true });
      this.eventListeners.push({ event, handler: this.updateActivityHandler });
    });

    // 定期检查是否超过空闲时间
    this.checkInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - this.lastActivityTime;

      // 检查所有回调，看是否达到对应的 idleDelay
      this.callbacks.forEach((entry, callback) => {
        const timeSinceLastTrigger = now - entry.lastTriggerTime;
        
        // 如果距离最后活动时间超过 idleDelay，且距离上次触发也超过 idleDelay
        if (timeSinceLastActivity >= entry.idleDelay && timeSinceLastTrigger >= entry.idleDelay) {
          try {
            callback();
            entry.lastTriggerTime = now;
          } catch (error) {
            console.error('[ActivityDetector] 回调执行失败:', error);
          }
        }
      });
    }, 100); // 每 100ms 检查一次
  }

  /**
   * 停止活动检测
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;

    // 移除所有事件监听器
    this.eventListeners.forEach(({ event, handler }) => {
      window.removeEventListener(event, handler);
    });
    this.eventListeners = [];

    // 清除检查间隔
    if (this.checkInterval !== null) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // 清空所有回调
    this.callbacks.clear();
  }

  /**
   * 注册回调函数，在用户停止活动后调用
   * @param callback 回调函数
   * @param idleDelay 无活动延迟时间（毫秒）
   */
  onIdle(callback: ActivityCallback, idleDelay: number = 2500): () => void {
    // 确保检测器已启动
    if (!this.isActive) {
      this.start();
    }

    // 注册回调
    this.callbacks.set(callback, {
      callback,
      idleDelay,
      lastTriggerTime: 0
    });

    // 返回取消注册的函数
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * 手动更新活动时间（用于程序化操作）
   */
  updateActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * 获取最后活动时间
   */
  getLastActivityTime(): number {
    return this.lastActivityTime;
  }

  /**
   * 获取距离最后活动的时间（毫秒）
   */
  getTimeSinceLastActivity(): number {
    return Date.now() - this.lastActivityTime;
  }
}

// 单例实例
export const activityDetector = new ActivityDetector();

