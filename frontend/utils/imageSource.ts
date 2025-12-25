const imageRefPrefix = "images/";
const imageRefPrefixAbs = "/images/";
const assetBase = (import.meta as ImportMeta).env?.VITE_ASSET_BASE_URL ?? "";
const normalizedAssetBase = assetBase.replace(/\/+$/, "");

export const isDataUrl = (src: string): boolean => src.startsWith("data:");

export const isImageRef = (src: string): boolean =>
  src.startsWith(imageRefPrefix) || src.startsWith(imageRefPrefixAbs);

export const normalizeImageSrc = (src: string): string => {
  if (src.startsWith(imageRefPrefix)) {
    if (normalizedAssetBase) {
      return `${normalizedAssetBase}/${src}`;
    }
    return `/${src}`;
  }
  if (src.startsWith(imageRefPrefixAbs) && normalizedAssetBase) {
    return `${normalizedAssetBase}${src}`;
  }
  return src;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image data"));
    reader.readAsDataURL(blob);
  });

export const ensureDataUrl = async (src: string): Promise<string> => {
  if (isDataUrl(src)) {
    return src;
  }

  const response = await fetch(normalizeImageSrc(src));
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  return blobToDataUrl(await response.blob());
};
