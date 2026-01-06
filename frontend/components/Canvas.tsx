import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { CanvasImage, Point, Viewport, CanvasActionType } from '../types';
import { Move, ZoomIn, ZoomOut, Trash2, Edit, Upload, Copy, Check, MousePointer2, Scissors, Sparkles, Maximize2 } from 'lucide-react';
import { ExportImage } from '../wailsjs/go/core/App';
import { v4 as uuidv4 } from 'uuid';
import { ImageIndex } from '../utils/imageIndex'; 
import { isDataUrl, isImageRef, normalizeImageSrc } from '../utils/imageSource';
import {
  getPngBlob,
  createDragPreviewThumbnailSync,
  calculateZoomViewport,
  clamp,
} from '../utils/canvasUtils';
import useHistoryManager, { HistoryActionType } from '../hooks/useHistoryManager';
import HistoryPanel from './HistoryPanel';
import ExpandMode from './ExpandMode';

/**
 * 生成唯一 ID
 */
const generateId = () => Math.random().toString(36).substr(2, 9);

interface CanvasProps {
  images: CanvasImage[];
  setImages: React.Dispatch<React.SetStateAction<CanvasImage[]>>;
  selectedImageId: string | null;
  setSelectedImageId: (id: string | null) => void;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  onAction: (id: string, action: CanvasActionType) => void;
  onImportImage: (imageSrc: string, x?: number, y?: number) => void;
  onGenerateExpanded?: (imageId: string, expandedImageDataUrl: string) => void;
}

type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br';

