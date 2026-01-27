import type { IndexedImagePayload } from "./types";

declare global {
  interface Window {
    comfy: {
      selectFolders: () => Promise<string[]>;
      indexFolders: (paths: string[]) => Promise<Array<{ rootPath: string; images: IndexedImagePayload[] }>>;
      toFileUrl: (filePath: string) => Promise<string>;
      getThumbnail: (filePath: string) => Promise<string | null>;
      showContextMenu: (
        payload:
          | { type: "image"; imageId: string; label: string; selectedCount: number; isSelected: boolean }
          | { type: "album"; albumId: string; label: string; selectedCount: number; isSelected: boolean }
      ) => Promise<
        | "remove-image"
        | "remove-selected-images"
        | "remove-album"
        | "remove-selected-albums"
        | "delete-image-disk"
        | "delete-selected-images-disk"
        | "delete-album-disk"
        | "delete-selected-albums-disk"
        | "reveal-image"
        | "reveal-album"
        | null
      >;
      deleteFilesFromDisk: (payload: {
        paths: string[];
        label: string;
        detail?: string;
      }) => Promise<{ deletedPaths: string[]; canceled: boolean }>;
      revealInFolder: (filePath: string) => Promise<void>;
      openInEditor: (filePath: string) => Promise<void>;
      onMenuAction: (
        callback: (action: "add-folder" | "remove-selected-images" | "remove-selected-albums" | "delete-selected-images-disk" | "delete-selected-albums-disk" | "reveal-active-image" | "reveal-active-album" | "edit-active-image") => void
      ) => () => void;
      onIndexingFolder: (callback: (payload: { current: number; total: number; folder: string }) => void) => () => void;
      onIndexingImage: (callback: (payload: { current: number; total: number; fileName: string }) => void) => () => void;
      onIndexingComplete: (callback: () => void) => () => void;
    };
  }
}

export {};
