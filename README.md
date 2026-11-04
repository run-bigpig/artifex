# ArtifexBot

基于 Wails、Go 和 React 的图片工作台。

## 模型配置

在设置中添加服务商，为每个服务商选择 OpenAI 或 Gemini 协议，分别配置名称、Base URL、API Key 与模型列表。可以添加多个同类型服务商；同名模型通过服务商的唯一 ID 隔离，不会串用连接。类别分为「生图模型」与「多模态模型」。支持从服务商拉取模型列表；类别须按实际能力确认。默认模型与 Sidebar 的本次操作选择独立，停用或删除模型不会触发静默回退。

Sidebar 输入框底部仅保留模型名称和发送按钮，主模型仅显示生图模型，菜单按「服务商 → 模型」分组，支持搜索和键盘操作。右上角配置按钮统一管理宽高比、分辨率、思考强度、意图识别模型（仅多模态模型），并提供识别意图入口；上传参考图按钮独立显示在输入框右上角。图片生成、编辑与意图识别统一使用非流式调用，完成后展示最终结果；服务商和模型启用状态使用 Switch 开关。新安装从空服务商列表开始。

调用规则：

- OpenAI 生图模型直接使用 Images API；多模态模型仅用于意图识别，通过 Responses API 返回结构化结果。推荐 `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare` 与 `gpt-6.1-sol`。
- Gemini 生图模型用于生成和编辑，多模态模型用于图片理解与意图识别。默认图片模型为 `gemini-3.1-flash-image`；保留已有配置中的模型 ID。
- 自定义模型别名按配置类别路由。OpenAI 多模态意图识别服务须实现 Responses API 与结构化输出；不是所有第三方“OpenAI 兼容”服务都实现了这些能力。

## 图片操作

生成、参考图、草图、编辑、多图融合、主体/中景/背景提取、画质修复和扩图均使用程序内的专用提示词。操作约束与用户提示词分开存储、传递；可在输入区取消专用约束。

OpenAI 支持质量、透明背景、PNG/JPEG/WebP、压缩质量及取消。1K/2K/4K 按模型像素上限映射，4K 不代表所有比例均为 4096 像素。GPT Image 1 系列只允许标准尺寸。最新模型的高分辨率输出仍受服务端限制。

扩图同时生成区域蒙版。OpenAI 使用蒙版编辑；Gemini 使用黑白区域引导图及最接近的受支持比例。生成模型不能保证编辑区外像素绝对不变。Gemini 未提供同等的透明背景参数，透明提取会校验结果，未返回真实透明通道时明确报错。严格透明抠图建议使用 GPT Image。

Gemini 3.1 Flash Image 支持最小与高思考档位；中档沿用默认最小档。其他 Gemini 图片模型不发送未经确认的思考参数。图片质量与多模态推理强度是不同设置。

模型列表检测只验证连接与模型发现，不进行付费生成。每次操作提交本次提示词及附件；继续编辑历史图片时需将图片加入参考图。

## 配置迁移

已移除 Cloud provider 与 Vertex AI。旧 Cloud 选择迁移到 OpenAI，需要配置有效连接；Vertex 凭证不再加载或使用。旧 OpenAI 独立图片连接合并为一组连接，若曾填写图片专用 URL/Key，优先保留它们。旧单模型或固定 OpenAI/Gemini 配置转换为独立服务商实例，并保留原连接、默认模型。旧流式选项不再生效，保存时自动移除。已有配置仅在内存中迁移，点击保存后才写回；删除的服务商不会自动恢复。

API Key 继续由 Go 后端加密保存。SDK 调用与提示词组合均在后端，前端不再依赖 Google AI SDK。

## 构建与验证

需要 Go 1.26+、Node.js 与 Wails 2。使用官方 SDK：`github.com/openai/openai-go/v3 v3.93.0`、`google.golang.org/genai v1.77.0`。

```bash
cd frontend
npm ci
cd ..
# Wails build/dev 会自动生成前端绑定。
wails build
```

后端契约测试使用本地 HTTP 模拟服务，不消耗 API 额度：

```bash
go test -tags bindings ./...
cd frontend
npx tsc --noEmit
npm run build
```

依据：[OpenAI 图片生成](https://developers.openai.com/api/docs/guides/image-generation)、[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[Gemini 图片生成](https://ai.google.dev/gemini-api/docs/image-generation)。
