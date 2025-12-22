/**
 * 设置相关的类型定义
 * 与后端 core/types/types.go 中的 Settings 结构对应
 */

// AI 提供商类型
export type AIProvider = 'gemini' | 'openai' | 'cloud';

// OpenAI 图像模式
export type OpenAIImageMode = 'auto' | 'image_api' | 'chat';

// 应用设置接口（与后端 Settings 对应）
export interface Settings {
  version: string;
  ai: AISettings;
}

// AI 服务设置（与后端 AISettings 对应）
export interface AISettings {
  // 通用配置
  provider: AIProvider;
  apiKey: string; // 加密存储
  textModel: string;
  imageModel: string;

  // Vertex AI 配置
  useVertexAI: boolean;
  vertexProject: string;
  vertexLocation: string;
  vertexCredentials: string; // 加密存储

  // OpenAI 配置
  openaiApiKey: string; // 加密存储
  openaiImageApiKey: string; // 加密存储
  openaiBaseUrl: string;
  openaiImageBaseUrl: string;
  openaiTextModel: string;
  openaiImageModel: string;
  openaiImageMode: OpenAIImageMode;
  openaiTextStream: boolean;
  openaiImageStream: boolean;

  // Cloud 云服务配置
  cloudEndpointUrl: string;
  cloudToken: string; // 加密存储
}

// 默认设置
export const defaultSettings: Settings = {
  version: '1.0.0',
  ai: {
    provider: 'gemini',
    apiKey: '',
    textModel: 'gemini-2.5-flash',
    imageModel: 'gemini-2.5-flash-preview-05-20',
    useVertexAI: false,
    vertexProject: '',
    vertexLocation: 'us-central1',
    vertexCredentials: '',
    openaiApiKey: '',
    openaiImageApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiImageBaseUrl: '',
    openaiTextModel: 'gpt-4o',
    openaiImageModel: 'dall-e-3',
    openaiImageMode: 'auto',
    openaiTextStream: false,
    openaiImageStream: false,
    cloudEndpointUrl: '',
    cloudToken: '',
  },
};

