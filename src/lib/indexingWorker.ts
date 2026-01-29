/// <reference lib="webworker" />

import { addCollectionWithImages, addImagesToCollection } from "./db";
import type { Collection, IndexedImage, IndexedImagePayload } from "./types";

type AddImagesMessage = {
  type: "add-images";
  requestId: string;
  data: {
    collectionId: string;
    images: IndexedImagePayload[];
  };
};

type AddCollectionMessage = {
  type: "add-collection";
  requestId: string;
  data: {
    rootPath: string;
    images: IndexedImagePayload[];
  };
};

type IncomingMessage = AddImagesMessage | AddCollectionMessage;

type DoneMessage = {
  type: "done";
  requestId: string;
  payload: {
    collection: Collection | null;
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
      const added = await addImagesToCollection(message.data.collectionId, message.data.images);
      postDone({ type: "done", requestId: message.requestId, payload: { collection: null, images: added } });
      return;
    }
    if (message.type === "add-collection") {
      const result = await addCollectionWithImages(message.data.rootPath, message.data.images);
      postDone({
        type: "done",
        requestId: message.requestId,
        payload: { collection: result.collection, images: result.images },
      });
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown indexing error";
    postError({ type: "error", requestId: message.requestId, message: messageText });
  }
};