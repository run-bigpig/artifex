import React, { useState, useEffect } from 'react';
import { Cog, X, Minimize2, Maximize2, Minimize, Minus } from 'lucide-react';
import { WindowMinimise, WindowFullscreen, WindowUnfullscreen, WindowIsFullscreen, Quit } from '../wailsjs/runtime/runtime';
import SettingsComponent from './Settings';

interface HeaderProps {
  onOpenAppSettings?: () => void;
  onClose?: () => Promise<void>;
}

const Header: React.FC<HeaderProps> = ({ onOpenAppSettings, onClose }) => {
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // 检查全屏状态
  useEffect(() => {
    const checkFullscreen = async () => {
      const fullscreen = await WindowIsFullscreen();
      setIsFullscreen(fullscreen);
    };
    checkFullscreen();
    // 定期检查全屏状态（可以监听窗口事件，但这里简化处理）
    const interval = setInterval(checkFullscreen, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleMinimize = () => {
    WindowMinimise();
  };

  const handleFullscreen = async () => {
    if (isFullscreen) {
      WindowUnfullscreen();
    } else {
      WindowFullscreen();
    }
    // 更新状态
    setTimeout(async () => {
      const fullscreen = await WindowIsFullscreen();
      setIsFullscreen(fullscreen);
    }, 100);
  };

  const handleClose = () => {
    if (isClosing) return; // 防止重复点击
    
    setIsClosing(true);
    
    // 调用自定义关闭处理函数（会显示保存进度并在后台完成保存和关闭）
    // 注意：onClose 现在会立即返回，保存和关闭在后台异步执行
    if (onClose) {
      onClose();
    } else {
      // 如果没有自定义处理函数，直接关闭
      Quit();
    }
    
    // 注意：这里不再设置 setIsClosing(false)，因为应用即将关闭
  };

  const handleSettings = () => {
    setShowAppSettings(true);
    if (onOpenAppSettings) {
      onOpenAppSettings();
    }
  };

  return (
    <>
      <div 
        className="h-16 px-6 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md flex justify-between items-center shrink-0 z-20 fixed top-0 left-0 right-0"
        style={{ "--wails-draggable": "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2.5 text-slate-100 font-bold text-lg tracking-tight">
          <div className="p-1.5 bg-blue-500/10 rounded-lg">
            <img src="/logo.png" alt="Logo" className="w-[18px] h-[18px]" />
          </div>
          <span>ArtifexBot</span>
        </div>
        
        <div className="flex items-center gap-2">
          {onOpenAppSettings && (
            <button 
              onClick={handleSettings}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
              title="应用设置"
              style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
            >
              <Cog size={20} />
            </button>
          )}
          
          {/* 窗口控制按钮：最小化、全屏、关闭 */}
          <div className="flex items-center gap-1 ml-2">
            <button 
              onClick={handleMinimize}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
              title="最小化"
              style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
            >
              <Minus size={18} />
            </button>
            <button 
              onClick={handleFullscreen}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
              title={isFullscreen ? "退出全屏" : "全屏"}
              style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize2 size={16} />}
            </button>
            <button 
              onClick={handleClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-red-500/20 hover:text-red-400 rounded-full transition-colors"
              title="关闭应用"
              style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* App Settings Modal */}
      <SettingsComponent isOpen={showAppSettings} onClose={() => setShowAppSettings(false)} />
    </>
  );
};

export default Header;

