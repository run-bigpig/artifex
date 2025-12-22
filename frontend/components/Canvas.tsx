import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { CanvasImage, Point, Viewport, CanvasActionType } from '../types';
import { Move, ZoomIn, ZoomOut, Trash2, Edit, Upload, Copy, Check, MousePointer2, Scissors } from 'lucide-react';
import { ExportImage } from '../wailsjs/go/core/App';
import { v4 as uuidv4 } from 'uuid';
import { ImageIndex } from '../utils/imageIndex'; 

const generateId = () => Math.random().toString(36).substr(2, 9);

// Helper to ensure we get a PNG blob for clipboard compatibility
const getPngBlob = (src: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Context creation failed")); 
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Blob creation failed"));
        }
      }, 'image/png');
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
};

// Helper to create a thumbnail drag preview image synchronously
// 返回 Canvas 元素，可以直接用作 drag image（不需要等待加载）
const createDragPreviewThumbnailSync = (img: HTMLImageElement, size: number = 64): HTMLCanvasElement => {
  // 创建 Canvas 来生成缩略图
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error("Context creation failed");
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
  
  // 直接返回 Canvas 元素，setDragImage 支持 Canvas
  return canvas;
};

interface CanvasProps {
  images: CanvasImage[];
  setImages: React.Dispatch<React.SetStateAction<CanvasImage[]>>;
  selectedImageIds: string[];
  setSelectedImageIds: (ids: string[]) => void;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  onAction: (id: string, action: CanvasActionType) => void;
  onImportImage: (base64: string, x: number, y: number) => void;
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
  onImportImage
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

  // Internal Clipboard for Copy/Paste shortcuts
  const [internalClipboard, setInternalClipboard] = useState<CanvasImage[]>([]);

  // ✅ 性能优化：使用索引加速查找
  const imageIndex = useMemo(() => new ImageIndex(images), [images]);
  
  // ✅ 性能优化：使用 Set 加速 id 查找
  const selectedImageIdsSet = useMemo(() => new Set(selectedImageIds), [selectedImageIds]);

