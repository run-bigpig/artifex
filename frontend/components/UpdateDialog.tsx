import React, { useState, useEffect } from 'react';
import { X, Download, RefreshCw, CheckCircle2, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { checkForUpdate, updateWithProgress, getCurrentVersion, restartApplication, UpdateInfo, UpdateProgress } from '../services/updateService';

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const UpdateDialog: React.FC<UpdateDialogProps> = ({ isOpen, onClose }) => {
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 加载当前版本
  useEffect(() => {
    if (isOpen) {
      loadCurrentVersion();
    }
  }, [isOpen]);

  const loadCurrentVersion = async () => {
    try {
      const version = await getCurrentVersion();
      setCurrentVersion(version);
    } catch (err) {
      console.error('获取版本号失败:', err);
    }
  };

  // 检查更新
  const handleCheckUpdate = async () => {
    setChecking(true);
    setError(null);
    setUpdateInfo(null);
    
    try {
      const info = await checkForUpdate();
      setUpdateInfo(info);
      
      if (info.error) {
        setError(info.error);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '检查更新失败';
      setError(errorMessage);
    } finally {
      setChecking(false);
    }
  };

  // 执行更新
  const handleUpdate = async () => {
    if (!updateInfo?.hasUpdate) return;

    setUpdating(true);
    setError(null);
    setProgress({
      status: 'checking',
      message: '正在准备更新...',
      percent: 0,
    });

    try {
      const finalProgress = await updateWithProgress((progress) => {
        setProgress(progress);
      });

      if (finalProgress.status === 'completed') {
        // 更新完成，自动重启应用
        setTimeout(() => {
          handleRestart();
        }, 2000);
      } else if (finalProgress.status === 'error') {
        setError(finalProgress.message);
        setUpdating(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '更新失败';
      setError(errorMessage);
      setUpdating(false);
      setProgress(null);
    }
  };

  // 重启应用（自动重启）
  const handleRestart = async () => {
    try {
      // 调用后端重启方法，会自动启动新进程并退出当前进程
      await restartApplication();
      // 如果重启成功，这里不会执行（进程已退出）
      // 如果失败，会抛出错误
    } catch (err) {
      console.error('重启失败:', err);
      const errorMessage = err instanceof Error ? err.message : '重启失败';
      setError(`更新完成，但自动重启失败: ${errorMessage}。请手动关闭并重新打开应用`);
      setUpdating(false);
    }
  };

  // 打开发布页面
  const handleOpenRelease = () => {
    if (updateInfo?.releaseUrl) {
      window.open(updateInfo.releaseUrl, '_blank');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-2xl font-bold text-slate-200">检查更新</h2>
          <button
            onClick={onClose}
            disabled={updating}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* 当前版本 */}
            {currentVersion && (
              <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
                <span className="text-slate-300">当前版本</span>
                <span className="text-slate-200 font-mono font-semibold">{currentVersion}</span>
              </div>
            )}

            {/* 检查更新按钮 */}
            {!updateInfo && !checking && (
              <div className="flex flex-col items-center gap-4 py-8">
                <RefreshCw className="w-12 h-12 text-blue-500" />
                <p className="text-slate-400 text-center">
                  点击下方按钮检查是否有可用更新
                </p>
                <button
                  onClick={handleCheckUpdate}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2"
                >
                  <RefreshCw size={18} />
                  检查更新
                </button>
              </div>
            )}

            {/* 检查中 */}
            {checking && (
              <div className="flex flex-col items-center gap-4 py-8">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                <p className="text-slate-400">正在检查更新...</p>
              </div>
            )}

            {/* 更新信息 */}
            {updateInfo && !updating && (
              <div className="space-y-4">
                {updateInfo.hasUpdate ? (
                  <>
                    <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                      <CheckCircle2 className="w-6 h-6 text-blue-500 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-blue-400 font-semibold">发现新版本！</p>
                        <p className="text-slate-300 text-sm mt-1">
                          最新版本: <span className="font-mono font-semibold">{updateInfo.latestVersion}</span>
                        </p>
                      </div>
                    </div>

                    {updateInfo.releaseNotes && (
                      <div className="p-4 bg-slate-800/50 rounded-lg">
                        <h3 className="text-slate-200 font-semibold mb-2">更新说明</h3>
                        <div className="text-slate-400 text-sm whitespace-pre-wrap">
                          {updateInfo.releaseNotes}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button
                        onClick={handleUpdate}
                        className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors flex items-center justify-center gap-2"
                      >
                        <Download size={18} />
                        立即更新
                      </button>
                      {updateInfo.releaseUrl && (
                        <button
                          onClick={handleOpenRelease}
                          className="px-6 py-3 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors flex items-center gap-2"
                        >
                          <ExternalLink size={18} />
                          查看详情
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-4 py-8">
                    <CheckCircle2 className="w-12 h-12 text-green-500" />
                    <p className="text-slate-300 font-semibold">已是最新版本</p>
                    <p className="text-slate-400 text-sm">
                      当前版本: <span className="font-mono">{updateInfo.currentVersion}</span>
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 更新进度 */}
            {updating && progress && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                  <div className="flex-1">
                    <p className="text-slate-200 font-semibold">{progress.message}</p>
                    <div className="mt-2 w-full bg-slate-800 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                    <p className="text-slate-400 text-sm mt-1">{progress.percent}%</p>
                  </div>
                </div>

                {progress.status === 'completed' && (
                  <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-green-400 font-semibold">更新完成！</p>
                      <p className="text-slate-300 text-sm mt-1">
                        应用将在几秒后自动重启...
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 错误信息 */}
            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-red-400 font-semibold">错误</p>
                  <p className="text-slate-300 text-sm mt-1">{error}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-800">
          {!updating && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors"
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateDialog;

