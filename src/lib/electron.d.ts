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
        "remove-image" | "remove-selected-images" | "remove-album" | "remove-selected-albums" | null
      >;
      onMenuAction: (
        callback: (action: "add-folder" | "remove-selected-images" | "remove-selected-albums") => void
      ) => () => void;
      onIndexingFolder: (callback: (payload: { current: number; total: number; folder: string }) => void) => () => void;
      onIndexingImage: (callback: (payload: { current: number; total: number; fileName: string }) => void) => () => void;
      onIndexingComplete: (callback: () => void) => () => void;
    };
  }
}

export {};
