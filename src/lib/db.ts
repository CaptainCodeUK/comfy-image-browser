import { openDB, type IDBPDatabase } from "idb";
import type { Collection, IndexedImage, IndexedImagePayload } from "./types";

const DB_NAME = "comfy-browser-db";
const DB_VERSION = 4;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  async upgrade(db: IDBPDatabase, oldVersion, _newVersion, transaction) {
    if (!db.objectStoreNames.contains("collections")) {
      db.createObjectStore("collections", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("images")) {
      const store = db.createObjectStore("images", { keyPath: "id" });
      store.createIndex("collectionId", "collectionId");
    }
    if (!db.objectStoreNames.contains("imagePrefs")) {
      db.createObjectStore("imagePrefs", { keyPath: "imageId" });
    }
    if (!db.objectStoreNames.contains("favorites")) {
      db.createObjectStore("favorites", { keyPath: "imageId" });
    }
    if (!db.objectStoreNames.contains("appPrefs")) {
      db.createObjectStore("appPrefs", { keyPath: "key" });
    }
    if (transaction) {
      if (db.objectStoreNames.contains("images")) {
        const imageStore = transaction.objectStore("images");
        if (!Array.from(imageStore.indexNames).includes("collectionId")) {
          imageStore.createIndex("collectionId", "collectionId");
        }
      }
      transaction.oncomplete = () => {};
    }
  },
});

const createCollectionName = (rootPath: string) => {
  const segments = rootPath.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? rootPath;
};

export const addCollectionWithImages = async (rootPath: string, payloads: IndexedImagePayload[]) => {
  const collection: Collection = {
    id: crypto.randomUUID(),
    name: createCollectionName(rootPath),
    rootPath,
    addedAt: new Date().toISOString(),
  };

  const images: IndexedImage[] = payloads.map((payload) => ({
    id: crypto.randomUUID(),
    collectionId: collection.id,
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
  const tx = db.transaction(["collections", "images"], "readwrite");
  await tx.objectStore("collections").add(collection);
  const imageStore = tx.objectStore("images");
  for (const image of images) {
    await imageStore.put(image);
  }
  await tx.done;

  return { collection, images };
};

export const addImagesToCollection = async (collectionId: string, payloads: IndexedImagePayload[]) => {
  const images: IndexedImage[] = payloads.map((payload) => ({
    id: crypto.randomUUID(),
    collectionId,
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

export const getCollections = async () => {
  const db = await dbPromise;
  return db.getAll("collections");
};

export const getImages = async () => {
  const db = await dbPromise;
  return db.getAll("images");
};

export const removeImagesById = async (ids: string[]) => {
  const db = await dbPromise;
  const tx = db.transaction(["images", "imagePrefs", "favorites"], "readwrite");
  for (const id of ids) {
    tx.objectStore("images").delete(id);
    tx.objectStore("imagePrefs").delete(id);
    tx.objectStore("favorites").delete(id);
  }
  await tx.done;
};

export const removeCollectionById = async (collectionId: string) => {
  const db = await dbPromise;
  const tx = db.transaction(["collections", "images", "imagePrefs", "favorites"], "readwrite");
  const imageIndex = tx.objectStore("images").index("collectionId");
  const imageKeys = await imageIndex.getAllKeys(collectionId);
  for (const key of imageKeys) {
    tx.objectStore("images").delete(key);
    tx.objectStore("imagePrefs").delete(String(key));
    tx.objectStore("favorites").delete(String(key));
  }
  tx.objectStore("collections").delete(collectionId);
  await tx.done;
};

export const removeCollectionRecord = async (collectionId: string) => {
  const db = await dbPromise;
  const tx = db.transaction(["collections"], "readwrite");
  await tx.objectStore("collections").delete(collectionId);
  await tx.done;
};

export const getFavorites = async () => {
  const db = await dbPromise;
  const rows = await db.getAll("favorites");
  return rows.map((row: { imageId: string }) => row.imageId);
};

export const addFavorites = async (ids: string[]) => {
  if (ids.length === 0) return;
  const db = await dbPromise;
  const tx = db.transaction(["favorites"], "readwrite");
  for (const id of ids) {
    await tx.objectStore("favorites").put({ imageId: id, addedAt: new Date().toISOString() });
  }
  await tx.done;
};

export const removeFavorites = async (ids: string[]) => {
  if (ids.length === 0) return;
  const db = await dbPromise;
  const tx = db.transaction(["favorites"], "readwrite");
  for (const id of ids) {
    await tx.objectStore("favorites").delete(id);
  }
  await tx.done;
};

export const updateCollectionInfo = async (collectionId: string, updates: Partial<Collection>) => {
  const db = await dbPromise;
  const collection = await db.get("collections", collectionId);
  if (!collection) return null;
  const updated = { ...collection, ...updates } as Collection;
  await db.put("collections", updated);
  return updated;
};

export const updateImageFileInfo = async (imageId: string, filePath: string, fileName: string) => {
  const db = await dbPromise;
  const image = await db.get("images", imageId);
  if (!image) return null;
  const updated = { ...image, filePath, fileName, fileUrl: filePath } as IndexedImage;
  await db.put("images", updated);
  return updated;
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
