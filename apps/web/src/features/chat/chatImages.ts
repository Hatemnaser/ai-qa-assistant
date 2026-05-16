import type { SelectedImage } from "./types";

const MAX_IMAGE_SIZE_MB = 4;

export function getImageFileError(file: File | undefined) {
  if (!file) return "";

  if (!file.type.startsWith("image/")) {
    return "Please upload an image file.";
  }

  if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
    return `Image is too large. Please upload an image smaller than ${MAX_IMAGE_SIZE_MB}MB.`;
  }

  return "";
}

export function fileToSelectedImage(file: File): Promise<SelectedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const base64Data = result.split(",")[1] || "";

      resolve({
        name: file.name,
        mimeType: file.type,
        data: base64Data,
        previewUrl: result,
      });
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
