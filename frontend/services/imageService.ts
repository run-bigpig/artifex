import { StoreImage } from '../wailsjs/go/core/App';
import { isDataUrl, isImageRef, toImageRef } from '../utils/imageSource';

export const storeImage = async (src: string): Promise<string> => {
  if (!src) {
    return '';
  }
  const ref = toImageRef(src);
  if (isImageRef(ref)) {
    return ref;
  }
  if (!isDataUrl(src)) {
    return src;
  }
  return StoreImage(src);
};
