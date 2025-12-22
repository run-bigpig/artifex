/**
 * Serialization Worker 服务
 * 封装 Web Worker 的使用，提供类型安全的 JSON 序列化接口
 */

interface SerializeTask {
  id: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}

class SerializationWorkerService {
  private worker: Worker | null = null;
  private tasks: Map<string, SerializeTask> = new Map();
  private taskIdCounter = 0;
  private isInitialized = false;

  /**
   * 初始化 Worker（延迟初始化，只在首次使用时创建）
   */
  private initialize(): void {
    if (this.isInitialized) {
      return;
    }

    try {
      // 使用 Vite 的 worker 导入方式
      // 注意：在 Wails 环境中，可能需要使用不同的路径
      const workerUrl = new URL('../workers/serialization.worker.ts', import.meta.url);
      this.worker = new Worker(workerUrl, { type: 'module' });

      this.worker.onmessage = (e: MessageEvent) => {
        const { id, success, result, error } = e.data;
        const task = this.tasks.get(id);

        if (!task) {
          return;
        }

        this.tasks.delete(id);

        if (success && result) {
          task.resolve(result);
        } else {
          task.reject(new Error(error || '序列化失败'));
        }
      };

      this.worker.onerror = (error) => {
        console.error('[SerializationWorker] Worker 错误:', error);
        // 清理所有待处理的任务
        this.tasks.forEach((task) => {
          task.reject(new Error('Worker 发生错误'));
        });
        this.tasks.clear();
      };

      this.isInitialized = true;
    } catch (error) {
      this.isInitialized = false;
    }
  }

  /**
   * 序列化数据（异步，在 Worker 中执行）
   * @param data 要序列化的数据
   * @returns Promise<string> JSON 字符串
   */
  stringify(data: any): Promise<string> {
    return new Promise((resolve, reject) => {
      // 如果 Worker 初始化失败，回退到主线程序列化
      if (!this.isInitialized) {
        try {
          const result = JSON.stringify(data);
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('序列化失败'));
        }
        return;
      }

      this.initialize();

      if (!this.worker) {
        // Worker 创建失败，回退到主线程
        try {
          const result = JSON.stringify(data);
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('序列化失败'));
        }
        return;
      }

      const id = `task_${++this.taskIdCounter}_${Date.now()}`;
      
      this.tasks.set(id, { id, resolve, reject });

      // 设置超时（30秒）
      const timeout = setTimeout(() => {
        if (this.tasks.has(id)) {
          this.tasks.delete(id);
          reject(new Error('序列化超时'));
        }
      }, 30000);

      // 修改 resolve 以清除超时
      const originalResolve = this.tasks.get(id)!.resolve;
      this.tasks.get(id)!.resolve = (result: string) => {
        clearTimeout(timeout);
        originalResolve(result);
      };

      this.worker.postMessage({
        id,
        type: 'stringify',
        data
      });
    });
  }

  /**
   * 终止 Worker（通常在应用关闭时调用）
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.tasks.clear();
      this.isInitialized = false;
    }
  }
}

// 导出单例实例
export const serializationWorker = new SerializationWorkerService();

