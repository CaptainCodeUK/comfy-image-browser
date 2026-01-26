import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("comfy", {
  selectFolders: () => ipcRenderer.invoke("comfy:select-folders"),
  indexFolders: (paths: string[]) => ipcRenderer.invoke("comfy:index-folders", paths),
  toFileUrl: (filePath: string) => ipcRenderer.invoke("comfy:to-file-url", filePath),
});
