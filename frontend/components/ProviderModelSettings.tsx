import React, { useState } from "react";
import { Eye, EyeOff, Plus, Trash2, RefreshCw } from "lucide-react";
import {
  ProviderConfig,
  ModelDefinition,
  createProvider,
} from "../types/settings";
import ToggleSwitch from "./ToggleSwitch";
import ThemeSelect from "./ThemeSelect";
import { ListProviderModels } from "../wailsjs/go/core/App";

const inputClass =
  "w-full min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none";
const ProviderModelSettings: React.FC<{
  settings: ProviderConfig;
  onChange: (patch: Partial<ProviderConfig>) => void;
}> = ({ settings, onChange }) => {
  const isGemini = settings.type === "gemini";
  const presets = isGemini
    ? [
        "gemini-3.1-flash-image",
        "gemini-3-pro-image-preview",
        "gemini-2.5-flash-image",
        "gemini-2.5-flash",
      ]
    : ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-6.1-sol"];
  const [showKey, setShowKey] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const models = settings.models || [];
  const update = (index: number, patch: Partial<ModelDefinition>) =>
    onChange({
      models: models.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    });
  const eligible = models.filter((m) => m.enabled && m.modelId);
  const selectModel = (
    label: string,
    field: "imageModel" | "intentModel",
    modality?: string,
  ) => (
    <label className="grid gap-2 text-xs text-slate-400">
      {label}
      <ThemeSelect
        label={label}
        value={settings[field]}
        onChange={(value) => onChange({ [field]: value })}
        options={[
          { value: "", label: "请选择" },
          ...(!eligible.some(
            (m) =>
              m.modelId === settings[field] &&
              (!modality || m.modality === modality),
          ) && settings[field]
            ? [
                {
                  value: settings[field],
                  label: modality === "image" ? "原配置不可用，请选择生图模型" : "原配置不可用，请选择多模态模型",
                  disabled: true,
                },
              ]
            : []),
          ...eligible
            .filter((m) => !modality || m.modality === modality)
            .map((m) => ({ value: m.modelId, label: m.name || m.modelId })),
        ]}
      />
    </label>
  );
  const discover = async () => {
    setDiscovering(true);
    setNotice("正在检测连接并获取模型列表…");
    try {
      const ids = await ListProviderModels(JSON.stringify(settings));
      setDiscovered([...new Set(ids)].sort());
      setNotice(
        `连接成功，发现 ${ids.length} 个模型。输入模型 ID 时可选择；类别由你确认。此检测不会生成图片。`,
      );
    } catch (error) {
      setNotice(`连接检测失败：${String(error)}`);
    } finally {
      setDiscovering(false);
    }
  };
  return (
    <div className="space-y-5 rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-2 text-xs text-slate-400">
          服务商名称
          <input
            aria-label="服务商名称"
            className={inputClass}
            value={settings.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="例如：官方 OpenAI / 备用通道"
          />
        </label>
        <label className="grid gap-2 text-xs text-slate-400">
          服务商类型
          <ThemeSelect
            label="服务商类型"
            value={settings.type}
            title="切换类型会重置此服务商的连接和模型"
            onChange={(value) =>
              onChange(
                createProvider(
                  value as "openai" | "gemini",
                  settings.id,
                  settings.name,
                ),
              )
            }
            options={[
              { value: "openai", label: "OpenAI 兼容" },
              { value: "gemini", label: "Gemini" },
            ]}
          />
        </label>
      </div>
      <label className="grid gap-2 text-xs text-slate-400">
        Base URL
        <input
          className={inputClass}
          value={settings.baseUrl}
          placeholder={
            isGemini
              ? "https://generativelanguage.googleapis.com"
              : "https://api.openai.com/v1"
          }
          onChange={(e) => {
            onChange({ baseUrl: e.target.value });
            setDiscovered([]);
          }}
        />
      </label>
      <label className="grid gap-2 text-xs text-slate-400">
        API Key
        <div className="flex gap-2">
          <input
            className={inputClass}
            type={showKey ? "text" : "password"}
            autoComplete="off"
            value={settings.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
          />
          <button
            type="button"
            aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
            onClick={() => setShowKey(!showKey)}
            className="px-2 text-slate-400"
          >
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </label>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-slate-200">模型列表</span>
          <button
            type="button"
            disabled={discovering}
            onClick={discover}
            className="flex shrink-0 items-center gap-2 text-xs text-blue-300 disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={`shrink-0 ${discovering ? "animate-spin" : ""}`}
            />
            检测连接 / 获取模型
          </button>
        </div>
        <div
          role="status"
          aria-label="连接检测结果"
          aria-live="polite"
          aria-atomic="true"
          aria-busy={discovering}
          tabIndex={0}
          className={`h-16 overflow-y-auto rounded-lg bg-slate-900/40 px-3 py-2 text-xs leading-5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-500 ${notice ? "text-slate-300" : "text-slate-500"}`}
          style={{ scrollbarGutter: "stable", overflowWrap: "anywhere" }}
        >
          {notice || "检测当前连接并获取模型列表，不会生成图片。"}
        </div>
      </div>
      <div className="space-y-3">
        {models.map((model, i) => (
          <div
            key={i}
            className={`space-y-2 rounded-lg border border-slate-700 p-3 ${model.enabled ? "" : "opacity-60"}`}
          >
            <div className="flex items-center gap-2">
              <ToggleSwitch
                compact
                checked={model.enabled}
                label="启用"
                ariaLabel={`启用模型 ${model.name || model.modelId || i + 1}`}
                onChange={(enabled) => update(i, { enabled })}
              />
              <ThemeSelect
                label={`模型 ${i + 1} 类别`}
                className="ml-auto max-w-44"
                value={model.modality}
                onChange={(value) =>
                  update(i, { modality: value as "image" | "vision" })
                }
                options={[
                  { value: "image", label: "生图模型" },
                  { value: "vision", label: "多模态模型" },
                ]}
              />
              <button
                type="button"
                aria-label={`删除模型 ${model.name || model.modelId || i + 1}`}
                onClick={() =>
                  onChange({ models: models.filter((_, n) => n !== i) })
                }
                className="p-2 text-slate-500 hover:text-red-400"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <ThemeSelect
              editable
              label={`模型 ${i + 1} ID`}
              value={model.modelId}
              placeholder={
                model.modality === "image"
                  ? presets[0]
                  : presets[presets.length - 1]
              }
              onChange={(value) => update(i, { modelId: value })}
              options={[...new Set([...presets, ...discovered])].map((id) => ({
                value: id,
                label: id,
              }))}
            />
            <input
              aria-label={`模型 ${i + 1} 显示名称`}
              className={inputClass}
              value={model.name || ""}
              placeholder="显示名称（可选）"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <p className="text-[11px] leading-4 text-slate-500">
              {model.modality === "image"
                ? "生成、参考图、编辑、抠图与扩图。"
                : isGemini
                  ? "图片理解与意图识别；生图任务请选择图片模型。"
                  : "图片理解与意图识别；生图任务请选择生图模型。"}
            </p>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          onChange({
            models: [
              ...models,
              { modelId: "", name: "", modality: "image", enabled: true },
            ],
          })
        }
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-600 py-2 text-sm text-slate-300 hover:border-blue-400"
      >
        <Plus size={15} />
        添加模型
      </button>
      <div className="grid gap-3 border-t border-slate-700 pt-4">
        {selectModel("默认图片任务模型", "imageModel", "image")}
        {selectModel("默认意图识别模型", "intentModel", "vision")}
      </div>
      {!isGemini && (
        <>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-700 pt-4">
            <label className="grid gap-2 text-xs text-slate-400">
              图像质量
              <ThemeSelect
                label="图像质量"
                value={settings.imageQuality}
                onChange={(value) => onChange({ imageQuality: value })}
                options={Object.entries({
                  auto: "自动",
                  low: "低",
                  medium: "中",
                  high: "高",
                  xhigh: "超高 · 2.5",
                  max: "最高 · 2.5",
                }).map(([value, label]) => ({ value, label }))}
              />
            </label>
            <label className="grid gap-2 text-xs text-slate-400">
              背景
              <ThemeSelect
                label="背景"
                value={settings.imageBackground}
                onChange={(value) =>
                  onChange({
                    imageBackground: value,
                    ...(value === "transparent" &&
                    settings.imageOutputFormat === "jpeg"
                      ? { imageOutputFormat: "png" }
                      : {}),
                  })
                }
                options={[
                  { value: "auto", label: "自动" },
                  { value: "opaque", label: "不透明" },
                  { value: "transparent", label: "透明" },
                ]}
              />
            </label>
            <label className="grid gap-2 text-xs text-slate-400">
              输出格式
              <ThemeSelect
                label="输出格式"
                value={settings.imageOutputFormat}
                onChange={(value) => onChange({ imageOutputFormat: value })}
                options={[
                  { value: "png", label: "PNG" },
                  { value: "webp", label: "WebP" },
                  {
                    value: "jpeg",
                    label: "JPEG",
                    disabled: settings.imageBackground === "transparent",
                  },
                ]}
              />
            </label>
            {settings.imageOutputFormat !== "png" && (
              <label className="grid gap-2 text-xs text-slate-400">
                压缩质量（0–100）
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={100}
                  value={settings.imageCompression ?? 100}
                  onChange={(e) =>
                    onChange({ imageCompression: Number(e.target.value) })
                  }
                />
              </label>
            )}
          </div>
          <p className="text-xs leading-5 text-slate-500">
            质量与多模态思考强度分别设置。透明抠图会自动使用支持透明通道的格式。4K
            按模型像素上限生成，高于 2560×1440 的输出属于实验性分辨率。
          </p>
        </>
      )}
      {isGemini && (
        <p className="text-xs leading-5 text-slate-500">
          Gemini 3.1 Flash Image
          的思考档位为低（minimal）与高；中档沿用模型默认。扩图使用区域引导图，尺寸取最接近的受支持比例。严格透明抠图建议选择
          GPT Image。
        </p>
      )}
    </div>
  );
};

export default ProviderModelSettings;
