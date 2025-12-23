export interface CanvasImage {
  id: string;
  src: string; // Base64 data URL
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  prompt: string;
  rotation?: number; // 旋转角度（度），默认 0
}

export type MessageType = 'text' | 'system' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  type?: MessageType;
  text: string;
  images?: string[]; // Array of base64 strings to display thumbnails
  timestamp: number;
}

export type CanvasActionType = 'edit' | 'delete' | 'extract_subject' | 'extract_mid' | 'extract_bg' | 'enhance' | 'expand' | 'generate_expanded';

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Attachment {
  id: string;
  type: 'canvas' | 'local';
  content: string; // For 'canvas', this is the imageId. For 'local', this is the Base64 string.
}

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
export type ImageSize = "1K" | "2K" | "4K";

export interface ModelSettings {
  temperature: number;
  topP: number;
  topK: number;
  aspectRatio: AspectRatio | "";
  imageSize: ImageSize | "";
}

// 扩图偏移量（相对于原图的扩展范围）
export interface ExpandOffsets {
  top: number;    // 顶部扩展像素
  right: number;  // 右侧扩展像素
  bottom: number; // 底部扩展像素
  left: number;   // 左侧扩展像素
}