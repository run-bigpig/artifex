/**
 * ExpandMode - 扩图模式组件
 * 
 * 提供图片扩展功能的完整 UI 和交互逻辑：
 * - 8 个控制点（4 角 + 4 边）
 * - Ctrl 键对称扩展
 * - 智能辅助线和磁吸对齐
 * - 实时尺寸显示
 * - ESC 退出支持
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Maximize2, X } from 'lucide-react';
import { CanvasImage, Point, Viewport, ExpandOffsets } from '../types';
import { generateExpandedImage, getImageNaturalDimensions } from '../utils/canvasUtils';

// ==================== 类型定义 ====================

interface SmartGuide {
  type: 'equal' | 'near'; // 相等或接近
  edges: string[]; // 相关的边（如 ['top', 'bottom']）
  distance: number; // 相等的距离值
  timestamp: number; // 添加时间戳，用于延迟消失
}

type ExpandHandleType = 
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'  // 四角
  | 'top' | 'right' | 'bottom' | 'left';  // 四边

interface ExpandModeProps {
  /** 正在扩图的图片 */
  image: CanvasImage;
  /** 视口信息 */
  viewport: Viewport;
  /** 容器 ref（用于坐标计算） */
  containerRef: React.RefObject<HTMLDivElement>;
  /** 生成扩图回调 */
  onGenerate: (expandedBase64: string) => void;
  /** 取消/退出回调 */
  onCancel: () => void;
  /** Ctrl 键是否按下（从父组件传入以保持同步） */
  ctrlKeyPressed?: boolean;
}

// ==================== 常量 ====================

/** 磁吸阈值（像素）：当距离差小于此值时自动对齐 */
const SNAP_THRESHOLD = 5;

/** 辅助线延迟消失时间（毫秒）：拖动停止后保持显示的时间 */
const GUIDE_FADE_DELAY = 500;

// ==================== 组件 ====================

