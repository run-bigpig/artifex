export type AIProvider = "gemini" | "openai";
export interface ModelDefinition {
  modelId: string;
  name: string;
  modality: "image" | "vision";
  enabled: boolean;
}
export interface ProviderConfig {
  id: string;
  name: string;
  type: AIProvider;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  models: ModelDefinition[];
  imageModel: string;
  intentModel: string;
  imageToolModel: string;
  imageQuality: string;
  imageBackground: string;
  imageOutputFormat: string;
  imageCompression?: number;
}
export interface AISettings {
  defaultProviderId: string;
  providers: ProviderConfig[];
}
export interface Settings {
  version: string;
  ai: AISettings;
}

export function createProvider(
  type: AIProvider,
  id = `provider-${crypto.randomUUID()}`,
  name = type === "gemini" ? "Gemini" : "OpenAI",
): ProviderConfig {
  const gemini = type === "gemini";
  return {
    id,
    name,
    type,
    enabled: true,
    baseUrl: gemini
      ? "https://generativelanguage.googleapis.com"
      : "https://api.openai.com/v1",
    apiKey: "",
    models: gemini
      ? [
          {
            modelId: "gemini-3.1-flash-image",
            name: "Gemini 3.1 Flash Image",
            modality: "image",
            enabled: true,
          },
          {
            modelId: "gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            modality: "vision",
            enabled: true,
          },
        ]
      : [
          {
            modelId: "gpt-image-2.5-sunburst",
            name: "GPT Image 2.5 Sunburst",
            modality: "image",
            enabled: true,
          },
          {
            modelId: "gpt-image-2.5-flare",
            name: "GPT Image 2.5 Flare",
            modality: "image",
            enabled: true,
          },
          {
            modelId: "gpt-6.1-sol",
            name: "GPT 6.1 Sol",
            modality: "vision",
            enabled: true,
          },
        ],
    imageModel: gemini ? "gemini-3.1-flash-image" : "gpt-image-2.5-sunburst",
    intentModel: gemini ? "gemini-2.5-flash" : "gpt-6.1-sol",
    imageToolModel: gemini ? "" : "gpt-image-2.5-sunburst",
    imageQuality: "auto",
    imageBackground: "auto",
    imageOutputFormat: "png",
    imageCompression: 100,
  };
}
export const defaultSettings: Settings = {
  version: "1.0.0",
  ai: { defaultProviderId: "", providers: [] },
};
