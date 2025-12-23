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
  selectedImageIds: string[];
  setSelectedImageIds: (ids: string[]) => void;
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
  selectedImageIds,
  setSelectedImageIds,
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
  
  // Dropdown state for the active menu
  const [showExtractMenu, setShowExtractMenu] = useState(false);

  // Reset dropdown when selection changes
  useEffect(() => {
    setShowExtractMenu(false);
  }, [selectedImageIds]);

  // 当选中图片时，自动将选中的图片提升到最上层
  useEffect(() => {
    if (selectedImageIds.length === 0) return;

    setImages(prev => {
      // 获取当前所有图片的最大 zIndex
      const maxZIndex = prev.length > 0 
        ? Math.max(...prev.map(img => img.zIndex), 0)
        : 0;

      // 检查是否有选中的图片需要更新 zIndex
      const needsUpdate = prev.some(img => {
        const index = selectedImageIds.indexOf(img.id);
        return index !== -1 && img.zIndex !== maxZIndex + index + 1;
      });

      // 如果没有需要更新的，直接返回原数组（避免不必要的状态更新）
      if (!needsUpdate) return prev;

      // 更新选中图片的 zIndex，使其在最上层
      // 多个图片选中时，按选中顺序设置 zIndex，最后选中的在最上层
      return prev.map(img => {
        const index = selectedImageIds.indexOf(img.id);
        if (index !== -1) {
          // 选中的图片：根据在选中数组中的位置设置 zIndex
          // 最后选中的图片（数组最后一个）zIndex 最大
          return {
            ...img,
            zIndex: maxZIndex + index + 1
          };
        }
        return img;
      });
    });
  }, [selectedImageIds]); // 只依赖 selectedImageIds，在 setImages 内部获取最新的 images 状态

  // 扩图模式状态（需要在 useEffect 之前声明）
  const [expandingImageId, setExpandingImageId] = useState<string | null>(null);
  const [expandOffsets, setExpandOffsets] = useState<ExpandOffsets>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [isDraggingExpandHandle, setIsDraggingExpandHandle] = useState(false);
  const [draggingHandleType, setDraggingHandleType] = useState<string | null>(null);
  const [dragStartPoint, setDragStartPoint] = useState<Point>({ x: 0, y: 0 });
  const [expandStartOffsets, setExpandStartOffsets] = useState<ExpandOffsets>({ top: 0, right: 0, bottom: 0, left: 0 });

  // Internal Clipboard for Copy/Paste shortcuts
  const [internalClipboard, setInternalClipboard] = useState<CanvasImage[]>([]);

  // ✅ 性能优化：使用索引加速查找
  const imageIndex = useMemo(() => new ImageIndex(images), [images]);
  
  // ✅ 性能优化：使用 Set 加速 id 查找
  const selectedImageIdsSet = useMemo(() => new Set(selectedImageIds), [selectedImageIds]);

  // --- Unified Copy Logic ---
  /**
   * 复制图片到剪贴板
   * @param targetIds 要复制的图片 ID 数组
   */
  const handleCopyImages = useCallback(async (targetIds: string[]) => {
    try {
      // ✅ 使用索引批量查找，O(n) 而不是 O(n²)
      const targets = imageIndex.getMany(targetIds);
      if (targets.length === 0) {
        console.warn('没有找到要复制的图片');
        return;
      }

      // 1. 更新内部剪贴板
      setInternalClipboard(targets);

      // 2. 更新系统剪贴板（仅主图片）
      const primaryImg = targets[targets.length - 1];
      
      try {
        const blob = await getPngBlob(primaryImg.src);
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
      } catch (err) {
        // 系统剪贴板写入失败不影响内部复制功能
        console.warn('系统剪贴板写入失败（内部复制仍可用）:', err);
      }

      // 3. 视觉反馈
      setCopiedId(primaryImg.id);
      // 使用定时器显示复制成功提示，2秒后自动清除
      const timer = setTimeout(() => setCopiedId(null), 2000);
      // 注意：这里不需要清理定时器，因为组件卸载时会自动清理状态
    } catch (error) {
      console.error('复制图片失败:', error);
    }
  }, [imageIndex]);

  /**
   * 从系统剪贴板粘贴图片
   */
  const handlePasteFromClipboard = useCallback(async () => {
    try {
      // 读取剪贴板内容
      const clipboardItems = await navigator.clipboard.read();
      
      // 查找图片类型的剪贴板项
      for (const item of clipboardItems) {
        // 检查是否有图片类型
        const imageTypes = item.types.filter(type => type.startsWith('image/'));
        
        if (imageTypes.length > 0) {
          // 获取第一个图片类型
          const imageType = imageTypes[0];
          const blob = await item.getType(imageType);
          
          // 将 Blob 转换为 base64
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const base64 = ev.target?.result as string;
              if (base64) {
                // 添加到画布中心位置
                onImportImage(base64);
              }
            } catch (error) {
              console.error('处理剪贴板图片失败:', error);
            }
          };
          reader.onerror = () => {
            console.error('读取剪贴板图片失败');
          };
          reader.readAsDataURL(blob);
          
          // 只处理第一个图片
          return;
        }
      }
      
      // 如果没有找到图片，尝试读取文本（可能是图片 URL）
      const textTypes = clipboardItems.flatMap(item => 
        item.types.filter(type => type === 'text/plain')
      );
      
      if (textTypes.length > 0) {
        const firstItem = clipboardItems.find(item => 
          item.types.includes('text/plain')
        );
        if (firstItem) {
          const text = await firstItem.getType('text/plain');
          const textContent = await text.text();
          
          // 检查是否是图片 URL（data URL 或 http/https URL）
          if (textContent.startsWith('data:image/') || 
              textContent.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|bmp)/i)) {
            // 如果是 data URL，直接使用
            if (textContent.startsWith('data:image/')) {
              onImportImage(textContent);
            } else {
              // 如果是 http/https URL，需要先加载图片
              // 注意：由于跨域限制，可能需要后端代理
              console.warn('暂不支持从 URL 粘贴图片，请使用图片文件或截图');
            }
          }
        }
      }
    } catch (error) {
      // 剪贴板读取失败（可能是权限问题或剪贴板中没有图片）
      // 静默失败，不显示错误提示
      console.debug('无法从剪贴板读取图片:', error);
    }
  }, [onImportImage]);

  // --- Keyboard Shortcuts ---
  /**
   * 处理键盘快捷键
   * 支持删除、复制、粘贴、复制、全选等操作
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Delete
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedImageIds.length > 0) {
        setImages(prev => prev.filter(img => !selectedImageIds.includes(img.id)));
        setSelectedImageIds([]);
      }
    }

    // Copy (Ctrl+C)
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (selectedImageIds.length > 0) {
        e.preventDefault();
        handleCopyImages(selectedImageIds);
      }
    }

    // Paste (Ctrl+V)
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      
      // 1. 优先处理内部剪贴板（画布内复制的图片）
      if (internalClipboard.length > 0) {
        const newImages = internalClipboard.map(img => ({
          ...img,
          id: generateId(),
          x: img.x + 40, // Offset pasted images
          y: img.y + 40,
          zIndex: images.length + 1
        }));
        
        const maxZ = Math.max(...images.map(i => i.zIndex), 0);
        newImages.forEach((img, idx) => img.zIndex = maxZ + idx + 1);

        setImages(prev => [...prev, ...newImages]);
        setSelectedImageIds(newImages.map(img => img.id));
      } else {
        // 2. 如果没有内部剪贴板，尝试从系统剪贴板读取图片
        handlePasteFromClipboard();
      }
    }

    // Duplicate (Ctrl+D)
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      if (selectedImageIds.length > 0) {
        // ✅ 使用索引批量查找，O(n) 而不是 O(n²)
        const selectedImages = imageIndex.getMany(selectedImageIds);
        // ✅ 使用索引获取所有图片来计算 maxZ，避免重复遍历
        const allImages = imageIndex.getAll();
        const maxZ = allImages.length > 0 
          ? Math.max(...allImages.map(i => i.zIndex), 0)
          : 0;
        
        const newImages = selectedImages.map((img, idx) => ({
          ...img,
          id: generateId(),
          x: img.x + 40,
          y: img.y + 40,
          zIndex: maxZ + idx + 1
        }));
        setImages(prev => [...prev, ...newImages]);
        setSelectedImageIds(newImages.map(img => img.id));
      }
    }

    // Select All (Ctrl+A)
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      // ✅ 使用索引获取所有 id，已按 zIndex 排序
      setSelectedImageIds(imageIndex.getAllIds());
    }
  }, [selectedImageIds, internalClipboard, images, imageIndex, handleCopyImages, handlePasteFromClipboard, setImages, setSelectedImageIds]);

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

  // --- Mouse Interactions ---

  const handleMouseDown = (e: React.MouseEvent, imageId?: string) => {
    // Explicitly focus container to ensure keyboard shortcuts work
    containerRef.current?.focus();

    // 2. Image Click
    if (imageId) {
      e.stopPropagation();
      
      // 如果正在扩图模式，阻止图片拖动（但允许选择）
      if (expandingImageId === imageId && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // 只允许选择，不允许拖动
        const isSelected = selectedImageIds.includes(imageId);
        if (!isSelected) {
          setSelectedImageIds([imageId]);
        }
        return;
      }
      
      const isSelected = selectedImageIds.includes(imageId);
      
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
      
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        // Toggle selection
        if (isSelected) {
          setSelectedImageIds(selectedImageIds.filter(id => id !== imageId));
        } else {
          setSelectedImageIds([...selectedImageIds, imageId]);
        }
      } else {
        // If not holding modifier...
        if (!isSelected) {
          // If clicking an unselected item, select ONLY it
          setSelectedImageIds([imageId]);
        }
        // If clicking an already selected item, keep selection as is (allows dragging group)
      }

      setIsDraggingImage(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    } 
    // 3. Canvas Click
    else {
      setIsDraggingCanvas(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      // Deselect if clicking empty space
      if (!e.shiftKey && !e.ctrlKey) {
        setSelectedImageIds([]);
      }
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

    } else if (isDraggingImage && selectedImageIds.length > 0) {
      const dx = (e.clientX - dragStart.x) / scale;
      const dy = (e.clientY - dragStart.y) / scale;
      
      setImages(prev => prev.map(img => 
        selectedImageIds.includes(img.id)
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
  const generateExpandedImageLocal = useCallback(async (img: CanvasImage, offsets: ExpandOffsets): Promise<string> => {
    try {
      return await generateExpandedImage(img.src, offsets);
    } catch (error) {
      console.error('生成扩展图片失败:', error);
      throw error;
    }
  }, []);

  // 处理扩图控制点拖动开始
  const handleExpandHandleMouseDown = (e: React.MouseEvent, handleType: string) => {
    e.stopPropagation();
    setIsDraggingExpandHandle(true);
    setDraggingHandleType(handleType);
    setDragStartPoint({ x: e.clientX, y: e.clientY });
    setExpandStartOffsets({ ...expandOffsets });
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

      switch (draggingHandleType) {
        case 'top-left':
          // 四角：对称扩展（左上角）
          // 使用较小的变化量来保持对称，根据拖动方向判断增加或减少
          const deltaTL = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          // 向左上拖动（deltaX < 0 && deltaY < 0）增加扩展
          // 向右下拖动（deltaX > 0 && deltaY > 0）减少扩展
          const signTL = (deltaX < 0 && deltaY < 0) ? 1 : (deltaX > 0 && deltaY > 0) ? -1 : 0;
          if (signTL !== 0) {
            newOffsets.top = Math.max(0, expandStartOffsets.top + signTL * deltaTL);
            newOffsets.left = Math.max(0, expandStartOffsets.left + signTL * deltaTL);
          }
          break;
        case 'top-right':
          // 右上角：对称扩展
          const deltaTR = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          // 向右上拖动（deltaX > 0 && deltaY < 0）增加扩展
          // 向左下拖动（deltaX < 0 && deltaY > 0）减少扩展
          const signTR = (deltaX > 0 && deltaY < 0) ? 1 : (deltaX < 0 && deltaY > 0) ? -1 : 0;
          if (signTR !== 0) {
            newOffsets.top = Math.max(0, expandStartOffsets.top + signTR * deltaTR);
            newOffsets.right = Math.max(0, expandStartOffsets.right + signTR * deltaTR);
          }
          break;
        case 'bottom-left':
          // 左下角：对称扩展
          const deltaBL = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          // 向左下拖动（deltaX < 0 && deltaY > 0）增加扩展
          // 向右上拖动（deltaX > 0 && deltaY < 0）减少扩展
          const signBL = (deltaX < 0 && deltaY > 0) ? 1 : (deltaX > 0 && deltaY < 0) ? -1 : 0;
          if (signBL !== 0) {
            newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + signBL * deltaBL);
            newOffsets.left = Math.max(0, expandStartOffsets.left + signBL * deltaBL);
          }
          break;
        case 'bottom-right':
          // 右下角：对称扩展
          const deltaBR = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          // 向右下拖动（deltaX > 0 && deltaY > 0）增加扩展
          // 向左上拖动（deltaX < 0 && deltaY < 0）减少扩展
          const signBR = (deltaX > 0 && deltaY > 0) ? 1 : (deltaX < 0 && deltaY < 0) ? -1 : 0;
          if (signBR !== 0) {
            newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + signBR * deltaBR);
            newOffsets.right = Math.max(0, expandStartOffsets.right + signBR * deltaBR);
          }
          break;
        case 'top':
          // 四边：单向扩展
          newOffsets.top = Math.max(0, expandStartOffsets.top - deltaY);
          break;
        case 'right':
          newOffsets.right = Math.max(0, expandStartOffsets.right + deltaX);
          break;
        case 'bottom':
          newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + deltaY);
          break;
        case 'left':
          newOffsets.left = Math.max(0, expandStartOffsets.left - deltaX);
          break;
      }

      setExpandOffsets(newOffsets);
    };

    const handleMouseUp = () => {
      setIsDraggingExpandHandle(false);
      setDraggingHandleType(null);
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
  const selectionCount = selectedImageIds.length;
  const primarySelectedId = selectionCount > 0 ? selectedImageIds[selectionCount - 1] : null;

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
          // ✅ 使用 Set 进行 O(1) 查找，而不是 O(n) 的 includes
          const isSelected = selectedImageIdsSet.has(img.id);
          // Show menu only on the primary (last) selected item to avoid clutter
          const showMenu = isSelected && img.id === primarySelectedId;
          const isExpanding = expandingImageId === img.id;

          return (
            <div
              key={img.id}
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
        const isSelected = selectedImageIdsSet.has(img.id);
        const showMenu = isSelected && img.id === primarySelectedId;
        
        if (!isSelected) return null;

        // 计算图片在屏幕上的实际位置（考虑 viewport 的 transform）
        const screenX = viewport.x + img.x * viewport.zoom;
        const screenY = viewport.y + img.y * viewport.zoom;
        const screenWidth = img.width * viewport.zoom;
        const screenHeight = img.height * viewport.zoom;

        const isExpanding = expandingImageId === img.id;
        
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
                  left: screenX + screenWidth / 2,
                  top: screenY - 48,
                  transform: 'translate(-50%, 0)',
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
                      title={selectionCount > 1 ? "编辑所有选中图片" : "编辑"}
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
                      title={selectionCount > 1 ? "变清晰所有选中图片" : "变清晰"}
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
                        if (selectedImageIds.includes(img.id)) {
                          handleCopyImages(selectedImageIds);
                        } else {
                          handleCopyImages([img.id]);
                        }
                      }}
                      className="p-1.5 hover:bg-blue-600 rounded text-slate-300 hover:text-white transition-colors"
                      title={selectionCount > 1 ? "复制选中图片 (原图)" : "复制原图"}
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
        {selectionCount > 0 && (
          <div className="flex items-center gap-1 text-blue-400 border-l border-slate-600 pl-4">
            <MousePointer2 size={12} />
            <span>Selected: {selectionCount}</span>
          </div>
        )}
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