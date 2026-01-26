import type { IndexedImage } from "./types";
import { toFileUrl } from "./fileUrl";

export const attachFileUrls = async (images: IndexedImage[]) => {
  const results = await Promise.all(
    images.map(async (image) => {
      try {
        const fileUrl = await toFileUrl(image.filePath);
        return { ...image, fileUrl };
      } catch {
        return { ...image, fileUrl: image.filePath };
      }
    })
  );
  return results;
};
