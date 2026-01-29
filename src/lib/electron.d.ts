import type { IndexedImagePayload } from "./types";

declare global {
  interface Window {
    comfy: {
      selectFolders: () => Promise<string[]>;
      indexFolders: (
        paths: string[],
        existingPaths?: string[]
      ) => Promise<Array<{ rootPath: string; images: IndexedImagePayload[] }>>;
      cancelIndexing: () => Promise<void>;
      toFileUrl: (filePath: string) => Promise<string>;
      getThumbnail: (filePath: string) => Promise<string | null>;
      getPreview: (filePath: string) => Promise<string | null>;
      getCachedThumbnails: (
        payload: Array<{ id: string; filePath: string }>
      ) => Promise<Array<{ id: string; url: string | null }>>;
      showContextMenu: (
        payload:
          | { type: "image"; imageId: string; label: string; selectedCount: number; isSelected: boolean }
          | { type: "album"; albumId: string; label: string; selectedCount: number; isSelected: boolean }
      ) => Promise<
        | "remove-selected-images"
        | "remove-selected-albums"
        | "delete-selected-images-disk"
        | "delete-selected-albums-disk"
  | "add-selected-images-favorites"
  | "remove-selected-images-favorites"
  | "add-selected-albums-favorites"
  | "remove-selected-albums-favorites"
        | "reveal-image"
  | "edit-image"
        | "rename-image"
        | "reveal-album"
        | "rescan-album"
        | "rename-album"
        | "select-all-images"
        | "invert-image-selection"
        | "clear-image-selection"
        | "select-all-albums"
        | "invert-album-selection"
        | "clear-album-selection"
        | null
      >;
      deleteFilesFromDisk: (payload: {
        paths: string[];
        label: string;
        detail?: string;
      }) => Promise<{ deletedPaths: string[]; canceled: boolean }>;
      revealInFolder: (filePath: string) => Promise<void>;
      openInEditor: (filePath: string) => Promise<void>;
      findMissingFiles: (paths: string[]) => Promise<string[]>;
      renamePath: (payload: { oldPath: string; newPath: string; kind: "file" | "folder" }) => Promise<{
        success: boolean;
        message?: string;
      }>;
      getAppInfo: () => Promise<{ name: string; version: string }>;
      openExternal: (url: string) => Promise<boolean>;
  toggleDevTools: () => Promise<boolean>;
      updateMenuState: (state: {
        hasActiveImage: boolean;
        hasActiveAlbum: boolean;
        hasSelectedImages: boolean;
        hasSelectedAlbums: boolean;
        hasSingleSelectedImage: boolean;
        hasSingleSelectedAlbum: boolean;
        hasImages: boolean;
        hasAlbums: boolean;
      }) => void;
      onMenuAction: (
        callback: (
          action:
            | "add-folder"
            | "remove-selected-images"
            | "remove-selected-albums"
            | "delete-selected-images-disk"
            | "delete-selected-albums-disk"
            | "reveal-active-image"
            | "reveal-active-album"
            | "edit-active-image"
            | "rename-selected-image"
            | "add-selected-images-favorites"
            | "remove-selected-images-favorites"
            | "rename-selected-album"
            | "add-selected-albums-favorites"
            | "remove-selected-albums-favorites"
            | "rescan-selected-albums"
            | "select-all-images"
            | "invert-image-selection"
            | "clear-image-selection"
            | "select-all-albums"
            | "invert-album-selection"
            | "clear-album-selection"
            | "tab-next"
            | "tab-prev"
            | "tab-duplicate"
            | "tab-close"
            | "tab-close-others"
            | "tab-close-all"
            | "show-about"
        ) => void
      ) => () => void;
      onIndexingFolder: (callback: (payload: { current: number; total: number; folder: string }) => void) => () => void;
      onIndexingImage: (callback: (payload: { current: number; total: number; fileName: string }) => void) => () => void;
      onIndexingAlbum: (callback: (payload: { rootPath: string; images: IndexedImagePayload[] }) => void) => () => void;
      onIndexingComplete: (callback: () => void) => () => void;
    };
  }
}

export {};
