import React, { useState } from "react";
import { Aperture, ChevronDown, Plus, Sparkles, Trash2, X } from "lucide-react";
import {
  AIProvider,
  AISettings,
  ProviderConfig,
  createProvider,
} from "../types/settings";
import ProviderModelSettings from "./ProviderModelSettings";
import ToggleSwitch from "./ToggleSwitch";
import ThemeSelect from "./ThemeSelect";

const ProviderManager: React.FC<{
  settings: AISettings;
  onChange: (patch: Partial<AISettings>) => void;
}> = ({ settings, onChange }) => {
  const providers = settings.providers || [];
  const [expanded, setExpanded] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState("");
  const update = (id: string, patch: Partial<ProviderConfig>) =>
    onChange({
      providers: providers.map((p) =>
        p.id === id ? { ...p, ...patch, id } : p,
      ),
    });
  const add = (type: AIProvider) => {
    const name = type === "openai" ? "OpenAI" : "Gemini";
    const count = providers.filter((p) => p.type === type).length;
    const config = createProvider(
      type,
      undefined,
      count ? `${name} ${count + 1}` : name,
    );
    onChange({
      providers: [...providers, config],
      ...(!settings.defaultProviderId ? { defaultProviderId: config.id } : {}),
    });
    setExpanded(config.id);
    setAdding(false);
  };
  const remove = (id: string) => {
    onChange({
      providers: providers.filter((p) => p.id !== id),
      ...(settings.defaultProviderId === id ? { defaultProviderId: "" } : {}),
    });
    setRemoving("");
    if (expanded === id) setExpanded("");
  };
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">服务商</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            每个服务商拥有独立连接、模型列表与生成偏好。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(!adding)}
          aria-expanded={adding}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-600/70 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
        >
          {adding ? <X size={14} /> : <Plus size={14} />}添加服务商
        </button>
      </div>
      {adding && (
        <div
          className="grid grid-cols-2 gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3"
          aria-label="选择服务商类型"
        >
          <button
            type="button"
            onClick={() => add("openai")}
            className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-left hover:border-emerald-700/70"
          >
            <Aperture className="text-emerald-200/80" size={23} />
            <span>
              <span className="block text-sm text-slate-200">OpenAI 兼容</span>
              <span className="mt-1 block text-[11px] text-slate-500">
                官方或兼容服务
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => add("gemini")}
            className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-left hover:border-blue-700/70"
          >
            <Sparkles className="text-blue-200/80" size={23} />
            <span>
              <span className="block text-sm text-slate-200">Gemini</span>
              <span className="mt-1 block text-[11px] text-slate-500">
                Gemini API 服务
              </span>
            </span>
          </button>
        </div>
      )}
      <label className="grid gap-2 text-xs text-slate-400">
        默认服务商
        <ThemeSelect
          label="默认服务商"
          value={settings.defaultProviderId}
          onChange={(value) => onChange({ defaultProviderId: value })}
          options={[
            { value: "", label: "请选择默认服务商" },
            ...(settings.defaultProviderId &&
            !providers.some((p) => p.id === settings.defaultProviderId)
              ? [
                  {
                    value: settings.defaultProviderId,
                    label: "服务商已移除",
                    disabled: true,
                  },
                ]
              : []),
            ...providers.map((p) => ({
              value: p.id,
              label: `${p.name || "未命名服务商"}${p.enabled ? "" : " · 已停用"}`,
              disabled: !p.enabled,
            })),
          ]}
        />
      </label>
      <div className="space-y-3">
        {providers.map((p) => {
          const Icon = p.type === "gemini" ? Sparkles : Aperture;
          const isExpanded = expanded === p.id;
          return (
            <section
              key={p.id}
              className={`overflow-hidden rounded-xl border ${isExpanded ? "border-slate-600/80 bg-slate-800/20" : "border-slate-700/60 bg-slate-800/20"}`}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  aria-label={`配置服务商 ${p.name}`}
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? "" : p.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/5 ${p.type === "gemini" ? "bg-blue-400/5 text-blue-200/80" : "bg-emerald-400/5 text-emerald-200/80"}`}
                  >
                    <Icon size={19} strokeWidth={1.6} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-200">
                        {p.name || "未命名服务商"}
                      </span>
                      {settings.defaultProviderId === p.id && (
                        <span className="rounded border border-slate-600/50 px-1.5 py-0.5 text-[9px] text-slate-400">
                          默认
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-slate-500">
                      {p.type === "gemini" ? "Gemini" : "OpenAI 兼容"} ·{" "}
                      {(p.models || []).filter((m) => m.enabled).length}{" "}
                      个已启用模型
                    </span>
                  </span>
                  <ChevronDown
                    size={14}
                    className={`shrink-0 text-slate-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </button>
                <ToggleSwitch
                  compact
                  label="启用"
                  ariaLabel={`启用服务商 ${p.name}`}
                  checked={p.enabled}
                  onChange={(enabled) => update(p.id, { enabled })}
                />
                <button
                  type="button"
                  aria-label={`移除服务商 ${p.name}`}
                  onClick={() => setRemoving(p.id)}
                  className="p-1.5 text-slate-500 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {removing === p.id && (
                <div className="flex items-center justify-between gap-3 border-t border-slate-700/60 bg-red-950/10 px-4 py-3 text-xs">
                  <span className="text-slate-400">
                    移除此连接？保存设置后生效。
                  </span>
                  <span className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setRemoving("")}
                      className="text-slate-400"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      className="text-red-300"
                    >
                      确认移除
                    </button>
                  </span>
                </div>
              )}
              {isExpanded && (
                <div className="border-t border-slate-700/60 p-3">
                  <ProviderModelSettings
                    key={`${p.id}:${p.type}`}
                    settings={p}
                    onChange={(patch) => update(p.id, patch)}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!providers.length && (
        <div className="rounded-xl border border-dashed border-slate-700 px-6 py-10 text-center text-sm text-slate-500">
          添加一个服务商，开始配置模型。
        </div>
      )}
    </div>
  );
};
export default ProviderManager;
