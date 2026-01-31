export type Collection = {
  id: string;
  name: string;
  rootPath: string;
  addedAt: string;
  includeSubfolders?: boolean;
};

export type IndexedImagePayload = {
  filePath: string;
  fileName: string;
  collectionRoot: string;
  sizeBytes: number;
  createdAt: string;
  width?: number;
  height?: number;
  metadataText: Record<string, string> | null;
  metadataJson: Record<string, unknown> | null;
};

export type IndexedImage = {
  id: string;
  collectionId: string;
  filePath: string;
  fileName: string;
  fileUrl: string;
  sizeBytes: number;
  createdAt: string;
  width?: number;
  height?: number;
  metadataText: Record<string, string> | null;
};

export type ImageViewPrefs = {
  imageId: string;
  zoomMode: "fit" | "actual" | "width" | "height" | "manual";
  zoomLevel: number;
  updatedAt: string;
};
