import React, { useState, useEffect } from 'react';
import { Settings as SettingsType, AISettings } from '../types/settings';
import { loadSettings, saveSettings } from '../services/settingsService';
import { X, Save, Loader2, Eye, EyeOff, CheckCircle2, AlertCircle, RefreshCw, Info, Download, ExternalLink } from 'lucide-react';
import { getCurrentVersion, checkForUpdate, updateWithProgress, restartApplication, UpdateInfo, UpdateProgress } from '../services/updateService';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'ai' | 'about';

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('ai');
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // 加载设置和版本信息
  useEffect(() => {
    if (isOpen) {
      if (!settings) {
        loadSettingsData();
      }
      loadVersionInfo();
    } else {
      // 关闭弹窗时重置更新相关状态
      setUpdateInfo(null);
      setCheckingUpdate(false);
      setUpdating(false);
      setUpdateProgress(null);
      setUpdateError(null);
    }
  }, [isOpen]);

  const loadSettingsData = async () => {
    setLoading(true);
    try {
      const loadedSettings = await loadSettings();
      setSettings(loadedSettings);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setMessage({ type: 'error', text: '加载设置失败' });
    } finally {
      setLoading(false);
    }
  };

  const loadVersionInfo = async () => {
    try {
      const version = await getCurrentVersion();
      setCurrentVersion(version);
    } catch (error) {
      console.error('Failed to load version:', error);
    }
  };

  // 检查更新
  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    setUpdateInfo(null);
    
    try {
      const info = await checkForUpdate();
      setUpdateInfo(info);
      
      if (info.error) {
        setUpdateError(info.error);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '检查更新失败';
      setUpdateError(errorMessage);
    } finally {
      setCheckingUpdate(false);
    }
  };

  // 执行更新
  const handleUpdate = async () => {
    if (!updateInfo?.hasUpdate) return;

    setUpdating(true);
    setUpdateError(null);
    setUpdateProgress({
      status: 'checking',
      message: '正在准备更新...',
      percent: 0,
    });

    try {
      const finalProgress = await updateWithProgress((progress) => {
        setUpdateProgress(progress);
      });

      if (finalProgress.status === 'completed') {
        // 更新完成，自动重启应用
        setTimeout(() => {
          handleRestart();
        }, 2000);
      } else if (finalProgress.status === 'error') {
        setUpdateError(finalProgress.message);
        setUpdating(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '更新失败';
      setUpdateError(errorMessage);
      setUpdating(false);
      setUpdateProgress(null);
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
      setUpdateError(`更新完成，但自动重启失败: ${errorMessage}。请手动关闭并重新打开应用`);
      setUpdating(false);
    }
  };

  // 打开发布页面
  const handleOpenRelease = () => {
    if (updateInfo?.releaseUrl) {
      window.open(updateInfo.releaseUrl, '_blank');
    }
  };

  // 保存设置
  const handleSave = async () => {
    if (!settings) return;

    setSaving(true);
    setMessage(null);
    try {
      await saveSettings(settings);
      setMessage({ type: 'success', text: '设置已保存' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setMessage({ type: 'error', text: '保存设置失败' });
    } finally {
      setSaving(false);
    }
  };

  // 更新 AI 设置
  const updateAISettings = (updates: Partial<AISettings>) => {
    if (!settings) return;
    setSettings({
      ...settings,
      ai: { ...settings.ai, ...updates },
    });
  };


  // 切换 API Key 显示
  const toggleApiKeyVisibility = (key: string) => {
    setShowApiKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!isOpen) return null;

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/20 backdrop-blur-md z-[100] flex items-center justify-center">
        <div className="bg-slate-900 rounded-xl p-8 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-slate-400">加载设置中...</p>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-md z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-slate-900 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl relative z-[101]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-2xl font-bold text-slate-200">设置</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 px-6">
          <button
            onClick={() => setActiveTab('ai')}
            className={`px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
              activeTab === 'ai'
                ? 'text-blue-400 border-blue-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            AI 配置
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
              activeTab === 'about'
                ? 'text-blue-400 border-blue-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            关于
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'ai' && (
            <div className="space-y-6">
            {/* Provider Selection */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">AI 提供商</label>
                <select
                  value={settings.ai.provider}
                  onChange={(e) => updateAISettings({ provider: e.target.value as any })}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="cloud">Cloud 云服务</option>
                </select>
            </div>

            {/* Gemini Settings */}
            {settings.ai.provider === 'gemini' && (
                <div className="space-y-4 p-4 bg-slate-800/50 rounded-lg">
                  <h3 className="text-lg font-semibold text-slate-200">Gemini 配置</h3>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">API Key</label>
                    <div className="relative">
                      <input
                        type={showApiKeys['gemini'] ? 'text' : 'password'}
                        value={settings.ai.apiKey}
                        onChange={(e) => updateAISettings({ apiKey: e.target.value })}
                        className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                        placeholder="输入 Gemini API Key"
                      />
                      <button
                        type="button"
                        onClick={() => toggleApiKeyVisibility('gemini')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                      >
                        {showApiKeys['gemini'] ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">文本模型</label>
                    <input
                      type="text"
                      value={settings.ai.textModel}
                      onChange={(e) => updateAISettings({ textModel: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="gemini-2.5-flash"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">图像模型</label>
                    <input
                      type="text"
                      value={settings.ai.imageModel}
                      onChange={(e) => updateAISettings({ imageModel: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="gemini-2.5-flash-preview-05-20"
                    />
                  </div>

                  {/* Vertex AI */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                      <input
                        type="checkbox"
                        checked={settings.ai.useVertexAI}
                        onChange={(e) => updateAISettings({ useVertexAI: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
                      />
                      使用 Vertex AI
                    </label>
                  </div>

                  {settings.ai.useVertexAI && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">GCP 项目 ID</label>
                        <input
                          type="text"
                          value={settings.ai.vertexProject}
                          onChange={(e) => updateAISettings({ vertexProject: e.target.value })}
                          className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="your-project-id"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">GCP 区域</label>
                        <input
                          type="text"
                          value={settings.ai.vertexLocation}
                          onChange={(e) => updateAISettings({ vertexLocation: e.target.value })}
                          className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="us-central1"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">GCP 服务账号 JSON</label>
                        <textarea
                          value={settings.ai.vertexCredentials}
                          onChange={(e) => updateAISettings({ vertexCredentials: e.target.value })}
                          className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 h-32 font-mono text-xs"
                          placeholder="粘贴 GCP 服务账号 JSON"
                        />
                      </div>
                    </>
                  )}
                </div>
            )}

            {/* OpenAI Settings */}
            {settings.ai.provider === 'openai' && (
                <div className="space-y-4 p-4 bg-slate-800/50 rounded-lg">
                  <h3 className="text-lg font-semibold text-slate-200">OpenAI 配置</h3>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">API Key</label>
                    <div className="relative">
                      <input
                        type={showApiKeys['openai'] ? 'text' : 'password'}
                        value={settings.ai.openaiApiKey}
                        onChange={(e) => updateAISettings({ openaiApiKey: e.target.value })}
                        className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                        placeholder="输入 OpenAI API Key"
                      />
                      <button
                        type="button"
                        onClick={() => toggleApiKeyVisibility('openai')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                      >
                        {showApiKeys['openai'] ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">图像 API Key（可选）</label>
                    <div className="relative">
                      <input
                        type={showApiKeys['openaiImage'] ? 'text' : 'password'}
                        value={settings.ai.openaiImageApiKey}
                        onChange={(e) => updateAISettings({ openaiImageApiKey: e.target.value })}
                        className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                        placeholder="输入 OpenAI 图像 API Key（可选）"
                      />
                      <button
                        type="button"
                        onClick={() => toggleApiKeyVisibility('openaiImage')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                      >
                        {showApiKeys['openaiImage'] ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Base URL</label>
                    <input
                      type="text"
                      value={settings.ai.openaiBaseUrl}
                      onChange={(e) => updateAISettings({ openaiBaseUrl: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">图像 Base URL（可选）</label>
                    <input
                      type="text"
                      value={settings.ai.openaiImageBaseUrl}
                      onChange={(e) => updateAISettings({ openaiImageBaseUrl: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">文本模型</label>
                    <input
                      type="text"
                      value={settings.ai.openaiTextModel}
                      onChange={(e) => updateAISettings({ openaiTextModel: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="gpt-4o"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">图像模型</label>
                    <input
                      type="text"
                      value={settings.ai.openaiImageModel}
                      onChange={(e) => updateAISettings({ openaiImageModel: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="dall-e-3"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">图像模式</label>
                    <select
                      value={settings.ai.openaiImageMode}
                      onChange={(e) => updateAISettings({ openaiImageMode: e.target.value as any })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="auto">自动判断</option>
                      <option value="image_api">Image API</option>
                      <option value="chat">Chat Completion API</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                      <input
                        type="checkbox"
                        checked={settings.ai.openaiTextStream}
                        onChange={(e) => updateAISettings({ openaiTextStream: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
                      />
                      文本模型使用流式请求
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                      <input
                        type="checkbox"
                        checked={settings.ai.openaiImageStream}
                        onChange={(e) => updateAISettings({ openaiImageStream: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
                      />
                      图像模型使用流式请求
                    </label>
                  </div>
                </div>
            )}

            {/* Cloud Settings */}
            {settings.ai.provider === 'cloud' && (
                <div className="space-y-4 p-4 bg-slate-800/50 rounded-lg">
                  <h3 className="text-lg font-semibold text-slate-200">Cloud 云服务配置</h3>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">端点 URL</label>
                    <input
                      type="text"
                      value={settings.ai.cloudEndpointUrl}
                      onChange={(e) => updateAISettings({ cloudEndpointUrl: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="https://api.example.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">认证 Token</label>
                    <div className="relative">
                      <input
                        type={showApiKeys['cloud'] ? 'text' : 'password'}
                        value={settings.ai.cloudToken}
                        onChange={(e) => updateAISettings({ cloudToken: e.target.value })}
                        className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                        placeholder="输入 Cloud Token"
                      />
                      <button
                        type="button"
                        onClick={() => toggleApiKeyVisibility('cloud')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                      >
                        {showApiKeys['cloud'] ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </div>
            )}

            </div>
          )}

          {activeTab === 'about' && (
            <div className="space-y-6">
              {/* 版本信息 */}
              <div className="space-y-4 p-4 bg-slate-800/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Info className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-200">应用信息</h3>
                    <p className="text-slate-400 text-sm">ArtifexBot</p>
                  </div>
                </div>
                
                {currentVersion && (
                  <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <span className="text-slate-300">当前版本</span>
                    <span className="text-slate-200 font-mono font-semibold">{currentVersion}</span>
                  </div>
                )}
              </div>

              {/* 应用更新 */}
              <div className="space-y-4 p-4 bg-slate-800/50 rounded-lg">
                <h3 className="text-lg font-semibold text-slate-200">应用更新</h3>
                
                {/* 检查更新按钮 */}
                {!updateInfo && !checkingUpdate && !updating && (
                  <>
                    <p className="text-slate-400 text-sm">
                      检查并安装最新版本的应用更新
                    </p>
                    <button
                      onClick={handleCheckUpdate}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2"
                    >
                      <RefreshCw size={18} />
                      检查更新
                    </button>
                  </>
                )}

                {/* 检查中 */}
                {checkingUpdate && (
                  <div className="flex flex-col items-center gap-4 py-4">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
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
                          <div className="p-4 bg-slate-900/50 rounded-lg">
                            <h4 className="text-slate-200 font-semibold mb-2">更新说明</h4>
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
                      <div className="flex flex-col items-center gap-4 py-4">
                        <CheckCircle2 className="w-12 h-12 text-green-500" />
                        <p className="text-slate-300 font-semibold">已是最新版本</p>
                        <p className="text-slate-400 text-sm">
                          当前版本: <span className="font-mono">{updateInfo.currentVersion}</span>
                        </p>
                        <button
                          onClick={handleCheckUpdate}
                          className="px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors flex items-center gap-2"
                        >
                          <RefreshCw size={18} />
                          重新检查
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 更新进度 */}
                {updating && updateProgress && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                      <div className="flex-1">
                        <p className="text-slate-200 font-semibold">{updateProgress.message}</p>
                        <div className="mt-2 w-full bg-slate-800 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${updateProgress.percent}%` }}
                          />
                        </div>
                        <p className="text-slate-400 text-sm mt-1">{updateProgress.percent}%</p>
                      </div>
                    </div>

                    {updateProgress.status === 'completed' && (
                      <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                        <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-green-400 font-semibold">更新完成！</p>
                          <p className="text-slate-300 text-sm mt-1">
                            应用将在几秒后自动退出，请重新打开应用以使用新版本。
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 错误信息 */}
                {updateError && (
                  <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-red-400 font-semibold">错误</p>
                      <p className="text-slate-300 text-sm mt-1">{updateError}</p>
                    </div>
                    <button
                      onClick={() => {
                        setUpdateError(null);
                        setUpdateInfo(null);
                      }}
                      className="text-slate-400 hover:text-slate-200"
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-slate-800">
          {message && (
            <div
              className={`flex items-center gap-2 ${
                message.type === 'success' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 size={18} />
              ) : (
                <AlertCircle size={18} />
              )}
              <span className="text-sm">{message.text}</span>
            </div>
          )}
          <div className="ml-auto flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors"
            >
              取消
            </button>
            {activeTab === 'ai' && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    保存
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;