const Canvas: React.FC<CanvasProps> = ({
  images,
  setImages,
  selectedImageId,
  setSelectedImageId,
  viewport,
  setViewport,
  onAction,
  onImportImage,
  onGenerateExpanded
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // ✅ 多选状态：使用 Set 管理多个选中的图片 ID
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());

  // Interaction States
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Drag Data
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
  const [resizingImageId, setResizingImageId] = useState<string | null>(null);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  const [resizeStartDims, setResizeStartDims] = useState<{width: number, height: number} | null>(null);
  const [resizeStartPos, setResizeStartPos] = useState<{x: number, y: number} | null>(null);
  const [originalAspectRatio, setOriginalAspectRatio] = useState<number | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDraggingToSidebar, setIsDraggingToSidebar] = useState(false);
  const [isDragOutMode, setIsDragOutMode] = useState(false); // 拖出模式标志

    // ✅ 框选状态：Shift + 拖拽框选
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [boxSelectionStart, setBoxSelectionStart] = useState<Point>({ x: 0, y: 0 });
  const [boxSelectionEnd, setBoxSelectionEnd] = useState<Point>({ x: 0, y: 0 });
  
  // ✅ 多选状态标志：记录当前是否处于多选模式
  // 用于防止在多选后单击其中一个图片时清空其他选中
  const wasMultiSelectBeforeClickRef = useRef(false);

  // ✅ 鼠标样式状态
  const [cursorStyle, setCursorStyle] = useState<string>('default');
  
  // 使用 ref 跟踪 Alt 键状态，避免状态更新延迟问题
  const altKeyPressedRef = useRef(false);

  // 使用 ref 跟踪 Ctrl 键状态，用于对称扩展功能
  const ctrlKeyPressedRef = useRef(false);

  // ✅ 性能优化：使用 ref 跟踪是否正在拖动，避免 zIndex 更新和拖动冲突
  const isDraggingRef = useRef(false);

  // ✅ 标记是否刚刚执行了批量操作（删除/复制/移动等）
  // 用于避免 useEffect 中重复保存历史记录
  const isBatchOperationRef = useRef(false);

  // ✅ 多选状态管理工具函数

  /**
   * 判断图片是否被选中
   */
  const isImageSelected = useCallback((id: string): boolean => {
    return selectedImageIds.has(id);
  }, [selectedImageIds]);

  /**
   * 判断是否有多个图片被选中
   */
  const hasMultipleSelection = selectedImageIds.size > 1;

  /**
   * 更新选中状态，同时同步更新 selectedImageId
   * 用于保持向后兼容性
   */
  const updateSelectedIds = useCallback((newIds: Set<string>) => {
    setSelectedImageIds(newIds);
    // 同步更新 selectedImageId，保持向后兼容
    setSelectedImageId(newIds.size > 0 ? Array.from(newIds)[0] : null);
  }, [setSelectedImageId]);

  /**
   * 添加或移除单个图片的选中状态（用于 Ctrl/Cmd + 点击）
   */
  const toggleImageSelection = useCallback((id: string) => {
    setSelectedImageIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      // 同步更新 selectedImageId
      setSelectedImageId(newSet.size > 0 ? Array.from(newSet)[0] : null);
      return newSet;
    });
  }, [setSelectedImageId]);

  // ✅ 坐标转换工具函数

  /**
   * 屏幕坐标转世界坐标
   * @param screenX 屏幕 X 坐标
   * @param screenY 屏幕 Y 坐标
   * @returns 世界坐标
   */
  const screenToWorld = useCallback((screenX: number, screenY: number): Point => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) {
      return { x: 0, y: 0 };
    }

    const containerX = screenX - containerRect.left;
    const containerY = screenY - containerRect.top;

    return {
      x: (containerX - viewport.x) / viewport.zoom,
      y: (containerY - viewport.y) / viewport.zoom
    };
  }, [viewport]);

  /**
   * 获取图片在屏幕坐标的边界
   * @param image 图片对象
   * @returns 屏幕坐标边界
   */
  const getImageScreenBounds = useCallback((image: CanvasImage) => {
    const screenX = viewport.x + image.x * viewport.zoom;
    const screenY = viewport.y + image.y * viewport.zoom;

    return {
      x: screenX,
      y: screenY,
      width: image.width * viewport.zoom,
      height: image.height * viewport.zoom
    };
  }, [viewport]);

  /**
   * 碰撞检测：检测图片是否与框选矩形相交
   * @param image 图片对象
   * @param boxSelection 框选矩形 (世界坐标)
   * @returns 是否相交
   */
  const isImageInBoxSelection = useCallback((
    image: CanvasImage,
    boxSelection: { x: number; y: number; width: number; height: number }
  ): boolean => {
    // 将图片的世界坐标边界转换为屏幕坐标边界
    const imgScreenBounds = getImageScreenBounds(image);

    // 将框选矩形的世界坐标转换为屏幕坐标
    const boxScreenX = viewport.x + boxSelection.x * viewport.zoom;
    const boxScreenY = viewport.y + boxSelection.y * viewport.zoom;
    const boxScreenWidth = boxSelection.width * viewport.zoom;
    const boxScreenHeight = boxSelection.height * viewport.zoom;

    const imgRight = imgScreenBounds.x + imgScreenBounds.width;
    const imgBottom = imgScreenBounds.y + imgScreenBounds.height;
    const boxRight = boxScreenX + boxScreenWidth;
    const boxBottom = boxScreenY + boxScreenHeight;

    // AABB 碰撞检测
    return (
      boxScreenX < imgRight &&
      boxRight > imgScreenBounds.x &&
      boxScreenY < imgBottom &&
      boxBottom > imgScreenBounds.y
    );
  }, [getImageScreenBounds, viewport]);
  
  // ============================================================================
  // 历史记录管理（使用独立 Hook）
  // ============================================================================
  
  const {
    historyList,
    currentIndex: historyCurrentIndex,
    canUndo,
    canRedo,
    pushHistory,
    undo,
    redo,
    jumpTo: historyJumpTo,
    clear: clearHistory,
    initialize: initializeHistory,
    isInitialized: isHistoryInitialized,
  } = useHistoryManager({ maxSize: 50 });

  // 标记是否正在执行撤销/重做操作（避免触发额外的状态更新）
  const isUndoRedoRef = useRef(false);

  /**
   * 撤销操作
   */
  const handleUndo = useCallback(() => {
    const prevState = undo();
    if (prevState) {
      isUndoRedoRef.current = true;
      setImages(prevState);
    }
  }, [undo, setImages]);

  /**
   * 重做操作
   */
  const handleRedo = useCallback(() => {
    const nextState = redo();
    if (nextState) {
      isUndoRedoRef.current = true;
      setImages(nextState);
    }
  }, [redo, setImages]);

  /**
   * 跳转到指定历史位置
   */
  const handleHistoryJumpTo = useCallback((index: number) => {
    const state = historyJumpTo(index);
    if (state) {
      isUndoRedoRef.current = true;
      setImages(state);
    }
  }, [historyJumpTo, setImages]);

  /**
   * 清空历史记录
   */
  const handleClearHistory = useCallback(() => {
    clearHistory();
    // 重新初始化为当前状态
    initializeHistory(images);
  }, [clearHistory, initializeHistory, images]);

  /**
   * 记录操作到历史
   * 传入操作后的新状态
   */
  const recordHistory = useCallback((actionType: HistoryActionType, newState: CanvasImage[], detail?: string) => {
    pushHistory(actionType, newState, detail);
  }, [pushHistory]);

  // ====== 操作前状态暂存（用于移动/调整大小等需要检测变化的操作）======
  // 保存操作开始时的图片状态，用于在操作结束时比较是否真的有变化
  const operationStartStateRef = useRef<CanvasImage[] | null>(null);
  // 保存操作类型（move/resize）
  const pendingOperationRef = useRef<{ type: HistoryActionType; detail?: string } | null>(null);

  // 记录上一次的图片数量，用于检测图片添加
  const prevImagesLengthRef = useRef(images.length);

  // 初始化历史记录：在第一次有内容时保存初始状态
  // 同时监听图片添加（粘贴、导入等异步操作）
  useEffect(() => {
    // 如果正在执行撤销/重做，跳过
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      prevImagesLengthRef.current = images.length;
      return;
    }
    
    // 如果是批量操作（删除、复制等已经手动记录的），跳过
    if (isBatchOperationRef.current) {
      isBatchOperationRef.current = false;
      prevImagesLengthRef.current = images.length;
      return;
    }
    
    // 只在第一次有图片内容时初始化历史记录
    if (!isHistoryInitialized && images.length > 0) {
      initializeHistory(images);
      prevImagesLengthRef.current = images.length;
      return;
    }
    
    // 检测图片添加（粘贴、导入等异步操作）
    if (isHistoryInitialized && images.length > prevImagesLengthRef.current) {
      const addedCount = images.length - prevImagesLengthRef.current;
      // 记录添加操作到历史
      pushHistory('import_image', images, `${addedCount} 个图片`);
    }
    
    prevImagesLengthRef.current = images.length;
  }, [images, isHistoryInitialized, initializeHistory, pushHistory]);
  
  // Dropdown state for the active menu
  const [showExtractMenu, setShowExtractMenu] = useState(false);

  // Reset dropdown when selection changes
  useEffect(() => {
    setShowExtractMenu(false);
  }, [selectedImageId]);

  // ✅ 性能优化：提取 zIndex 更新逻辑为独立函数，可在拖动时立即同步调用
  // ✅ 支持批量更新多个图片的 zIndex
  const updateSelectedImageZIndex = useCallback((targetIds: Set<string>, sync: boolean = false) => {
    if (targetIds.size === 0) return;

    const updateZIndex = () => {
      setImages(prev => {
        // ✅ 性能优化：使用单次遍历计算最大 zIndex，避免展开运算符的性能问题
        let maxZIndex = 0;
        for (const img of prev) {
          if (img.zIndex > maxZIndex) {
            maxZIndex = img.zIndex;
          }
        }

        // 批量更新选中图片的 zIndex，使它们都在最上层
        // 使用索引来保持相对顺序
        const idArray = Array.from(targetIds);

        // 检查是否所有选中的图片都已经是最上层
        const allAtTop = idArray.every((id, index) => {
          const img = prev.find(i => i.id === id);
          return img && img.zIndex === maxZIndex + index + 1;
        });

        if (allAtTop) return prev;

        // 更新所有选中图片的 zIndex
        return prev.map(img => {
          const index = idArray.indexOf(img.id);
          if (index !== -1) {
            return {
              ...img,
              zIndex: maxZIndex + index + 1
            };
          }
          return img;
        });
      });
    };

    if (sync) {
      // 同步执行（拖动时立即更新，避免卡顿）
      updateZIndex();
    } else {
      // 异步执行（非拖动时避免阻塞主进程）
      requestAnimationFrame(updateZIndex);
    }
  }, []);

  // ✅ 向后兼容的包装函数：支持单个 ID 参数
  const updateSelectedImageZIndexSingle = useCallback((targetSelectedId: string | null, sync: boolean = false) => {
    if (!targetSelectedId) return;
    updateSelectedImageZIndex(new Set([targetSelectedId]), sync);
  }, [updateSelectedImageZIndex]);

  // 当选中图片时，自动将选中的图片提升到最上层
  // ✅ 性能优化：拖动时立即同步更新 zIndex，非拖动时异步更新避免阻塞
  useEffect(() => {
    if (selectedImageIds.size === 0) return;

    // 如果正在拖动，立即同步更新（避免拖动卡顿）
    if (isDraggingRef.current) {
      updateSelectedImageZIndex(selectedImageIds, true);
      return;
    }

    // 否则使用 requestAnimationFrame 异步更新（避免阻塞主进程）
    const rafId = requestAnimationFrame(() => {
      updateSelectedImageZIndex(selectedImageIds, true);
    });

    // 清理函数：如果组件卸载或依赖变化，取消待执行的更新
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [selectedImageIds, updateSelectedImageZIndex]);

  // 扩图模式状态：只需要记录当前正在扩图的图片 ID
  const [expandingImageId, setExpandingImageId] = useState<string | null>(null);

  // ✅ 性能优化：使用索引加速查找
  const imageIndex = useMemo(() => new ImageIndex(images), [images]);
  
  // 用于存储图片元素的 ref，用于自动触发点击
  const imageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // 跟踪上一次的 selectedImageId，用于检测新选中的图片
  const prevSelectedImageIdRef = useRef<string | null>(null);
  // Auto-focus canvas on selection change so Ctrl+C works.
  useEffect(() => {
    if (!selectedImageId) {
      prevSelectedImageIdRef.current = null;
      return;
    }
    
    // 检查图片是否存在于 images 中
    const imageExists = images.some(img => img.id === selectedImageId);
    if (!imageExists) {
      prevSelectedImageIdRef.current = selectedImageId;
      return;
    }
    
    // 检查是否是新的选中（从 null 变为某个 id，或从其他 id 变为当前 id）
    const isNewSelection = prevSelectedImageIdRef.current !== selectedImageId;
    
    if (isNewSelection) {
      // Use requestAnimationFrame to wait for DOM updates.
      requestAnimationFrame(() => {
        const imageElement = imageRefs.current.get(selectedImageId);
        if (imageElement) {
          // Focus the container so keyboard shortcuts work.
          containerRef.current?.focus();
        }
      });
    }

    prevSelectedImageIdRef.current = selectedImageId;
  }, [selectedImageId, images]);
  
  // --- Copy Logic ---
  /**
   * 复制图片到系统剪贴板
   * @param targetId 要复制的图片 ID
   */
  const handleCopyImage = useCallback(async (targetId: string) => {
    try {
      const target = imageIndex.get(targetId);
      if (!target) {
        console.warn('没有找到要复制的图片');
        return;
      }

      // 更新系统剪贴板
    try {
        const blob = await getPngBlob(target.src);
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
    } catch (err) {
        console.warn('系统剪贴板写入失败:', err);
        return;
      }

      // 视觉反馈
      setCopiedId(target.id);
      // 使用定时器显示复制成功提示，2秒后自动清除
      const timer = setTimeout(() => setCopiedId(null), 2000);
      // 注意：这里不需要清理定时器，因为组件卸载时会自动清理状态
    } catch (error) {
      console.error('复制图片失败:', error);
    }
  }, [imageIndex]);

  /**
   * 处理粘贴事件（使用 ClipboardEvent API，与输入框区域的处理方式完全一致）
   * @param e 剪贴板事件
   */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    // 统一使用 ClipboardEvent API，与输入框区域的处理方式完全一致
    const items = e.clipboardData.items;

    // 查找图片类型的剪贴板项（与 Sidebar 中的 handlePaste 逻辑完全一致）
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        // ✅ 修复：标记批量操作完成，避免 useEffect 重复保存
        isBatchOperationRef.current = true;
        const file = items[i].getAsFile();
        if (file) {
          // 将 File 转换为 base64 并添加到画布
          const reader = new FileReader();
          reader.onload = (ev) => {
            const base64 = ev.target?.result as string;
            if (base64) {
              onImportImage(base64);
    }
          };
          reader.readAsDataURL(file);
        }
        return;
      }
    }
  }, [onImportImage]);

  // 在 document 级别监听 paste 事件
  // div 元素的 onPaste 事件可能不会触发，需要在 document 级别监听
  useEffect(() => {
    const handleDocumentPaste = (e: ClipboardEvent) => {
      const activeElement = document.activeElement;
      const container = containerRef.current;
      
      // 如果容器不存在，不处理
      if (!container) return;
      
      // 如果焦点在输入框（textarea/input）中，不处理（由输入框自己处理）
      // 但排除容器本身（容器有 tabIndex=0）
      if (activeElement && 
          activeElement !== container &&
          (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
        return;
      }
      
      // 检查焦点是否在画布容器内（包括容器本身或其子元素）
      // 如果焦点不在画布内，不处理
      if (activeElement !== container && !container.contains(activeElement)) {
        return;
      }
      
      // 检查剪贴板中是否有图片
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      
      // 查找图片类型的剪贴板项（与 Sidebar 中的 handlePaste 逻辑完全一致）
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          e.stopPropagation();
          
          // 粘贴操作的历史记录由 useEffect 自动处理（检测图片数量增加）
          
          const file = items[i].getAsFile();
          if (file) {
            // 将 File 转换为 base64 并添加到画布
            const reader = new FileReader();
            reader.onload = (ev) => {
              const base64 = ev.target?.result as string;
              if (base64) {
                onImportImage(base64);
              }
            };
            reader.onerror = () => {
              console.error('读取剪贴板图片失败');
            };
            reader.readAsDataURL(file);
          }
          return;
        }
      }
    };

    // 使用 capture 阶段确保能捕获事件
    document.addEventListener('paste', handleDocumentPaste, true);
    return () => {
      document.removeEventListener('paste', handleDocumentPaste, true);
  };
  }, [onImportImage]);

  // --- Keyboard Shortcuts ---
  /**
   * 处理键盘快捷键
   * 支持删除、复制、粘贴、复制、撤销、重做等操作
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Esc: 优先退出扩图模式，否则清空所有选中
    if (e.key === 'Escape') {
      if (expandingImageId) {
        // 退出扩图模式（ExpandMode 组件也会自己处理 ESC，这里是备份）
        setExpandingImageId(null);
      } else {
        // 清空所有选中
        updateSelectedIds(new Set());
      }
      return;
    }

    // Undo (Ctrl+Z)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }

    // Redo (Ctrl+Y 或 Ctrl+Shift+Z)
    if (((e.ctrlKey || e.metaKey) && e.key === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
      e.preventDefault();
      handleRedo();
      return;
    }

    // Delete / Backspace: 批量删除所有选中的图片
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedImageIds.size > 0) {
        const count = selectedImageIds.size;
        
        // 计算删除后的新状态
        const newImages = images.filter(img => !selectedImageIds.has(img.id));
        
        // 记录删除操作到历史（传入删除后的新状态）
        recordHistory(count > 1 ? 'batch_delete' : 'delete_image', newImages, `${count} 个图片`);
        
        // 标记批量操作完成，避免 useEffect 重复保存
        isBatchOperationRef.current = true;

        // 设置删除后的图片
        setImages(newImages);

        // 清空所有选中
        updateSelectedIds(new Set());
      }
      return;
    }

    // Copy (Ctrl+C) - 单个选中时复制，多选时不复制
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (selectedImageId && selectedImageIds.size === 1) {
        e.preventDefault();
        handleCopyImage(selectedImageId);
      }
    }

    // Paste (Ctrl+V) - 系统剪贴板由 document 级别的监听器处理
    // 这里不需要处理，让 paste 事件正常触发

    // Duplicate (Ctrl+D) - 单个选中时复制，多选时不复制
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      if (selectedImageId && selectedImageIds.size === 1) {
        // 标记批量操作完成，避免 useEffect 重复保存
        isBatchOperationRef.current = true;

        const selectedImage = imageIndex.get(selectedImageId);
        if (selectedImage) {
          // 使用索引获取所有图片来计算 maxZ，避免重复遍历
          const allImages = imageIndex.getAll();
          const maxZ = allImages.length > 0
            ? Math.max(...allImages.map(i => i.zIndex), 0)
            : 0;

          const newImage = {
            ...selectedImage,
            id: generateId(),
            x: selectedImage.x + 40,
            y: selectedImage.y + 40,
            zIndex: maxZ + 1
          };
          
          // 计算复制后的新状态
          const newImages = [...images, newImage];
          
          // 记录复制操作到历史（传入复制后的新状态）
          recordHistory('copy_image', newImages);
          
          setImages(newImages);
          setSelectedImageId(newImage.id);
          updateSelectedIds(new Set([newImage.id]));
        }
      }
    }
  }, [selectedImageId, selectedImageIds, imageIndex, handleCopyImage, setImages, handleUndo, handleRedo, recordHistory, updateSelectedIds, images]);

  // --- Wheel Zoom ---
  /**
   * 处理鼠标滚轮缩放
   * 使用工具函数优化坐标转换和缩放计算
   */
  const handleWheel = useCallback((e: WheelEvent) => {
    const container = containerRef.current;
    if (!container) return;

    e.preventDefault();
    
    // 获取容器相对于视口的位置
    const rect = container.getBoundingClientRect();
    
    // 计算鼠标在容器内的位置（相对于容器的坐标）
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // 计算鼠标指向的画布世界坐标（缩放前的世界坐标）
    const worldX = (mouseX - viewport.x) / viewport.zoom;
    const worldY = (mouseY - viewport.y) / viewport.zoom;
    
    // 计算新的缩放比例
    // 优化缩放步进值：使用更小的灵敏度，使缩放更平滑可控（约 5% 步进）
    const zoomSensitivity = 0.0003;
    const zoomDelta = -e.deltaY * zoomSensitivity;
    const newZoom = clamp(viewport.zoom + zoomDelta, 0.1, 5);
    
    // 使用工具函数计算新的视口位置
    const newViewport = calculateZoomViewport(mouseX, mouseY, worldX, worldY, newZoom);
    
    setViewport(prev => ({
      ...prev,
      zoom: newZoom,
      x: newViewport.x,
      y: newViewport.y
    }));
  }, [viewport, setViewport]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // 监听键盘事件，跟踪 Alt 键状态
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.altKey) {
        altKeyPressedRef.current = true;
        setIsDragOutMode(true);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || !e.altKey) {
        altKeyPressedRef.current = false;
        setIsDragOutMode(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // 监听键盘事件，跟踪 Ctrl 键状态（用于对称扩展功能）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.ctrlKey || e.metaKey) {
        ctrlKeyPressedRef.current = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || (!e.ctrlKey && !e.metaKey)) {
        ctrlKeyPressedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // ✅ 监听键盘 Shift 键状态，用于更新鼠标样式
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.shiftKey) {
        setCursorStyle('crosshair');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || !e.shiftKey) {
        setCursorStyle('default');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // --- Mouse Interactions ---

  const handleMouseDown = (e: React.MouseEvent, imageId?: string) => {
    // Explicitly focus container to ensure keyboard shortcuts and paste events work
    containerRef.current?.focus();

    // 2. Image Click
    if (imageId) {
      e.stopPropagation();

      // ✅ 修复：在处理点击之前记录当前多选状态
      const wasMultiSelectBeforeClick = selectedImageIds.size > 1;

      // ✅ 检测 Ctrl/Cmd 键：多选模式
      const isMultiSelect = e.ctrlKey || e.metaKey;

      if (isMultiSelect) {
        // Ctrl/Cmd + 点击：切换选中状态（添加/移除）
        // 先判断当前状态
        const willBeSelected = !selectedImageIds.has(imageId);

        // 手动创建新的选中集合
        const newSelectedIds = new Set(selectedImageIds);
        if (willBeSelected) {
          newSelectedIds.add(imageId);
        } else {
          newSelectedIds.delete(imageId);
        }

        // 更新状态
        updateSelectedIds(newSelectedIds);

        // 如果切换后被选中，准备拖动
        if (willBeSelected) {
          // ✅ 性能优化：设置拖动标志
          isDraggingRef.current = true;

          // 批量提升 zIndex
          updateSelectedImageZIndex(newSelectedIds, true);

          setIsDraggingImage(true);
          setDragStart({ x: e.clientX, y: e.clientY });
        }
        return;
      }

      // 如果正在扩图模式，阻止图片拖动（但允许选择）
      if (expandingImageId === imageId) {
        // 只允许选择，不允许拖动
        if (selectedImageId !== imageId) {
          updateSelectedIds(new Set([imageId]));
        }
        return;
      }

      const isSelected = selectedImageIds.has(imageId);

      // 检测 Alt 键：如果按住 Alt，启用拖出模式，不进行画布内移动
      // 使用 ref 和事件对象双重检查，确保准确性
      if (e.altKey || altKeyPressedRef.current) {
        // Alt 键按下：启用拖出模式
        setIsDragOutMode(true);
        altKeyPressedRef.current = true;
        // 不设置 isDraggingImage，这样就不会触发画布内移动
        // 拖出功能将通过 HTML5 drag API 处理
        return;
      }

      // 非 Alt 键：正常处理选择和画布内移动
      setIsDragOutMode(false);
      altKeyPressedRef.current = false;

      // ✅ 性能优化：在设置选中状态之前就设置拖动标志，并立即同步更新 zIndex
      // 这样当选中状态变化时，zIndex 会立即同步更新，避免拖动时的卡顿
      isDraggingRef.current = true;

      // ✅ 修复：如果点击前处于多选状态且点击的是已选中的图片，则保持多选状态不改变
      // 这样可以拖拽所有选中的图片
      if (wasMultiSelectBeforeClick && isSelected) {
        // 不改变选中状态，只准备拖动
        // 使用当前的选中集合
      } else if (!isSelected || selectedImageIds.size !== 1) {
        // 单选：只选中当前点击的图片
        updateSelectedIds(new Set([imageId]));
      }

      // 性能优化：立即同步更新 zIndex，确保拖动开始时 zIndex 已经更新完成
      // 这样拖动操作可以立即开始，不会因为 zIndex 更新延迟而导致卡顿
      updateSelectedImageZIndex(selectedImageIds, true);

      // 暂存操作前状态（在 mouseUp 时检查是否真的移动了再记录历史）
      operationStartStateRef.current = JSON.parse(JSON.stringify(images));
      const count = selectedImageIds.size;
      pendingOperationRef.current = {
        type: count > 1 ? 'batch_move' : 'move_image',
        detail: count > 1 ? `${count} 个图片` : undefined,
      };

      setIsDraggingImage(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
    // 3. Canvas Click
    else {
      // ✅ 检测 Shift 键：框选模式
      const isBoxSelectionMode = e.shiftKey;

      if (isBoxSelectionMode) {
        // Shift + 点击空白处：开始框选
        setIsBoxSelecting(true);
        // 记录起始坐标（屏幕坐标）
        setBoxSelectionStart({ x: e.clientX, y: e.clientY });
        setBoxSelectionEnd({ x: e.clientX, y: e.clientY });
        // 清空当前选中（可选，根据用户体验需求）
        updateSelectedIds(new Set());
      } else {
        // 普通点击：拖拽画布
        setIsDraggingCanvas(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        // ✅ 点击空白处：清空所有选中（使用 updateSelectedIds 保持同步）
        updateSelectedIds(new Set());
        setShowExtractMenu(false);
        // 退出扩图模式
        if (expandingImageId) {
          setExpandingImageId(null);
        }
      }
    }
  };

  const handleResizeStart = (e: React.MouseEvent, img: CanvasImage, handle: ResizeHandle) => {
    e.stopPropagation();
    
    // 暂存操作前状态（在 mouseUp 时检查是否真的调整了再记录历史）
    operationStartStateRef.current = JSON.parse(JSON.stringify(images));
    pendingOperationRef.current = { type: 'resize_image' };
    
    setIsResizing(true);
    setResizingImageId(img.id);
    setResizeHandle(handle);
    setDragStart({ x: e.clientX, y: e.clientY });
    setResizeStartDims({ width: img.width, height: img.height });
    setResizeStartPos({ x: img.x, y: img.y });
    // 计算并存储原始宽高比
    setOriginalAspectRatio(img.width / img.height);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // 如果处于拖出模式，不处理画布内移动
    if (isDragOutMode) {
      return;
    }

    // ✅ 框选模式：实时更新框选矩形
    if (isBoxSelecting) {
      setBoxSelectionEnd({ x: e.clientX, y: e.clientY });
      return;
    }

    const scale = viewport.zoom;

    if (isResizing && resizingImageId && resizeStartDims && resizeStartPos && resizeHandle && originalAspectRatio) {
      const dx = (e.clientX - dragStart.x) / scale;
      const dy = (e.clientY - dragStart.y) / scale;

      let newX = resizeStartPos.x;
      let newY = resizeStartPos.y;
      let newWidth = resizeStartDims.width;
      let newHeight = resizeStartDims.height;

      // 等比例缩放逻辑，保持原始宽高比
      // 根据拖动的角，计算相对于对角点的偏移量
      let deltaWidth = 0;
      let deltaHeight = 0;

      switch (resizeHandle) {
        case 'br': // Bottom Right - 右下角：向右下拖动增加尺寸
          deltaWidth = dx;
          deltaHeight = dy;
          break;
        case 'bl': // Bottom Left - 左下角：向左下拖动增加尺寸
          deltaWidth = -dx;
          deltaHeight = dy;
          break;
        case 'tr': // Top Right - 右上角：向右上拖动增加尺寸
          deltaWidth = dx;
          deltaHeight = -dy;
          break;
        case 'tl': // Top Left - 左上角：向左上拖动增加尺寸
          deltaWidth = -dx;
          deltaHeight = -dy;
          break;
      }

      // 使用较大的变化量来保持宽高比（选择变化更大的方向）
      const scaleFactor = Math.abs(deltaWidth) > Math.abs(deltaHeight * originalAspectRatio)
        ? deltaWidth / resizeStartDims.width
        : deltaHeight / resizeStartDims.height;

      // 计算新尺寸（保持宽高比）
      newWidth = Math.max(50, resizeStartDims.width * (1 + scaleFactor));
      newHeight = newWidth / originalAspectRatio;

      // 根据拖动的角调整位置，使得对角的点保持固定
      switch (resizeHandle) {
        case 'br': // Bottom Right - 右下角：左上角固定
          // 位置不变
          break;
        case 'bl': // Bottom Left - 左下角：右上角固定
          newX = resizeStartPos.x + resizeStartDims.width - newWidth;
          break;
        case 'tr': // Top Right - 右上角：左下角固定
          newY = resizeStartPos.y + resizeStartDims.height - newHeight;
          break;
        case 'tl': // Top Left - 左上角：右下角固定
          newX = resizeStartPos.x + resizeStartDims.width - newWidth;
          newY = resizeStartPos.y + resizeStartDims.height - newHeight;
          break;
      }

      setImages(prev => prev.map(img =>
        img.id === resizingImageId
          ? { ...img, x: newX, y: newY, width: newWidth, height: newHeight }
          : img
      ));

    } else if (isDraggingImage && selectedImageIds.size > 0) {
      // ✅ 批量移动所有选中的图片
      const dx = (e.clientX - dragStart.x) / scale;
      const dy = (e.clientY - dragStart.y) / scale;

      setImages(prev => prev.map(img =>
        selectedImageIds.has(img.id)
          ? { ...img, x: img.x + dx, y: img.y + dy }
          : img
      ));
      setDragStart({ x: e.clientX, y: e.clientY });

    } else if (isDraggingCanvas) {
      setViewport(prev => ({
        ...prev,
        x: prev.x + (e.clientX - dragStart.x),
        y: prev.y + (e.clientY - dragStart.y)
      }));
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  /**
   * 处理鼠标抬起事件
   * 重置所有拖拽和调整大小状态，并保存历史记录
   */
  const handleMouseUp = useCallback(() => {
    // ✅ 框选完成：计算选中的图片
    if (isBoxSelecting) {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        // 将屏幕坐标转换为容器坐标
        const startContainerX = boxSelectionStart.x - containerRect.left;
        const startContainerY = boxSelectionStart.y - containerRect.top;
        const endContainerX = boxSelectionEnd.x - containerRect.left;
        const endContainerY = boxSelectionEnd.y - containerRect.top;

        // 计算框选矩形（容器坐标）
        const boxX = Math.min(startContainerX, endContainerX);
        const boxY = Math.min(startContainerY, endContainerY);
        const boxWidth = Math.abs(endContainerX - startContainerX);
        const boxHeight = Math.abs(endContainerY - startContainerY);

        // 转换为世界坐标
        const worldBox = {
          x: (boxX - viewport.x) / viewport.zoom,
          y: (boxY - viewport.y) / viewport.zoom,
          width: boxWidth / viewport.zoom,
          height: boxHeight / viewport.zoom
        };

        // 碰撞检测：找出所有与框选矩形相交的图片
        const selectedIds = new Set<string>();
        images.forEach(img => {
          if (isImageInBoxSelection(img, worldBox)) {
            selectedIds.add(img.id);
          }
        });

        // 更新选中状态
        if (selectedIds.size > 0) {
          updateSelectedIds(selectedIds);
          // 提升所有选中图片的 zIndex
          updateSelectedImageZIndex(selectedIds, true);
        }
      }

      // 清空框选状态
      setIsBoxSelecting(false);
      setBoxSelectionStart({ x: 0, y: 0 });
      setBoxSelectionEnd({ x: 0, y: 0 });
      return;
    }

    // 检查是否真的有移动/调整大小操作，只有状态变化了才记录历史
    if ((isDraggingImage || isResizing) && operationStartStateRef.current && pendingOperationRef.current) {
      // 比较操作前后的状态是否有变化（只比较位置和尺寸）
      const startState = operationStartStateRef.current;
      const hasChanged = images.some((img, index) => {
        const startImg = startState.find(s => s.id === img.id);
        if (!startImg) return true; // 新增图片
        // 检查位置或尺寸是否变化
        return (
          Math.abs(img.x - startImg.x) > 0.1 ||
          Math.abs(img.y - startImg.y) > 0.1 ||
          Math.abs(img.width - startImg.width) > 0.1 ||
          Math.abs(img.height - startImg.height) > 0.1
        );
      });

      if (hasChanged) {
        // 状态确实变化了，记录操作后的新状态到历史
        recordHistory(pendingOperationRef.current.type, images, pendingOperationRef.current.detail);
      }
    }

    // 清空暂存的操作状态
    operationStartStateRef.current = null;
    pendingOperationRef.current = null;

    // 性能优化：重置拖动标志，恢复异步 zIndex 更新
    isDraggingRef.current = false;
    setIsDraggingCanvas(false);
    setIsDraggingImage(false);
    setIsResizing(false);
    setResizingImageId(null);
    setResizeHandle(null);
    setResizeStartDims(null);
    setResizeStartPos(null);
    setOriginalAspectRatio(null);
    // 重置批量操作标志
    isBatchOperationRef.current = false;
    // 只有在 Alt 键未按下时才重置拖出模式
    if (!altKeyPressedRef.current) {
      setIsDragOutMode(false);
    }
  }, [isBoxSelecting, isDraggingImage, isResizing, boxSelectionStart, boxSelectionEnd, viewport, images, updateSelectedIds, updateSelectedImageZIndex, isImageInBoxSelection, recordHistory]);

  // --- Drag Image to Sidebar ---
  /**
   * 处理图片拖拽开始事件（拖出到侧边栏）
   * 仅在 Alt 键按下时允许拖出操作
   * @param e 拖拽事件
   * @param img 要拖拽的图片
   */
  const handleImageDragStart = useCallback((e: React.DragEvent, img: CanvasImage) => {
    // 检查 Alt 键是否按下（通过 ref 和事件对象双重检查）
    const isAltPressed = altKeyPressedRef.current || e.altKey;
    
    // 只有在 Alt 键按下时才允许拖出到侧边栏
    if (!isAltPressed) {
      // Alt 键未按下，阻止拖出操作，允许画布内移动
      e.preventDefault();
      return;
    }
    
    // 阻止事件冒泡，避免触发鼠标拖拽移动
    e.stopPropagation();
    
    // Alt 键按下：启用拖出模式
    setIsDragOutMode(true);
    
    // 创建自定义拖拽预览缩略图
    // 注意：setDragImage 必须在 dragstart 事件中同步调用，且元素必须已添加到 DOM
    try {
      let sourceImg: HTMLImageElement | null = null;
      
      // 方法1：查找页面上已经存在的图片元素（画布上显示的图片）
      const targetElement = e.currentTarget as HTMLElement;
      const existingImg = targetElement.querySelector('img') as HTMLImageElement;
      
      // 优先使用已存在的图片元素（即使 complete 为 false，只要 naturalWidth > 0 就可以使用）
      if (existingImg && existingImg.naturalWidth > 0) {
        sourceImg = existingImg;
      } else {
        // 方法2：创建新的图片元素（使用可加载的 src）
        const tempImg = new Image();
        tempImg.src = normalizeImageSrc(img.src);
        
        // 对于已缓存图片，complete 会立即为 true
        if (tempImg.complete && tempImg.naturalWidth > 0) {
          sourceImg = tempImg;
        }
      }
      
      if (sourceImg && sourceImg.naturalWidth > 0) {
        // 创建缩略图 Canvas
        const thumbnail = createDragPreviewThumbnailSync(sourceImg, 64);
        
        // 重要：Canvas 元素必须先添加到 DOM 中才能被 setDragImage 使用
        thumbnail.style.position = 'absolute';
        thumbnail.style.top = '-9999px';
        thumbnail.style.left = '-9999px';
        thumbnail.style.pointerEvents = 'none';
        document.body.appendChild(thumbnail);
        
        // 设置拖拽预览图，偏移量设置为缩略图中心
        e.dataTransfer.setDragImage(thumbnail, 32, 32);
        
        // 延迟移除 Canvas 元素
        setTimeout(() => {
          if (document.body.contains(thumbnail)) {
            document.body.removeChild(thumbnail);
          }
        }, 0);
      } else {
        // 图片未加载或无法获取，创建一个简单的占位符
        // 这至少能确保有一个预览图显示
        const placeholder = document.createElement('div');
        placeholder.style.width = '64px';
        placeholder.style.height = '64px';
        placeholder.style.backgroundColor = 'rgba(59, 130, 246, 0.8)';
        placeholder.style.borderRadius = '4px';
        placeholder.style.border = '2px solid rgba(255, 255, 255, 0.5)';
        placeholder.style.position = 'absolute';
        placeholder.style.top = '-9999px';
        placeholder.style.left = '-9999px';
        placeholder.style.pointerEvents = 'none';
        document.body.appendChild(placeholder);
        e.dataTransfer.setDragImage(placeholder, 32, 32);
        // 延迟移除占位符
        setTimeout(() => {
          if (document.body.contains(placeholder)) {
            document.body.removeChild(placeholder);
          }
        }, 0);
      }
    } catch (error) {
      // 如果缩略图创建失败，创建一个简单的占位符
      console.error('创建拖拽预览缩略图失败:', error);
      const placeholder = document.createElement('div');
      placeholder.style.width = '64px';
      placeholder.style.height = '64px';
      placeholder.style.backgroundColor = 'rgba(59, 130, 246, 0.8)';
      placeholder.style.borderRadius = '4px';
      placeholder.style.border = '2px solid rgba(255, 255, 255, 0.5)';
      placeholder.style.position = 'absolute';
      placeholder.style.top = '-9999px';
      placeholder.style.left = '-9999px';
      placeholder.style.pointerEvents = 'none';
      document.body.appendChild(placeholder);
      e.dataTransfer.setDragImage(placeholder, 32, 32);
      setTimeout(() => {
        if (document.body.contains(placeholder)) {
          document.body.removeChild(placeholder);
        }
      }, 0);
    }
    
    // 将图片数据存储到 dataTransfer
    const dragSrc = img.src;
    e.dataTransfer.setData('application/canvas-image', img.id);
    if (isDataUrl(dragSrc) || isImageRef(dragSrc)) {
      e.dataTransfer.setData('text/plain', dragSrc);
    }
    e.dataTransfer.effectAllowed = 'copy';
    setIsDraggingToSidebar(true);
    
    // 取消图片移动拖拽，避免冲突
    setIsDraggingImage(false);
  }, []);

  /**
   * 处理图片拖拽结束事件
   * @param e 拖拽事件
   */
  const handleImageDragEnd = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setIsDraggingToSidebar(false);
  }, []);

  // --- Actions ---

  const handleActionClick = (e: React.MouseEvent, id: string, action: CanvasActionType) => {
    e.stopPropagation();
    
    // 处理扩图相关动作
    if (action === 'expand') {
      // 进入扩图模式
      setExpandingImageId(id);
      return;
    }
    
    // 其他动作时，如果正在扩图模式，先退出扩图模式
    if (expandingImageId && action !== 'generate_expanded') {
      setExpandingImageId(null);
    }
    
    // 记录删除操作到历史（传入删除后的新状态）
    if (action === 'delete') {
      const newImages = images.filter(img => img.id !== id);
      recordHistory('delete_image', newImages);
      isBatchOperationRef.current = true;
    }
    
    onAction(id, action);
    if (action.startsWith('extract')) {
        setShowExtractMenu(false);
    }
  };

  /**
   * 导出图片到文件系统
   * @param e 鼠标事件
   * @param img 要导出的图片
   */
  const handleExport = useCallback(async (e: React.MouseEvent, img: CanvasImage) => {
    e.stopPropagation();
    try {
      // 使用 ExportImage 方法导出图片，使用随机文件名
      const now = new Date();
      const formattedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const randomName = `artifexBot-${formattedDate}-${Math.random().toString(36).slice(2, 11)}.png`;
      await ExportImage(img.src, randomName, 'png', '');
    } catch (err) {
      console.error('导出图片失败:', err);
    }
  }, []);

  // --- Drag & Drop Import ---
  /**
   * 处理拖拽悬停事件
   * 检查是否为画布图片拖拽，避免触发文件上传
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    // 检查是否是从画布拖拽的图片（Alt键拖拽到侧边栏）
    // application/canvas-image 是画布图片拖拽的唯一标识
    // 如果是从画布拖拽的图片，不应该触发文件上传功能
    const isCanvasImageDrag = e.dataTransfer.types.includes('application/canvas-image');
    
    if (isCanvasImageDrag) {
      // 是从画布拖拽的图片，不触发文件上传
      return;
    }
    
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  
  /**
   * 处理拖拽离开事件
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 检查是否是从画布拖拽的图片
    const isCanvasImageDrag = e.dataTransfer.types.includes('application/canvas-image');
    
    if (isCanvasImageDrag) {
      // 是从画布拖拽的图片，不处理
      return;
    }
    
    e.preventDefault();
    setIsDragOver(false);
  }, []);
  
  /**
   * 处理文件拖拽放置事件
   * 支持从文件系统拖拽图片到画布
   */
  const handleDrop = useCallback((e: React.DragEvent) => {
    // 检查是否是从画布拖拽的图片（Alt键拖拽到侧边栏）
    // 如果是从画布拖拽的图片，不应该触发文件上传功能
    const canvasImageId = e.dataTransfer.getData('application/canvas-image');
    const canvasImageSrc = e.dataTransfer.getData('text/plain');
    
    if (canvasImageId || isDataUrl(canvasImageSrc) || isImageRef(canvasImageSrc)) {
      // 是从画布拖拽的图片，不触发文件上传，直接返回
      setIsDragOver(false);
      return;
    }
    
    e.preventDefault();
    setIsDragOver(false);
    
    // 只有真正的文件拖拽才处理上传
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // 导入操作的历史记录由 useEffect 自动处理（检测图片数量增加）
      
      try {
      const files = Array.from(e.dataTransfer.files);
      const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          console.warn('无法获取容器位置信息');
          return;
        }
        
      const dropX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const dropY = (e.clientY - rect.top - viewport.y) / viewport.zoom;
        
      files.forEach((file: File) => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              try {
            const base64 = ev.target?.result as string;
                if (base64) {
                  onImportImage(base64, dropX, dropY);
                } else {
                  console.warn('文件读取结果为空');
                }
              } catch (error) {
                console.error('处理导入图片失败:', error);
              }
            };
            reader.onerror = () => {
              console.error('文件读取失败:', file.name);
          };
          reader.readAsDataURL(file);
        }
      });
      } catch (error) {
        console.error('处理文件拖拽失败:', error);
    }
    }
  }, [viewport, onImportImage]);

  // Determine valid selection state for UI
  // primarySelectedId 用于显示操作菜单（多选时显示在第一个选中的图片上）
  const primarySelectedId = selectedImageId;

  return (
    <div
      ref={containerRef}
      tabIndex={0} // Make focusable for keyboard events
      onKeyDown={handleKeyDown}
      className={`relative w-full h-full bg-slate-900 overflow-hidden select-none transition-colors duration-200 outline-none ${
        isDragOver ? 'bg-slate-800' : ''
      }`}
      style={{ cursor: cursorStyle }}
      onMouseDown={(e) => handleMouseDown(e)}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Background */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20 checkerboard"
        style={{
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`
        }}
      />

      {/* Canvas World */}
      <div 
        className="absolute origin-top-left will-change-transform"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
        }}
      >
        {images.map((img) => {
          const isSelected = selectedImageIds.has(img.id);
          const showMenu = isSelected && img.id === primarySelectedId;
          const isExpanding = expandingImageId === img.id;

          // ✅ 框选过程中临时高亮检测
          const isTempHighlighted = (() => {
            if (!isBoxSelecting) return false;

            const containerRect = containerRef.current?.getBoundingClientRect();
            if (!containerRect) return false;

            const imgScreenBounds = getImageScreenBounds(img);

            // 计算框选矩形（容器坐标）
            const startContainerX = boxSelectionStart.x - containerRect.left;
            const startContainerY = boxSelectionStart.y - containerRect.top;
            const endContainerX = boxSelectionEnd.x - containerRect.left;
            const endContainerY = boxSelectionEnd.y - containerRect.top;

            const boxX = Math.min(startContainerX, endContainerX);
            const boxY = Math.min(startContainerY, endContainerY);
            const boxWidth = Math.abs(endContainerX - startContainerX);
            const boxHeight = Math.abs(endContainerY - startContainerY);

            const imgRight = imgScreenBounds.x + imgScreenBounds.width;
            const imgBottom = imgScreenBounds.y + imgScreenBounds.height;
            const boxRight = boxX + boxWidth;
            const boxBottom = boxY + boxHeight;

            // AABB 碰撞检测
            return (
              boxX < imgRight &&
              boxRight > imgScreenBounds.x &&
              boxY < imgBottom &&
              boxBottom > imgScreenBounds.y
            );
          })();

          // 选中或临时高亮的样式
          const showSelectionOrHighlight = isSelected || isTempHighlighted;

          return (
            <div
              key={img.id}
              ref={(el) => {
                if (el) {
                  imageRefs.current.set(img.id, el);
                } else {
                  imageRefs.current.delete(img.id);
                }
              }}
              className={`absolute group hover:ring-1 hover:ring-slate-500 transition-shadow duration-100 ${isDraggingToSidebar ? 'opacity-50' : ''}`}
              style={{
                left: img.x,
                top: img.y,
                width: img.width,
                height: img.height,
                zIndex: img.zIndex,
                boxShadow: showSelectionOrHighlight
                  ? isTempHighlighted
                    ? '0 0 0 2px #22c55e, 0 20px 25px -5px rgb(0 0 0 / 0.1)' // 临时高亮：绿色
                    : '0 0 0 2px #3b82f6, 0 20px 25px -5px rgb(0 0 0 / 0.1)' // 正常选中：蓝色
                  : 'none',
                // 移除容器的旋转，改为只旋转图片元素
              }}
              onMouseDown={(e) => handleMouseDown(e, img.id)}
              draggable={true}
              onDragStart={(e) => handleImageDragStart(e, img)}
              onDragEnd={handleImageDragEnd}
            >
              {/* 图片元素 */}
              <img 
                src={normalizeImageSrc(img.src)} 
                alt={img.prompt}
                // Changed from object-cover to object-fill to support free resize distortion
                className="w-full h-full object-fill select-none pointer-events-none bg-slate-800 block relative"
                draggable={false}
              />
              
              {/* Info Badge */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-xs text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity truncate pointer-events-none">
                {img.prompt}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating UI Elements (不受缩放影响) */}
      {images.map((img) => {
        const isSelected = selectedImageIds.has(img.id);
        const showMenu = isSelected && img.id === primarySelectedId;
        const isExpanding = expandingImageId === img.id;
        
        // 只有在选中或扩图模式下才渲染 UI 元素
        if (!isSelected && !isExpanding) return null;

        // 计算图片在屏幕上的实际位置（考虑 viewport 的 transform）
        const screenX = viewport.x + img.x * viewport.zoom;
        const screenY = viewport.y + img.y * viewport.zoom;
        const screenWidth = img.width * viewport.zoom;
        const screenHeight = img.height * viewport.zoom;

        // 计算控制点位置的辅助函数（简化版：容器不旋转，直接使用容器坐标）
        // 由于容器不再旋转，可以直接使用容器坐标系统，无需旋转计算
        const getHandlePosition = (localX: number, localY: number) => {
          // 直接转换为屏幕坐标（容器不旋转，坐标系统正常）
          const screenPosX = screenX + localX * viewport.zoom;
          const screenPosY = screenY + localY * viewport.zoom;
          
          return { x: screenPosX, y: screenPosY };
        };

        return (
          <React.Fragment key={`ui-${img.id}`}>
            {/* 扩图模式：使用 ExpandMode 组件 */}
            {isExpanding && (
              <ExpandMode
                image={img}
                viewport={viewport}
                containerRef={containerRef}
                ctrlKeyPressed={ctrlKeyPressedRef.current}
                onGenerate={(expandedBase64) => {
                  if (onGenerateExpanded) {
                    onGenerateExpanded(img.id, expandedBase64);
                  }
                  setExpandingImageId(null);
                }}
                onCancel={() => setExpandingImageId(null)}
              />
            )}

            {/* Resize Handles - 4 Corners (仅在非扩图模式显示) */}
            {!isExpanding && (
              <>
                {/* Top Left */}
                <div 
                  className="absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-nw-resize z-50 hover:scale-125 transition-transform pointer-events-auto"
                  style={{
                    left: screenX - 8,
                    top: screenY - 8,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleResizeStart(e, img, 'tl');
                  }}
                />
                {/* Top Right */}
                <div 
                  className="absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-ne-resize z-50 hover:scale-125 transition-transform pointer-events-auto"
                  style={{
                    left: screenX + screenWidth - 8,
                    top: screenY - 8,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleResizeStart(e, img, 'tr');
                  }}
                />
                {/* Bottom Left */}
                <div 
                  className="absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-sw-resize z-50 hover:scale-125 transition-transform pointer-events-auto"
                  style={{
                    left: screenX - 8,
                    top: screenY + screenHeight - 8,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleResizeStart(e, img, 'bl');
                  }}
                />
                {/* Bottom Right */}
                <div 
                  className="absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-se-resize z-50 hover:scale-125 transition-transform pointer-events-auto"
                  style={{
                    left: screenX + screenWidth - 8,
                    top: screenY + screenHeight - 8,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleResizeStart(e, img, 'br');
                  }}
                />
              </>
            )}

            {/* Action Menu (Only for primary selection, hidden in expand mode) */}
            {showMenu && !isExpanding && (
              <div 
                className="absolute flex gap-1 bg-slate-800/90 backdrop-blur rounded-lg p-1.5 shadow-xl border border-slate-700 pointer-events-auto z-50 items-center"
                style={{
                  left: screenX + screenWidth / 2,
                  top: screenY - 48,
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseDown={(e) => e.stopPropagation()} 
              >
                <button 
                  onClick={(e) => handleActionClick(e, img.id, 'edit')}
                  className="p-1.5 hover:bg-blue-600 rounded text-slate-300 hover:text-white transition-colors"
                  title="编辑"
                >
                  <Edit size={14} />
                </button>

                {/* Extract / Scissors Menu */}
                <div className="relative">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setShowExtractMenu(!showExtractMenu); }}
                    className={`p-1.5 rounded transition-colors ${showExtractMenu ? 'bg-blue-600 text-white' : 'hover:bg-blue-600 text-slate-300 hover:text-white'}`}
                    title="抠图 / 提取"
                  >
                    <Scissors size={14} />
                  </button>
                  
                  {showExtractMenu && (
                    <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-32 bg-slate-800 border border-slate-700 shadow-xl rounded-lg overflow-hidden flex flex-col z-[60]">
                      <button 
                        onClick={(e) => handleActionClick(e, img.id, 'extract_subject')}
                        className="px-3 py-2 text-xs text-left text-slate-300 hover:bg-blue-600 hover:text-white transition-colors border-b border-slate-700"
                      >
                        保留主体
                      </button>
                      <button 
                        onClick={(e) => handleActionClick(e, img.id, 'extract_mid')}
                        className="px-3 py-2 text-xs text-left text-slate-300 hover:bg-blue-600 hover:text-white transition-colors border-b border-slate-700"
                      >
                        保留中景
                      </button>
                      <button 
                        onClick={(e) => handleActionClick(e, img.id, 'extract_bg')}
                        className="px-3 py-2 text-xs text-left text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                      >
                        保留背景
                      </button>
                    </div>
                  )}
                </div>

                <button 
                  onClick={(e) => handleActionClick(e, img.id, 'enhance')}
                  className="p-1.5 hover:bg-blue-600 rounded text-slate-300 hover:text-white transition-colors"
                  title="变清晰"
                >
                  <Sparkles size={14} />
                </button>

                <button 
                  onClick={(e) => handleActionClick(e, img.id, 'expand')}
                  className="p-1.5 hover:bg-blue-600 rounded text-slate-300 hover:text-white transition-colors"
                  title="扩图"
                >
                  <Maximize2 size={14} />
                </button>

                <div className="w-px bg-slate-600 mx-1 self-center h-4" />
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    handleCopyImage(img.id);
                  }}
                  className="p-1.5 hover:bg-blue-600 rounded text-slate-300 hover:text-white transition-colors"
                  title="复制原图"
                >
                  {copiedId === img.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
                <button 
                  onClick={(e) => handleExport(e, img)}
                  className="p-1.5 hover:bg-blue-600 rounded text-slate-300 hover:text-white transition-colors"
                  title="导出图片"
                >
                  <Upload size={14} />
                </button>
                <div className="w-px bg-slate-600 mx-1 self-center h-4" />
                <button 
                  onClick={(e) => handleActionClick(e, img.id, 'delete')}
                  className="p-1.5 hover:bg-red-500/80 rounded text-slate-300 hover:text-white transition-colors"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* Mini Viewport HUD */}
      <div className="absolute bottom-4 left-4 bg-slate-800/90 backdrop-blur border border-slate-700 rounded-lg p-2 text-xs flex gap-4 text-slate-300 pointer-events-none select-none">
        <div className="flex items-center gap-1">
          <Move size={12} />
          <span>{Math.round(viewport.x)}, {Math.round(viewport.y)}</span>
        </div>
        <div className="flex items-center gap-1">
          {viewport.zoom > 1 ? <ZoomIn size={12} /> : <ZoomOut size={12} />}
          <span>{Math.round(viewport.zoom * 100)}%</span>
        </div>
      </div>

      {/* ✅ 选中计数器 */}
      {selectedImageIds.size > 1 && (
        <div className="absolute top-4 right-4 bg-slate-800/90 backdrop-blur border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white pointer-events-none select-none">
          已选中 {selectedImageIds.size} 个图片
        </div>
      )}
      
      {/* 历史记录面板（类 Photoshop 风格） */}
      <HistoryPanel
        historyList={historyList}
        currentIndex={historyCurrentIndex}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onJumpTo={handleHistoryJumpTo}
        onClear={handleClearHistory}
      />

      {/* Drop overlay hint */}
      {isDragOver && (
         <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 pointer-events-none z-[100] border-4 border-blue-500 border-dashed m-4 rounded-xl">
             <div className="text-blue-200 font-bold text-xl drop-shadow-md">释放图片以添加到画布</div>
         </div>
      )}

      {/* ✅ 框选矩形 */}
      {isBoxSelecting && (() => {
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return null;

        // 计算框选矩形（容器坐标）
        const startContainerX = boxSelectionStart.x - containerRect.left;
        const startContainerY = boxSelectionStart.y - containerRect.top;
        const endContainerX = boxSelectionEnd.x - containerRect.left;
        const endContainerY = boxSelectionEnd.y - containerRect.top;

        const boxX = Math.min(startContainerX, endContainerX);
        const boxY = Math.min(startContainerY, endContainerY);
        const boxWidth = Math.abs(endContainerX - startContainerX);
        const boxHeight = Math.abs(endContainerY - startContainerY);

        return (
          <div
            className="absolute pointer-events-none z-[90]"
            style={{
              left: boxX,
              top: boxY,
              width: boxWidth,
              height: boxHeight,
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              border: '2px dashed #3b82f6'
            }}
          />
        );
      })()}

      {/* ✅ 框选矩形 */}
      {isBoxSelecting && (() => {
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return null;

        // 计算框选矩形（容器坐标）
        const startContainerX = boxSelectionStart.x - containerRect.left;
        const startContainerY = boxSelectionStart.y - containerRect.top;
        const endContainerX = boxSelectionEnd.x - containerRect.left;
        const endContainerY = boxSelectionEnd.y - containerRect.top;

        const boxX = Math.min(startContainerX, endContainerX);
        const boxY = Math.min(startContainerY, endContainerY);
        const boxWidth = Math.abs(endContainerX - startContainerX);
        const boxHeight = Math.abs(endContainerY - startContainerY);

        return (
          <div
            className="absolute pointer-events-none z-[90]"
            style={{
              left: boxX,
              top: boxY,
              width: boxWidth,
              height: boxHeight,
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              border: '2px dashed #3b82f6'
            }}
          />
        );
      })()}
    </div>
  );
};

export default Canvas;
