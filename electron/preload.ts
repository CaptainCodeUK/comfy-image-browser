import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("comfy", {
  selectFolders: () => ipcRenderer.invoke("comfy:select-folders"),
  indexFolders: (paths: string[], existingPaths?: string[]) =>
    ipcRenderer.invoke("comfy:index-folders", paths, existingPaths ?? []),
  cancelIndexing: () => ipcRenderer.invoke("comfy:cancel-indexing"),
  toFileUrl: (filePath: string) => ipcRenderer.invoke("comfy:to-file-url", filePath),
  getThumbnail: (filePath: string) => ipcRenderer.invoke("comfy:get-thumbnail", filePath),
  getPreview: (filePath: string) => ipcRenderer.invoke("comfy:get-preview", filePath),
  getCachedThumbnails: (payload: Array<{ id: string; filePath: string }>) =>
    ipcRenderer.invoke("comfy:get-cached-thumbnails", payload),
  showContextMenu: (
    payload:
      | { type: "image"; imageId: string; label: string; selectedCount: number; isSelected: boolean }
      | { type: "album"; albumId: string; label: string; selectedCount: number; isSelected: boolean }
  ) => ipcRenderer.invoke("comfy:show-context-menu", payload),
  deleteFilesFromDisk: (payload: { paths: string[]; label: string; detail?: string }) =>
    ipcRenderer.invoke("comfy:delete-files-from-disk", payload),
  revealInFolder: (filePath: string) => ipcRenderer.invoke("comfy:reveal-in-folder", filePath),
  openInEditor: (filePath: string) => ipcRenderer.invoke("comfy:open-in-editor", filePath),
  findMissingFiles: (paths: string[]) => ipcRenderer.invoke("comfy:find-missing-files", paths),
  renamePath: (payload: { oldPath: string; newPath: string; kind: "file" | "folder" }) =>
    ipcRenderer.invoke("comfy:rename-path", payload),
  getAppInfo: () => ipcRenderer.invoke("comfy:get-app-info"),
  openExternal: (url: string) => ipcRenderer.invoke("comfy:open-external", url),
  toggleDevTools: () => ipcRenderer.invoke("comfy:toggle-devtools"),
  updateMenuState: (state: {
    hasActiveImage: boolean;
    hasActiveAlbum: boolean;
    hasSelectedImages: boolean;
    hasSelectedAlbums: boolean;
    hasSingleSelectedImage: boolean;
    hasSingleSelectedAlbum: boolean;
    hasImages: boolean;
    hasAlbums: boolean;
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
  onIndexingComplete: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("comfy:indexing-complete", listener);
    return () => ipcRenderer.removeListener("comfy:indexing-complete", listener);
  },
});
