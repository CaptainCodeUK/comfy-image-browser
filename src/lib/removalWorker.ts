/// <reference lib="webworker" />

import { removeAlbumRecord, removeImagesById } from "./db";

type RemovalItem = { id: string; label: string };

type RemoveImagesMessage = {
  type: "remove-images";
  requestId: string;
  items: RemovalItem[];
  batchSize: number;
};

type RemoveAlbumMessage = {
  type: "remove-album";
  requestId: string;
  albumId: string;
  items: RemovalItem[];
  batchSize: number;
};

type CancelMessage = {
  type: "cancel";
  requestId: string;
};

type IncomingMessage = RemoveImagesMessage | RemoveAlbumMessage | CancelMessage;

type ProgressMessage = {
  type: "progress";
  requestId: string;
  current: number;
  total: number;
  label: string;
};

type DoneMessage = { type: "done"; requestId: string };

type ErrorMessage = { type: "error"; requestId: string; message: string };

const postProgress = (message: ProgressMessage) => {
  (self as DedicatedWorkerGlobalScope).postMessage(message);
};

const postDone = (message: DoneMessage) => {
  (self as DedicatedWorkerGlobalScope).postMessage(message);
};

const postError = (message: ErrorMessage) => {
  (self as DedicatedWorkerGlobalScope).postMessage(message);
};

const cancelledRequests = new Set<string>();

const isCancelled = (requestId: string) => cancelledRequests.has(requestId);

const removeItems = async (requestId: string, items: RemovalItem[], batchSize: number) => {
  let batch: string[] = [];
  let index = 0;
  const total = items.length;
  for (const item of items) {
    if (isCancelled(requestId)) {
      throw new Error("Removal cancelled");
    }
    index += 1;
    postProgress({ type: "progress", requestId, current: index, total, label: item.label });
    batch.push(item.id);
    if (batch.length >= batchSize) {
      await removeImagesById(batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await removeImagesById(batch);
  }
};

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (!message || typeof message !== "object" || !message.type) return;
  try {
    if (message.type === "cancel") {
      cancelledRequests.add(message.requestId);
      return;
    }
    if (message.type === "remove-images") {
      await removeItems(message.requestId, message.items, message.batchSize);
      postDone({ type: "done", requestId: message.requestId });
      return;
    }
    if (message.type === "remove-album") {
      await removeItems(message.requestId, message.items, message.batchSize);
      await removeAlbumRecord(message.albumId);
      postDone({ type: "done", requestId: message.requestId });
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown removal error";
    postError({ type: "error", requestId: message.requestId, message: messageText });
  } finally {
    if (message.type !== "cancel") {
      cancelledRequests.delete(message.requestId);
    }
  }
};
