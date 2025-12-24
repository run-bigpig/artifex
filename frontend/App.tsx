import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { CanvasImage, Viewport, CanvasActionType, Attachment, ModelSettings } from './types';
import Canvas from './components/Canvas';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LoadingOverlay from './components/LoadingOverlay';
import { generateImage, editMultiImages } from './services/aiService';
import { loadCanvasHistory, saveCanvasHistory, flushCanvasHistory, saveCanvasHistorySync, saveChatHistorySync, flushChatHistory } from './services/historyService';
import { ChatMessage } from './types';
import { serializationWorker } from './services/serializationWorker';
import { ImageIndex, hasImagesChanged } from './utils/imageIndex';
import { activityDetector } from './services/activityDetector';
import SaveProgressOverlay from './components/SaveProgressOverlay';
import { Quit } from './wailsjs/runtime/runtime';

const generateId = () => Math.random().toString(36).substr(2, 9);

// Helper to get image dimensions from base64 string
const loadImageDimensions = (src: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = (e) => reject(e);
    img.src = src;
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

  // 同步更新 ref
  useEffect(() => {
    viewportRef.current = viewport;
    imagesRef.current = images;
  }, [viewport, images]);

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
    const canvasWidth = window.innerWidth - sidebarWidth;
    const canvasHeight = window.innerHeight;
    return { width: canvasWidth, height: canvasHeight };
  };

  // Helper to calculate center of the visible canvas area
  const getCanvasCenter = (width: number, height: number) => {
    const { width: canvasWidth, height: canvasHeight } = getCanvasDimensions();

    const centerX = (canvasWidth / 2 - viewport.x) / viewport.zoom;
    const centerY = (canvasHeight / 2 - viewport.y) / viewport.zoom;

    return {
      x: centerX - (width / 2),
      y: centerY - (height / 2)
    };
  };

  // Helper to constrain image size to fit within canvas viewport
  // Returns constrained dimensions while maintaining aspect ratio
  const constrainImageSize = (
    originalWidth: number,
    originalHeight: number,
    maxWidth?: number,
    maxHeight?: number
  ): { width: number; height: number } => {
    // Get canvas dimensions if not provided
    const { width: canvasWidth, height: canvasHeight } = getCanvasDimensions();

    // Use provided max dimensions or calculate from canvas (with some padding)
    // 留出一些边距，确保图片不会紧贴边缘
    const padding = 40;
    const effectiveMaxWidth = maxWidth ?? (canvasWidth / viewport.zoom - padding);
    const effectiveMaxHeight = maxHeight ?? (canvasHeight / viewport.zoom - padding);

    // Calculate aspect ratio
    const aspectRatio = originalWidth / originalHeight;

    let finalWidth = originalWidth;
    let finalHeight = originalHeight;

    // Scale down if image exceeds max dimensions
    if (finalWidth > effectiveMaxWidth || finalHeight > effectiveMaxHeight) {
      const widthRatio = effectiveMaxWidth / finalWidth;
      const heightRatio = effectiveMaxHeight / finalHeight;
      // Use the smaller ratio to ensure both dimensions fit
      const scaleRatio = Math.min(widthRatio, heightRatio);

      finalWidth = originalWidth * scaleRatio;
      finalHeight = originalHeight * scaleRatio;
    }

    return { width: finalWidth, height: finalHeight };
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
  const handleGenerateExpanded = (imageId: string, expandedBase64: string) => {
    // 1. 首先清空参考图输入框的内容
    setAttachments([]);
    
    // 2. 然后将扩图后的图片添加到参考图列表
    setAttachments([{
      id: generateId(),
      type: 'local',
      content: expandedBase64
    }]);

    // 3. 自动在提示词输入框中写入"扩图"关键词
    setSidebarInputValue('扩图');

    // 4. 重置选中状态（恢复到初始状态）
    setSelectedImageId(null);
  };

  const handleImportImage = async (base64: string, dropX?: number, dropY?: number) => {
    try {
      const { width, height } = await loadImageDimensions(base64);

      // Constrain image size to fit within canvas viewport while maintaining aspect ratio
      const { width: finalWidth, height: finalHeight } = constrainImageSize(width, height);

      const newId = generateId();

      let xPos, yPos;

      if (dropX !== undefined && dropY !== undefined) {
        xPos = dropX - (finalWidth / 2);
        yPos = dropY - (finalHeight / 2);
      } else {
        const center = getCanvasCenter(finalWidth, finalHeight);
        const offset = images.length * 20; // Stagger slightly if multiple imports
        xPos = center.x + offset;
        yPos = center.y + offset;
      }

      const newImage: CanvasImage = {
        id: newId,
        src: base64,
        x: xPos,
        y: yPos,
        width: finalWidth,
        height: finalHeight,
        zIndex: images.length + 1,
        prompt: '导入的图片'
      };

      setImages(prev => [...prev, newImage]);
      // Auto-select imported image
      setSelectedImageId(newId);
    } catch (e) {
      console.error("Failed to load image dimensions", e);
    }
  };

  const handleGenerate = async (prompt: string): Promise<string> => {
    setIsProcessing(true);
    try {
      // Pass modelSettings here
      // 生成模式下，aspectRatio 和 imageSize 必须有值，使用默认值
      const settingsForGenerate: ModelSettings = {
        ...modelSettings,
        aspectRatio: modelSettings.aspectRatio || '1:1',
        imageSize: modelSettings.imageSize || '1K'
      };
      const base64 = await generateImage(prompt, settingsForGenerate);
      const { width, height } = await loadImageDimensions(base64);

      // Constrain image size to fit within canvas viewport while maintaining aspect ratio
      const { width: finalWidth, height: finalHeight } = constrainImageSize(width, height);

      const pos = getCanvasCenter(finalWidth, finalHeight);

      const newImage: CanvasImage = {
        id: generateId(),
        src: base64,
        x: pos.x,
        y: pos.y,
        width: finalWidth,
        height: finalHeight,
        zIndex: images.length + 1,
        prompt: prompt
      };

      setImages(prev => [...prev, newImage]);
      setSelectedImageId(newImage.id);
      return base64;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEdit = async (prompt: string, base64Sources: string[]): Promise<string> => {
    if (base64Sources.length === 0) throw new Error("No source images");

    setIsProcessing(true);
    try {
      // 使用统一的 editMultiImages 方法（支持单图和多图）
      // 如果 aspectRatio 或 imageSize 为空字符串，则不传递这些参数（保持原图）
      const newBase64 = await editMultiImages(
        base64Sources,
        prompt,
        modelSettings.imageSize || undefined,
        modelSettings.aspectRatio || undefined
      );
      const { width, height } = await loadImageDimensions(newBase64);

      // Constrain image size to fit within canvas viewport while maintaining aspect ratio
      const { width: finalWidth, height: finalHeight } = constrainImageSize(width, height);

      // Place slightly offset from center to distinguish from original if it was centered
      const pos = getCanvasCenter(finalWidth, finalHeight);

      const newImage: CanvasImage = {
        id: generateId(),
        src: newBase64,
        width: finalWidth,
        height: finalHeight,
        x: pos.x + 40,
        y: pos.y + 40,
        zIndex: images.length + 2,
        prompt: prompt
      };

      setImages(prev => [...prev, newImage]);
      setSelectedImageId(newImage.id);
      return newBase64;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  // Wrapper for sidebar to add to canvas without coords
  const handleAddToCanvas = (base64: string) => handleImportImage(base64);

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
        <div className="flex flex-1 overflow-hidden pt-16">
          {/* Sidebar (Left) */}
          <div className="flex-shrink-0 h-full">
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

          {/* Main Workspace */}
          <div className="flex-1 relative h-full">
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