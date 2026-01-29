/// <reference lib="webworker" />

import { addAlbumWithImages, addImagesToAlbum } from "./db";
import type { Album, IndexedImage, IndexedImagePayload } from "./types";

type AddImagesMessage = {
  type: "add-images";
  requestId: string;
  data: {
    albumId: string;
    images: IndexedImagePayload[];
  };
};

type AddAlbumMessage = {
  type: "add-album";
  requestId: string;
  data: {
    rootPath: string;
    images: IndexedImagePayload[];
  };
};

type IncomingMessage = AddImagesMessage | AddAlbumMessage;

type DoneMessage = {
  type: "done";
  requestId: string;
  payload: {
    album: Album | null;
    images: IndexedImage[];
  };
};

type ErrorMessage = {
  type: "error";
  requestId: string;
  message: string;
};

const postDone = (message: DoneMessage) => {
  (self as DedicatedWorkerGlobalScope).postMessage(message);
};

const postError = (message: ErrorMessage) => {
  (self as DedicatedWorkerGlobalScope).postMessage(message);
};

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (!message || typeof message !== "object" || !message.type) return;
  try {
    if (message.type === "add-images") {
      const added = await addImagesToAlbum(message.data.albumId, message.data.images);
      postDone({ type: "done", requestId: message.requestId, payload: { album: null, images: added } });
      return;
    }
    if (message.type === "add-album") {
      const result = await addAlbumWithImages(message.data.rootPath, message.data.images);
      postDone({
        type: "done",
        requestId: message.requestId,
        payload: { album: result.album, images: result.images },
      });
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown indexing error";
    postError({ type: "error", requestId: message.requestId, message: messageText });
  }
};