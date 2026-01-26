import { openDB, type IDBPDatabase } from "idb";
import type { Album, IndexedImage, IndexedImagePayload } from "./types";

const DB_NAME = "comfy-browser-db";
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db: IDBPDatabase) {
    if (!db.objectStoreNames.contains("albums")) {
      db.createObjectStore("albums", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("images")) {
      const store = db.createObjectStore("images", { keyPath: "id" });
      store.createIndex("albumId", "albumId");
    }
  },
});

const createAlbumName = (rootPath: string) => {
  const segments = rootPath.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? rootPath;
};

export const addAlbumWithImages = async (rootPath: string, payloads: IndexedImagePayload[]) => {
  const album: Album = {
    id: crypto.randomUUID(),
    name: createAlbumName(rootPath),
    rootPath,
    addedAt: new Date().toISOString(),
  };

  const images: IndexedImage[] = payloads.map((payload) => ({
    id: crypto.randomUUID(),
    albumId: album.id,
    filePath: payload.filePath,
    fileName: payload.fileName,
    fileUrl: payload.filePath,
    sizeBytes: payload.sizeBytes,
    createdAt: payload.createdAt,
    width: payload.width,
    height: payload.height,
    metadataText: payload.metadataText,
  }));

  const db = await dbPromise;
  const tx = db.transaction(["albums", "images"], "readwrite");
  await tx.objectStore("albums").add(album);
  const imageStore = tx.objectStore("images");
  for (const image of images) {
    await imageStore.put(image);
  }
  await tx.done;

  return { album, images };
};

export const getAlbums = async () => {
  const db = await dbPromise;
  return db.getAll("albums");
};

export const getImages = async () => {
  const db = await dbPromise;
  return db.getAll("images");
};

export const removeImagesById = async (ids: string[]) => {
  const db = await dbPromise;
  const tx = db.transaction("images", "readwrite");
  for (const id of ids) {
    await tx.store.delete(id);
  }
  await tx.done;
};
