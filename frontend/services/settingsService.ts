/**
 * 设置服务 - 处理应用设置的加载和保存
 */

import { LoadSettings, SaveSettings } from '../wailsjs/go/core/App';
import { Settings, defaultSettings } from '../types/settings';

/**
 * 加载设置
 * @returns 设置对象
 */
export const loadSettings = async (): Promise<Settings> => {
  try {
    const settingsJSON = await LoadSettings();
    const settings: Settings = JSON.parse(settingsJSON);
    return settings;
  } catch (error) {
    console.error('Failed to load settings:', error);
    // 返回默认设置
    return defaultSettings;
  }
};

/**
 * 保存设置
 * @param settings 设置对象
 */
export const saveSettings = async (settings: Settings): Promise<void> => {
  try {
    const settingsJSON = JSON.stringify(settings);
    await SaveSettings(settingsJSON);
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw error;
  }
};

