import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingOverlayProps {
  isLoading: boolean;
  progress?: {
    chatLoaded: boolean;
    canvasLoaded: boolean;
  };
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isLoading, progress }) => {
  const [isVisible, setIsVisible] = useState(isLoading);
  const [shouldRender, setShouldRender] = useState(isLoading);

  // 控制显示和隐藏动画
  useEffect(() => {
    if (isLoading) {
      setShouldRender(true);
      // 短暂延迟后显示，确保 DOM 已渲染
      const rafId = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(rafId);
    } else {
      setIsVisible(false);
      // 等待动画完成后移除 DOM
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  if (!shouldRender) return null;

  const totalSteps = 2;
  const completedSteps = (progress?.chatLoaded ? 1 : 0) + (progress?.canvasLoaded ? 1 : 0);
  const progressPercent = (completedSteps / totalSteps) * 100;

  return (
    <div 
      className={`fixed inset-0 bg-slate-950/95 backdrop-blur-sm z-[9999] flex items-center justify-center transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ 
        pointerEvents: 'all',
        userSelect: 'none',
        zIndex: 9999
      }}
    >
      <div className="flex flex-col items-center gap-6">
        {/* Logo or App Name */}
        <div className="text-2xl font-bold text-slate-200 mb-2 animate-pulse">
          ArtifexBot
        </div>

        {/* Loading Spinner */}
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />

        {/* Loading Text */}
        <div className="text-slate-300 text-lg font-medium">
          启动中...
        </div>

        {/* Progress Steps */}
        <div className="w-64 space-y-2">
          {/* Progress Bar */}
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500 ease-out rounded-full shadow-lg shadow-blue-500/50"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Progress Steps Text */}
          <div className="flex justify-between text-sm">
            <span 
              className={`transition-all duration-300 ${
                progress?.canvasLoaded 
                  ? 'text-green-400 font-medium scale-105' 
                  : 'text-slate-400'
              }`}
            >
              {progress?.canvasLoaded ? '✓' : '○'} 画布历史
            </span>
            <span 
              className={`transition-all duration-300 ${
                progress?.chatLoaded 
                  ? 'text-green-400 font-medium scale-105' 
                  : 'text-slate-400'
              }`}
            >
              {progress?.chatLoaded ? '✓' : '○'} 对话历史
            </span>
          </div>
        </div>

        {/* Loading Tips */}
        <div className="text-slate-500 text-sm mt-4 text-center max-w-md transition-opacity duration-300">
          {completedSteps === 0 && '正在加载历史记录...'}
          {completedSteps === 1 && '正在加载剩余数据...'}
          {completedSteps === 2 && '即将完成...'}
        </div>
      </div>
    </div>
  );
};

export default LoadingOverlay;

