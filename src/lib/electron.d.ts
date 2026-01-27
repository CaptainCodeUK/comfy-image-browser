import type { IndexedImagePayload } from "./types";

declare global {
  interface Window {
    comfy: {
      selectFolders: () => Promise<string[]>;
      indexFolders: (paths: string[]) => Promise<Array<{ rootPath: string; images: IndexedImagePayload[] }>>;
      toFileUrl: (filePath: string) => Promise<string>;
      onIndexingFolder: (callback: (payload: { current: number; total: number; folder: string }) => void) => () => void;
      onIndexingImage: (callback: (payload: { current: number; total: number; fileName: string }) => void) => () => void;
      onIndexingComplete: (callback: () => void) => () => void;
    };
  }
}

export {};
