import React from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

interface SaveProgressOverlayProps {
  isVisible: boolean;
  progress: {
    chatSaved: boolean;
    canvasSaved: boolean;
  };
}

const SaveProgressOverlay: React.FC<SaveProgressOverlayProps> = ({ isVisible, progress }) => {
  if (!isVisible) return null;

  const totalSteps = 2;
  const completedSteps = (progress.chatSaved ? 1 : 0) + (progress.canvasSaved ? 1 : 0);
  const progressPercent = (completedSteps / totalSteps) * 100;
  const isComplete = completedSteps === totalSteps;

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
        {/* App Name */}
        <div className="text-2xl font-bold text-slate-200 mb-2">
          ArtifexBot
        </div>

        {/* Icon */}
        {isComplete ? (
          <CheckCircle2 className="w-12 h-12 text-green-500" />
        ) : (
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
        )}

        {/* Status Text */}
        <div className={`text-lg font-medium ${isComplete ? 'text-green-400' : 'text-slate-300'}`}>
          {isComplete ? '保存完成' : '正在保存...'}
        </div>

        {/* Progress Steps */}
        <div className="w-64 space-y-2">
          {/* Progress Bar */}
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ease-out rounded-full shadow-lg ${
                isComplete 
                  ? 'bg-gradient-to-r from-green-500 to-green-400 shadow-green-500/50' 
                  : 'bg-gradient-to-r from-blue-500 to-blue-400 shadow-blue-500/50'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Progress Steps Text */}
          <div className="flex justify-between text-sm">
            <span 
              className={`transition-all duration-300 ${
                progress.chatSaved 
                  ? 'text-green-400 font-medium scale-105' 
                  : 'text-slate-400'
              }`}
            >
              {progress.chatSaved ? '✓' : '○'} 对话历史
            </span>
            <span 
              className={`transition-all duration-300 ${
                progress.canvasSaved 
                  ? 'text-green-400 font-medium scale-105' 
                  : 'text-slate-400'
              }`}
            >
              {progress.canvasSaved ? '✓' : '○'} 画布历史
            </span>
          </div>
        </div>

        {/* Status Tips */}
        <div className="text-slate-500 text-sm mt-4 text-center max-w-md transition-opacity duration-300">
          {completedSteps === 0 && '正在保存历史记录...'}
          {completedSteps === 1 && '正在保存剩余数据...'}
          {completedSteps === 2 && '保存完成，正在关闭应用...'}
        </div>
      </div>
    </div>
  );
};

export default SaveProgressOverlay;

