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
  ClearCanvasHistory,
  SaveChatHistorySync,
  SaveCanvasHistorySync
} from '../wailsjs/go/core/App';
import { EventsEmit } from '../wailsjs/runtime/runtime';
import { ChatMessage } from '../types';
import { CanvasImage, Viewport } from '../types';
import { serializationWorker } from './serializationWorker';
import { activityDebounce } from '../utils/activityDebounce';
import { toImageRef } from '../utils/imageSource';

// 保存上次的数据快照，用于检测数据是否发生变化
let lastChatHistorySnapshot: string | null = null;
let lastCanvasHistorySnapshot: string | null = null;

/**
 * 深度比较两个数据是否相同（通过 JSON 序列化比较）
 * @param data1 第一个数据
 * @param data2 第二个数据
 * @returns 如果数据相同返回 true，否则返回 false
 */
const isDataEqual = (data1: any, data2: any): boolean => {
  try {
    // 使用 JSON.stringify 进行快速比较
    // 注意：这种方法对于对象属性顺序敏感，但对于我们的场景已经足够
    return JSON.stringify(data1) === JSON.stringify(data2);
  } catch (error) {
    // 如果序列化失败，认为数据不同，允许保存
    console.warn('[HistoryService] 数据比较失败，将执行保存:', error);
    return false;
  }
};

const normalizeChatImagesForSave = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((msg) => ({
    ...msg,
    images: msg.images ? msg.images.map((img) => toImageRef(img)) : undefined,
  }));

const normalizeCanvasImagesForSave = (images: CanvasImage[]): CanvasImage[] =>
  images.map((img) => ({
    ...img,
    src: toImageRef(img.src),
  }));

/**
 * 加载聊天历史记录
 * ✅ 注意：此函数只应在应用启动时调用一次
 * @returns 聊天消息数组
 */
export const loadChatHistory = async (): Promise<ChatMessage[]> => {
  try {
    const historyJSON = await LoadChatHistory();
    if (!historyJSON || historyJSON === '[]') {
      // 初始化空快照
      lastChatHistorySnapshot = '[]';
      return [];
    }
    const messages: ChatMessage[] = normalizeChatImagesForSave(JSON.parse(historyJSON));
    // 初始化快照，避免首次保存时误判为无变化
    lastChatHistorySnapshot = JSON.stringify(messages);
    return messages;
  } catch (error) {
    console.error('Failed to load chat history:', error);
    lastChatHistorySnapshot = '[]';
    return [];
  }
};

