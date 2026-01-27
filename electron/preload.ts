import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("comfy", {
  selectFolders: () => ipcRenderer.invoke("comfy:select-folders"),
  indexFolders: (paths: string[]) => ipcRenderer.invoke("comfy:index-folders", paths),
  cancelIndexing: () => ipcRenderer.invoke("comfy:cancel-indexing"),
  toFileUrl: (filePath: string) => ipcRenderer.invoke("comfy:to-file-url", filePath),
  getThumbnail: (filePath: string) => ipcRenderer.invoke("comfy:get-thumbnail", filePath),
  showContextMenu: (
    payload:
      | { type: "image"; imageId: string; label: string; selectedCount: number; isSelected: boolean }
      | { type: "album"; albumId: string; label: string; selectedCount: number; isSelected: boolean }
  ) => ipcRenderer.invoke("comfy:show-context-menu", payload),
  deleteFilesFromDisk: (payload: { paths: string[]; label: string; detail?: string }) =>
    ipcRenderer.invoke("comfy:delete-files-from-disk", payload),
  revealInFolder: (filePath: string) => ipcRenderer.invoke("comfy:reveal-in-folder", filePath),
  openInEditor: (filePath: string) => ipcRenderer.invoke("comfy:open-in-editor", filePath),
  updateMenuState: (state: {
    hasActiveImage: boolean;
    hasActiveAlbum: boolean;
    hasSelectedImages: boolean;
    hasSelectedAlbums: boolean;
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
