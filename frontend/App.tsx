import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { CanvasImage, Viewport, CanvasActionType, Attachment, ModelSettings } from './types';
import Canvas from './components/Canvas';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LoadingOverlay from './components/LoadingOverlay';
import { generateImage, editMultiImages } from './services/aiService';
import { storeImage } from './services/imageService';
import { loadCanvasHistory, saveCanvasHistory, flushCanvasHistory, saveCanvasHistorySync, saveChatHistorySync, flushChatHistory } from './services/historyService';
import { ChatMessage } from './types';
import { serializationWorker } from './services/serializationWorker';
import { ImageIndex, hasImagesChanged } from './utils/imageIndex';
import { normalizeImageSrc } from './utils/imageSource';
import { activityDetector } from './services/activityDetector';
import SaveProgressOverlay from './components/SaveProgressOverlay';
import { Quit } from './wailsjs/runtime/runtime';

const generateId = () => Math.random().toString(36).substr(2, 9);

// Helper to get image dimensions from data URLs or image refs
const loadImageDimensions = (src: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const normalizedSrc = normalizeImageSrc(src);
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = (e) => reject(e);
    img.src = normalizedSrc;
  });
};

const App: React.FC = () => {
  // Application State
  const [images, setImages] = useState<CanvasImage[]>([]);
  // Single selection only
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  // Sidebar/Chat State Integration
  const [sidebarInputValue, setSidebarInputValue] = useState('');

  // Attachments for Chat
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);

  // Model Settings State
  const [modelSettings, setModelSettings] = useState<ModelSettings>({
    temperature: 1.0,
    topP: 0.95,
    topK: 64,
    aspectRatio: '1:1',
    imageSize: '1K'
  });

  // Viewport State (Camera)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });

  // 用于跟踪数据变化的 ref
  const isInitialLoadRef = useRef(true);
  const prevCanvasDataRef = useRef<{ viewport: Viewport; images: CanvasImage[] } | null>(null);

  // ✅ 添加加载标志，防止重复加载
  const isLoadingCanvasHistoryRef = useRef(false);
  const hasLoadedCanvasHistoryRef = useRef(false);

  // ✅ 用于应用关闭时保存的 ref（避免每次变化时重新注册事件监听器）
  const viewportRef = useRef<Viewport>(viewport);
  const imagesRef = useRef<CanvasImage[]>(images);
  const messagesRef = useRef<ChatMessage[] | null>(null);

  // ✅ 同步更新 ref（使用 useMemo 确保在渲染时立即更新，而不是等待 useEffect）
  // 这解决了异步更新导致的 getCanvasCenter 获取旧值问题
  viewportRef.current = viewport;
  imagesRef.current = images;

  // 保存进度状态
  const [saveProgress, setSaveProgress] = useState({
    isVisible: false,
    chatSaved: false,
    canvasSaved: false
  });

  // ✅ 性能优化：使用索引来加速比较和查找
  // 使用 useMemo 缓存索引，只在 images 变化时重建
  const imageIndex = useMemo(() => new ImageIndex(images), [images]);

  // 全局加载状态管理
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState({
    chatLoaded: false,
    canvasLoaded: false,
  });

  // Helper to get canvas container dimensions
  const getCanvasDimensions = () => {
    // Sidebar is always 420px wide now
    const sidebarWidth = 420;
    // Header height is 64px (pt-16 in Tailwind = 4rem = 64px)
    const headerHeight = 64;
    const canvasWidth = window.innerWidth - sidebarWidth;
    const canvasHeight = window.innerHeight - headerHeight;
    return { width: canvasWidth, height: canvasHeight };
  };

  /**
   * 计算可视画布区域的中心位置（世界坐标）
   * 使用 viewportRef.current 获取最新的视口状态，避免闭包陈旧值问题
   * @param width 图片宽度（世界坐标）
   * @param height 图片高度（世界坐标）
   * @returns 图片左上角的世界坐标位置，使得图片中心对准可视区域中心
   */
  const getCanvasCenter = (width: number, height: number) => {
    const { width: canvasWidth, height: canvasHeight } = getCanvasDimensions();
    // ✅ 使用 viewportRef.current 获取最新视口状态，避免异步操作中的闭包陈旧值
    const currentViewport = viewportRef.current;

    // 确保 zoom 在有效范围内（防止除零或极端值）
    const safeZoom = Math.max(0.001, Math.min(100, currentViewport.zoom));
    
    // ✅ 优化：屏幕中心点转换为世界坐标
    // 公式推导：screenX = viewport.x + worldX * zoom
    // 反推：worldX = (screenX - viewport.x) / zoom
    const screenCenterX = canvasWidth / 2;
    const screenCenterY = canvasHeight / 2;
    
    const worldCenterX = (screenCenterX - currentViewport.x) / safeZoom;
    const worldCenterY = (screenCenterY - currentViewport.y) / safeZoom;

    // 返回图片左上角位置，使图片中心对准可视区域中心
    const imageX = worldCenterX - (width / 2);
    const imageY = worldCenterY - (height / 2);

    // ✅ 开发模式下输出调试信息（仅在控制台）
    if (process.env.NODE_ENV === 'development') {
      console.debug('[getCanvasCenter] 位置计算:', {
        canvasDimensions: { width: canvasWidth, height: canvasHeight },
        viewport: currentViewport,
        safeZoom,
        screenCenter: { x: screenCenterX, y: screenCenterY },
        worldCenter: { x: worldCenterX, y: worldCenterY },
        imageDimensions: { width, height },
        imagePosition: { x: imageX, y: imageY }
      });
    }

    return {
      x: imageX,
      y: imageY
    };
  };

  /**
   * 获取当前所有图片中最大的 z-index 值
   * 使用 imagesRef.current 获取最新的图片列表，避免闭包陈旧值问题
   * @returns 最大 z-index 值，如果没有图片则返回 0
   */
  const getMaxZIndex = (): number => {
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return 0;
    return Math.max(...currentImages.map(img => img.zIndex));
  };

  /**
   * ✅ 可选功能：自动调整视口，确保指定图片完全可见
   * 如果图片已经在可视区域内，则不调整
   * 如果图片部分或完全在可视区域外，则平滑移动视口使其居中
   * 
   * @param image 要确保可见的图片
   */
  const ensureImageVisible = (image: CanvasImage) => {
    const { width: canvasWidth, height: canvasHeight } = getCanvasDimensions();
    const currentViewport = viewportRef.current;

    // 计算图片在屏幕上的边界
    const imageScreenX = currentViewport.x + image.x * currentViewport.zoom;
    const imageScreenY = currentViewport.y + image.y * currentViewport.zoom;
    const imageScreenWidth = image.width * currentViewport.zoom;
    const imageScreenHeight = image.height * currentViewport.zoom;

    // 检查图片是否完全在可视区域内
    const isFullyVisible = 
      imageScreenX >= 0 &&
      imageScreenY >= 0 &&
      imageScreenX + imageScreenWidth <= canvasWidth &&
      imageScreenY + imageScreenHeight <= canvasHeight;

    if (isFullyVisible) {
      // 图片已经完全可见，不需要调整
      return;
    }

    // 计算将图片居中所需的新 viewport 位置
    // 目标：图片中心对准屏幕中心
    const imageCenterWorldX = image.x + image.width / 2;
    const imageCenterWorldY = image.y + image.height / 2;

    // 新的 viewport 位置（保持 zoom 不变）
    const newViewportX = canvasWidth / 2 - imageCenterWorldX * currentViewport.zoom;
    const newViewportY = canvasHeight / 2 - imageCenterWorldY * currentViewport.zoom;

    if (process.env.NODE_ENV === 'development') {
      console.debug('[ensureImageVisible] 调整视口:', {
        image: { id: image.id, x: image.x, y: image.y, width: image.width, height: image.height },
        currentViewport,
        isFullyVisible,
        newViewport: { x: newViewportX, y: newViewportY, zoom: currentViewport.zoom }
      });
    }

    // 平滑移动视口
    setViewport({
      x: newViewportX,
      y: newViewportY,
      zoom: currentViewport.zoom
    });
  };

  /**
   * 约束图片尺寸
   * 策略：图片在屏幕上始终保持较小尺寸，便于画布容纳更多内容
   * 根据缩放级别和画布尺寸动态调整，确保图片既不会太大也不会太小
   * 
   * @param originalWidth 原始图片宽度（像素）
   * @param originalHeight 原始图片高度（像素）
   * @returns 约束后的尺寸（世界坐标），保持原始宽高比
   */
  const constrainImageSize = (
    originalWidth: number,
    originalHeight: number
  ): { width: number; height: number } => {
    const { width: canvasWidth, height: canvasHeight } = getCanvasDimensions();
    const currentZoom = viewportRef.current.zoom;

    // 确保 zoom 在有效范围内
    const safeZoom = Math.max(0.001, Math.min(100, currentZoom));

    // ✅ 优化：目标显示尺寸策略
    // 始终保持较小的显示尺寸，方便用户在画布上操作更多图片
    let displayRatio: number;
    
    if (safeZoom < 0.1) {
      // 极度缩小时：适度增大显示比例，确保图片可见但不过大
      displayRatio = 0.2;
    } else if (safeZoom < 0.5) {
      // 缩小状态：保持紧凑
      displayRatio = 0.15;
    } else if (safeZoom > 5) {
      // 极度放大时：减小显示比例，避免图片占满屏幕
      displayRatio = 0.12;
    } else if (safeZoom > 2) {
      // 放大状态：保持较小
      displayRatio = 0.15;
    } else {
      // 正常缩放 (0.5 ~ 2)：保持紧凑的默认大小
      displayRatio = 0.18;
    }
    
    const targetDisplayWidth = canvasWidth * displayRatio;
    const targetDisplayHeight = canvasHeight * displayRatio;

    // 保持原始宽高比，计算适应目标区域的显示尺寸
    const aspectRatio = originalWidth / originalHeight;
    let displayWidth: number;
    let displayHeight: number;

    if (aspectRatio > targetDisplayWidth / targetDisplayHeight) {
      // 图片较宽，以宽度为基准
      displayWidth = targetDisplayWidth;
      displayHeight = displayWidth / aspectRatio;
    } else {
      // 图片较高，以高度为基准
      displayHeight = targetDisplayHeight;
      displayWidth = displayHeight * aspectRatio;
    }

    // 将显示尺寸转换为世界坐标尺寸
    // worldSize = displaySize / zoom
    const finalWidth = displayWidth / safeZoom;
    const finalHeight = displayHeight / safeZoom;

    // ✅ 边界检查：确保尺寸在合理范围内
    // 最小尺寸：50 世界像素（防止图片太小看不见）
    // 最大尺寸：50000 世界像素（防止极端情况）
    const constrainedWidth = Math.max(50, Math.min(50000, finalWidth));
    const constrainedHeight = Math.max(50, Math.min(50000, finalHeight));

    // ✅ 开发模式下输出调试信息
    if (process.env.NODE_ENV === 'development') {
      console.debug('[constrainImageSize] 尺寸计算:', {
        original: { width: originalWidth, height: originalHeight },
        canvasDimensions: { width: canvasWidth, height: canvasHeight },
        zoom: currentZoom,
        safeZoom,
        displayRatio,
        targetDisplay: { width: targetDisplayWidth, height: targetDisplayHeight },
        calculatedDisplay: { width: displayWidth, height: displayHeight },
        worldSize: { width: finalWidth, height: finalHeight },
        constrainedSize: { width: constrainedWidth, height: constrainedHeight }
      });
    }

    return { width: constrainedWidth, height: constrainedHeight };
  };

  // Handle actions triggered from the Canvas (Floating Menu)
  const handleCanvasAction = (id: string, action: CanvasActionType) => {
    const affectedIds = selectedImageId === id ? [id] : [id];

    // Helper to setup edit mode
    const setupEdit = (promptText: string) => {
      // 1. 首先清空参考图输入框的内容，然后添加新图片到参考图输入框
      const newAttachments: Attachment[] = [];
      affectedIds.forEach(affectedId => {
          newAttachments.push({
            id: generateId(),
            type: 'canvas',
            content: affectedId
          });
      });

      // 一次性设置新的 attachments（清空旧内容并添加新内容）
      setAttachments(newAttachments);
      
      // 2. 设置提示词
      if (promptText) {
        setSidebarInputValue(promptText);
      }
    };

    switch (action) {
      case 'edit':
        setupEdit('');
        break;

      case 'extract_subject':
        setupEdit('抠图：去除背景，只保留主体 (Remove background, keep subject only)');
        break;

      case 'extract_mid':
        setupEdit('抠图：提取中景元素，去除前景和背景 (Extract midground elements)');
        break;

      case 'extract_bg':
        setupEdit('抠图：去除主体，只保留背景 (Remove subject, keep background only)');
        break;

      case 'enhance':
        setupEdit('变清晰');
        break;

      case 'expand':
        // 扩图模式由 Canvas 组件内部处理，这里不需要额外操作
        break;

      case 'generate_expanded':
        // 这个动作由 onGenerateExpanded 回调处理
        break;

      case 'delete':
        setImages(prev => prev.filter(i => !affectedIds.includes(i.id)));
        setSelectedImageId(null);
        // Also remove from sidebar attachments if they were attached
        setAttachments(prev => prev.filter(a => !(a.type === 'canvas' && affectedIds.includes(a.content))));
        break;
      default:
        break;
    }
  };

  // 处理扩图生成完成
  const handleGenerateExpanded = async (imageId: string, expandedBase64: string) => {
    // 1. 首先清空参考图输入框的内容
    setAttachments([]);
    try {
      const imageRef = await storeImage(expandedBase64);
      // 2. 然后将扩图后的图片添加到参考图列表
      setAttachments([{
        id: generateId(),
        type: 'url',
        content: imageRef
      }]);
    } catch (error) {
      console.error('Failed to store expanded image:', error);
    }

    // 3. 自动在提示词输入框中写入"扩图"关键词
    setSidebarInputValue('扩图');

    // 4. 重置选中状态（恢复到初始状态）
    setSelectedImageId(null);
  };

  /**
   * 导入图片到画布
   * @param imageSrc 图片源（base64 或 imageRef）
   * @param dropX 可选的拖放 X 坐标（世界坐标）
   * @param dropY 可选的拖放 Y 坐标（世界坐标）
   */
  const handleImportImage = async (imageSrc: string, dropX?: number, dropY?: number) => {
    try {
      const imageRef = await storeImage(imageSrc);
      const { width, height } = await loadImageDimensions(imageRef);

      // 约束图片尺寸，使其在画布上显示合理
      const { width: finalWidth, height: finalHeight } = constrainImageSize(width, height);

      const newId = generateId();

      let xPos, yPos;

      if (dropX !== undefined && dropY !== undefined) {
        // 用户拖放到指定位置：图片中心对准拖放点
        xPos = dropX - (finalWidth / 2);
        yPos = dropY - (finalHeight / 2);
        
        if (process.env.NODE_ENV === 'development') {
          console.debug('[handleImportImage] 拖放导入:', {
            dropPoint: { x: dropX, y: dropY },
            imageSize: { width: finalWidth, height: finalHeight },
            imagePosition: { x: xPos, y: yPos }
          });
        }
      } else {
        // 自动导入：放置在可视区域中心
        const center = getCanvasCenter(finalWidth, finalHeight);
        // 轻微偏移，避免多个导入的图片完全重叠
        const offset = (images.length % 10) * 20; // 使用模运算限制偏移量累积
        xPos = center.x + offset;
        yPos = center.y + offset;
        
        if (process.env.NODE_ENV === 'development') {
          console.debug('[handleImportImage] 自动导入:', {
            center,
            offset,
            imageSize: { width: finalWidth, height: finalHeight },
            imagePosition: { x: xPos, y: yPos }
          });
        }
      }

      const newImage: CanvasImage = {
        id: newId,
        src: imageRef,
        x: xPos,
        y: yPos,
        width: finalWidth,
        height: finalHeight,
        zIndex: getMaxZIndex() + 1, // ✅ 使用最大 z-index + 1，确保新图片在最顶层
        prompt: '导入的图片'
      };

      setImages(prev => [...prev, newImage]);
      // 自动选中新导入的图片
      setSelectedImageId(newId);

      // ✅ 自动调整视口，确保新图片完全可见
      requestAnimationFrame(() => {
        ensureImageVisible(newImage);
      });
    } catch (e) {
      console.error("[handleImportImage] 导入图片失败:", e);
    }
  };

  /**
   * 生成新图片
   * @param prompt 生成提示词
   * @returns 图片引用
   */
  const handleGenerate = async (prompt: string): Promise<string> => {
    setIsProcessing(true);
    try {
      // 生成模式下，aspectRatio 和 imageSize 必须有值，使用默认值
      const settingsForGenerate: ModelSettings = {
        ...modelSettings,
        aspectRatio: modelSettings.aspectRatio || '1:1',
        imageSize: modelSettings.imageSize || '1K'
      };
      const imageRef = await generateImage(prompt, settingsForGenerate);
      const { width, height } = await loadImageDimensions(imageRef);

      // 约束图片尺寸，使其在画布上显示合理
      const { width: finalWidth, height: finalHeight } = constrainImageSize(width, height);

      // 计算图片位置（居中显示）
      const pos = getCanvasCenter(finalWidth, finalHeight);

      const newImage: CanvasImage = {
        id: generateId(),
        src: imageRef,
        x: pos.x,
        y: pos.y,
        width: finalWidth,
        height: finalHeight,
        zIndex: getMaxZIndex() + 1, // ✅ 使用最大 z-index + 1，确保新图片在最顶层
        prompt: prompt
      };

      if (process.env.NODE_ENV === 'development') {
        console.debug('[handleGenerate] 生成图片:', {
          prompt,
          settings: settingsForGenerate,
          originalSize: { width, height },
          finalSize: { width: finalWidth, height: finalHeight },
          position: { x: pos.x, y: pos.y }
        });
      }

      setImages(prev => [...prev, newImage]);
      setSelectedImageId(newImage.id);
      
      // ✅ 自动确保新生成的图片可见
      requestAnimationFrame(() => {
        ensureImageVisible(newImage);
      });
      
      return imageRef;
    } catch (error) {
      console.error("[handleGenerate] 生成图片失败:", error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * 编辑图片
   * @param prompt 编辑提示词
   * @param base64Sources 源图片列表（base64 格式）
   * @returns 编辑后的图片引用
   */
  const handleEdit = async (prompt: string, base64Sources: string[]): Promise<string> => {
    if (base64Sources.length === 0) throw new Error("No source images");

    setIsProcessing(true);
    try {
      // 使用统一的 editMultiImages 方法（支持单图和多图）
      // 如果 aspectRatio 或 imageSize 为空字符串，则不传递这些参数（保持原图）
      const imageRef = await editMultiImages(
        base64Sources,
        prompt,
        modelSettings.imageSize || undefined,
        modelSettings.aspectRatio || undefined
      );
      const { width, height } = await loadImageDimensions(imageRef);

      // 约束图片尺寸，使其在画布上显示合理
      const { width: finalWidth, height: finalHeight } = constrainImageSize(width, height);

      // 计算图片位置（居中显示，略微偏移以区分原图）
      const pos = getCanvasCenter(finalWidth, finalHeight);
      // 添加轻微偏移，避免与原图完全重叠
      const offsetX = 40;
      const offsetY = 40;

      const newImage: CanvasImage = {
        id: generateId(),
        src: imageRef,
        width: finalWidth,
        height: finalHeight,
        x: pos.x + offsetX,
        y: pos.y + offsetY,
        zIndex: getMaxZIndex() + 1, // ✅ 使用最大 z-index + 1，确保新图片在最顶层
        prompt: prompt
      };

      if (process.env.NODE_ENV === 'development') {
        console.debug('[handleEdit] 编辑图片:', {
          prompt,
          sourceCount: base64Sources.length,
          originalSize: { width, height },
          finalSize: { width: finalWidth, height: finalHeight },
          position: { x: newImage.x, y: newImage.y },
          offset: { x: offsetX, y: offsetY }
        });
      }

      setImages(prev => [...prev, newImage]);
      setSelectedImageId(newImage.id);
      
      // ✅ 自动确保新编辑的图片可见
      requestAnimationFrame(() => {
        ensureImageVisible(newImage);
      });
      
      return imageRef;
    } catch (error) {
      console.error("[handleEdit] 编辑图片失败:", error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  // Wrapper for sidebar to add to canvas without coords
  const handleAddToCanvas = (imageSrc: string) => handleImportImage(imageSrc);

  // ✅ 修复：使用 useCallback 包装回调，避免 Sidebar 的 useEffect 重复执行
  // 处理聊天历史加载完成回调
  const handleChatHistoryLoaded = useCallback(() => {
    setLoadProgress(prev => ({ ...prev, chatLoaded: true }));
  }, []); // 空依赖数组，确保函数引用稳定

  // ✅ 应用启动时初始化活动检测器（只执行一次）
  useEffect(() => {
    // 启动用户活动检测器，用于基于用户活动的防抖保存
    activityDetector.start();

    // 组件卸载时停止活动检测器
    return () => {
      activityDetector.stop();
    };
  }, []);

  // ✅ 应用启动时加载画布历史记录（只执行一次）
  useEffect(() => {
    // 防止重复加载
    if (hasLoadedCanvasHistoryRef.current || isLoadingCanvasHistoryRef.current) {
      return;
    }

    isLoadingCanvasHistoryRef.current = true;
    hasLoadedCanvasHistoryRef.current = true;

    const loadHistory = async () => {
      try {
        const { viewport: savedViewport, images: savedImages } = await loadCanvasHistory();
        const finalViewport = savedViewport || { x: 0, y: 0, zoom: 1 };
        const finalImages = savedImages || [];

        if (finalImages.length > 0) {
          setImages(finalImages);
        }
        if (savedViewport) {
          setViewport(finalViewport);
        }

        // 更新数据快照（在状态更新后）
        prevCanvasDataRef.current = {
          viewport: { ...finalViewport },
          images: finalImages.map(img => ({ ...img }))
        };
      } catch (error) {
        console.error('Failed to load canvas history:', error);
        // 即使加载失败，也初始化快照为空数据
        prevCanvasDataRef.current = {
          viewport: { x: 0, y: 0, zoom: 1 },
          images: []
        };
      } finally {
        isInitialLoadRef.current = false;
        isLoadingCanvasHistoryRef.current = false;
        // 标记画布历史加载完成
        setLoadProgress(prev => ({ ...prev, canvasLoaded: true }));
      }
    };
    loadHistory();
    // ✅ 空依赖数组，确保只在组件挂载时执行一次
  }, []);

  // 当两个历史都加载完成后，移除加载蒙版
  useEffect(() => {
    if (loadProgress.chatLoaded && loadProgress.canvasLoaded) {
      // 添加短暂延迟，确保 UI 更新完成
      const timer = setTimeout(() => {
        setIsLoading(false);
      }, 150); // 150ms 延迟，让用户看到完成状态
      return () => clearTimeout(timer);
    }
    // 注意：不要在这里设置 isLoading 为 true，因为初始状态已经是 true
  }, [loadProgress.chatLoaded, loadProgress.canvasLoaded]);

  // ✅ 性能优化：使用索引进行快速比较
  // 使用 ImageIndex 来加速比较，避免 O(n²) 的嵌套循环
  const prevImageIndexRef = useRef<ImageIndex | null>(null);

  const hasCanvasDataChanged = (
    prev: { viewport: Viewport; images: CanvasImage[] } | null,
    current: { viewport: Viewport; images: CanvasImage[] }
  ): boolean => {
    if (!prev) return true;

    // 快速比较 viewport
    const viewportChanged =
      prev.viewport.x !== current.viewport.x ||
      prev.viewport.y !== current.viewport.y ||
      prev.viewport.zoom !== current.viewport.zoom;

    // ✅ 使用索引快速比较 images（O(n) 而不是 O(n²)）
    // 创建当前图片的索引
    const currentIndex = new ImageIndex(current.images);

    // 如果之前的索引不存在，创建它
    if (!prevImageIndexRef.current) {
      prevImageIndexRef.current = new ImageIndex(prev.images);
    }

    // 如果长度不同，直接返回 true
    if (prev.images.length !== current.images.length) {
      prevImageIndexRef.current = currentIndex;
      return true;
    }

    // 使用索引比较
    const imagesChanged = prevImageIndexRef.current.hasChanged(currentIndex);

    // 更新索引缓存
    if (imagesChanged) {
      prevImageIndexRef.current = currentIndex;
    }

    return viewportChanged || imagesChanged;
  };

  // 自动保存画布记录（仅在数据实际变化时触发）
  useEffect(() => {
    // 初始加载时不保存
    if (isInitialLoadRef.current) {
      return;
    }

    // 获取上一次的数据快照
    const prevData = prevCanvasDataRef.current;
    const currentData = { viewport, images };

    // 检查数据是否真正发生变化（使用优化的比较函数）
    if (!hasCanvasDataChanged(prevData, currentData)) {
      return;
    }

    // 数据发生变化，使用防抖保存（已在 historyService 中实现防抖）
    saveCanvasHistory(viewport, images);

    // 更新数据快照
    // 注意：虽然比较时跳过了 src，但快照中仍需要保存 src 的引用
    // 这样可以检测到图片被替换的情况（虽然比较时不会比较 src 内容）
    prevCanvasDataRef.current = {
      viewport: { ...viewport },
      images: images.map(img => ({ ...img }))
    };
  }, [viewport, images]);

  // ✅ 关闭应用前的保存处理函数
  // 优化：立即显示保存进度弹窗，后台异步执行保存，避免卡顿
  const handleClose = (): void => {
    // 立即显示保存进度弹窗（同步操作，不阻塞）
    setSaveProgress({
      isVisible: true,
      chatSaved: false,
      canvasSaved: false
    });

    // 使用 requestAnimationFrame 确保弹窗先渲染，然后再执行保存操作
    requestAnimationFrame(() => {
      // 在下一个事件循环中异步执行保存操作，不阻塞 UI
      setTimeout(async () => {
        try {
          // 并行保存聊天和画布历史
          const savePromises: Promise<void>[] = [];
          
          // 保存画布历史
          savePromises.push(
            saveCanvasHistorySync(viewportRef.current, imagesRef.current)
              .then(() => {
                setSaveProgress(prev => ({ ...prev, canvasSaved: true }));
              })
              .catch((error) => {
                console.error('保存画布历史失败:', error);
                setSaveProgress(prev => ({ ...prev, canvasSaved: true })); // 即使失败也标记为完成
              })
          );

          // 保存聊天历史
          if (messagesRef.current && messagesRef.current.length > 0) {
            savePromises.push(
              saveChatHistorySync(messagesRef.current)
                .then(() => {
                  setSaveProgress(prev => ({ ...prev, chatSaved: true }));
                })
                .catch((error) => {
                  console.error('保存聊天历史失败:', error);
                  setSaveProgress(prev => ({ ...prev, chatSaved: true })); // 即使失败也标记为完成
                })
            );
          } else {
            // 没有消息，直接标记为完成
            setSaveProgress(prev => ({ ...prev, chatSaved: true }));
          }

          // 等待所有保存完成
          await Promise.all(savePromises);

          // 短暂延迟，让用户看到完成状态
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // 保存完成后关闭应用
          Quit();
        } catch (error) {
          console.error('保存历史记录时出错:', error);
          // 即使出错也关闭应用
          Quit();
        }
      }, 0);
    });
  };

  // ✅ 应用关闭时保存画布历史记录（后备方案，用于异常退出）
  useEffect(() => {
    const handleBeforeUnload = () => {
      // 立即保存画布历史，取消待执行的防抖保存
      flushCanvasHistory(viewportRef.current, imagesRef.current);
      if (messagesRef.current) {
        flushChatHistory(messagesRef.current);
      }
    };

    // 监听页面卸载事件（应用关闭时）
    window.addEventListener('beforeunload', handleBeforeUnload);

    // 组件卸载时也保存（作为后备方案）
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // 组件卸载时立即保存
      flushCanvasHistory(viewportRef.current, imagesRef.current);
      if (messagesRef.current) {
        flushChatHistory(messagesRef.current);
      }
      // 清理 Worker
      serializationWorker.terminate();
    };
  }, []); // 空依赖数组，只在组件挂载/卸载时执行

  return (
    <>
      {/* 全局加载蒙版 */}
      <LoadingOverlay isLoading={isLoading} progress={loadProgress} />

      {/* 保存进度提示 */}
      <SaveProgressOverlay
        isVisible={saveProgress.isVisible}
        progress={{
          chatSaved: saveProgress.chatSaved,
          canvasSaved: saveProgress.canvasSaved
        }}
      />

      <div className="flex flex-col h-screen w-screen bg-slate-950 overflow-hidden font-sans">
        {/* Header */}
        <Header onOpenAppSettings={() => { }} onClose={handleClose} />

        {/* Main Content Area */}
        {/* ✅ 性能优化：初始加载期间使用 contain: strict 隔离整个内容区域 */}
        {/* 这防止初始加载大量图片时的连锁重渲染影响侧边栏 */}
        <div 
          className="flex flex-1 overflow-hidden pt-16"
          style={{ contain: isLoading ? 'strict' : 'none' }}
        >
          {/* Sidebar (Left) - z-20 与 Header 同级，高于 Canvas */}
          {/* ✅ 性能优化：添加 contain: layout paint 隔离侧边栏渲染 */}
          {/* 同时在初始加载期间添加 transform 强制创建独立合成层 */}
          <div 
            className="flex-shrink-0 h-full relative z-20"
            style={{ 
              contain: 'layout paint',
              // 初始加载期间强制创建独立的 GPU 合成层，隔离渲染
              transform: isLoading ? 'translateZ(0)' : 'none',
            }}
          >
            <Sidebar
              onGenerate={handleGenerate}
              onEdit={handleEdit}
              onAddToCanvas={handleAddToCanvas}
              isProcessing={isProcessing}
              inputValue={sidebarInputValue}
              setInputValue={setSidebarInputValue}
              attachments={attachments}
              setAttachments={setAttachments}
              images={images}
              modelSettings={modelSettings}
              setModelSettings={setModelSettings}
              onChatHistoryLoaded={handleChatHistoryLoaded}
              messagesRef={messagesRef}
            />
          </div>

          {/* Main Workspace - isolate 创建独立堆叠上下文，Canvas 内部 z-index 不影响外部 */}
          {/* ✅ 性能优化：初始加载期间添加 content-visibility 延迟 Canvas 渲染 */}
          <div 
            className="flex-1 relative h-full isolate overflow-hidden"
            style={{ 
              contentVisibility: isLoading ? 'hidden' : 'visible',
            }}
          >
            <Canvas
              images={images}
              setImages={setImages}
              selectedImageId={selectedImageId}
              setSelectedImageId={setSelectedImageId}
              viewport={viewport}
              setViewport={setViewport}
              onAction={handleCanvasAction}
              onImportImage={handleImportImage}
              onGenerateExpanded={handleGenerateExpanded}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default App;