// 内部保存函数（实际执行保存操作）
const _saveChatHistoryInternal = (messages: ChatMessage[]): void => {
  const normalizedMessages = normalizeChatImagesForSave(messages);
  // 检测数据是否发生变化
  if (lastChatHistorySnapshot !== null) {
    try {
      const lastMessages = JSON.parse(lastChatHistorySnapshot);
      if (isDataEqual(normalizedMessages, lastMessages)) {
        // 数据未变化，跳过保存
        return;
      }
    } catch (error) {
      // 解析失败，继续执行保存
      console.warn('[HistoryService] 解析上次聊天快照失败，将执行保存:', error);
    }
  }
  
  const startTime = performance.now();
  
  // 使用 Web Worker 异步序列化，避免阻塞主线程
  serializationWorker.stringify(normalizedMessages)
    .then((historyJSON) => {
      const serializeTime = performance.now() - startTime;
      
      // 性能监控：记录序列化时间
      if (serializeTime > 100) {
        console.warn(`[HistoryService] 聊天序列化耗时较长: ${serializeTime.toFixed(2)}ms, 数据大小: ${(historyJSON.length / 1024).toFixed(2)}KB`);
      }
      
      // 更新快照
      lastChatHistorySnapshot = historyJSON;
      
      // 使用事件系统发送保存请求，完全非阻塞
      EventsEmit('history:save-chat', historyJSON);
    })
    .catch((error) => {
      // 序列化失败时，尝试使用主线程序列化作为后备方案
      try {
        const fallbackStartTime = performance.now();
        const historyJSON = JSON.stringify(normalizedMessages);
        const fallbackTime = performance.now() - fallbackStartTime;
        
        if (fallbackTime > 100) {
          console.warn(`[HistoryService] 主线程序列化耗时较长: ${fallbackTime.toFixed(2)}ms`);
        }
        
        // 更新快照
        lastChatHistorySnapshot = historyJSON;
        
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
 * - 使用基于用户活动的防抖机制，在用户停止操作 2 秒后保存
 * - 使用 Web Worker 进行 JSON 序列化，避免阻塞主线程
 * - 通过 EventsEmit 发送保存请求事件，立即返回，不等待保存完成
 */
export const saveChatHistory = activityDebounce(_saveChatHistoryInternal, 10000);

/**
 * 清除聊天历史记录
 */
export const clearChatHistory = async (): Promise<void> => {
  try {
    await ClearChatHistory();
    // 清除快照
    lastChatHistorySnapshot = '[]';
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
      // 初始化空快照
      const emptyData = { viewport: { x: 0, y: 0, zoom: 1 }, images: [] };
      lastCanvasHistorySnapshot = JSON.stringify(emptyData);
      return emptyData;
    }
    const data = JSON.parse(historyJSON);
    const result = {
      viewport: data.viewport || { x: 0, y: 0, zoom: 1 },
      images: (data.images || []).map((img: CanvasImage) => ({
        ...img,
        src: toImageRef(img.src)
      }))
    };
    // 初始化快照，避免首次保存时误判为无变化
    lastCanvasHistorySnapshot = JSON.stringify(result);
    return result;
  } catch (error) {
    console.error('Failed to load canvas history:', error);
    const emptyData = { viewport: { x: 0, y: 0, zoom: 1 }, images: [] };
    lastCanvasHistorySnapshot = JSON.stringify(emptyData);
    return emptyData;
  }
};

// 内部保存函数（实际执行保存操作）
const _saveCanvasHistoryInternal = (viewport: Viewport, images: CanvasImage[]): void => {
  const normalizedImages = normalizeCanvasImagesForSave(images);
  const data = {
    viewport,
    images: normalizedImages
  };
  
  // 检测数据是否发生变化
  if (lastCanvasHistorySnapshot !== null) {
    try {
      const lastData = JSON.parse(lastCanvasHistorySnapshot);
      if (isDataEqual(data, lastData)) {
        // 数据未变化，跳过保存
        return;
      }
    } catch (error) {
      // 解析失败，继续执行保存
      console.warn('[HistoryService] 解析上次画布快照失败，将执行保存:', error);
    }
  }
  
  const startTime = performance.now();
  
  // 使用 Web Worker 异步序列化，避免阻塞主线程
  serializationWorker.stringify(data)
    .then((historyJSON) => {
      const serializeTime = performance.now() - startTime;
      
      // 性能监控：记录序列化时间
      if (serializeTime > 100) {
        console.warn(`[HistoryService] 画布序列化耗时较长: ${serializeTime.toFixed(2)}ms, 数据大小: ${(historyJSON.length / 1024).toFixed(2)}KB`);
      }
      
      // 更新快照
      lastCanvasHistorySnapshot = historyJSON;
      
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
        
        // 更新快照
        lastCanvasHistorySnapshot = historyJSON;
        
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
 * - 使用基于用户活动的防抖机制，在用户停止操作 2.5 秒后保存
 * - 使用 Web Worker 进行 JSON 序列化，避免阻塞主线程
 * - 通过 EventsEmit 发送保存请求事件，立即返回，不等待保存完成
 */
export const saveCanvasHistory = activityDebounce(_saveCanvasHistoryInternal, 10000);

/**
 * 立即保存聊天历史记录（用于应用关闭时）
 * 会取消待执行的防抖保存，并立即执行保存
 * @param messages 聊天消息数组
 */
export const flushChatHistory = (messages: ChatMessage[]): void => {
  saveChatHistory.cancel();
  _saveChatHistoryInternal(messages);
};

/**
 * 立即保存画布历史记录（用于应用关闭时）
 * 会取消待执行的防抖保存，并立即执行保存
 * @param viewport 视口状态
 * @param images 画布图像数组
 */
export const flushCanvasHistory = (viewport: Viewport, images: CanvasImage[]): void => {
  saveCanvasHistory.cancel();
  _saveCanvasHistoryInternal(viewport, images);
};

/**
 * 同步保存聊天历史记录（等待保存完成）
 * 用于应用关闭时确保数据已保存
 * 直接调用 Go 后端的同步保存方法，不走事件队列
 * @param messages 聊天消息数组
 * @returns Promise，保存完成后 resolve
 */
export const saveChatHistorySync = async (messages: ChatMessage[]): Promise<void> => {
  const normalizedMessages = normalizeChatImagesForSave(messages);
  try {
    const startTime = performance.now();
    
    // 使用 Web Worker 异步序列化
    const historyJSON = await serializationWorker.stringify(normalizedMessages);
    const serializeTime = performance.now() - startTime;
    
    if (serializeTime > 100) {
      console.warn(`[HistoryService] 聊天序列化耗时较长: ${serializeTime.toFixed(2)}ms`);
    }
    
    // 直接调用 Go 后端的同步保存方法，确保数据已写入磁盘
    await SaveChatHistorySync(historyJSON);
    
    const totalTime = performance.now() - startTime;
    if (totalTime > 200) {
      console.warn(`[HistoryService] 聊天历史同步保存总耗时: ${totalTime.toFixed(2)}ms`);
    }
  } catch (error) {
    // 后备方案：使用主线程序列化
    try {
      const historyJSON = JSON.stringify(normalizedMessages);
      await SaveChatHistorySync(historyJSON);
    } catch (fallbackError) {
      console.error('Failed to save chat history:', fallbackError);
      throw fallbackError;
    }
  }
};

/**
 * 同步保存画布历史记录（等待保存完成）
 * 用于应用关闭时确保数据已保存
 * 直接调用 Go 后端的同步保存方法，不走事件队列
 * @param viewport 视口状态
 * @param images 画布图像数组
 * @returns Promise，保存完成后 resolve
 */
export const saveCanvasHistorySync = async (viewport: Viewport, images: CanvasImage[]): Promise<void> => {
  const data = { viewport, images: normalizeCanvasImagesForSave(images) };
  
  try {
    const startTime = performance.now();
    
    // 使用 Web Worker 异步序列化
    const historyJSON = await serializationWorker.stringify(data);
    const serializeTime = performance.now() - startTime;
    
    if (serializeTime > 100) {
      console.warn(`[HistoryService] 画布序列化耗时较长: ${serializeTime.toFixed(2)}ms`);
    }
    
    // 直接调用 Go 后端的同步保存方法，确保数据已写入磁盘
    await SaveCanvasHistorySync(historyJSON);
    
    const totalTime = performance.now() - startTime;
    if (totalTime > 200) {
      console.warn(`[HistoryService] 画布历史同步保存总耗时: ${totalTime.toFixed(2)}ms`);
    }
  } catch (error) {
    // 后备方案：使用主线程序列化
    try {
      const historyJSON = JSON.stringify(data);
      await SaveCanvasHistorySync(historyJSON);
    } catch (fallbackError) {
      console.error('Failed to save canvas history:', fallbackError);
      throw fallbackError;
    }
  }
};

/**
 * 清除画布历史记录
 */
export const clearCanvasHistory = async (): Promise<void> => {
  try {
    await ClearCanvasHistory();
    // 清除快照
    const emptyData = { viewport: { x: 0, y: 0, zoom: 1 }, images: [] };
    lastCanvasHistorySnapshot = JSON.stringify(emptyData);
  } catch (error) {
    console.error('Failed to clear canvas history:', error);
    throw error;
  }
};

