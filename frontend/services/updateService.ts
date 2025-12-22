import { CheckForUpdate, GetCurrentVersion, Update, UpdateWithProgress } from '../wailsjs/go/core/App';

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
 * 执行更新（带进度信息）
 * @param onProgress 进度回调函数
 * @returns 更新进度信息
 */
export const updateWithProgress = async (
  onProgress?: (progress: UpdateProgress) => void
): Promise<UpdateProgress> => {
  try {
    const result = await UpdateWithProgress();
    const progress: UpdateProgress = JSON.parse(result);
    
    if (onProgress) {
      onProgress(progress);
    }
    
    return progress;
  } catch (error) {
    console.error('更新失败:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorProgress: UpdateProgress = {
      status: 'error',
      message: errorMessage,
      percent: 0,
    };
    
    if (onProgress) {
      onProgress(errorProgress);
    }
    
    throw new Error(errorMessage);
  }
};

