import React, { useState, useEffect } from 'react';
import { Settings as SettingsType, AISettings } from '../types/settings';
import { loadSettings, saveSettings } from '../services/settingsService';
import { X, Save, Loader2, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 加载设置
  useEffect(() => {
    if (isOpen && !settings) {
      loadSettingsData();
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
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-slate-900 rounded-xl p-8 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-slate-400">加载设置中...</p>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;

