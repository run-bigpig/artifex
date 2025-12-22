/**
 * AI 服务 - 统一的前端与后端 AI 服务对接接口层
 * 
 * 此模块提供了与 Go 后端 AI 服务通信的统一接口，封装了所有 AI 相关的功能：
 * - 图像生成
 * - 图像编辑（单图和多图）
 * - 提示词增强
 * 
 * API Key 和配置管理由 Go 后端统一处理。
 */

import { GenerateImage, EditMultiImages, EnhancePrompt } from '../wailsjs/go/core/App';
import { ModelSettings } from '../types';

// ==================== 类型定义 ====================

/**
 * 生成图像参数接口（与 Go 后端 GenerateImageParams 对应）
 */
interface GenerateImageParams {
  prompt: string;
  referenceImage?: string; // base64 编码的参考图像
  sketchImage?: string; // base64 编码的草图图像
  imageSize: string; // "1K", "2K", "4K"
  aspectRatio: string; // "1:1", "16:9", "9:16", "3:4", "4:3"
}

/**
 * 多图编辑参数接口（与 Go 后端 MultiImageEditParams 对应）
 */
interface MultiImageEditParams {
  images: string[]; // base64 编码的图像数组（支持单图或多图）
  prompt: string; // 编辑提示词
  imageSize?: string; // 图片尺寸，可选值："1K", "2K", "4K"（可选）
  aspectRatio?: string; // 宽高比，可选值："1:1", "16:9", "9:16", "3:4", "4:3"（可选）
}

/**
 * 增强提示词参数接口（与 Go 后端 EnhancePromptParams 对应）
 */
interface EnhancePromptParams {
  prompt: string;
  referenceImages?: string[]; // base64 编码的参考图像数组（可选）
}

// ==================== 图像生成 ====================

/**
 * 生成图像
 * @param prompt 提示词
 * @param settings 模型设置（可选）
 * @param referenceImage 可选的参考图像（base64）
 * @param sketchImage 可选的草图图像（base64）
 * @returns base64 编码的图像数据
 * @throws 如果生成失败会抛出错误
 */
export const generateImage = async (
  prompt: string,
  settings?: ModelSettings,
  referenceImage?: string,
  sketchImage?: string
): Promise<string> => {
  try {
    const params: GenerateImageParams = {
      prompt,
      imageSize: settings?.imageSize || '1K',
      aspectRatio: settings?.aspectRatio || '1:1',
    };

    if (referenceImage) {
      params.referenceImage = referenceImage;
    }

    if (sketchImage) {
      params.sketchImage = sketchImage;
    }

    const paramsJSON = JSON.stringify(params);
    return await GenerateImage(paramsJSON);
  } catch (error) {
    console.error("Image generation failed", error);
    throw error;
  }
};

// ==================== 图像编辑 ====================

/**
 * 编辑图像（支持单图或多图）
 * 统一使用多图编辑方法，即使只有一张图也使用此方法。
 * 
 * @param base64Images base64 编码的图像数组（支持单图或多图）
 * @param prompt 编辑提示词
 * @param imageSize 图片尺寸，可选值："1K", "2K", "4K"（可选，仅 Gemini Provider 支持）
 * @param aspectRatio 宽高比，可选值："1:1", "16:9", "9:16", "3:4", "4:3"（可选，仅 Gemini Provider 支持）
 * @returns base64 编码的编辑后图像数据
 * @throws 如果编辑失败会抛出错误
 */
export const editMultiImages = async (
  base64Images: string[],
  prompt: string,
  imageSize?: string,
  aspectRatio?: string
): Promise<string> => {
  try {
    if (base64Images.length === 0) {
      throw new Error('No images provided');
    }

    // 统一使用多图编辑参数
    const params: MultiImageEditParams = {
      images: base64Images,
      prompt: prompt,
    };

    // 如果提供了 ImageSize 或 AspectRatio，添加到参数中
    if (imageSize) {
      params.imageSize = imageSize;
    }
    if (aspectRatio) {
      params.aspectRatio = aspectRatio;
    }

    const paramsJSON = JSON.stringify(params);
    // 直接调用后端的 EditMultiImages 方法
    return await EditMultiImages(paramsJSON);
  } catch (error) {
    console.error("Image editing failed", error);
    throw error;
  }
};

// ==================== 提示词增强 ====================

/**
 * 增强提示词
 * 支持基于参考图像的提示词增强，AI 会分析参考图像的视觉风格、光照、构图等特征。
 * 
 * @param prompt 原始提示词
 * @param referenceImages 可选的参考图像数组（base64）
 * @returns 增强后的提示词。如果增强失败，返回原始提示词
 */
export const enhancePrompt = async (
  prompt: string,
  referenceImages?: string[]
): Promise<string> => {
  try {
    const params: EnhancePromptParams = {
      prompt,
    };

    if (referenceImages && referenceImages.length > 0) {
      params.referenceImages = referenceImages;
    }

    const paramsJSON = JSON.stringify(params);
    return await EnhancePrompt(paramsJSON);
  } catch (error) {
    console.error("Prompt enhancement failed", error);
    // 如果增强失败，返回原始提示词（保持向后兼容）
    return prompt;
  }
};


