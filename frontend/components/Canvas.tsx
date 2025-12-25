import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { CanvasImage, Point, Viewport, CanvasActionType, ExpandOffsets } from '../types';
import { Move, ZoomIn, ZoomOut, Trash2, Edit, Upload, Copy, Check, MousePointer2, Scissors, Sparkles, Maximize2 } from 'lucide-react';
import { ExportImage } from '../wailsjs/go/core/App';
import { v4 as uuidv4 } from 'uuid';
import { ImageIndex } from '../utils/imageIndex'; 
import {
  getPngBlob,
  createDragPreviewThumbnailSync,
  generateExpandedImage,
  getImageNaturalDimensions,
  calculateZoomViewport,
  clamp,
} from '../utils/canvasUtils';

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
  onImportImage: (base64: string, x: number, y: number) => void;
  onGenerateExpanded?: (imageId: string, expandedBase64: string) => void;
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
  
  // 使用 ref 跟踪 Alt 键状态，避免状态更新延迟问题
  const altKeyPressedRef = useRef(false);
  
  // 使用 ref 跟踪 Ctrl 键状态，用于对称扩展功能
  const ctrlKeyPressedRef = useRef(false);
  
  // ✅ 性能优化：使用 ref 跟踪是否正在拖动，避免 zIndex 更新和拖动冲突
  const isDraggingRef = useRef(false);
  
  // Dropdown state for the active menu
  const [showExtractMenu, setShowExtractMenu] = useState(false);

  // Reset dropdown when selection changes
  useEffect(() => {
    setShowExtractMenu(false);
  }, [selectedImageId]);

  // ✅ 性能优化：提取 zIndex 更新逻辑为独立函数，可在拖动时立即同步调用
  const updateSelectedImageZIndex = useCallback((targetSelectedId: string | null, sync: boolean = false) => {
    if (!targetSelectedId) return;

    const updateZIndex = () => {
      setImages(prev => {
        // ✅ 性能优化：使用单次遍历计算最大 zIndex，避免展开运算符的性能问题
        let maxZIndex = 0;
        for (const img of prev) {
          if (img.zIndex > maxZIndex) {
            maxZIndex = img.zIndex;
          }
        }

        // 检查选中的图片是否需要更新 zIndex
        const selectedImg = prev.find(img => img.id === targetSelectedId);
        if (!selectedImg) return prev;

        // 如果已经是最大 zIndex，不需要更新
        if (selectedImg.zIndex === maxZIndex + 1) return prev;

        // 更新选中图片的 zIndex，使其在最上层
        return prev.map(img => {
          if (img.id === targetSelectedId) {
            return {
              ...img,
              zIndex: maxZIndex + 1
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

  // 当选中图片时，自动将选中的图片提升到最上层
  // ✅ 性能优化：拖动时立即同步更新 zIndex，非拖动时异步更新避免阻塞
  useEffect(() => {
    if (!selectedImageId) return;

    // 如果正在拖动，立即同步更新（避免拖动卡顿）
    if (isDraggingRef.current) {
      updateSelectedImageZIndex(selectedImageId, true);
      return;
    }

    // 否则使用 requestAnimationFrame 异步更新（避免阻塞主进程）
    const rafId = requestAnimationFrame(() => {
      updateSelectedImageZIndex(selectedImageId, true);
    });

    // 清理函数：如果组件卸载或依赖变化，取消待执行的更新
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [selectedImageId, updateSelectedImageZIndex]);

  // 扩图模式状态（需要在 useEffect 之前声明）
  const [expandingImageId, setExpandingImageId] = useState<string | null>(null);
  const [expandOffsets, setExpandOffsets] = useState<ExpandOffsets>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [isDraggingExpandHandle, setIsDraggingExpandHandle] = useState(false);
  const [draggingHandleType, setDraggingHandleType] = useState<string | null>(null);
  const [dragStartPoint, setDragStartPoint] = useState<Point>({ x: 0, y: 0 });
  const [expandStartOffsets, setExpandStartOffsets] = useState<ExpandOffsets>({ top: 0, right: 0, bottom: 0, left: 0 });

  // 智能辅助线状态
  interface SmartGuide {
    type: 'equal' | 'near'; // 相等或接近
    edges: string[]; // 相关的边（如 ['top', 'bottom']）
    distance: number; // 相等的距离值
    timestamp: number; // 添加时间戳，用于延迟消失
  }
  const [smartGuides, setSmartGuides] = useState<SmartGuide[]>([]);
  
  // 磁吸阈值（像素）：当距离差小于此值时自动对齐
  const SNAP_THRESHOLD = 5;
  
  // 辅助线延迟消失时间（毫秒）：拖动停止后保持显示的时间
  const GUIDE_FADE_DELAY = 500;

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
   * 支持删除、复制、粘贴、复制等操作
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Delete
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedImageId) {
        setImages(prev => prev.filter(img => img.id !== selectedImageId));
        setSelectedImageId(null);
      }
    }

    // Copy (Ctrl+C)
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (selectedImageId) {
        e.preventDefault();
        handleCopyImage(selectedImageId);
      }
    }

    // Paste (Ctrl+V) - 系统剪贴板由 document 级别的监听器处理
    // 这里不需要处理，让 paste 事件正常触发

    // Duplicate (Ctrl+D)
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      if (selectedImageId) {
        const selectedImage = imageIndex.get(selectedImageId);
        if (selectedImage) {
        // ✅ 使用索引获取所有图片来计算 maxZ，避免重复遍历
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
          setImages(prev => [...prev, newImage]);
          setSelectedImageId(newImage.id);
      }
    }
    }
  }, [selectedImageId, imageIndex, handleCopyImage, setImages, setSelectedImageId]);

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

  // --- Mouse Interactions ---

  const handleMouseDown = (e: React.MouseEvent, imageId?: string) => {
    // Explicitly focus container to ensure keyboard shortcuts and paste events work
    containerRef.current?.focus();

    // 2. Image Click
    if (imageId) {
      e.stopPropagation();
      
      // 如果正在扩图模式，阻止图片拖动（但允许选择）
      if (expandingImageId === imageId) {
        // 只允许选择，不允许拖动
        if (selectedImageId !== imageId) {
          setSelectedImageId(imageId);
        }
        return;
      }
      
      const isSelected = selectedImageId === imageId;
      
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
      
      // 单选逻辑：点击图片就选中它
        if (!isSelected) {
        setSelectedImageId(imageId);
      }

      // ✅ 性能优化：立即同步更新 zIndex，确保拖动开始时 zIndex 已经更新完成
      // 这样拖动操作可以立即开始，不会因为 zIndex 更新延迟而导致卡顿
      updateSelectedImageZIndex(imageId, true);

      setIsDraggingImage(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    } 
    // 3. Canvas Click
    else {
      setIsDraggingCanvas(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      // Deselect if clicking empty space
      setSelectedImageId(null);
      setShowExtractMenu(false);
      // 退出扩图模式
      if (expandingImageId) {
        setExpandingImageId(null);
        setExpandOffsets({ top: 0, right: 0, bottom: 0, left: 0 });
      }
    }
  };

  const handleResizeStart = (e: React.MouseEvent, img: CanvasImage, handle: ResizeHandle) => {
    e.stopPropagation();
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

    } else if (isDraggingImage && selectedImageId) {
      const dx = (e.clientX - dragStart.x) / scale;
      const dy = (e.clientY - dragStart.y) / scale;
      
      setImages(prev => prev.map(img => 
        img.id === selectedImageId
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
   * 重置所有拖拽和调整大小状态
   */
  const handleMouseUp = useCallback(() => {
    // ✅ 性能优化：重置拖动标志，恢复异步 zIndex 更新
    isDraggingRef.current = false;
    setIsDraggingCanvas(false);
    setIsDraggingImage(false);
    setIsResizing(false);
    setResizingImageId(null);
    setResizeHandle(null);
    setResizeStartDims(null);
    setResizeStartPos(null);
    setOriginalAspectRatio(null);
    // 只有在 Alt 键未按下时才重置拖出模式
    if (!altKeyPressedRef.current) {
      setIsDragOutMode(false);
    }
  }, []);

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
        // 方法2：创建新的图片元素（使用 base64 src）
        const tempImg = new Image();
        tempImg.src = img.src;
        
        // 对于 base64 图片，如果已经在缓存中，complete 会立即为 true
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
    e.dataTransfer.setData('application/canvas-image', img.id);
    e.dataTransfer.setData('text/plain', img.src); // 备用：直接存储 base64
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
      setExpandOffsets({ top: 0, right: 0, bottom: 0, left: 0 });
      return;
    }
    
    // 其他动作时，如果正在扩图模式，先退出扩图模式
    if (expandingImageId && action !== 'generate_expanded') {
      setExpandingImageId(null);
      setExpandOffsets({ top: 0, right: 0, bottom: 0, left: 0 });
    }
    
    onAction(id, action);
    if (action.startsWith('extract')) {
        setShowExtractMenu(false);
    }
  };


  // 生成带白边画布的图片（使用工具函数）
  // 注意：这里保留一个包装函数以保持接口一致性
  /**
   * 生成扩图：将显示尺寸的偏移量转换为原始尺寸的偏移量
   * 
   * 坐标系统说明：
   * - img.width/height 是画布世界坐标系中的逻辑尺寸（不受 viewport.zoom 影响）
   * - expandOffsets 也是世界坐标系中的偏移量（在拖动时已通过 / viewport.zoom 转换）
   * - naturalWidth/Height 是原始图片的物理像素尺寸
   * 
   * 因此，我们需要将世界坐标中的偏移量转换为原始图片像素坐标中的偏移量
   * 
   * @param img 画布图片对象（包含世界坐标中的显示尺寸）
   * @param offsets 基于世界坐标的扩展偏移量（已考虑 viewport.zoom）
   * @returns Promise<string> 扩展后的 base64 图片
   */
  const generateExpandedImageLocal = useCallback(async (img: CanvasImage, offsets: ExpandOffsets): Promise<string> => {
    try {
      // 获取图片的原始尺寸（物理像素）
      const naturalDims = await getImageNaturalDimensions(img.src);
      
      // 计算世界坐标显示尺寸与原始物理尺寸的比例
      // img.width/height 是世界坐标（逻辑尺寸），不受 viewport.zoom 影响
      // naturalDims 是原始图片的物理像素尺寸
      const scaleX = naturalDims.width / img.width;
      const scaleY = naturalDims.height / img.height;
      
      // 将偏移量从世界坐标转换为原始图片像素坐标
      // offsets 已经是世界坐标（在拖动时已除以 viewport.zoom）
      // 现在需要转换为原始图片的像素坐标
      const naturalOffsets: ExpandOffsets = {
        top: Math.round(offsets.top * scaleY),
        right: Math.round(offsets.right * scaleX),
        bottom: Math.round(offsets.bottom * scaleY),
        left: Math.round(offsets.left * scaleX),
      };
      
      // 使用转换后的偏移量生成扩图（基于原始像素尺寸）
      return await generateExpandedImage(img.src, naturalOffsets);
    } catch (error) {
      console.error('生成扩展图片失败:', error);
      throw error;
    }
  }, []);

  /**
   * 检测智能辅助线：检测当前拖动的边是否与其他边相等或接近
   * @param offsets 当前的扩展偏移量
   * @param draggingEdge 当前正在拖动的边（'top' | 'right' | 'bottom' | 'left'）
   * @returns 检测到的智能辅助线数组
   */
  const detectSmartGuides = (offsets: ExpandOffsets, draggingEdge: string): SmartGuide[] => {
    const guides: SmartGuide[] = [];
    const edges = ['top', 'right', 'bottom', 'left'] as const;
    const edgeValues = {
      top: offsets.top,
      right: offsets.right,
      bottom: offsets.bottom,
      left: offsets.left
    };
        
    // 获取当前拖动的边的值
    const currentValue = edgeValues[draggingEdge as keyof typeof edgeValues];
    
    // 如果当前值为0或太小，不显示辅助线
    if (currentValue < 1) {
      return guides;
    }

    // 检测与其他边的相等关系
    for (const edge of edges) {
      if (edge === draggingEdge) continue; // 跳过当前拖动的边
      
      const otherValue = edgeValues[edge];
      // 如果另一条边为0，跳过（不显示辅助线）
      if (otherValue < 1) continue;
      
      const diff = Math.abs(currentValue - otherValue);
        
      // 如果完全相等（差值小于1像素，放宽阈值以便更容易触发）
      if (diff < 1) {
        guides.push({
          type: 'equal',
          edges: [draggingEdge, edge],
          distance: currentValue,
          timestamp: Date.now()
        });
      }
      // 如果接近相等（在磁吸阈值内）
      else if (diff <= SNAP_THRESHOLD) {
        guides.push({
          type: 'near',
          edges: [draggingEdge, edge],
          distance: otherValue, // 使用已存在的边的值作为目标值
          timestamp: Date.now()
        });
      }
    }

    return guides;
  };

  // 处理扩图控制点拖动开始
  const handleExpandHandleMouseDown = (e: React.MouseEvent, handleType: string) => {
    e.stopPropagation();
    setIsDraggingExpandHandle(true);
    setDraggingHandleType(handleType);
    setDragStartPoint({ x: e.clientX, y: e.clientY });
    setExpandStartOffsets({ ...expandOffsets });
    setSmartGuides([]); // 重置辅助线
  };

  // 处理扩图控制点拖动
  useEffect(() => {
    if (!isDraggingExpandHandle || !draggingHandleType || !expandingImageId) return;

    // 获取正在扩图的图片
    const expandingImg = images.find(img => img.id === expandingImageId);
    if (!expandingImg) return;

    const handleMouseMove = (e: MouseEvent) => {
      // 将屏幕坐标转换为容器局部坐标系（简化版：容器不旋转，直接转换）
      // 由于容器不再旋转，可以直接使用简单的坐标转换，无需考虑旋转
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      
      // 计算相对于容器的坐标
      const startContainerX = (dragStartPoint.x - containerRect.left - viewport.x) / viewport.zoom;
      const startContainerY = (dragStartPoint.y - containerRect.top - viewport.y) / viewport.zoom;
      const currentContainerX = (e.clientX - containerRect.left - viewport.x) / viewport.zoom;
      const currentContainerY = (e.clientY - containerRect.top - viewport.y) / viewport.zoom;
      
      // 转换为相对于图片左上角的局部坐标
      const startLocalX = startContainerX - expandingImg.x;
      const startLocalY = startContainerY - expandingImg.y;
      const currentLocalX = currentContainerX - expandingImg.x;
      const currentLocalY = currentContainerY - expandingImg.y;
      
      const deltaX = currentLocalX - startLocalX;
      const deltaY = currentLocalY - startLocalY;

      const newOffsets = { ...expandStartOffsets };

      // 检测 Ctrl 键是否按下（用于对称扩展功能）
      const isCtrlPressed = e.ctrlKey || e.metaKey || ctrlKeyPressedRef.current;

      switch (draggingHandleType) {
        case 'top-left':
          // 四角：根据 Ctrl 键状态决定是局部对称扩展还是对角对称扩展
          const deltaTL = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          // 向左上拖动（deltaX < 0 && deltaY < 0）增加扩展
          // 向右下拖动（deltaX > 0 && deltaY > 0）减少扩展
          const signTL = (deltaX < 0 && deltaY < 0) ? 1 : (deltaX > 0 && deltaY > 0) ? -1 : 0;
          if (signTL !== 0) {
            if (isCtrlPressed) {
              // Ctrl 键按下：对角对称扩展（拖动左上角时，右下角同步扩展）
              const expandDelta = signTL * deltaTL;
              newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
            } else {
              // 未按 Ctrl 键：局部对称扩展（只扩展当前角的两条边）
              newOffsets.top = Math.max(0, expandStartOffsets.top + signTL * deltaTL);
              newOffsets.left = Math.max(0, expandStartOffsets.left + signTL * deltaTL);
            }
          }
          break;
        case 'top-right':
          // 右上角：根据 Ctrl 键状态决定是局部对称扩展还是对角对称扩展
          const deltaTR = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          // 向右上拖动（deltaX > 0 && deltaY < 0）增加扩展
          // 向左下拖动（deltaX < 0 && deltaY > 0）减少扩展
          const signTR = (deltaX > 0 && deltaY < 0) ? 1 : (deltaX < 0 && deltaY > 0) ? -1 : 0;
          if (signTR !== 0) {
            if (isCtrlPressed) {
              // Ctrl 键按下：对角对称扩展（拖动右上角时，左下角同步扩展）
              const expandDelta = signTR * deltaTR;
              newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
            } else {
              // 未按 Ctrl 键：局部对称扩展（只扩展当前角的两条边）
              newOffsets.top = Math.max(0, expandStartOffsets.top + signTR * deltaTR);
              newOffsets.right = Math.max(0, expandStartOffsets.right + signTR * deltaTR);
            }
          }
          break;
        case 'bottom-left':
          // 左下角：根据 Ctrl 键状态决定是局部对称扩展还是对角对称扩展
          const deltaBL = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          // 向左下拖动（deltaX < 0 && deltaY > 0）增加扩展
          // 向右上拖动（deltaX > 0 && deltaY < 0）减少扩展
          const signBL = (deltaX < 0 && deltaY > 0) ? 1 : (deltaX > 0 && deltaY < 0) ? -1 : 0;
          if (signBL !== 0) {
            if (isCtrlPressed) {
              // Ctrl 键按下：对角对称扩展（拖动左下角时，右上角同步扩展）
              const expandDelta = signBL * deltaBL;
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
              newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
            } else {
              // 未按 Ctrl 键：局部对称扩展（只扩展当前角的两条边）
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + signBL * deltaBL);
              newOffsets.left = Math.max(0, expandStartOffsets.left + signBL * deltaBL);
            }
          }
          break;
        case 'bottom-right':
          // 右下角：根据 Ctrl 键状态决定是局部对称扩展还是对角对称扩展
          const deltaBR = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          // 向右下拖动（deltaX > 0 && deltaY > 0）增加扩展
          // 向左上拖动（deltaX < 0 && deltaY < 0）减少扩展
          const signBR = (deltaX > 0 && deltaY > 0) ? 1 : (deltaX < 0 && deltaY < 0) ? -1 : 0;
          if (signBR !== 0) {
            if (isCtrlPressed) {
              // Ctrl 键按下：对角对称扩展（拖动右下角时，左上角同步扩展）
              const expandDelta = signBR * deltaBR;
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
              newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
            } else {
              // 未按 Ctrl 键：局部对称扩展（只扩展当前角的两条边）
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + signBR * deltaBR);
              newOffsets.right = Math.max(0, expandStartOffsets.right + signBR * deltaBR);
            }
          }
          break;
        case 'top':
          // 四边：根据 Ctrl 键状态决定是单向扩展还是对称扩展
          if (isCtrlPressed) {
            // Ctrl 键按下：对称扩展（拖动上边缘时，下边缘同步向下扩展相同距离）
            const expandDelta = -deltaY; // 向上拖动（deltaY < 0）增加扩展
            newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
            newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
          } else {
            // 未按 Ctrl 键：单向扩展
            newOffsets.top = Math.max(0, expandStartOffsets.top - deltaY);
          }
          break;
        case 'right':
          // 四边：根据 Ctrl 键状态决定是单向扩展还是对称扩展
          if (isCtrlPressed) {
            // Ctrl 键按下：对称扩展（拖动右边缘时，左边缘同步向左扩展相同距离）
            const expandDelta = deltaX; // 向右拖动（deltaX > 0）增加扩展
            newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
            newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
          } else {
            // 未按 Ctrl 键：单向扩展
            newOffsets.right = Math.max(0, expandStartOffsets.right + deltaX);
          }
          break;
        case 'bottom':
          // 四边：根据 Ctrl 键状态决定是单向扩展还是对称扩展
          if (isCtrlPressed) {
            // Ctrl 键按下：对称扩展（拖动下边缘时，上边缘同步向上扩展相同距离）
            const expandDelta = deltaY; // 向下拖动（deltaY > 0）增加扩展
            newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
            newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
          } else {
            // 未按 Ctrl 键：单向扩展
            newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + deltaY);
          }
          break;
        case 'left':
          // 四边：根据 Ctrl 键状态决定是单向扩展还是对称扩展
          if (isCtrlPressed) {
            // Ctrl 键按下：对称扩展（拖动左边缘时，右边缘同步向右扩展相同距离）
            const expandDelta = -deltaX; // 向左拖动（deltaX < 0）增加扩展
            newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
            newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
          } else {
            // 未按 Ctrl 键：单向扩展
            newOffsets.left = Math.max(0, expandStartOffsets.left - deltaX);
          }
          break;
      }

      // 智能辅助线检测和磁吸效果
      // 确定当前拖动的边（用于检测）
      let currentDraggingEdge: string = '';
      if (draggingHandleType === 'top' || draggingHandleType === 'top-left' || draggingHandleType === 'top-right') {
        currentDraggingEdge = 'top';
      } else if (draggingHandleType === 'right' || draggingHandleType === 'top-right' || draggingHandleType === 'bottom-right') {
        currentDraggingEdge = 'right';
      } else if (draggingHandleType === 'bottom' || draggingHandleType === 'bottom-left' || draggingHandleType === 'bottom-right') {
        currentDraggingEdge = 'bottom';
      } else if (draggingHandleType === 'left' || draggingHandleType === 'top-left' || draggingHandleType === 'bottom-left') {
        currentDraggingEdge = 'left';
      }

      // 对于四角拖动，需要检测两条边
      const detectedGuides: SmartGuide[] = [];
      if (draggingHandleType === 'top-left') {
        // 检测 top 和 left 两条边
        detectedGuides.push(...detectSmartGuides(newOffsets, 'top'));
        detectedGuides.push(...detectSmartGuides(newOffsets, 'left'));
      } else if (draggingHandleType === 'top-right') {
        detectedGuides.push(...detectSmartGuides(newOffsets, 'top'));
        detectedGuides.push(...detectSmartGuides(newOffsets, 'right'));
      } else if (draggingHandleType === 'bottom-left') {
        detectedGuides.push(...detectSmartGuides(newOffsets, 'bottom'));
        detectedGuides.push(...detectSmartGuides(newOffsets, 'left'));
      } else if (draggingHandleType === 'bottom-right') {
        detectedGuides.push(...detectSmartGuides(newOffsets, 'bottom'));
        detectedGuides.push(...detectSmartGuides(newOffsets, 'right'));
      } else if (currentDraggingEdge) {
        // 单边拖动
        detectedGuides.push(...detectSmartGuides(newOffsets, currentDraggingEdge));
      }

      // 应用磁吸效果：当接近相等时自动对齐
      for (const guide of detectedGuides) {
        if (guide.type === 'near') {
          // 对于四角拖动，需要特殊处理
          if (draggingHandleType === 'top-left') {
            // 检测 top 和 left 是否分别与其他边接近
            if (guide.edges.includes('top') && guide.edges.includes('bottom')) {
              newOffsets.top = guide.distance;
            } else if (guide.edges.includes('top') && guide.edges.includes('right')) {
              newOffsets.top = guide.distance;
            } else if (guide.edges.includes('left') && guide.edges.includes('right')) {
              newOffsets.left = guide.distance;
            } else if (guide.edges.includes('left') && guide.edges.includes('bottom')) {
              newOffsets.left = guide.distance;
            }
          } else if (draggingHandleType === 'top-right') {
            if (guide.edges.includes('top') && guide.edges.includes('bottom')) {
              newOffsets.top = guide.distance;
            } else if (guide.edges.includes('top') && guide.edges.includes('left')) {
              newOffsets.top = guide.distance;
            } else if (guide.edges.includes('right') && guide.edges.includes('left')) {
              newOffsets.right = guide.distance;
            } else if (guide.edges.includes('right') && guide.edges.includes('bottom')) {
              newOffsets.right = guide.distance;
            }
          } else if (draggingHandleType === 'bottom-left') {
            if (guide.edges.includes('bottom') && guide.edges.includes('top')) {
              newOffsets.bottom = guide.distance;
            } else if (guide.edges.includes('bottom') && guide.edges.includes('right')) {
              newOffsets.bottom = guide.distance;
            } else if (guide.edges.includes('left') && guide.edges.includes('right')) {
              newOffsets.left = guide.distance;
            } else if (guide.edges.includes('left') && guide.edges.includes('top')) {
              newOffsets.left = guide.distance;
            }
          } else if (draggingHandleType === 'bottom-right') {
            if (guide.edges.includes('bottom') && guide.edges.includes('top')) {
              newOffsets.bottom = guide.distance;
            } else if (guide.edges.includes('bottom') && guide.edges.includes('left')) {
              newOffsets.bottom = guide.distance;
            } else if (guide.edges.includes('right') && guide.edges.includes('left')) {
              newOffsets.right = guide.distance;
            } else if (guide.edges.includes('right') && guide.edges.includes('top')) {
              newOffsets.right = guide.distance;
            }
          } else {
            // 单边拖动：直接对齐
            const targetEdge = guide.edges.find(e => e !== currentDraggingEdge);
            if (targetEdge && currentDraggingEdge) {
              if (currentDraggingEdge === 'top') {
                newOffsets.top = guide.distance;
              } else if (currentDraggingEdge === 'right') {
                newOffsets.right = guide.distance;
              } else if (currentDraggingEdge === 'bottom') {
                newOffsets.bottom = guide.distance;
              } else if (currentDraggingEdge === 'left') {
                newOffsets.left = guide.distance;
              }
            }
          }
        }
      }

      // 更新辅助线状态（只显示完全相等的辅助线，不显示接近的）
      const equalGuides = detectedGuides.filter(g => g.type === 'equal');
      
      // 去重：避免重复的辅助线，并添加时间戳
      const uniqueGuides = equalGuides
        .filter((guide, index, self) => {
          const guideKey = guide.edges.sort().join('-');
          return index === self.findIndex(g => g.edges.sort().join('-') === guideKey);
        })
        .map(guide => ({
          ...guide,
          timestamp: Date.now() // 添加时间戳
        }));
      
      setSmartGuides(uniqueGuides);

      setExpandOffsets(newOffsets);
    };

    const handleMouseUp = () => {
      setIsDraggingExpandHandle(false);
      setDraggingHandleType(null);
      // 拖动结束时延迟清除辅助线，让用户有时间看到
      setTimeout(() => {
        setSmartGuides([]);
      }, GUIDE_FADE_DELAY);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingExpandHandle, draggingHandleType, dragStartPoint, expandStartOffsets, expandOffsets, viewport, expandingImageId, images]);

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
    const canvasImageBase64 = e.dataTransfer.getData('text/plain');
    
    if (canvasImageId || (canvasImageBase64 && canvasImageBase64.startsWith('data:image'))) {
      // 是从画布拖拽的图片，不触发文件上传，直接返回
      setIsDragOver(false);
      return;
    }
    
    e.preventDefault();
    setIsDragOver(false);
    
    // 只有真正的文件拖拽才处理上传
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
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
  const primarySelectedId = selectedImageId;

  return (
    <div 
      ref={containerRef}
      tabIndex={0} // Make focusable for keyboard events
      onKeyDown={handleKeyDown}
      className={`relative w-full h-full bg-slate-900 overflow-hidden cursor-default select-none transition-colors duration-200 outline-none ${
        isDragOver ? 'bg-slate-800' : ''
      }`}
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
          const isSelected = selectedImageId === img.id;
          const showMenu = isSelected && img.id === primarySelectedId;
          const isExpanding = expandingImageId === img.id;

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
                boxShadow: isSelected ? '0 0 0 2px #3b82f6, 0 20px 25px -5px rgb(0 0 0 / 0.1)' : 'none',
                // 移除容器的旋转，改为只旋转图片元素
              }}
              onMouseDown={(e) => handleMouseDown(e, img.id)}
              draggable={true}
              onDragStart={(e) => handleImageDragStart(e, img)}
              onDragEnd={handleImageDragEnd}
            >
              {/* 扩图模式：白色画布背景（在原图下方） */}
              {isExpanding && (
                <div
                  className="absolute bg-white/80 border-2 border-dashed border-blue-400 pointer-events-none"
                  style={{
                    left: -expandOffsets.left,
                    top: -expandOffsets.top,
                    width: img.width + expandOffsets.left + expandOffsets.right,
                    height: img.height + expandOffsets.top + expandOffsets.bottom,
                    zIndex: 0, // 使用 0 而不是 -1，确保在图片容器内正确显示
                  }}
                />
              )}
              
              {/* 图片元素 */}
              <img 
                src={img.src} 
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
        const isSelected = selectedImageId === img.id;
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
            {/* 扩图模式：显示扩图控制点 */}
            {isExpanding && (
              <>
                {/* 扩图控制点 - 四角（对称扩展） */}
                {(() => {
                  const topLeft = getHandlePosition(-expandOffsets.left, -expandOffsets.top);
                  return (
                    <div 
                      className="absolute w-5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-nw-resize z-50 hover:scale-125 transition-transform pointer-events-auto shadow-lg"
                      style={{
                        left: topLeft.x - 10,
                        top: topLeft.y - 10,
                      }}
                      onMouseDown={(e) => handleExpandHandleMouseDown(e, 'top-left')}
                    />
                  );
                })()}
                {(() => {
                  const topRight = getHandlePosition(img.width + expandOffsets.right, -expandOffsets.top);
                  return (
                    <div 
                      className="absolute w-5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-ne-resize z-50 hover:scale-125 transition-transform pointer-events-auto shadow-lg"
                      style={{
                        left: topRight.x - 10,
                        top: topRight.y - 10,
                      }}
                      onMouseDown={(e) => handleExpandHandleMouseDown(e, 'top-right')}
                    />
                  );
                })()}
                {(() => {
                  const bottomLeft = getHandlePosition(-expandOffsets.left, img.height + expandOffsets.bottom);
                  return (
                    <div 
                      className="absolute w-5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-sw-resize z-50 hover:scale-125 transition-transform pointer-events-auto shadow-lg"
                      style={{
                        left: bottomLeft.x - 10,
                        top: bottomLeft.y - 10,
                      }}
                      onMouseDown={(e) => handleExpandHandleMouseDown(e, 'bottom-left')}
                    />
                  );
                })()}
                {(() => {
                  const bottomRight = getHandlePosition(img.width + expandOffsets.right, img.height + expandOffsets.bottom);
                  return (
                    <div 
                      className="absolute w-5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-se-resize z-50 hover:scale-125 transition-transform pointer-events-auto shadow-lg"
                      style={{
                        left: bottomRight.x - 10,
                        top: bottomRight.y - 10,
                      }}
                      onMouseDown={(e) => handleExpandHandleMouseDown(e, 'bottom-right')}
                    />
                  );
                })()}
                
                {/* 扩图控制点 - 四边（单向扩展） */}
                {(() => {
                  const top = getHandlePosition(img.width / 2, -expandOffsets.top);
                  return (
                    <div 
                      className="absolute w-5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-n-resize z-50 hover:scale-125 transition-transform pointer-events-auto shadow-lg"
                      style={{
                        left: top.x - 10,
                        top: top.y - 10,
                      }}
                      onMouseDown={(e) => handleExpandHandleMouseDown(e, 'top')}
                    />
                  );
                })()}
                {(() => {
                  const right = getHandlePosition(img.width + expandOffsets.right, img.height / 2);
                  return (
                    <div 
                      className="absolute w-5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-e-resize z-50 hover:scale-125 transition-transform pointer-events-auto shadow-lg"
                      style={{
                        left: right.x - 10,
                        top: right.y - 10,
                      }}
                      onMouseDown={(e) => handleExpandHandleMouseDown(e, 'right')}
                    />
                  );
                })()}
                {(() => {
                  const bottom = getHandlePosition(img.width / 2, img.height + expandOffsets.bottom);
                  return (
                    <div 
                      className="absolute w-5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-s-resize z-50 hover:scale-125 transition-transform pointer-events-auto shadow-lg"
                      style={{
                        left: bottom.x - 10,
                        top: bottom.y - 10,
                      }}
                      onMouseDown={(e) => handleExpandHandleMouseDown(e, 'bottom')}
                    />
                  );
                })()}
                {(() => {
                  const left = getHandlePosition(-expandOffsets.left, img.height / 2);
                  return (
                    <div 
                      className="absolute w-5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-w-resize z-50 hover:scale-125 transition-transform pointer-events-auto shadow-lg"
                      style={{
                        left: left.x - 10,
                        top: left.y - 10,
                      }}
                      onMouseDown={(e) => handleExpandHandleMouseDown(e, 'left')}
                    />
                  );
                })()}
                
                {/* 智能辅助线：显示相等的边 */}
                {smartGuides.length > 0 && (() => {
                  // 计算图片在屏幕上的实际位置
                  const screenX = viewport.x + img.x * viewport.zoom;
                  const screenY = viewport.y + img.y * viewport.zoom;
                  const screenWidth = img.width * viewport.zoom;
                  const screenHeight = img.height * viewport.zoom;
                  
                  // 计算扩展后的边界位置（用于确定辅助线的位置）
                  const expandedLeft = screenX - expandOffsets.left * viewport.zoom;
                  const expandedTop = screenY - expandOffsets.top * viewport.zoom;
                  const expandedRight = screenX + screenWidth + expandOffsets.right * viewport.zoom;
                  const expandedBottom = screenY + screenHeight + expandOffsets.bottom * viewport.zoom;
                  
                  // 获取Canvas容器的完整尺寸，使辅助线覆盖整个画布
                  const containerRect = containerRef.current?.getBoundingClientRect();
                  const canvasWidth = containerRect ? containerRect.width : window.innerWidth;
                  const canvasHeight = containerRect ? containerRect.height : window.innerHeight;
                  
                  // 使用 Set 避免重复渲染相同的辅助线
                  const renderedGuides = new Set<string>();
                  
                  return smartGuides.map((guide, index) => {
                    // 创建唯一标识符
                    const edges = guide.edges.sort();
                    const guideKey = edges.join('-');
                    if (renderedGuides.has(guideKey)) {
                      return null;
                    }
                    renderedGuides.add(guideKey);
                    
                    // 根据边的组合渲染不同的辅助线
                    const edgeKey = guideKey;
                    
                    if (edgeKey === 'bottom-top' || edgeKey === 'top-bottom') {
                      // 上下相等：在顶部和底部显示水平辅助线，横跨整个Canvas
                      return (
                        <React.Fragment key={`guide-${index}`}>
                          {/* 顶部辅助线 - 红色，1px，覆盖整个Canvas宽度 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: 0,
                              top: expandedTop,
                              width: canvasWidth,
                              height: 1,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                          {/* 底部辅助线 - 红色，1px，覆盖整个Canvas宽度 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: 0,
                              top: expandedBottom,
                              width: canvasWidth,
                              height: 1,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                        </React.Fragment>
                      );
                    } else if (edgeKey === 'left-right' || edgeKey === 'right-left') {
                      // 左右相等：在左侧和右侧显示垂直辅助线，横跨整个Canvas高度
                      return (
                        <React.Fragment key={`guide-${index}`}>
                          {/* 左侧辅助线 - 红色，1px，覆盖整个Canvas高度 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: expandedLeft,
                              top: 0,
                              width: 1,
                              height: canvasHeight,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                          {/* 右侧辅助线 - 红色，1px，覆盖整个Canvas高度 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: expandedRight,
                              top: 0,
                              width: 1,
                              height: canvasHeight,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                        </React.Fragment>
                      );
                    } else if (edgeKey === 'left-top' || edgeKey === 'top-left') {
                      // 左上角相等：显示两条辅助线（水平和垂直），横跨整个Canvas
                      return (
                        <React.Fragment key={`guide-${index}`}>
                          {/* 水平辅助线 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: 0,
                              top: expandedTop,
                              width: canvasWidth,
                              height: 1,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                          {/* 垂直辅助线 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: expandedLeft,
                              top: 0,
                              width: 1,
                              height: canvasHeight,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                        </React.Fragment>
                      );
                    } else if (edgeKey === 'right-top' || edgeKey === 'top-right') {
                      // 右上角相等：显示两条辅助线
                      return (
                        <React.Fragment key={`guide-${index}`}>
                          {/* 水平辅助线 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: 0,
                              top: expandedTop,
                              width: canvasWidth,
                              height: 1,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                          {/* 垂直辅助线 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: expandedRight,
                              top: 0,
                              width: 1,
                              height: canvasHeight,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                        </React.Fragment>
                      );
                    } else if (edgeKey === 'bottom-left' || edgeKey === 'left-bottom') {
                      // 左下角相等：显示两条辅助线
                      return (
                        <React.Fragment key={`guide-${index}`}>
                          {/* 水平辅助线 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: 0,
                              top: expandedBottom,
                              width: canvasWidth,
                              height: 1,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                          {/* 垂直辅助线 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: expandedLeft,
                              top: 0,
                              width: 1,
                              height: canvasHeight,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                        </React.Fragment>
                      );
                    } else if (edgeKey === 'bottom-right' || edgeKey === 'right-bottom') {
                      // 右下角相等：显示两条辅助线
                      return (
                        <React.Fragment key={`guide-${index}`}>
                          {/* 水平辅助线 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: 0,
                              top: expandedBottom,
                              width: canvasWidth,
                              height: 1,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                          {/* 垂直辅助线 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: expandedRight,
                              top: 0,
                              width: 1,
                              height: canvasHeight,
                              backgroundColor: '#FF0000', // 红色
                              zIndex: 100,
                            }}
                          />
                        </React.Fragment>
                      );
                    }
                    return null;
                  });
                })()}
              </>
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

            {/* Action Menu (Only for primary selection) */}
            {showMenu && (
              <div 
                className="absolute flex gap-1 bg-slate-800/90 backdrop-blur rounded-lg p-1.5 shadow-xl border border-slate-700 pointer-events-auto z-50 items-center"
                style={{
                  // 扩图模式下，按钮显示在扩展后区域的水平中心
                  left: isExpanding
                    ? screenX + screenWidth / 2 + (expandOffsets.right - expandOffsets.left) * viewport.zoom / 2
                    : screenX + screenWidth / 2,
                  // 扩图模式下，按钮显示在扩展后区域的垂直中心
                  top: isExpanding
                    ? screenY + screenHeight / 2 + (expandOffsets.bottom - expandOffsets.top) * viewport.zoom / 2
                    : screenY - 48,
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseDown={(e) => e.stopPropagation()} 
              >
                {/* 扩图模式：只显示"按照新尺寸生成"按钮 */}
                {expandingImageId === img.id ? (
                  <button 
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const expandedBase64 = await generateExpandedImageLocal(img, expandOffsets);
                        // 将生成的图片传递给回调函数
                        if (onGenerateExpanded) {
                          onGenerateExpanded(img.id, expandedBase64);
                        }
                        // 重置扩图状态
                        setExpandingImageId(null);
                        setExpandOffsets({ top: 0, right: 0, bottom: 0, left: 0 });
                      } catch (error) {
                        console.error('Failed to generate expanded image:', error);
                      }
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-white text-xs font-medium transition-colors flex items-center gap-1.5"
                    title="按照新尺寸生成"
                  >
                    <Maximize2 size={14} />
                    <span>按照新尺寸生成</span>
                  </button>
                ) : (
                  <>
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
                  </>
                )}
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
      
      {/* Drop overlay hint */}
      {isDragOver && (
         <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 pointer-events-none z-[100] border-4 border-blue-500 border-dashed m-4 rounded-xl">
             <div className="text-blue-200 font-bold text-xl drop-shadow-md">释放图片以添加到画布</div>
         </div>
      )}
    </div>
  );
};

export default Canvas;