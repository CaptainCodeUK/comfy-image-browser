import { parentPort } from "node:worker_threads";
import path from "node:path";
import fs from "node:fs/promises";
import { parsePngMetadata, readPngDimensions } from "../src/lib/pngMetadata";

type IndexedImagePayload = {
  filePath: string;
  fileName: string;
  albumRoot: string;
  sizeBytes: number;
  createdAt: string;
  width?: number;
  height?: number;
  metadataText: Record<string, string> | null;
  metadataJson: Record<string, unknown> | null;
};

type StartMessage = {
  type: "start";
  rootPaths: string[];
  existingPaths: string[];
  returnPayload?: boolean;
};

type CancelMessage = { type: "cancel" };

type IncomingMessage = StartMessage | CancelMessage;

type FolderProgressMessage = {
  type: "progress-folder";
  current: number;
  total: number;
  folder: string;
};

type ImageProgressMessage = {
  type: "progress-image";
  current: number;
  total: number;
  fileName: string;
};

type AlbumMessage = {
  type: "album";
  rootPath: string;
  images: IndexedImagePayload[];
};

type DoneMessage = {
  type: "done";
  albums: Array<{ rootPath: string; images: IndexedImagePayload[] }>;
};

type ErrorMessage = { type: "error"; message: string };

type CancelledMessage = { type: "cancelled"; albums: Array<{ rootPath: string; images: IndexedImagePayload[] }> };

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".dib"]);
const THUMBNAIL_DIR = ".thumbs";

let cancelled = false;

const postMessage = (
  message: FolderProgressMessage | ImageProgressMessage | AlbumMessage | DoneMessage | ErrorMessage | CancelledMessage
) => {
  parentPort?.postMessage(message);
};

const scanFolderTree = async (rootPath: string, existingFiles: Set<string>) => {
  const folders: string[] = [rootPath];
  const files: string[] = [];
  const stack = [rootPath];

  while (stack.length) {
    if (cancelled) return { cancelled: true, folders, files } as const;
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === THUMBNAIL_DIR) {
        continue;
      }
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        folders.push(resolved);
        stack.push(resolved);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext) && !existingFiles.has(resolved)) {
          files.push(resolved);
        }
      }
    }
  }

  return { cancelled: false, folders, files } as const;
};

const buildImagePayload = async (filePath: string, albumRoot: string): Promise<IndexedImagePayload> => {
  const stats = await fs.stat(filePath);
  const fileName = path.basename(filePath);
  const payload: IndexedImagePayload = {
    filePath,
    fileName,
    albumRoot,
    sizeBytes: stats.size,
    createdAt: stats.birthtime.toISOString(),
    metadataText: null,
    metadataJson: null,
  };

  if (path.extname(filePath).toLowerCase() === ".png") {
    const buffer = await fs.readFile(filePath);
    const dimensions = readPngDimensions(buffer);
    payload.width = dimensions?.width;
    payload.height = dimensions?.height;
    const metadata = parsePngMetadata(buffer);
    payload.metadataText = Object.keys(metadata.textChunks).length ? metadata.textChunks : null;
    payload.metadataJson = Object.keys(metadata.jsonChunks).length ? metadata.jsonChunks : null;
  }

  return payload;
};

const runIndexing = async (rootPaths: string[], existingPaths: string[], returnPayload: boolean) => {
  const existingFiles = new Set(existingPaths);
  const albums: Array<{ rootPath: string; images: IndexedImagePayload[] }> = [];
  const scans = await Promise.all(rootPaths.map((rootPath) => scanFolderTree(rootPath, existingFiles)));
  const albumFolders: Array<{ rootPath: string; folderPath: string; files: string[] }> = [];

  for (let i = 0; i < rootPaths.length; i += 1) {
    if (cancelled) return { cancelled: true, albums } as const;
    const rootPath = rootPaths[i];
    const files = scans[i].files;
    const folderMap = new Map<string, string[]>();

    for (const filePath of files) {
      const folder = path.dirname(filePath);
      const existing = folderMap.get(folder);
      if (existing) {
        existing.push(filePath);
      } else {
        folderMap.set(folder, [filePath]);
      }
    }

    for (const [folderPath, folderFiles] of folderMap.entries()) {
      if (!folderFiles.length) continue;
      albumFolders.push({ rootPath: folderPath, folderPath, files: folderFiles });
    }
  }

  const totalImages = albumFolders.reduce((sum, album) => sum + album.files.length, 0);
  let folderIndex = 0;
  let imageIndex = 0;

  for (const albumFolder of albumFolders) {
    if (cancelled) return { cancelled: true, albums } as const;
    folderIndex += 1;
    postMessage({
      type: "progress-folder",
      current: folderIndex,
      total: albumFolders.length,
      folder: albumFolder.folderPath,
    });

    const images: IndexedImagePayload[] = [];
    for (const filePath of albumFolder.files) {
      if (cancelled) return { cancelled: true, albums } as const;
      imageIndex += 1;
      postMessage({
        type: "progress-image",
        current: imageIndex,
        total: totalImages,
        fileName: path.basename(filePath),
      });
      images.push(await buildImagePayload(filePath, albumFolder.rootPath));
    }

    postMessage({ type: "album", rootPath: albumFolder.rootPath, images });
    if (returnPayload) {
      albums.push({ rootPath: albumFolder.rootPath, images });
    }
  }

  return { cancelled: false, albums } as const;
};

if (!parentPort) {
  throw new Error("Indexing worker started without parent port");
}

parentPort.on("message", async (message: IncomingMessage) => {
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }
  if (message.type !== "start") return;
  cancelled = false;
  try {
  const result = await runIndexing(message.rootPaths, message.existingPaths, message.returnPayload ?? true);
    if (result.cancelled) {
      postMessage({ type: "cancelled", albums: result.albums });
      return;
    }
    postMessage({ type: "done", albums: result.albums });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown indexing error";
    postMessage({ type: "error", message: messageText });
  }
});
