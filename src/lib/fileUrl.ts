export const toFileUrl = async (filePath: string) => {
  return window.comfy.toFileUrl(filePath);
};

export const toComfyUrl = (filePath: string) =>
  `comfy://local?path=${encodeURIComponent(filePath)}`;
