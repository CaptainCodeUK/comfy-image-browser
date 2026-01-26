import type { IndexedImagePayload } from "./types";

declare global {
  interface Window {
    comfy: {
      selectFolders: () => Promise<string[]>;
      indexFolders: (paths: string[]) => Promise<Array<{ rootPath: string; images: IndexedImagePayload[] }>>;
      toFileUrl: (filePath: string) => Promise<string>;
    };
  }
}

export {};
