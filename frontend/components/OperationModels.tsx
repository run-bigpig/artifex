import React, {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Aperture,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ScanEye,
  Search,
  SlidersHorizontal,
  Paperclip,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";
import { AIProvider, AISettings, ModelDefinition } from "../types/settings";
import { ModelSettings } from "../types";
import "./OperationModels.css";

type Panel = "models" | "options" | "intent";
const providerNames: Record<AIProvider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
};
const modelName = (model?: ModelDefinition, fallback?: string) =>
  model?.name || model?.modelId || fallback || "选择模型";

function ProviderMark({
  provider,
  small = false,
}: {
  provider: AIProvider;
  small?: boolean;
}) {
  const Icon = provider === "gemini" ? Sparkles : Aperture;
  return (
    <span
      className={`model-dock__mark model-dock__mark--${provider}${small ? " model-dock__mark--small" : ""}`}
      aria-hidden="true"
    >
      <Icon size={small ? 14 : 17} strokeWidth={1.6} />
    </span>
  );
}

export default function OperationModels({
  ai,
  value,
  onChange,
  disabled,
  configuration,
  onUpload,
  onRecognize,
  canRecognize,
  recognizing,
}: {
  ai: AISettings;
  value: ModelSettings;
  onChange: (settings: ModelSettings) => void;
  disabled: boolean;
  configuration: React.ReactNode;
  onUpload: () => void;
  onRecognize: () => void;
  canRecognize: boolean;
  recognizing: boolean;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [query, setQuery] = useState("");
  const [availableHeight, setAvailableHeight] = useState(500);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const restoreTarget = useRef<"model" | "options">("model");
  const dialogId = useId();
  const provider = value.provider || ai.defaultProviderId;
  const connection = ai.providers.find((p) => p.id === provider);
  const adapter = connection?.type || "openai";
  const providerName = connection?.name || "服务商不可用";
  const models = connection?.models || [];
  const defaultImage = connection?.imageModel || "";
  const defaultIntent = connection?.intentModel || "";
  const defaultConnection = ai.providers.find(
    (p) => p.id === ai.defaultProviderId,
  );
  const globalDefaultModel = defaultConnection?.models.find(
    (m) => m.modelId === defaultConnection.imageModel && m.modality === "image",
  );
  const imageId = value.model || defaultImage;
  const selected = models.find(
    (m) => m.modelId === imageId && m.modality === "image",
  );
  const intent = models.find(
    (m) =>
      m.modelId === (value.intentModel || defaultIntent) &&
      m.modality === "vision",
  );
  const followingDefault = !value.provider && !value.model;
  const primaryInvalid = !connection?.enabled || !selected?.enabled;
  const secondaryInvalid = !intent?.enabled;
  const customized = !!value.intentModel;
  const title =
    panel === "models"
      ? "选择生成模型"
      : panel === "intent"
        ? "选择识别模型"
        : "生成配置";

  const close = (restoreFocus = false) => {
    setPanel(null);
    setQuery("");
    if (restoreFocus)
      (restoreTarget.current === "model"
        ? modelTrigger
        : optionsTrigger
      ).current?.focus();
  };
  const open = (next: Panel, origin?: "model" | "options") => {
    if (origin) restoreTarget.current = origin;
    setQuery("");
    setPanel((current) => (current === next ? null : next));
  };

  useLayoutEffect(() => {
    if (!panel) return;
    const measure = () => {
      const composer = rootRef.current?.closest("[data-prompt-composer]");
      if (composer)
        setAvailableHeight(
          Math.min(
            panel === "options" ? 500 : 340,
            Math.max(120, composer.getBoundingClientRect().top - 80),
          ),
        );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [panel]);

  useEffect(() => {
    if (!panel) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPanel(null);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", outside);
    const frame = requestAnimationFrame(() =>
      dialogRef.current
        ?.querySelector<HTMLElement>("input, button:not(:disabled)")
        ?.focus(),
    );
    return () => {
      document.removeEventListener("pointerdown", outside);
      cancelAnimationFrame(frame);
    };
  }, [panel]);
  useEffect(() => {
    if (disabled) {
      setPanel(null);
      setQuery("");
    }
  }, [disabled]);

  const chooseImage = (nextProvider: string, model: ModelDefinition) => {
    onChange({
      ...value,
      provider: nextProvider,
      model: model.modelId,
      imageToolModel: "",
      ...(nextProvider !== provider ? { intentModel: "" } : {}),
    });
    close(true);
  };
  const chooseSecondary = (modelId: string) => {
    onChange({
      ...value,
      intentModel: modelId,
    });
    setQuery("");
    setPanel("options");
  };
  const matches = (model: ModelDefinition) =>
    `${model.name} ${model.modelId}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const groups = ai.providers.map((p) => ({
    key: p.id,
    connection: p,
    models: (p.models || []).filter(
      (m) =>
        m.modality === "image" &&
        (matches(m) ||
          p.name.toLowerCase().includes(query.trim().toLowerCase())),
    ),
  }));
  const secondaryModels = models.filter(
    (m) => m.modality === "vision" && matches(m),
  );
  const defaultSecondary = defaultIntent;
  const secondaryChoice = value.intentModel;
  const defaultModel = models.find(
    (m) => m.modelId === defaultSecondary && m.modality === "vision",
  );

  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (
      event.target instanceof HTMLInputElement &&
      ["Home", "End"].includes(event.key)
    )
      return;
    const items = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-model-option]:not(:disabled)",
      ) || [],
    );
    const buttons = items as HTMLButtonElement[];
    if (!buttons.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (index + 1) % items.length
            : index <= 0
              ? items.length - 1
              : index - 1;
    buttons[next].focus();
  };

  return (
    <div
      className="model-dock"
      ref={rootRef}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          close();
      }}
    >
      <div className="model-dock__bar">
        <button
          type="button"
          ref={modelTrigger}
          className={`model-dock__trigger${primaryInvalid ? " is-invalid" : ""}`}
          disabled={disabled}
          aria-label={`选择生成模型，当前 ${providerName} ${selected ? modelName(selected) : "选择生图模型"}`}
          aria-haspopup="dialog"
          aria-expanded={panel === "models"}
          aria-controls={panel ? dialogId : undefined}
          title={`${providerName} · ${imageId || "未配置"}${followingDefault ? " · 跟随默认设置" : ""}`}
          onClick={() => open("models", "model")}
        >
          <span className="model-dock__name-text">
            {selected ? modelName(selected) : "选择生图模型"}
          </span>
          <ChevronDown
            size={13}
            className={`model-dock__chevron${panel === "models" ? " is-open" : ""}`}
          />
        </button>

        <button
          type="button"
          disabled={disabled}
          className="model-dock__options-trigger model-dock__upload-trigger"
          aria-label="上传参考图"
          title="上传参考图"
          onClick={() => {
            close();
            onUpload();
          }}
        >
          <Paperclip size={16} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          ref={optionsTrigger}
          disabled={disabled}
          className={`model-dock__options-trigger${panel && panel !== "models" ? " is-active" : ""}`}
          aria-label="生成配置"
          aria-haspopup="dialog"
          aria-expanded={!!panel && panel !== "models"}
          aria-controls={panel ? dialogId : undefined}
          title="生成配置：尺寸、分辨率与意图识别模型"
          onClick={() => open("options", "options")}
        >
          <SlidersHorizontal size={16} strokeWidth={1.6} />

          {(secondaryInvalid || customized) && (
            <span
              className={`model-dock__indicator${secondaryInvalid ? " is-warning" : ""}`}
            />
          )}
        </button>
      </div>

      {panel && (
        <div
          ref={dialogRef}
          id={dialogId}
          role="dialog"
          aria-label={title}
          className={`model-dock__popover${panel !== "options" ? " model-dock__popover--picker" : ""}`}
          style={{ maxHeight: availableHeight }}
          onKeyDown={keyboard}
        >
          <div className="model-dock__heading">
            <div className="model-dock__heading-title">
              {panel === "intent" && (
                <button
                  type="button"
                  aria-label="返回模型配置"
                  onClick={() => {
                    setQuery("");
                    setPanel("options");
                  }}
                  className="model-dock__back"
                >
                  <ArrowLeft size={14} />
                </button>
              )}
              <span>{title}</span>
            </div>
            <span className="model-dock__scope">仅本次会话</span>
          </div>
          {(primaryInvalid || secondaryInvalid) && (
            <p className="model-dock__warning" role="status">
              {primaryInvalid
                ? "生成模型不可用，请重新选择。"
                : "识别模型不可用，请选择多模态模型。"}
            </p>
          )}
          {panel === "options" ? (
            <div className="model-dock__configuration">
              <div className="composer-config__actions">
                <button
                  type="button"
                  disabled={!canRecognize || recognizing}
                  onClick={() => {
                    close(true);
                    onRecognize();
                  }}
                >
                  {recognizing ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <ScanEye size={15} />
                  )}
                  {recognizing ? "识别中…" : "识别意图"}
                </button>
              </div>
              {configuration}
              <div className="composer-config__section-label">任务模型</div>
              <button
                type="button"
                className="model-dock__task"
                onClick={() => open("intent")}
              >
                <span className="model-dock__task-icon">
                  <ScanEye size={18} strokeWidth={1.5} />
                </span>
                <span className="model-dock__task-copy">
                  <span className="model-dock__task-title">
                    意图识别
                    <span className="model-dock__task-note">
                      理解提示词与参考图
                    </span>
                  </span>
                  <span
                    className={`model-dock__task-model${!intent?.enabled ? " is-invalid" : ""}`}
                  >
                    {intent ? modelName(intent) : "选择多模态模型"}
                  </span>
                </span>
                <ChevronRight size={14} />
              </button>
              <p className="model-dock__footnote">
                调整此处的选择，不会改变设置中的默认模型。
              </p>
            </div>
          ) : (
            <>
              <div className="model-dock__search">
                <Search size={14} />
                <input
                  aria-label="搜索模型"
                  placeholder="搜索名称或模型 ID"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                />
              </div>
              <div className="model-dock__list" role="group" aria-label={title}>
                {!query && (
                  <button
                    type="button"
                    data-model-option
                    className="model-dock__default-row"
                    disabled={
                      panel === "models"
                        ? !defaultConnection?.enabled ||
                          !globalDefaultModel?.enabled
                        : !connection?.enabled || !defaultModel?.enabled
                    }
                    onClick={() => {
                      if (panel === "models") {
                        onChange({
                          ...value,
                          provider: undefined,
                          model: "",
                          intentModel: "",
                          imageToolModel: "",
                        });
                        close(true);
                      } else chooseSecondary("");
                    }}
                  >
                    <span className="model-dock__auto-mark">
                      <Zap size={15} />
                    </span>
                    <span className="model-dock__item-copy">
                      <span className="model-dock__item-name">
                        跟随默认设置
                      </span>
                      <span className="model-dock__item-meta">
                        {panel === "models"
                          ? `${defaultConnection?.name || "未配置"} · ${defaultConnection?.imageModel || "请选择默认服务商"}`
                          : defaultSecondary || "未配置"}
                      </span>
                    </span>
                    {(panel === "models"
                      ? followingDefault
                      : !secondaryChoice) && (
                      <Check size={14} className="model-dock__check" />
                    )}
                  </button>
                )}
                {panel === "models"
                  ? groups.map(
                      (group) =>
                        group.models.length > 0 && (
                          <div
                            key={group.key}
                            role="group"
                            aria-label={group.connection.name}
                          >
                            <div className="model-dock__group-label">
                              <span>{group.connection.name}</span>
                              <span>
                                {providerNames[group.connection.type]} ·{" "}
                                {group.models.length}
                              </span>
                            </div>
                            {group.models.map((model) => {
                              const active =
                                provider === group.key &&
                                imageId === model.modelId;
                              return (
                                <button
                                  type="button"
                                  data-model-option
                                  key={model.modelId}
                                  className={`model-dock__item${active ? " is-selected" : ""}`}
                                  disabled={
                                    !group.connection.enabled || !model.enabled
                                  }
                                  aria-pressed={active}
                                  title={model.modelId}
                                  onClick={() => chooseImage(group.key, model)}
                                >
                                  <ProviderMark
                                    provider={group.connection.type}
                                    small
                                  />
                                  <span className="model-dock__item-copy">
                                    <span className="model-dock__item-name">
                                      {modelName(model)}
                                    </span>
                                  </span>
                                  {(!group.connection.enabled || !model.enabled) && <span className="model-dock__badge">已停用</span>}
                                  {active && (
                                    <Check
                                      size={14}
                                      className="model-dock__check"
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ),
                    )
                  : secondaryModels.map((model) => {
                      const active =
                        (secondaryChoice || defaultSecondary) === model.modelId;
                      return (
                        <button
                          type="button"
                          data-model-option
                          key={model.modelId}
                          className={`model-dock__item${active ? " is-selected" : ""}`}
                          disabled={!connection?.enabled || !model.enabled}
                          aria-pressed={active}
                          onClick={() => chooseSecondary(model.modelId)}
                        >
                          <ProviderMark provider={adapter} small />
                          <span className="model-dock__item-copy">
                            <span className="model-dock__item-name">
                              {modelName(model)}
                            </span>
                            <span className="model-dock__item-meta">
                              {model.modelId}
                            </span>
                          </span>
                          {!model.enabled && (
                            <span className="model-dock__badge">已停用</span>
                          )}
                          {active && (
                            <Check size={14} className="model-dock__check" />
                          )}
                        </button>
                      );
                    })}
                {(panel === "models"
                  ? groups.every((group) => !group.models.length)
                  : !secondaryModels.length) && (
                  <div className="model-dock__empty">
                    {query
                      ? "没有匹配的模型"
                      : "暂无可用模型，请先在设置中添加。"}
                  </div>
                )}
              </div>
              <div className="model-dock__footer">
                <span>模型来自服务商配置</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
