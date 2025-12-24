/**
 * Canvas 工具函数集合
 * 提供坐标转换、图片处理、Canvas API 封装等功能
 */

import { Viewport, Point, ExpandOffsets } from '../types';

/**
 * 将世界坐标转换为屏幕坐标
 * @param worldX 世界 X 坐标
 * @param worldY 世界 Y 坐标
 * @param viewport 视口信息
 * @returns 屏幕坐标
 */
export const worldToScreen = (
  worldX: number,
  worldY: number,
  viewport: Viewport
): Point => {
  return {
    x: viewport.x + worldX * viewport.zoom,
    y: viewport.y + worldY * viewport.zoom,
  };
};

/**
 * 将屏幕坐标转换为世界坐标
 * @param screenX 屏幕 X 坐标
 * @param screenY 屏幕 Y 坐标
 * @param viewport 视口信息
 * @returns 世界坐标
 */
export const screenToWorld = (
  screenX: number,
  screenY: number,
  viewport: Viewport
): Point => {
  return {
    x: (screenX - viewport.x) / viewport.zoom,
    y: (screenY - viewport.y) / viewport.zoom,
  };
};

/**
 * 将图片转换为 PNG Blob（用于剪贴板兼容性）
 * @param src 图片源（base64 或 URL）
 * @returns Promise<Blob> PNG 格式的 Blob
 * @throws 如果图片加载失败或 Canvas 上下文创建失败
 */
export const getPngBlob = (src: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 上下文创建失败'));
          return;
        }
        
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Blob 创建失败'));
            }
          },
          'image/png'
        );
      } catch (error) {
        reject(new Error(`图片处理失败: ${error instanceof Error ? error.message : String(error)}`));
      }
    };
    
    img.onerror = () => {
      reject(new Error('图片加载失败'));
    };
    
    img.src = src;
  });
};

/**
 * 创建拖拽预览缩略图（同步版本）
 * 返回 Canvas 元素，可以直接用作 drag image（不需要等待加载）
 * @param img 图片元素
 * @param size 缩略图尺寸（默认 64px）
 * @returns HTMLCanvasElement 缩略图 Canvas
 * @throws 如果 Canvas 上下文创建失败
 */
export const createDragPreviewThumbnailSync = (
  img: HTMLImageElement,
  size: number = 64
): HTMLCanvasElement => {
  // 创建 Canvas 来生成缩略图
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 上下文创建失败');
  }

  // 计算缩放比例，保持宽高比，使用 cover 模式（居中裁剪）
  const imgAspect = img.naturalWidth / img.naturalHeight;

  let drawWidth = size;
  let drawHeight = size;
  let drawX = 0;
  let drawY = 0;

  if (imgAspect > 1) {
    // 图片更宽，以高度为准
    drawHeight = size;
    drawWidth = size * imgAspect;
    drawX = (size - drawWidth) / 2;
  } else {
    // 图片更高，以宽度为准
    drawWidth = size;
    drawHeight = size / imgAspect;
    drawY = (size - drawHeight) / 2;
  }

  // 填充背景色（使用半透明黑色）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(0, 0, size, size);

  // 绘制图片（居中裁剪）
  ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

  // 添加边框
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  return canvas;
};

/**
 * 获取图片的原始尺寸（naturalWidth/naturalHeight）
 * @param imgSrc 图片源（base64 或 URL）
 * @returns Promise<{ width: number; height: number }> 原始尺寸
 * @throws 如果图片加载失败
 */
export const getImageNaturalDimensions = (imgSrc: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imgSrc;
  });
};

/**
 * 生成带白边画布的扩展图片
 * @param imgSrc 原始图片源（base64）
 * @param offsets 扩展偏移量（基于原始尺寸的像素值）
 * @returns Promise<string> 扩展后的 base64 图片
 * @throws 如果图片加载失败或 Canvas 操作失败
 */
export const generateExpandedImage = async (
  imgSrc: string,
  offsets: ExpandOffsets
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const imageElement = new Image();
    
    imageElement.onload = () => {
      try {
        // 计算新画布的尺寸（使用原始尺寸）
        const newWidth = imageElement.naturalWidth + offsets.left + offsets.right;
        const newHeight = imageElement.naturalHeight + offsets.top + offsets.bottom;

        // 创建 Canvas
        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 上下文创建失败'));
          return;
        }

        // 填充白色背景
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, newWidth, newHeight);

        // 绘制原图到新位置（考虑偏移量）
        ctx.drawImage(
          imageElement,
          offsets.left,
          offsets.top,
          imageElement.naturalWidth,
          imageElement.naturalHeight
        );

        // 转换为 base64
        const base64 = canvas.toDataURL('image/png');
        resolve(base64);
      } catch (error) {
        reject(new Error(`扩展图片生成失败: ${error instanceof Error ? error.message : String(error)}`));
      }
    };
    
    imageElement.onerror = () => {
      reject(new Error('图片加载失败'));
    };
    
    imageElement.src = imgSrc;
  });
};

/**
 * 计算两点之间的距离
 * @param p1 点1
 * @param p2 点2
 * @returns 距离
 */
export const getDistance = (p1: Point, p2: Point): number => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * 限制数值在指定范围内
 * @param value 原始值
 * @param min 最小值
 * @param max 最大值
 * @returns 限制后的值
 */
export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

/**
 * 计算缩放后的视口位置，使指定世界坐标点在屏幕上的位置保持不变
 * @param mouseScreenX 鼠标屏幕 X 坐标
 * @param mouseScreenY 鼠标屏幕 Y 坐标
 * @param worldX 目标世界 X 坐标
 * @param worldY 目标世界 Y 坐标
 * @param newZoom 新的缩放比例
 * @returns 新的视口位置
 */
export const calculateZoomViewport = (
  mouseScreenX: number,
  mouseScreenY: number,
  worldX: number,
  worldY: number,
  newZoom: number
): { x: number; y: number } => {
  // 调整视口位置，使得缩放前后鼠标指向的世界坐标点在屏幕上的位置保持不变
  // 公式：newViewport.x = mouseX - worldX * newZoom
  return {
    x: mouseScreenX - worldX * newZoom,
    y: mouseScreenY - worldY * newZoom,
  };
};

