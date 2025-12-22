/**
 * Serialization Web Worker
 * 在后台线程中执行 JSON 序列化，避免阻塞主线程
 * 
 * 用于处理大型项目数据的序列化操作
 */

interface WorkerMessage {
  id: string;
  type: 'stringify';
  data: any;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  result?: string;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  try {
    const { id, type, data } = e.data;
    
    if (type === 'stringify') {
      const result = JSON.stringify(data);
      
      self.postMessage({ 
        id, 
        success: true, 
        result 
      } as WorkerResponse);
    } else {
      throw new Error(`Unknown operation type: ${type}`);
    }
  } catch (error) {
    self.postMessage({ 
      id: e.data.id, 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    } as WorkerResponse);
  }
};