const ExpandMode: React.FC<ExpandModeProps> = ({
  image,
  viewport,
  containerRef,
  onGenerate,
  onCancel,
  ctrlKeyPressed = false,
}) => {
  // ==================== 状态 ====================
  
  const [expandOffsets, setExpandOffsets] = useState<ExpandOffsets>({ 
    top: 0, right: 0, bottom: 0, left: 0 
  });
  const [isDragging, setIsDragging] = useState(false);
  const [draggingHandleType, setDraggingHandleType] = useState<ExpandHandleType | null>(null);
  const [dragStartPoint, setDragStartPoint] = useState<Point>({ x: 0, y: 0 });
  const [expandStartOffsets, setExpandStartOffsets] = useState<ExpandOffsets>({ 
    top: 0, right: 0, bottom: 0, left: 0 
  });
  const [smartGuides, setSmartGuides] = useState<SmartGuide[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // 使用 ref 跟踪 Ctrl 键状态
  const ctrlKeyRef = useRef(ctrlKeyPressed);
  useEffect(() => {
    ctrlKeyRef.current = ctrlKeyPressed;
  }, [ctrlKeyPressed]);

  // ==================== 计算辅助函数 ====================

  /** 计算控制点在屏幕上的位置 */
  const getHandlePosition = useCallback((localX: number, localY: number) => {
    const screenX = viewport.x + image.x * viewport.zoom;
    const screenY = viewport.y + image.y * viewport.zoom;
    return {
      x: screenX + localX * viewport.zoom,
      y: screenY + localY * viewport.zoom,
    };
  }, [viewport, image]);

  /** 检测智能辅助线 */
  const detectSmartGuides = useCallback((offsets: ExpandOffsets, draggingEdge: string): SmartGuide[] => {
    const guides: SmartGuide[] = [];
    const edges = ['top', 'right', 'bottom', 'left'] as const;
    const edgeValues = {
      top: offsets.top,
      right: offsets.right,
      bottom: offsets.bottom,
      left: offsets.left
    };
    
    const currentValue = edgeValues[draggingEdge as keyof typeof edgeValues];
    
    // 如果当前值为0或太小，不显示辅助线
    if (currentValue < 1) {
      return guides;
    }

    // 检测与其他边的相等关系
    for (const edge of edges) {
      if (edge === draggingEdge) continue;
      
      const otherValue = edgeValues[edge];
      if (otherValue < 1) continue;
      
      const diff = Math.abs(currentValue - otherValue);
      
      if (diff < 1) {
        // 完全相等
        guides.push({
          type: 'equal',
          edges: [draggingEdge, edge],
          distance: currentValue,
          timestamp: Date.now()
        });
      } else if (diff <= SNAP_THRESHOLD) {
        // 接近相等（在磁吸阈值内）
        guides.push({
          type: 'near',
          edges: [draggingEdge, edge],
          distance: otherValue,
          timestamp: Date.now()
        });
      }
    }

    return guides;
  }, []);

  /** 生成扩展后的图片 */
  const generateExpandedImageLocal = useCallback(async (): Promise<string> => {
    // 获取图片的原始尺寸
    const naturalDims = await getImageNaturalDimensions(image.src);
    
    // 计算世界坐标与原始尺寸的比例
    const scaleX = naturalDims.width / image.width;
    const scaleY = naturalDims.height / image.height;
    
    // 将偏移量从世界坐标转换为原始像素坐标
    const naturalOffsets: ExpandOffsets = {
      top: Math.round(expandOffsets.top * scaleY),
      right: Math.round(expandOffsets.right * scaleX),
      bottom: Math.round(expandOffsets.bottom * scaleY),
      left: Math.round(expandOffsets.left * scaleX),
    };
    
    return await generateExpandedImage(image.src, naturalOffsets);
  }, [image, expandOffsets]);

  // ==================== 拖动处理 ====================

  const handleMouseDown = useCallback((e: React.MouseEvent, handleType: ExpandHandleType) => {
    e.stopPropagation();
    setIsDragging(true);
    setDraggingHandleType(handleType);
    setDragStartPoint({ x: e.clientX, y: e.clientY });
    setExpandStartOffsets({ ...expandOffsets });
    setSmartGuides([]);
  }, [expandOffsets]);

  // 拖动处理 effect
  useEffect(() => {
    if (!isDragging || !draggingHandleType) return;

    const handleMouseMove = (e: MouseEvent) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      
      // 计算相对于容器的坐标
      const startContainerX = (dragStartPoint.x - containerRect.left - viewport.x) / viewport.zoom;
      const startContainerY = (dragStartPoint.y - containerRect.top - viewport.y) / viewport.zoom;
      const currentContainerX = (e.clientX - containerRect.left - viewport.x) / viewport.zoom;
      const currentContainerY = (e.clientY - containerRect.top - viewport.y) / viewport.zoom;
      
      // 转换为相对于图片左上角的局部坐标
      const startLocalX = startContainerX - image.x;
      const startLocalY = startContainerY - image.y;
      const currentLocalX = currentContainerX - image.x;
      const currentLocalY = currentContainerY - image.y;
      
      const deltaX = currentLocalX - startLocalX;
      const deltaY = currentLocalY - startLocalY;

      const newOffsets = { ...expandStartOffsets };
      const isCtrlPressed = e.ctrlKey || e.metaKey || ctrlKeyRef.current;

      // 根据控制点类型更新偏移量
      switch (draggingHandleType) {
        case 'top-left': {
          const delta = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          const sign = (deltaX < 0 && deltaY < 0) ? 1 : (deltaX > 0 && deltaY > 0) ? -1 : 0;
          if (sign !== 0) {
            if (isCtrlPressed) {
              // 对角对称扩展
              const expandDelta = sign * delta;
              newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
            } else {
              // 局部对称扩展
              newOffsets.top = Math.max(0, expandStartOffsets.top + sign * delta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + sign * delta);
            }
          }
          break;
        }
        case 'top-right': {
          const delta = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          const sign = (deltaX > 0 && deltaY < 0) ? 1 : (deltaX < 0 && deltaY > 0) ? -1 : 0;
          if (sign !== 0) {
            if (isCtrlPressed) {
              const expandDelta = sign * delta;
              newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
            } else {
              newOffsets.top = Math.max(0, expandStartOffsets.top + sign * delta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + sign * delta);
            }
          }
          break;
        }
        case 'bottom-left': {
          const delta = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          const sign = (deltaX < 0 && deltaY > 0) ? 1 : (deltaX > 0 && deltaY < 0) ? -1 : 0;
          if (sign !== 0) {
            if (isCtrlPressed) {
              const expandDelta = sign * delta;
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
              newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
            } else {
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + sign * delta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + sign * delta);
            }
          }
          break;
        }
        case 'bottom-right': {
          const delta = Math.min(Math.abs(deltaX), Math.abs(deltaY));
          const sign = (deltaX > 0 && deltaY > 0) ? 1 : (deltaX < 0 && deltaY < 0) ? -1 : 0;
          if (sign !== 0) {
            if (isCtrlPressed) {
              const expandDelta = sign * delta;
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
              newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
              newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
            } else {
              newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + sign * delta);
              newOffsets.right = Math.max(0, expandStartOffsets.right + sign * delta);
            }
          }
          break;
        }
        case 'top':
          if (isCtrlPressed) {
            const expandDelta = -deltaY;
            newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
            newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
          } else {
            newOffsets.top = Math.max(0, expandStartOffsets.top - deltaY);
          }
          break;
        case 'right':
          if (isCtrlPressed) {
            const expandDelta = deltaX;
            newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
            newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
          } else {
            newOffsets.right = Math.max(0, expandStartOffsets.right + deltaX);
          }
          break;
        case 'bottom':
          if (isCtrlPressed) {
            const expandDelta = deltaY;
            newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + expandDelta);
            newOffsets.top = Math.max(0, expandStartOffsets.top + expandDelta);
          } else {
            newOffsets.bottom = Math.max(0, expandStartOffsets.bottom + deltaY);
          }
          break;
        case 'left':
          if (isCtrlPressed) {
            const expandDelta = -deltaX;
            newOffsets.left = Math.max(0, expandStartOffsets.left + expandDelta);
            newOffsets.right = Math.max(0, expandStartOffsets.right + expandDelta);
          } else {
            newOffsets.left = Math.max(0, expandStartOffsets.left - deltaX);
          }
          break;
      }

      // 智能辅助线检测和磁吸
      const detectedGuides: SmartGuide[] = [];
      
      if (['top-left', 'top-right', 'top', 'bottom-left', 'bottom-right', 'bottom'].includes(draggingHandleType)) {
        if (['top-left', 'top-right', 'top'].includes(draggingHandleType)) {
          detectedGuides.push(...detectSmartGuides(newOffsets, 'top'));
        }
        if (['bottom-left', 'bottom-right', 'bottom'].includes(draggingHandleType)) {
          detectedGuides.push(...detectSmartGuides(newOffsets, 'bottom'));
        }
      }
      
      if (['top-left', 'bottom-left', 'left', 'top-right', 'bottom-right', 'right'].includes(draggingHandleType)) {
        if (['top-left', 'bottom-left', 'left'].includes(draggingHandleType)) {
          detectedGuides.push(...detectSmartGuides(newOffsets, 'left'));
        }
        if (['top-right', 'bottom-right', 'right'].includes(draggingHandleType)) {
          detectedGuides.push(...detectSmartGuides(newOffsets, 'right'));
        }
      }

      // 应用磁吸效果
      for (const guide of detectedGuides) {
        if (guide.type === 'near') {
          const [edge1, edge2] = guide.edges;
          const targetEdge = edge1 === draggingHandleType || 
            (draggingHandleType.includes(edge1)) ? edge1 : edge2;
          
          if (targetEdge === 'top') newOffsets.top = guide.distance;
          else if (targetEdge === 'right') newOffsets.right = guide.distance;
          else if (targetEdge === 'bottom') newOffsets.bottom = guide.distance;
          else if (targetEdge === 'left') newOffsets.left = guide.distance;
        }
      }

      // 去重并更新辅助线
      const uniqueGuides = detectedGuides.filter((guide, index, self) => {
        const guideKey = guide.edges.sort().join('-');
        return index === self.findIndex(g => g.edges.sort().join('-') === guideKey);
      }).map(guide => ({ ...guide, timestamp: Date.now() }));
      
      setSmartGuides(uniqueGuides);
      setExpandOffsets(newOffsets);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDraggingHandleType(null);
      // 延迟清除辅助线
      setTimeout(() => setSmartGuides([]), GUIDE_FADE_DELAY);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, draggingHandleType, dragStartPoint, expandStartOffsets, viewport, image, containerRef, detectSmartGuides]);

  // ==================== 键盘事件 ====================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  // ==================== 事件处理 ====================

  const handleGenerate = async () => {
    if (isGenerating) return;
    
    setIsGenerating(true);
    try {
      const expandedBase64 = await generateExpandedImageLocal();
      onGenerate(expandedBase64);
    } catch (error) {
      console.error('生成扩展图片失败:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  // ==================== 渲染辅助 ====================

  const screenX = viewport.x + image.x * viewport.zoom;
  const screenY = viewport.y + image.y * viewport.zoom;
  const screenWidth = image.width * viewport.zoom;
  const screenHeight = image.height * viewport.zoom;

  // 控制点配置
  const handleConfigs: Array<{
    type: ExpandHandleType;
    position: Point;
    cursor: string;
  }> = [
    // 四角
    { type: 'top-left', position: getHandlePosition(-expandOffsets.left, -expandOffsets.top), cursor: 'nw-resize' },
    { type: 'top-right', position: getHandlePosition(image.width + expandOffsets.right, -expandOffsets.top), cursor: 'ne-resize' },
    { type: 'bottom-left', position: getHandlePosition(-expandOffsets.left, image.height + expandOffsets.bottom), cursor: 'sw-resize' },
    { type: 'bottom-right', position: getHandlePosition(image.width + expandOffsets.right, image.height + expandOffsets.bottom), cursor: 'se-resize' },
    // 四边
    { type: 'top', position: getHandlePosition(image.width / 2, -expandOffsets.top), cursor: 'n-resize' },
    { type: 'right', position: getHandlePosition(image.width + expandOffsets.right, image.height / 2), cursor: 'e-resize' },
    { type: 'bottom', position: getHandlePosition(image.width / 2, image.height + expandOffsets.bottom), cursor: 's-resize' },
    { type: 'left', position: getHandlePosition(-expandOffsets.left, image.height / 2), cursor: 'w-resize' },
  ];

  // 计算扩展后的边界
  const expandedLeft = screenX - expandOffsets.left * viewport.zoom;
  const expandedTop = screenY - expandOffsets.top * viewport.zoom;
  const expandedRight = screenX + screenWidth + expandOffsets.right * viewport.zoom;
  const expandedBottom = screenY + screenHeight + expandOffsets.bottom * viewport.zoom;

  // 计算容器尺寸
  const containerRect = containerRef.current?.getBoundingClientRect();
  const canvasWidth = containerRect ? containerRect.width : window.innerWidth;
  const canvasHeight = containerRect ? containerRect.height : window.innerHeight;

  // 检查是否有扩展
  const hasExpansion = expandOffsets.top > 0 || expandOffsets.right > 0 || 
                       expandOffsets.bottom > 0 || expandOffsets.left > 0;

  // 在拖动时停止拖动的处理函数
  const stopDragging = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      setDraggingHandleType(null);
      setTimeout(() => setSmartGuides([]), GUIDE_FADE_DELAY);
    }
  }, [isDragging]);

  return (
    <>
      {/* 拖动时的全屏透明遮罩层 - 确保所有鼠标事件都能被正确捕获 */}
      {isDragging && (
        <div
          className="fixed inset-0 z-[99]"
          style={{ 
            cursor: handleConfigs.find(h => h.type === draggingHandleType)?.cursor || 'default'
          }}
          onMouseUp={stopDragging}
        />
      )}

      {/* 扩展区域背景（白色虚线框） */}
      <div
        className="absolute bg-white/80 border-2 border-dashed border-blue-400 pointer-events-none"
        style={{
          left: expandedLeft,
          top: expandedTop,
          width: (image.width + expandOffsets.left + expandOffsets.right) * viewport.zoom,
          height: (image.height + expandOffsets.top + expandOffsets.bottom) * viewport.zoom,
          zIndex: 10,
        }}
      />

      {/* 控制点 */}
      {handleConfigs.map(({ type, position, cursor }) => (
        <div
          key={type}
          className="absolute w-5 h-5 bg-white border-2 border-blue-500 rounded-full z-[100] hover:scale-125 transition-transform pointer-events-auto shadow-lg"
          style={{
            left: position.x - 10,
            top: position.y - 10,
            cursor: cursor,
          }}
          onMouseDown={(e) => handleMouseDown(e, type)}
        />
      ))}

      {/* 智能辅助线 */}
      {smartGuides.map((guide, index) => {
        const edges = guide.edges.sort();
        const edgeKey = edges.join('-');
        
        if (edgeKey === 'bottom-top') {
          return (
            <React.Fragment key={`guide-${index}`}>
              <div
                className="absolute pointer-events-none"
                style={{
                  left: 0,
                  top: expandedTop,
                  width: canvasWidth,
                  height: 1,
                  backgroundColor: '#FF0000',
                  zIndex: 100,
                }}
              />
              <div
                className="absolute pointer-events-none"
                style={{
                  left: 0,
                  top: expandedBottom,
                  width: canvasWidth,
                  height: 1,
                  backgroundColor: '#FF0000',
                  zIndex: 100,
                }}
              />
            </React.Fragment>
          );
        } else if (edgeKey === 'left-right') {
          return (
            <React.Fragment key={`guide-${index}`}>
              <div
                className="absolute pointer-events-none"
                style={{
                  left: expandedLeft,
                  top: 0,
                  width: 1,
                  height: canvasHeight,
                  backgroundColor: '#FF0000',
                  zIndex: 100,
                }}
              />
              <div
                className="absolute pointer-events-none"
                style={{
                  left: expandedRight,
                  top: 0,
                  width: 1,
                  height: canvasHeight,
                  backgroundColor: '#FF0000',
                  zIndex: 100,
                }}
              />
            </React.Fragment>
          );
        }
        return null;
      })}

      {/* 尺寸信息显示 */}
      {hasExpansion && (
        <div
          className="absolute bg-slate-900/90 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap z-50"
          style={{
            left: expandedLeft + (expandedRight - expandedLeft) / 2,
            top: expandedTop - 28,
            transform: 'translateX(-50%)',
          }}
        >
          {Math.round(image.width + expandOffsets.left + expandOffsets.right)} × {Math.round(image.height + expandOffsets.top + expandOffsets.bottom)}
          <span className="text-slate-400 ml-1">
            (+{Math.round(expandOffsets.left)}, +{Math.round(expandOffsets.top)}, +{Math.round(expandOffsets.right)}, +{Math.round(expandOffsets.bottom)})
          </span>
        </div>
      )}

      {/* 操作按钮 */}
      <div
        className="absolute flex gap-2 bg-slate-800/90 backdrop-blur rounded-lg p-1.5 shadow-xl border border-slate-700 pointer-events-auto z-50 items-center"
        style={{
          left: screenX + screenWidth / 2 + (expandOffsets.right - expandOffsets.left) * viewport.zoom / 2,
          top: screenY + screenHeight / 2 + (expandOffsets.bottom - expandOffsets.top) * viewport.zoom / 2,
          transform: 'translate(-50%, -50%)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={() => {
          // 确保在按钮区域释放鼠标时也能清除拖动状态
          if (isDragging) {
            setIsDragging(false);
            setDraggingHandleType(null);
            setTimeout(() => setSmartGuides([]), GUIDE_FADE_DELAY);
          }
        }}
      >
        {/* 取消按钮 */}
        <button
          onClick={onCancel}
          className="p-1.5 hover:bg-slate-600 rounded text-slate-300 hover:text-white transition-colors"
          title="取消 (ESC)"
        >
          <X size={14} />
        </button>
        
        {/* 分隔线 */}
        <div className="w-px bg-slate-600 h-4" />
        
        {/* 生成按钮 */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !hasExpansion}
          className={`px-3 py-1.5 rounded text-white text-xs font-medium transition-colors flex items-center gap-1.5 ${
            isGenerating || !hasExpansion
              ? 'bg-slate-600 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500'
          }`}
          title="按照新尺寸生成"
        >
          <Maximize2 size={14} />
          <span>{isGenerating ? '生成中...' : '按照新尺寸生成'}</span>
        </button>
      </div>
    </>
  );
};

export default ExpandMode;

// 导出白色背景组件，供 Canvas 在图片容器内使用
export const ExpandModeBackground: React.FC<{
  offsets: ExpandOffsets;
  imageWidth: number;
  imageHeight: number;
}> = ({ offsets, imageWidth, imageHeight }) => (
  <div
    className="absolute bg-white/80 border-2 border-dashed border-blue-400 pointer-events-none"
    style={{
      left: -offsets.left,
      top: -offsets.top,
      width: imageWidth + offsets.left + offsets.right,
      height: imageHeight + offsets.top + offsets.bottom,
      zIndex: 0,
    }}
  />
);

