/**
 * 历史记录服务 - 处理聊天历史和画布记录的加载和保存
 * 使用 Wails 事件系统进行异步通信，避免阻塞主进程
 * 
 * 性能优化：
 * - 使用防抖机制，减少频繁保存
 * - 使用 Web Worker 进行序列化，避免阻塞主线程
 * - 使用事件系统进行异步通信
 */

import { 
  LoadChatHistory, 
  ClearChatHistory,
  LoadCanvasHistory, 
  ClearCanvasHistory 
} from '../wailsjs/go/core/App';
import { EventsEmit } from '../wailsjs/runtime/runtime';
import { ChatMessage } from '../types';
import { CanvasImage, Viewport } from '../types';
import { serializationWorker } from './serializationWorker';
import { debounce } from '../utils/debounce';

/**
 * 加载聊天历史记录
 * ✅ 注意：此函数只应在应用启动时调用一次
 * @returns 聊天消息数组
 */
export const loadChatHistory = async (): Promise<ChatMessage[]> => {
  try {
    const historyJSON = await LoadChatHistory();
    if (!historyJSON || historyJSON === '[]') {
      return [];
    }
    const messages: ChatMessage[] = JSON.parse(historyJSON);
    return messages;
  } catch (error) {
    console.error('Failed to load chat history:', error);
    return [];
  }
};

// 内部保存函数（实际执行保存操作）
const _saveChatHistoryInternal = (messages: ChatMessage[]): void => {
  const startTime = performance.now();
  
  // 使用 Web Worker 异步序列化，避免阻塞主线程
  serializationWorker.stringify(messages)
    .then((historyJSON) => {
      const serializeTime = performance.now() - startTime;
      
      // 性能监控：记录序列化时间
      if (serializeTime > 100) {
        console.warn(`[HistoryService] 聊天序列化耗时较长: ${serializeTime.toFixed(2)}ms, 数据大小: ${(historyJSON.length / 1024).toFixed(2)}KB`);
      }
      
      // 使用事件系统发送保存请求，完全非阻塞
      EventsEmit('history:save-chat', historyJSON);
    })
    .catch((error) => {
      // 序列化失败时，尝试使用主线程序列化作为后备方案
      try {
        const fallbackStartTime = performance.now();
        const historyJSON = JSON.stringify(messages);
        const fallbackTime = performance.now() - fallbackStartTime;
        
        if (fallbackTime > 100) {
          console.warn(`[HistoryService] 主线程序列化耗时较长: ${fallbackTime.toFixed(2)}ms`);
        }
        
        EventsEmit('history:save-chat', historyJSON);
      } catch (fallbackError) {
        console.error('Failed to save chat history:', fallbackError);
      }
    });
};

/**
 * 保存聊天历史记录（使用事件系统，非阻塞）
 * @param messages 聊天消息数组
 * 
 * 性能优化：
 * - 使用防抖机制，延迟 300ms 执行，减少频繁保存
 * - 使用 Web Worker 进行 JSON 序列化，避免阻塞主线程
 * - 通过 EventsEmit 发送保存请求事件，立即返回，不等待保存完成
 */
export const saveChatHistory = debounce(_saveChatHistoryInternal, 300);

/**
 * 清除聊天历史记录
 */
export const clearChatHistory = async (): Promise<void> => {
  try {
    await ClearChatHistory();
  } catch (error) {
    console.error('Failed to clear chat history:', error);
    throw error;
  }
};

/**
 * 加载画布历史记录
 * ✅ 注意：此函数只应在应用启动时调用一次
 * @returns 画布数据对象，包含 viewport 和 images
 */
export const loadCanvasHistory = async (): Promise<{ viewport: Viewport; images: CanvasImage[] }> => {
  try {
    const historyJSON = await LoadCanvasHistory();
    if (!historyJSON) {
      return {
        viewport: { x: 0, y: 0, zoom: 1 },
        images: []
      };
    }
    const data = JSON.parse(historyJSON);
    return {
      viewport: data.viewport || { x: 0, y: 0, zoom: 1 },
      images: data.images || []
    };
  } catch (error) {
    console.error('Failed to load canvas history:', error);
    return {
      viewport: { x: 0, y: 0, zoom: 1 },
      images: []
    };
  }
};

// 内部保存函数（实际执行保存操作）
const _saveCanvasHistoryInternal = (viewport: Viewport, images: CanvasImage[]): void => {
  const startTime = performance.now();
  const data = {
    viewport,
    images
  };
  
  // 使用 Web Worker 异步序列化，避免阻塞主线程
  serializationWorker.stringify(data)
    .then((historyJSON) => {
      const serializeTime = performance.now() - startTime;
      
      // 性能监控：记录序列化时间
      if (serializeTime > 100) {
        console.warn(`[HistoryService] 画布序列化耗时较长: ${serializeTime.toFixed(2)}ms, 数据大小: ${(historyJSON.length / 1024).toFixed(2)}KB`);
      }
      
      // 使用事件系统发送保存请求，完全非阻塞
      EventsEmit('history:save-canvas', historyJSON);
    })
    .catch((error) => {
      // 序列化失败时，尝试使用主线程序列化作为后备方案
      try {
        const fallbackStartTime = performance.now();
        const historyJSON = JSON.stringify(data);
        const fallbackTime = performance.now() - fallbackStartTime;
        
        if (fallbackTime > 100) {
          console.warn(`[HistoryService] 主线程序列化耗时较长: ${fallbackTime.toFixed(2)}ms`);
        }
        
        EventsEmit('history:save-canvas', historyJSON);
      } catch (fallbackError) {
        console.error('Failed to save canvas history:', fallbackError);
      }
    });
};

/**
 * 保存画布历史记录（使用事件系统，非阻塞）
 * @param viewport 视口状态
 * @param images 画布图像数组
 * 
 * 性能优化：
 * - 使用防抖机制，延迟 500ms 执行，减少频繁保存
 * - 使用 Web Worker 进行 JSON 序列化，避免阻塞主线程
 * - 通过 EventsEmit 发送保存请求事件，立即返回，不等待保存完成
 */
export const saveCanvasHistory = debounce(_saveCanvasHistoryInternal, 500);

/**
 * 清除画布历史记录
 */
export const clearCanvasHistory = async (): Promise<void> => {
  try {
    await ClearCanvasHistory();
  } catch (error) {
    console.error('Failed to clear canvas history:', error);
    throw error;
  }
};

