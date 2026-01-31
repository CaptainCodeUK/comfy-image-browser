import { contextBridge, ipcRenderer } from "electron";
import type { IndexedImagePayload } from "../src/lib/types";

contextBridge.exposeInMainWorld("comfy", {
  selectFolders: () => ipcRenderer.invoke("comfy:select-folders"),
  indexFolders: (paths: string[], existingPaths?: string[], options?: { returnPayload?: boolean }) =>
    ipcRenderer.invoke("comfy:index-folders", paths, existingPaths ?? [], options ?? {}),
  cancelIndexing: () => ipcRenderer.invoke("comfy:cancel-indexing"),
  toFileUrl: (filePath: string) => ipcRenderer.invoke("comfy:to-file-url", filePath),
  getThumbnail: (filePath: string) => ipcRenderer.invoke("comfy:get-thumbnail", filePath),
  getPreview: (filePath: string) => ipcRenderer.invoke("comfy:get-preview", filePath),
  getCachedThumbnails: (payload: Array<{ id: string; filePath: string }>) =>
    ipcRenderer.invoke("comfy:get-cached-thumbnails", payload),
  showContextMenu: (
    payload:
      | { type: "image"; imageId: string; label: string; selectedCount: number; isSelected: boolean }
      | { type: "collection"; collectionId: string; label: string; selectedCount: number; isSelected: boolean }
  ) => ipcRenderer.invoke("comfy:show-context-menu", payload),
  deleteFilesFromDisk: (payload: { paths: string[]; label: string; detail?: string }) =>
    ipcRenderer.invoke("comfy:delete-files-from-disk", payload),
  revealInFolder: (filePath: string) => ipcRenderer.invoke("comfy:reveal-in-folder", filePath),
  openInEditor: (filePath: string) => ipcRenderer.invoke("comfy:open-in-editor", filePath),
  findMissingFiles: (paths: string[]) => ipcRenderer.invoke("comfy:find-missing-files", paths),
  renamePath: (payload: { oldPath: string; newPath: string; kind: "file" | "folder" }) =>
    ipcRenderer.invoke("comfy:rename-path", payload),
  getAppInfo: () => ipcRenderer.invoke("comfy:get-app-info"),
  getLatestRelease: () => ipcRenderer.invoke("comfy:get-latest-release"),
  openExternal: (url: string) => ipcRenderer.invoke("comfy:open-external", url),
  toggleDevTools: () => ipcRenderer.invoke("comfy:toggle-devtools"),
  updateMenuState: (state: {
    hasActiveImage: boolean;
    hasActiveCollection: boolean;
    hasSelectedImages: boolean;
    hasSelectedCollections: boolean;
    hasSingleSelectedImage: boolean;
    hasSingleSelectedCollection: boolean;
    hasImages: boolean;
    hasCollections: boolean;
    isIndexing: boolean;
    isRemoving: boolean;
    isDeleting: boolean;
  }) => ipcRenderer.send("comfy:update-menu-state", state),
  onMenuAction: (callback: (action: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on("comfy:menu-action", listener);
    return () => ipcRenderer.removeListener("comfy:menu-action", listener);
  },
  onIndexingFolder: (callback: (payload: { current: number; total: number; folder: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { current: number; total: number; folder: string }) =>
      callback(payload);
    ipcRenderer.on("comfy:indexing-folder", listener);
    return () => ipcRenderer.removeListener("comfy:indexing-folder", listener);
  },
  onIndexingImage: (callback: (payload: { current: number; total: number; fileName: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { current: number; total: number; fileName: string }
    ) => callback(payload);
    ipcRenderer.on("comfy:indexing-image", listener);
    return () => ipcRenderer.removeListener("comfy:indexing-image", listener);
  },
  onIndexingCollection: (callback: (payload: { rootPath: string; images: IndexedImagePayload[] }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { rootPath: string; images: IndexedImagePayload[] }
    ) => callback(payload);
    ipcRenderer.on("comfy:indexing-collection", listener);
    return () => ipcRenderer.removeListener("comfy:indexing-collection", listener);
  },
  onIndexingComplete: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("comfy:indexing-complete", listener);
    return () => ipcRenderer.removeListener("comfy:indexing-complete", listener);
  },
});