  // --- Unified Copy Logic ---
  const handleCopyImages = async (targetIds: string[]) => {
    // ✅ 使用索引批量查找，O(n) 而不是 O(n²)
    const targets = imageIndex.getMany(targetIds);
    if (targets.length === 0) return;

    // 1. Update Internal Clipboard
    setInternalClipboard(targets);

    // 2. Update System Clipboard (Primary image only)
    const primaryImg = targets[targets.length - 1];
    
    try {
      const blob = await getPngBlob(primaryImg.src);
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
    } catch (err) {
      console.warn('System clipboard write failed (internal copy still worked)', err);
    }

    // 3. Visual Feedback
    setCopiedId(primaryImg.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // --- Keyboard Shortcuts ---
  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      if (internalClipboard.length > 0) {
        e.preventDefault();
        
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
  };

  // --- Wheel Zoom/Pan ---
  const handleWheel = useCallback((e: WheelEvent) => {
    const container = containerRef.current;
    if (!container) return;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      
      // 获取容器相对于视口的位置
      const rect = container.getBoundingClientRect();
      
      // 计算鼠标在容器内的位置（相对于容器的坐标）
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // 计算鼠标指向的画布世界坐标（缩放前的世界坐标）
      // 公式：worldX = (screenX - viewport.x) / viewport.zoom
      const worldX = (mouseX - viewport.x) / viewport.zoom;
      const worldY = (mouseY - viewport.y) / viewport.zoom;
      
      // 计算新的缩放比例
      // 优化缩放步进值：使用更小的灵敏度，使缩放更平滑可控（约 5% 步进）
      const zoomSensitivity = 0.0003;
      const zoomDelta = -e.deltaY * zoomSensitivity;
      const newZoom = Math.min(Math.max(viewport.zoom + zoomDelta, 0.1), 5);
      
      // 调整视口位置，使得缩放前后鼠标指向的世界坐标点在屏幕上的位置保持不变
      // 公式：newViewport.x = mouseX - worldX * newZoom
      // 这确保了缩放前后，鼠标指向的世界坐标点在屏幕上的位置不变
      const newX = mouseX - worldX * newZoom;
      const newY = mouseY - worldY * newZoom;
      
      setViewport(prev => ({
        ...prev,
        zoom: newZoom,
        x: newX,
        y: newY
      }));
    } else {
      // 平移操作保持不变
      setViewport(prev => ({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY
      }));
    }
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
      // 计算拖动的主要方向，使用较大的变化量来保持比例
      const deltaX = Math.abs(dx);
      const deltaY = Math.abs(dy);
      const scaleFactor = Math.max(deltaX / resizeStartDims.width, deltaY / resizeStartDims.height);
      
      // 确定缩放方向（放大或缩小）
      let scaleDirection = 1;
      if (resizeHandle === 'br' || resizeHandle === 'tr') {
        // 右下角或右上角：向右或向下拖动为放大
        scaleDirection = (dx > 0 || dy > 0) ? 1 : -1;
      } else {
        // 左下角或左上角：向左或向上拖动为放大
        scaleDirection = (dx < 0 || dy < 0) ? 1 : -1;
      }
      
      // 计算新尺寸（保持宽高比）
      newWidth = Math.max(50, resizeStartDims.width * (1 + scaleDirection * scaleFactor));
      newHeight = newWidth / originalAspectRatio;
      
      // 根据拖动的角调整位置
      switch (resizeHandle) {
        case 'br': // Bottom Right - 右下角
          // 位置不变
          break;
        case 'bl': // Bottom Left - 左下角
          newX = resizeStartPos.x + (resizeStartDims.width - newWidth);
          break;
        case 'tr': // Top Right - 右上角
          newY = resizeStartPos.y + (resizeStartDims.height - newHeight);
          break;
        case 'tl': // Top Left - 左上角
          newX = resizeStartPos.x + (resizeStartDims.width - newWidth);
          newY = resizeStartPos.y + (resizeStartDims.height - newHeight);
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

  const handleMouseUp = () => {
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
  };

  // --- Drag Image to Sidebar ---
  const handleImageDragStart = (e: React.DragEvent, img: CanvasImage) => {
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
      console.error('Failed to create drag preview thumbnail:', error);
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
  };

  const handleImageDragEnd = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDraggingToSidebar(false);
  };

  // --- Actions ---

  const handleActionClick = (e: React.MouseEvent, id: string, action: CanvasActionType) => {
    e.stopPropagation();
    onAction(id, action);
    if (action.startsWith('extract')) {
        setShowExtractMenu(false);
    }
  };

  const handleExport = async (e: React.MouseEvent, img: CanvasImage) => {
    e.stopPropagation();
    try {
      // 使用 ExportImage 方法导出图片，使用随机文件名
      const now = new Date();
      const formattedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const randomName = `artifex-${formattedDate}-${Math.random().toString(36).slice(2, 11)}.png`;
      await ExportImage(img.src, randomName, 'png', '');
    } catch (err) {
      console.error('Export failed', err);
    }
  };

  // --- Drag & Drop Import ---
  const handleDragOver = (e: React.DragEvent) => {
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
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    // 检查是否是从画布拖拽的图片
    const isCanvasImageDrag = e.dataTransfer.types.includes('application/canvas-image');
    
    if (isCanvasImageDrag) {
      // 是从画布拖拽的图片，不处理
      return;
    }
    
    e.preventDefault();
    setIsDragOver(false);
  };
  
  const handleDrop = (e: React.DragEvent) => {
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
      const files = Array.from(e.dataTransfer.files);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dropX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const dropY = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      files.forEach((file: File) => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const base64 = ev.target?.result as string;
            if (base64) onImportImage(base64, dropX, dropY);
          };
          reader.readAsDataURL(file);
        }
      });
    }
  };

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
                boxShadow: isSelected ? '0 0 0 2px #3b82f6, 0 20px 25px -5px rgb(0 0 0 / 0.1)' : 'none'
              }}
              onMouseDown={(e) => handleMouseDown(e, img.id)}
              draggable={true}
              onDragStart={(e) => handleImageDragStart(e, img)}
              onDragEnd={handleImageDragEnd}
            >
              <img 
                src={img.src} 
                alt={img.prompt}
                // Changed from object-cover to object-fill to support free resize distortion
                className="w-full h-full object-fill select-none pointer-events-none bg-slate-800 block"
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

        return (
          <React.Fragment key={`ui-${img.id}`}>
            {/* Resize Handles - 4 Corners */}
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