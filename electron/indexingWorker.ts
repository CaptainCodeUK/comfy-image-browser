import { parentPort } from "node:worker_threads";
import path from "node:path";
import fs from "node:fs/promises";
import { parsePngMetadata, readPngDimensions } from "../src/lib/pngMetadata";

type IndexedImagePayload = {
  filePath: string;
  fileName: string;
  collectionRoot: string;
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

type CollectionMessage = {
  type: "collection";
  rootPath: string;
  images: IndexedImagePayload[];
};

type DoneMessage = {
  type: "done";
  collections: Array<{ rootPath: string; images: IndexedImagePayload[] }>;
};

type ErrorMessage = { type: "error"; message: string };

type CancelledMessage = {
  type: "cancelled";
  collections: Array<{ rootPath: string; images: IndexedImagePayload[] }>;
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".dib"]);
const THUMBNAIL_DIR = ".thumbs";

let cancelled = false;

const postMessage = (
  message:
    | FolderProgressMessage
    | ImageProgressMessage
    | CollectionMessage
    | DoneMessage
    | ErrorMessage
    | CancelledMessage
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

const buildImagePayload = async (filePath: string, collectionRoot: string): Promise<IndexedImagePayload> => {
  const stats = await fs.stat(filePath);
  const fileName = path.basename(filePath);
  const payload: IndexedImagePayload = {
    filePath,
    fileName,
    collectionRoot,
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
  const collections: Array<{ rootPath: string; images: IndexedImagePayload[] }> = [];
  const scans = await Promise.all(rootPaths.map((rootPath) => scanFolderTree(rootPath, existingFiles)));
  const collectionFolders: Array<{ rootPath: string; folderPath: string; files: string[] }> = [];

  for (let i = 0; i < rootPaths.length; i += 1) {
    if (cancelled) return { cancelled: true, collections } as const;
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
      collectionFolders.push({ rootPath: folderPath, folderPath, files: folderFiles });
    }
  }

  const totalImages = collectionFolders.reduce((sum, collection) => sum + collection.files.length, 0);
  let folderIndex = 0;
  let imageIndex = 0;

  for (const collectionFolder of collectionFolders) {
    if (cancelled) return { cancelled: true, collections } as const;
    folderIndex += 1;
    postMessage({
      type: "progress-folder",
      current: folderIndex,
      total: collectionFolders.length,
      folder: collectionFolder.folderPath,
    });

    const images: IndexedImagePayload[] = [];
    for (const filePath of collectionFolder.files) {
      if (cancelled) return { cancelled: true, collections } as const;
      imageIndex += 1;
      postMessage({
        type: "progress-image",
        current: imageIndex,
        total: totalImages,
        fileName: path.basename(filePath),
      });
      images.push(await buildImagePayload(filePath, collectionFolder.rootPath));
    }

    postMessage({ type: "collection", rootPath: collectionFolder.rootPath, images });
    if (returnPayload) {
      collections.push({ rootPath: collectionFolder.rootPath, images });
    }
  }

  return { cancelled: false, collections } as const;
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
      postMessage({ type: "cancelled", collections: result.collections });
      return;
    }
    postMessage({ type: "done", collections: result.collections });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown indexing error";
    postMessage({ type: "error", message: messageText });
  }
});
