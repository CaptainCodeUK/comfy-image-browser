import { openDB, type IDBPDatabase } from "idb";
import type { Album, IndexedImage, IndexedImagePayload } from "./types";

const DB_NAME = "comfy-browser-db";
const DB_VERSION = 2;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db: IDBPDatabase, _oldVersion, _newVersion, transaction) {
    if (!db.objectStoreNames.contains("albums")) {
      db.createObjectStore("albums", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("images")) {
      const store = db.createObjectStore("images", { keyPath: "id" });
      store.createIndex("albumId", "albumId");
    }
    if (!db.objectStoreNames.contains("imagePrefs")) {
      db.createObjectStore("imagePrefs", { keyPath: "imageId" });
    }
    if (!db.objectStoreNames.contains("appPrefs")) {
      db.createObjectStore("appPrefs", { keyPath: "key" });
    }
    if (transaction) {
      transaction.oncomplete = () => {};
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

export const addImagesToAlbum = async (albumId: string, payloads: IndexedImagePayload[]) => {
  const images: IndexedImage[] = payloads.map((payload) => ({
    id: crypto.randomUUID(),
    albumId,
    filePath: payload.filePath,
    fileName: payload.fileName,
    fileUrl: payload.filePath,
    sizeBytes: payload.sizeBytes,
    createdAt: payload.createdAt,
    width: payload.width,
    height: payload.height,
    metadataText: payload.metadataText,
  }));

  if (images.length === 0) return [] as IndexedImage[];

  const db = await dbPromise;
  const tx = db.transaction(["images"], "readwrite");
  const imageStore = tx.objectStore("images");
  for (const image of images) {
    await imageStore.put(image);
  }
  await tx.done;

  return images;
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
  const tx = db.transaction(["images", "imagePrefs"], "readwrite");
  for (const id of ids) {
    await tx.objectStore("images").delete(id);
    await tx.objectStore("imagePrefs").delete(id);
  }
  await tx.done;
};

export const removeAlbumById = async (albumId: string) => {
  const db = await dbPromise;
  const tx = db.transaction(["albums", "images", "imagePrefs"], "readwrite");
  const imageIndex = tx.objectStore("images").index("albumId");
  const imageKeys = await imageIndex.getAllKeys(albumId);
  for (const key of imageKeys) {
    await tx.objectStore("images").delete(key);
    await tx.objectStore("imagePrefs").delete(String(key));
  }
  await tx.objectStore("albums").delete(albumId);
  await tx.done;
};

export const getImageViewPrefs = async (imageId: string) => {
  const db = await dbPromise;
  return db.get("imagePrefs", imageId);
};

export const setImageViewPrefs = async (imageId: string, zoomMode: string, zoomLevel: number) => {
  const db = await dbPromise;
  return db.put("imagePrefs", {
    imageId,
    zoomMode,
    zoomLevel,
    updatedAt: new Date().toISOString(),
  });
};

export const getAppPref = async <T>(key: string) => {
  const db = await dbPromise;
  const result = await db.get("appPrefs", key);
  return result?.value as T | undefined;
};

export const setAppPref = async (key: string, value: unknown) => {
  const db = await dbPromise;
  return db.put("appPrefs", {
    key,
    value,
    updatedAt: new Date().toISOString(),
  });
};
