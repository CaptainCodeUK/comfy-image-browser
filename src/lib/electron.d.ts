import type { IndexedImagePayload } from "./types";

declare global {
  interface Window {
    comfy: {
      selectFolders: () => Promise<string[]>;
      indexFolders: (
        paths: string[],
        existingPaths?: string[],
        options?: { returnPayload?: boolean }
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
          | { type: "collection"; collectionId: string; label: string; selectedCount: number; isSelected: boolean }
      ) => Promise<
        | "remove-selected-images"
        | "remove-selected-collections"
        | "delete-selected-images-disk"
        | "delete-selected-collections-disk"
        | "add-selected-images-favorites"
        | "remove-selected-images-favorites"
        | "add-selected-collections-favorites"
        | "remove-selected-collections-favorites"
        | "reveal-image"
        | "edit-image"
        | "rename-image"
        | "bulk-rename-selected-images"
        | "reveal-collection"
        | "rescan-collection"
        | "rename-collection"
        | "select-all-images"
        | "invert-image-selection"
        | "clear-image-selection"
        | "select-all-collections"
        | "invert-collection-selection"
        | "clear-collection-selection"
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
  getLatestRelease: () => Promise<{ version: string; url: string }>;
      openExternal: (url: string) => Promise<boolean>;
  toggleDevTools: () => Promise<boolean>;
      updateMenuState: (state: {
        hasActiveImage: boolean;
        hasActiveCollection: boolean;
        hasSelectedImages: boolean;
        hasSelectedCollections: boolean;
        hasSingleSelectedImage: boolean;
        hasSingleSelectedCollection: boolean;
        hasImages: boolean;
        hasCollections: boolean;
        canBulkRenameImages: boolean;
        isIndexing: boolean;
        isRemoving: boolean;
        isDeleting: boolean;
      }) => void;
      onMenuAction: (
        callback: (
          action:
            | "add-folder"
            | "remove-selected-images"
            | "remove-selected-collections"
            | "delete-selected-images-disk"
            | "delete-selected-collections-disk"
            | "reveal-active-image"
            | "reveal-active-collection"
            | "edit-active-image"
            | "rename-selected-image"
            | "add-selected-images-favorites"
            | "remove-selected-images-favorites"
            | "rename-selected-collection"
            | "add-selected-collections-favorites"
            | "remove-selected-collections-favorites"
            | "rescan-selected-collections"
            | "bulk-rename-selected-images"
            | "select-all-images"
            | "invert-image-selection"
            | "clear-image-selection"
            | "select-all-collections"
            | "invert-collection-selection"
            | "clear-collection-selection"
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
  onIndexingCollection: (callback: (payload: { rootPath: string; images: IndexedImagePayload[] }) => void) => () => void;
      onIndexingComplete: (callback: () => void) => () => void;
    };
  }
}

export {};
