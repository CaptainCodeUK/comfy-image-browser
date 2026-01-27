import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("comfy", {
  selectFolders: () => ipcRenderer.invoke("comfy:select-folders"),
  indexFolders: (paths: string[]) => ipcRenderer.invoke("comfy:index-folders", paths),
  toFileUrl: (filePath: string) => ipcRenderer.invoke("comfy:to-file-url", filePath),
  getThumbnail: (filePath: string) => ipcRenderer.invoke("comfy:get-thumbnail", filePath),
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
