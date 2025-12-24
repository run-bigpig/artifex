import { CheckForUpdate, GetCurrentVersion, Update, RestartApplication } from '../wailsjs/go/core/App';
import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime';

/**
 * 更新信息接口
 */
export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  error?: string;
}

/**
 * 更新进度信息接口
 */
export interface UpdateProgress {
  status: 'checking' | 'downloading' | 'installing' | 'completed' | 'error';
  message: string;
  percent: number;
}

/**
 * 检查更新
 * @returns 更新信息
 */
export const checkForUpdate = async (): Promise<UpdateInfo> => {
  try {
    const result = await CheckForUpdate();
    return JSON.parse(result);
  } catch (error) {
    console.error('检查更新失败:', error);
    throw error;
  }
};

/**
 * 获取当前版本号
 * @returns 版本号字符串
 */
export const getCurrentVersion = async (): Promise<string> => {
  try {
    return await GetCurrentVersion();
  } catch (error) {
    console.error('获取版本号失败:', error);
    throw error;
  }
};

/**
 * 执行更新（简单版本，不返回进度）
 * @returns 错误信息，成功返回空字符串
 */
export const update = async (): Promise<string> => {
  try {
    const result = await Update();
    return result;
  } catch (error) {
    console.error('更新失败:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(errorMessage);
  }
};

/**
 * 执行更新（带进度信息，通过事件监听）
 * @param onProgress 进度回调函数
 * @returns Promise，resolve 时返回最终的更新进度信息
 */
export const updateWithProgress = async (
  onProgress?: (progress: UpdateProgress) => void
): Promise<UpdateProgress> => {
  return new Promise<UpdateProgress>((resolve, reject) => {
    let isResolved = false;
    let timeoutId: NodeJS.Timeout | null = null;

    // 监听更新进度事件（先设置监听，再启动更新）
    const unsubscribe = EventsOn('update:progress', (progressJSON: string) => {
      try {
        const progress: UpdateProgress = JSON.parse(progressJSON);

        // 调用进度回调
        if (onProgress) {
          onProgress(progress);
        }

        // 如果更新完成或出错，清理监听并 resolve/reject
        if (progress.status === 'completed' && !isResolved) {
          isResolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          unsubscribe();
          resolve(progress);
        } else if (progress.status === 'error' && !isResolved) {
          isResolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          unsubscribe();
          reject(new Error(progress.message));
        }
      } catch (error) {
        console.error('解析更新进度失败:', error);
        if (!isResolved) {
          isResolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          unsubscribe();
          reject(error);
        }
      }
    });

    // 设置超时保护（1小时超时）
    timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        unsubscribe();
        reject(new Error('更新超时，请检查网络连接'));
      }
    }, 3600000);

    // 启动更新（异步执行，不阻塞）
    Update()
      .catch((error) => {
        // Update() 如果立即失败，可能是同步错误
        if (!isResolved) {
          isResolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          unsubscribe();
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorProgress: UpdateProgress = {
            status: 'error',
            message: errorMessage,
            percent: 0,
          };
          
          if (onProgress) {
            onProgress(errorProgress);
          }
          
          reject(new Error(errorMessage));
        }
      });
    // 注意：Update() 成功返回不代表更新完成，实际进度通过事件推送
  });
};

/**
 * 重启应用程序
 * 更新完成后调用此方法自动重启应用
 */
export const restartApplication = async (): Promise<void> => {
  try {
    await RestartApplication();
  } catch (error) {
    console.error('重启应用失败:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(errorMessage);
  }
};

