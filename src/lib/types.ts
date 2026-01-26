export type Album = {
  id: string;
  name: string;
  rootPath: string;
  addedAt: string;
};

export type IndexedImagePayload = {
  filePath: string;
  fileName: string;
  albumRoot: string;
  sizeBytes: number;
  createdAt: string;
  width?: number;
  height?: number;
  metadataText: Record<string, string> | null;
  metadataJson: Record<string, unknown> | null;
};

export type IndexedImage = {
  id: string;
  albumId: string;
  filePath: string;
  fileName: string;
  fileUrl: string;
  sizeBytes: number;
  createdAt: string;
  width?: number;
  height?: number;
  metadataText: Record<string, string> | null;
};
