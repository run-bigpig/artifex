export interface CanvasImage {
  id: string;
  src: string; // Base64 data URL
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  prompt: string;
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

export type CanvasActionType = 'edit' | 'delete' | 'extract_subject' | 'extract_mid' | 'extract_bg';

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