import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, SyntheticEvent } from "react";
import {
  addCollectionRecord,
  addCollectionWithImages,
  addImagesToCollection,
  addFavorites,
  getCollections,
  getAppPref,
  getFavorites,
  getImages,
  removeFavorites,
  removeCollectionRecord,
  removeImagesById,
  setAppPref,
  updateCollectionInfo,
  updateImageFileInfo,
} from "./lib/db";
import type { Collection, IndexedImage, IndexedImagePayload } from "./lib/types";
import { sortCollections } from "./lib/collectionSort";
import { formatBytes } from "./lib/formatBytes";
import { toComfyUrl } from "./lib/fileUrl";
import { AboutDialog, ABOUT_GRAPHIC_PUBLIC_PATH } from "./components/AboutDialog";
import { BulkRenameModal } from "./components/BulkRenameModal";
import { MoveFilesModal } from "./components/MoveFilesModal";
import { CollectionSidebar } from "./components/CollectionSidebar";
import { ImageGrid } from "./components/ImageGrid";
import { ImageViewer } from "./components/ImageViewer";
import { TabStrip } from "./components/TabStrip";
import { useContextMenuDispatcher } from "./hooks/useContextMenuDispatcher";
import { MenuActionBridge } from "./components/MenuActionBridge";
import type { CollectionSort, ProgressState, RenameState, Tab } from "./lib/appTypes";

const DEFAULT_ICON_SIZE = 180;
const GRID_GAP = 16;
const CARD_META_HEIGHT = 56;
const THUMBNAIL_BATCH_SIZE = 6;
const THUMBNAIL_RETRY_MS = 1200;
const FILE_URL_BATCH_SIZE = 30;
const REMOVAL_BATCH_SIZE = 50;
const FAVORITES_ID = "favorites";
const THUMBNAIL_CACHE_LIMIT = 2000;

type ZoomMode = "fit" | "actual" | "width" | "height" | "manual";
type ImageSort = "name-asc" | "name-desc" | "date-desc" | "date-asc" | "size-desc" | "size-asc";
type RemovalItem = { id: string; label: string };
type RemovalRequest = {
  requestId: string;
  promise: Promise<void>;
};
type IndexingRequest<T> = {
  requestId: string;
  promise: Promise<T>;
};

type MetadataValue = string | number | boolean | null | MetadataValue[] | { [key: string]: MetadataValue };

const renderMetadataRows = (value: MetadataValue, prefix = ""): Array<{ key: string; value: string }> => {
  if (value === null || value === undefined) {
    return [{ key: prefix, value: "null" }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => renderMetadataRows(item, `${prefix}[${index}]`));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, val]) =>
      renderMetadataRows(val, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [{ key: prefix, value: String(value) }];
};

const parseJsonValue = (value: string | undefined) => {
  if (!value) return null;
  try {
    return JSON.parse(value) as MetadataValue;
  } catch {
    return null;
  }
};

const pickString = (value: MetadataValue | undefined) => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
};

const extractMetadataSummary = (metadata: Record<string, string> | null) => {
  if (!metadata) return null;
  const parsedPrompt = parseJsonValue(metadata.prompt);
  const parsedWorkflow = parseJsonValue(metadata.workflow);
  const parsed = (parsedPrompt && typeof parsedPrompt === "object" ? parsedPrompt : {}) as Record<string, MetadataValue>;
  const fallback = (parsedWorkflow && typeof parsedWorkflow === "object" ? parsedWorkflow : {}) as Record<string, MetadataValue>;

  const promptNodes = parsed && typeof parsed === "object" ? Object.values(parsed) : [];
  const workflowNodes = Array.isArray(fallback.nodes) ? fallback.nodes : [];
  const findNodeInput = (nodes: MetadataValue[], inputKey: string) => {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const inputs = (node as Record<string, MetadataValue>).inputs;
      if (inputs && typeof inputs === "object" && inputKey in inputs) {
        return (inputs as Record<string, MetadataValue>)[inputKey];
      }
      const widgets = (node as Record<string, MetadataValue>).widgets_values;
      if (Array.isArray(widgets) && widgets.length && inputKey === "text") {
        const maybeText = widgets.find((item) => typeof item === "string") as string | undefined;
        if (maybeText) return maybeText;
      }
    }
    return undefined;
  };

  const promptText =
    pickString(parsed.prompt) ||
    pickString(parsed.positive) ||
    pickString(parsed.text) ||
    pickString(findNodeInput(promptNodes, "text")) ||
    (typeof metadata.prompt === "string" && !parsedPrompt ? metadata.prompt : null);

  const width =
    pickString(parsed.width) ||
    pickString(findNodeInput(promptNodes, "width")) ||
    pickString(findNodeInput(workflowNodes, "width"));
  const height =
    pickString(parsed.height) ||
    pickString(findNodeInput(promptNodes, "height")) ||
    pickString(findNodeInput(workflowNodes, "height"));
  const batchSize =
    pickString(parsed.batch_size) ||
    pickString(parsed.batchSize) ||
    pickString(findNodeInput(promptNodes, "batch_size")) ||
    pickString(findNodeInput(workflowNodes, "batch_size"));
  const checkpoint =
    pickString(parsed.model) ||
    pickString(parsed.checkpoint) ||
    pickString(parsed.checkpoint_name) ||
    pickString(findNodeInput(promptNodes, "ckpt_name")) ||
    pickString(findNodeInput(workflowNodes, "ckpt_name"));
  const seed =
    pickString(parsed.seed) ||
    pickString(findNodeInput(promptNodes, "seed")) ||
    pickString(findNodeInput(workflowNodes, "seed"));

  const loraValues = [
    parsed.loras,
    parsed.lora,
    findNodeInput(promptNodes, "lora_name"),
    findNodeInput(workflowNodes, "lora_name"),
  ];
  const loras: Array<{ name: string; strength?: number }> = [];
  const pushLora = (value: MetadataValue | undefined | null, strength?: number) => {
    if (!value) return;
    if (typeof value === "string") {
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => loras.push({ name: entry, strength }));
      return;
    }
    if (typeof value === "number") {
      loras.push({ name: String(value), strength });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => pushLora(item, strength));
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, MetadataValue>;
      const named =
        pickString(record.lora_name) ||
        pickString(record.lora) ||
        pickString(record.name) ||
        pickString(record.model);
      if (named) {
        loras.push({ name: named, strength });
      }
      Object.values(record).forEach((entry) => pushLora(entry, strength));
    }
  };
  const collectLoras = (value: MetadataValue | undefined | null) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => collectLoras(entry));
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, MetadataValue>;
      const strengthModel = typeof record.strength_model === "number" ? record.strength_model : undefined;
      const strengthClip = typeof record.strength_clip === "number" ? record.strength_clip : undefined;
      const strength = strengthModel ?? strengthClip;
      Object.entries(record).forEach(([key, entry]) => {
        if (key === "lora_name" || key === "lora" || key === "loraName") {
          pushLora(entry, strength);
        }
        collectLoras(entry);
      });
    }
  };

  loraValues.forEach((value) => pushLora(value));
  collectLoras(parsedPrompt as MetadataValue);
  collectLoras(parsedWorkflow as MetadataValue);
  const uniqueLoras = Array.from(
    loras.reduce((map, entry) => {
      const key = entry.name;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, entry);
        return map;
      }
      if (existing.strength === undefined && entry.strength !== undefined) {
        map.set(key, entry);
      }
      return map;
    }, new Map<string, { name: string; strength?: number }>())
  ).map((entry) => entry[1]);

  return {
    promptText,
    width,
    height,
    batchSize,
    checkpoint,
    seed,
    loras: uniqueLoras,
  };
};

const CollectionTab: Tab = { id: "collection", title: "Collection", type: "collection" };

export default function App() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [images, setImages] = useState<IndexedImage[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([CollectionTab]);
  const [activeTab, setActiveTab] = useState<Tab>(CollectionTab);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [iconSize, setIconSize] = useState(DEFAULT_ICON_SIZE);
  const [activeCollection, setActiveCollection] = useState<string | "all">("all");
  const [isIndexing, setIsIndexing] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [zoomByTab, setZoomByTab] = useState<Record<string, { mode: ZoomMode; level: number }>>({});
  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const viewerFocusRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabScrollRef = useRef<HTMLDivElement | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastCopied, setLastCopied] = useState<string | null>(null);
  const [toastVisibleMessage, setToastVisibleMessage] = useState<string | null>(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const [collectionSort, setCollectionSort] = useState<CollectionSort>("name-asc");
  const [imageSort, setImageSort] = useState<ImageSort>("date-desc");
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(new Set());
  const [collectionSelectionAnchor, setCollectionSelectionAnchor] = useState<number | null>(null);
  const [collectionFocusedId, setCollectionFocusedId] = useState<string | null>(null);
  const [folderProgress, setFolderProgress] = useState<ProgressState>(null);
  const [imageProgress, setImageProgress] = useState<ProgressState>(null);
  const [removalCollectionProgress, setRemovalCollectionProgress] = useState<ProgressState>(null);
  const [removalImageProgress, setRemovalImageProgress] = useState<ProgressState>(null);
  const [removalCanceling, setRemovalCanceling] = useState(false);
  const [isDeletingFiles, setIsDeletingFiles] = useState(false);
  const indexingTokenRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const liveIndexRef = useRef<
    { active: boolean; basePaths: Set<string>; addedPaths: Set<string>; addedCollectionRoots: Set<string> } | null
  >(null);
  const liveIndexQueueRef = useRef<{ collections: Collection[]; images: IndexedImage[]; timer: number | null }>(
    {
      collections: [],
      images: [],
      timer: null,
    }
  );
  const [cancelingIndex, setCancelingIndex] = useState(false);
  const [gridMetrics, setGridMetrics] = useState({ width: 0, height: 0, scrollTop: 0 });
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridInnerRef = useRef<HTMLDivElement | null>(null);
  const [thumbnailMap, setThumbnailMap] = useState<Record<string, string>>({});
  const [loadedThumbs, setLoadedThumbs] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [renameState, setRenameState] = useState<RenameState>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<{ name: string; version: string } | null>(null);
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false);
  const [bulkRenameBase, setBulkRenameBase] = useState("");
  const [bulkRenameDigits, setBulkRenameDigits] = useState(3);
  const [bulkRenaming, setBulkRenaming] = useState(false);
  const [bulkRenameError, setBulkRenameError] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDestination, setMoveDestination] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const handleBulkRenameBaseChange = useCallback((value: string) => {
    setBulkRenameBase(value);
  }, []);
  const handleBulkRenameDigitsChange = useCallback((value: number) => {
    setBulkRenameDigits(Math.max(1, value || 1));
  }, []);
  const handleBulkRenameCancel = useCallback(() => {
    setBulkRenameOpen(false);
    setBulkRenameError(null);
  }, []);
  const [metadataSummary, setMetadataSummary] = useState<ReturnType<typeof extractMetadataSummary> | null>(null);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const activeImageRef = useRef<HTMLImageElement | null>(null);
  const renameCancelRef = useRef(false);
  const renameTargetRef = useRef<string | null>(null);
  const thumbnailMapRef = useRef<Record<string, string>>({});
  const thumbnailPendingRef = useRef<Set<string>>(new Set());
  const thumbnailOrderRef = useRef<string[]>([]);
  const loadedThumbOrderRef = useRef<string[]>([]);
  const thumbnailRetryRef = useRef<number | null>(null);
  const thumbnailTokenRef = useRef(0);
  const [thumbnailRetryTick, setThumbnailRetryTick] = useState(0);
  const metadataCacheRef = useRef<Map<string, ReturnType<typeof extractMetadataSummary>>>(new Map());
  const keyNavContextRef = useRef({
  activeTab: CollectionTab as Tab,
    selectedIds: new Set<string>(),
    selectedCollectionIds: new Set<string>(),
    images: [] as IndexedImage[],
    collections: [] as Collection[],
    activeCollection: "all" as string | "all",
    collectionById: new Map<string, Collection>(),
    filteredImageIds: [] as string[],
    filteredImageCount: 0,
    focusedIndex: 0 as number | null,
    selectionAnchor: 0 as number | null,
    gridColumnCount: 1,
    gridHeight: 0,
    rowHeight: 0,
    tabs: [] as Tab[],
    navigationImageIds: [] as string[],
    imageById: new Map<string, IndexedImage>(),
    getRangeIds: (_start: number, _end: number) => new Set<string>(),
    startRenameImage: (_image: IndexedImage) => { },
    startRenameCollection: (_collection: Collection) => { },
    toggleFavoriteImage: (_image: IndexedImage) => Promise.resolve(),
  handleOpenImages: (_images: IndexedImage[], _options?: { activate?: boolean }) => Promise.resolve(),
    handleNavigateImage: (_image: IndexedImage) => Promise.resolve(),
    handleCloseTab: (_tabId: string) => { },
    handleDuplicateTab: () => { },
    handleCloseOtherTabs: (_tabId: string) => { },
    handleCloseAllTabs: () => { },
    handleSelectAllImages: () => { },
    handleInvertImageSelection: () => { },
    handleClearImageSelection: () => { },
    handleSelectAllCollections: () => { },
    handleInvertCollectionSelection: () => { },
    handleClearCollectionSelection: () => { },
  });
  const removalWorkerRef = useRef<Worker | null>(null);
  const removalRequestsRef = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
        onProgress?: (progress: { current: number; total: number; label: string }) => void;
      }
    >()
  );
  const removalRequestIdRef = useRef<string | null>(null);
  const removalCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const indexingWorkerRef = useRef<Worker | null>(null);
  const indexingRequestsRef = useRef(
    new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  );

  const yieldToPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const getPathSeparator = (value: string) => (value.includes("\\") ? "\\" : "/");
  const ensureTrailingSeparator = (value: string) =>
    value.endsWith("/") || value.endsWith("\\") ? value : `${value}${getPathSeparator(value)}`;
  const isPathWithinRoot = (candidate: string, root: string) =>
    candidate === root || candidate.startsWith(ensureTrailingSeparator(root));
  const getParentPath = (value: string) => {
    const separator = getPathSeparator(value);
    const parts = value.split(/[/\\\\]/).filter((segment) => segment.length > 0);
    if (parts.length <= 1) {
      return value;
    }
    const parent = parts.slice(0, -1).join(separator);
    if (value.startsWith(separator)) {
      return `${separator}${parent}`;
    }
    if (/^[A-Za-z]:/.test(value)) {
      return `${parts[0]}${separator}${parts.slice(1, -1).join(separator)}`;
    }
    return parent;
  };
  const joinPath = (base: string, next: string) => `${ensureTrailingSeparator(base)}${next}`;
  const getFileExtension = (name: string) => {
    const index = name.lastIndexOf(".");
    if (index <= 0) return "";
    return name.slice(index);
  };
  const deriveBulkRenameBase = (image?: IndexedImage) => {
    if (!image) return "image-";
    const extension = getFileExtension(image.fileName);
    const withoutExtension = image.fileName.slice(0, image.fileName.length - extension.length);
    const trimmed = withoutExtension.replace(/\d+$/g, "");
    return trimmed || "image-";
  };
  const formatBulkRenameName = (image: IndexedImage, base: string, digits: number, index: number) => {
    const extension = getFileExtension(image.fileName);
    const padded = String(index + 1).padStart(Math.max(1, digits), "0");
    return `${base}${padded}${extension}`;
  };
  const calculateBulkRenameDigits = (totalFiles: number) => {
    const normalized = Math.max(1, totalFiles);
    return Math.max(1, String(normalized).length + 1);
  };
  const formatIndexSummary = (label: string, collectionsAdded: number, imagesAdded: number, cancelled: boolean) => {
    const status = cancelled ? `${label} canceled` : `${label} complete`;
    const collectionLabel = collectionsAdded === 1 ? "collection" : "collections";
    const imageLabel = imagesAdded === 1 ? "image" : "images";
    return `${status} — added ${collectionsAdded} ${collectionLabel}, ${imagesAdded} ${imageLabel}`;
  };

  const normalizeForComparison = (value: string) => {
    if (!value) return value;
    let normalized = value;
    while (normalized.length > 1 && (normalized.endsWith("/") || normalized.endsWith("\\"))) {
      normalized = normalized.slice(0, -1);
    }
    if (/^[A-Za-z]:$/.test(normalized)) {
      return `${normalized}\\`;
    }
    return normalized;
  };

  const pathsAreEquivalent = (a: string, b: string) => normalizeForComparison(a) === normalizeForComparison(b);

  const runRemovalWorker = useCallback(
    (
      payload:
        | { type: "remove-images"; items: RemovalItem[]; batchSize: number }
        | { type: "remove-collection"; collectionId: string; items: RemovalItem[]; batchSize: number },
      onProgress?: (progress: { current: number; total: number; label: string }) => void
    ) => {
      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
      const promise = new Promise<void>((resolve, reject) => {
        const worker = removalWorkerRef.current;
        if (!worker) {
          reject(new Error("Removal worker unavailable"));
          return;
        }
        removalRequestsRef.current.set(requestId, { resolve, reject, onProgress });
        worker.postMessage({ ...payload, requestId });
      });
      return { requestId, promise } as RemovalRequest;
    },
    []
  );

  const runRemovalTask = useCallback(
    async (
      payload:
        | { type: "remove-images"; items: RemovalItem[]; batchSize: number }
        | { type: "remove-collection"; collectionId: string; items: RemovalItem[]; batchSize: number },
      onProgress: (progress: { current: number; total: number; label: string }) => void,
      fallback: () => Promise<void>
    ) => {
      removalCancelRef.current = { cancelled: false };
      setRemovalCanceling(false);
      let request: RemovalRequest | null = null;
      try {
        request = runRemovalWorker(payload, onProgress);
        removalRequestIdRef.current = request.requestId;
        await request.promise;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Removal failed";
        if (message.toLowerCase().includes("cancel")) {
          console.warn("[comfy-browser] removal canceled");
          setRemovalCollectionProgress(null);
          setRemovalImageProgress(null);
          return;
        }
        console.error("[comfy-browser] removal worker failed, falling back", error);
        await fallback();
      } finally {
        removalRequestIdRef.current = null;
        setRemovalCanceling(false);
      }
    },
    [runRemovalWorker]
  );

  const runIndexingWorker = useCallback(
    <T,>(payload: { type: string; data: unknown }) => {
      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
      const promise = new Promise<T>((resolve, reject) => {
        const worker = indexingWorkerRef.current;
        if (!worker) {
          reject(new Error("Indexing worker unavailable"));
          return;
        }
        indexingRequestsRef.current.set(requestId, { resolve, reject });
        worker.postMessage({ requestId, ...payload });
      });
      return { requestId, promise } as IndexingRequest<T>;
    },
    []
  );

  const runIndexingTask = useCallback(
    async <T,>(payload: { type: string; data: unknown }, fallback: () => Promise<T>) => {
      try {
        const request = runIndexingWorker<T>(payload);
        return await request.promise;
      } catch (error) {
        console.error("[comfy-browser] indexing worker failed, falling back", error);
        return await fallback();
      }
    },
    [runIndexingWorker]
  );

  const bridgeAvailable = typeof window !== "undefined" && !!window.comfy;

  useEffect(() => {
    console.log("[comfy-browser] UI mounted");
  }, []);

  useEffect(() => {
    if (removalWorkerRef.current) return;
    const worker = new Worker(new URL("./lib/removalWorker.ts", import.meta.url), { type: "module" });
    removalWorkerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data as
        | { type: "progress"; requestId: string; current: number; total: number; label: string }
        | { type: "done"; requestId: string }
        | { type: "error"; requestId: string; message: string };
      if (!message || typeof message !== "object" || !("requestId" in message)) return;
      const entry = removalRequestsRef.current.get(message.requestId);
      if (!entry) return;
      if (message.type === "progress") {
        entry.onProgress?.({ current: message.current, total: message.total, label: message.label });
        return;
      }
      removalRequestsRef.current.delete(message.requestId);
      if (message.type === "done") {
        entry.resolve();
        return;
      }
      entry.reject(new Error(message.message || "Removal worker failed"));
    };
    worker.onerror = (event) => {
      console.error("[comfy-browser] removal worker error", event);
    };
    return () => {
      worker.terminate();
      removalWorkerRef.current = null;
      removalRequestsRef.current.clear();
      removalRequestIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (indexingWorkerRef.current) return;
    const worker = new Worker(new URL("./lib/indexingWorker.ts", import.meta.url), { type: "module" });
    indexingWorkerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data as
        | { type: "done"; requestId: string; payload: unknown }
        | { type: "error"; requestId: string; message: string };
      if (!message || typeof message !== "object" || !("requestId" in message)) return;
      const entry = indexingRequestsRef.current.get(message.requestId);
      if (!entry) return;
      indexingRequestsRef.current.delete(message.requestId);
      if (message.type === "done") {
        entry.resolve(message.payload);
        return;
      }
      entry.reject(new Error(message.message || "Indexing worker failed"));
    };
    worker.onerror = (event) => {
      console.error("[comfy-browser] indexing worker error", event);
    };
    return () => {
      worker.terminate();
      indexingWorkerRef.current = null;
      indexingRequestsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!bridgeAvailable || !window.comfy?.getAppInfo) return;
    window.comfy.getAppInfo().then(setAppInfo).catch(() => null);
  }, [bridgeAvailable]);

  useEffect(() => {
    if (!renameState) {
      renameTargetRef.current = null;
      return;
    }
    const targetKey = `${renameState.type}:${renameState.id}`;
    if (renameTargetRef.current === targetKey) return;
    renameTargetRef.current = targetKey;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      const input = renameInputRef.current;
      if (!input) return;
      if (renameState.type === "image") {
        const value = input.value;
        const dotIndex = value.lastIndexOf(".");
        if (dotIndex > 0) {
          input.setSelectionRange(0, dotIndex);
          return;
        }
      }
      input.select();
    });
  }, [renameState]);

  useEffect(() => {
    document.documentElement.style.setProperty("--icon-size", `${iconSize}px`);
  }, [iconSize]);

  useEffect(() => {
    thumbnailMapRef.current = thumbnailMap;
  }, [thumbnailMap]);

  const pruneThumbnailCache = useCallback(
    (prev: Record<string, string>, additions: Record<string, string>) => {
      const next = { ...prev, ...additions };
      let order = thumbnailOrderRef.current.filter((id) => id in next);
      const addedIds = Object.keys(additions);
      if (addedIds.length > 0) {
        order = order.filter((id) => !addedIds.includes(id));
        order.push(...addedIds);
      }
      const removedIds: string[] = [];
      while (order.length > THUMBNAIL_CACHE_LIMIT) {
        const removed = order.shift();
        if (removed && removed in next) {
          delete next[removed];
          removedIds.push(removed);
        }
      }
      thumbnailOrderRef.current = order.filter((id) => id in next);
      return { next, removedIds };
    },
    []
  );

  const removeLoadedThumbs = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setLoadedThumbs((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      loadedThumbOrderRef.current = loadedThumbOrderRef.current.filter((id) => !ids.includes(id));
      return next;
    });
  }, []);

  const removeThumbnailEntries = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setThumbnailMap((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        thumbnailOrderRef.current = thumbnailOrderRef.current.filter((id) => !ids.includes(id));
        return next;
      });
      removeLoadedThumbs(ids);
    },
    [removeLoadedThumbs]
  );

  const markThumbLoaded = useCallback((id: string) => {
    setLoadedThumbs((prev) => {
      const next = new Set(prev);
      next.add(id);
      let order = loadedThumbOrderRef.current.filter((entry) => entry !== id);
      order.push(id);
      while (order.length > THUMBNAIL_CACHE_LIMIT) {
        const removed = order.shift();
        if (removed) {
          next.delete(removed);
        }
      }
      loadedThumbOrderRef.current = order;
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (thumbnailRetryRef.current) {
        window.clearTimeout(thumbnailRetryRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void setAppPref("iconSize", iconSize);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [iconSize]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void setAppPref("activeCollection", activeCollection);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [activeCollection]);

  useEffect(() => {
    console.log("[comfy-browser] Active collection changed", activeCollection);
  }, [activeCollection]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void setAppPref("collectionSort", collectionSort);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [collectionSort]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void setAppPref("imageSort", imageSort);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [imageSort]);

  const collectionById = useMemo(() => {
    return new Map(collections.map((collection) => [collection.id, collection]));
  }, [collections]);


  const imageById = useMemo(() => {
    return new Map(images.map((image) => [image.id, image]));
  }, [images]);

  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const image of images) {
      const collectionName = image.collectionId
        ? collectionById.get(image.collectionId)?.name ?? ""
        : "Unassigned";
      const metaString = image.metadataText ? JSON.stringify(image.metadataText).toLowerCase() : "";
      map.set(image.id, `${image.fileName.toLowerCase()}|${collectionName.toLowerCase()}|${metaString}`);
    }
    return map;
  }, [images, collectionById]);

  const gridColumnCount = useMemo(() => {
    if (!gridMetrics.width) return 1;
    return Math.max(1, Math.floor((gridMetrics.width + GRID_GAP) / (iconSize + GRID_GAP)));
  }, [gridMetrics.width, iconSize]);

  const rowHeight = iconSize + CARD_META_HEIGHT + GRID_GAP;

  const sortImages = useCallback(
    (items: IndexedImage[]) => {
      let createdAtMap: Map<string, number> | null = null;
      if (imageSort === "date-asc" || imageSort === "date-desc") {
        createdAtMap = new Map(items.map((image) => [image.id, Date.parse(image.createdAt)]));
      }
      const sorted = [...items];
      sorted.sort((a, b) => {
        switch (imageSort) {
          case "name-asc":
            return a.fileName.localeCompare(b.fileName);
          case "name-desc":
            return b.fileName.localeCompare(a.fileName);
          case "date-asc": {
            const aTime = createdAtMap?.get(a.id) ?? 0;
            const bTime = createdAtMap?.get(b.id) ?? 0;
            return aTime - bTime;
          }
          case "date-desc": {
            const aTime = createdAtMap?.get(a.id) ?? 0;
            const bTime = createdAtMap?.get(b.id) ?? 0;
            return bTime - aTime;
          }
          case "size-asc":
            return a.sizeBytes - b.sizeBytes;
          case "size-desc":
            return b.sizeBytes - a.sizeBytes;
          default:
            return 0;
        }
      });
      return sorted;
    },
    [imageSort]
  );

  const sortedFilteredImages = useMemo(() => {
    const start = performance.now();
    const query = search.trim().toLowerCase();
    const visible = images.filter((image) => {
      if (activeCollection === FAVORITES_ID && !favoriteIds.has(image.id)) {
        return false;
      }
      if (
        activeCollection !== "all" &&
        activeCollection !== FAVORITES_ID &&
        image.collectionId !== activeCollection
      ) {
        return false;
      }
      if (!query) return true;
      const searchText = searchIndex.get(image.id) ?? "";
      return searchText.includes(query);
    });
    const sorted = sortImages(visible);
    const duration = performance.now() - start;
    if (duration > 50) {
      console.log("[comfy-browser] Filter/sort cost", {
        durationMs: Number(duration.toFixed(1)),
        total: images.length,
        visible: sorted.length,
      });
    }
    return { sorted, query };
  }, [images, search, activeCollection, favoriteIds, searchIndex, sortImages]);

  const filteredImageResult = useMemo(() => {
    const sorted = sortedFilteredImages.sorted;
    const ids = sorted.map((image) => image.id);
    const allImagesMode = activeCollection === "all" && !sortedFilteredImages.query;
    if (allImagesMode && sorted.length > gridColumnCount * 3) {
      const bufferRows = 6;
      const startRow = Math.max(0, Math.floor(gridMetrics.scrollTop / rowHeight) - bufferRows);
      const endRow = Math.ceil((gridMetrics.scrollTop + gridMetrics.height) / rowHeight) + bufferRows;
      const windowStartIndex = startRow * gridColumnCount;
      const windowEndIndex = Math.min(ids.length, (endRow + 1) * gridColumnCount);
      const windowed = sorted.slice(windowStartIndex, windowEndIndex);
      return { items: windowed, ids, totalCount: ids.length, windowStartIndex };
    }
    return { items: sorted, ids, totalCount: ids.length, windowStartIndex: 0 };
  }, [
    sortedFilteredImages,
    activeCollection,
    gridColumnCount,
    gridMetrics.scrollTop,
    gridMetrics.height,
    rowHeight,
  ]);

  const filteredImages = filteredImageResult.items;
  const filteredImageIds = filteredImageResult.ids;
  const filteredImageCount = filteredImageResult.totalCount;
  const filteredWindowStart = filteredImageResult.windowStartIndex;

  const filteredIndexById = useMemo(() => {
    return new Map(filteredImageIds.map((id, index) => [id, index] as const));
  }, [filteredImageIds]);

  const selectedImages = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const orderedIds = Array.from(selectedIds)
      .map((id) => ({ id, index: filteredIndexById.get(id) }))
      .filter((entry): entry is { id: string; index: number } => typeof entry.index === "number")
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.id);
    return orderedIds
      .map((id) => imageById.get(id))
      .filter((image): image is IndexedImage => Boolean(image));
  }, [selectedIds, filteredIndexById, imageById]);

  const selectedOrderedImageIds = useMemo(
    () => filteredImageIds.filter((id) => selectedIds.has(id)),
    [filteredImageIds, selectedIds]
  );
  const selectedOrderedImages = useMemo(
    () =>
      selectedOrderedImageIds
        .map((id) => imageById.get(id))
        .filter((image): image is IndexedImage => Boolean(image))
    ,
    [selectedOrderedImageIds, imageById]
  );
  const bulkRenamePreviewEntries = useMemo(() => {
    const previewIndexes = new Set<number>();
    const total = selectedOrderedImages.length;
    if (total === 0) return [];
    for (let index = 0; index < Math.min(2, total); index += 1) {
      previewIndexes.add(index);
    }
    for (let index = Math.max(0, total - 2); index < total; index += 1) {
      previewIndexes.add(index);
    }
    const base = bulkRenameBase.length > 0 ? bulkRenameBase : deriveBulkRenameBase(selectedOrderedImages[0]);
    const digits = Math.max(1, bulkRenameDigits);
    return Array.from(previewIndexes)
      .sort((a, b) => a - b)
      .map((index) => {
        const image = selectedOrderedImages[index];
        return image
          ? {
            id: image.id,
            fileName: image.fileName,
            nextName: formatBulkRenameName(image, base, digits, index),
          }
          : null;
      })
      .filter((entry): entry is { id: string; fileName: string; nextName: string } => Boolean(entry));
  }, [selectedOrderedImages, bulkRenameBase, bulkRenameDigits, deriveBulkRenameBase]);
  const bulkRenameAdditionalCount = Math.max(0, selectedOrderedImages.length - bulkRenamePreviewEntries.length);
  const movePreviewEntries = useMemo(() => {
    const previewLimit = Math.min(selectedOrderedImages.length, 8);
    return selectedOrderedImages.slice(0, previewLimit).map((image) => ({
      id: image.id,
      fileName: image.fileName,
      filePath: image.filePath,
    }));
  }, [selectedOrderedImages]);
  const movePreviewAdditionalCount = Math.max(0, selectedOrderedImages.length - movePreviewEntries.length);
  const trimmedMoveDestination = moveDestination.trim();
  const moveWillChange = Boolean(
    trimmedMoveDestination &&
      selectedOrderedImages.some((image) => joinPath(trimmedMoveDestination, image.fileName) !== image.filePath)
  );
  const moveReady = Boolean(trimmedMoveDestination && moveWillChange);

  const collectionIdForNav =
    activeTab.type === "image"
      ? activeCollection === FAVORITES_ID && favoriteIds.has(activeTab.image.id)
        ? FAVORITES_ID
        : activeTab.image.collectionId
      : activeCollection;
  const collectionHighlightId = collectionIdForNav;

  const navigationImageIds = filteredImageIds;

  const totalRows = Math.ceil(filteredImageCount / gridColumnCount);
  const startRow = Math.max(0, Math.floor(gridMetrics.scrollTop / rowHeight) - 1);
  const endRow = Math.min(
    totalRows - 1,
    Math.ceil((gridMetrics.scrollTop + gridMetrics.height) / rowHeight) + 1
  );
  const startIndex = startRow * gridColumnCount;
  const endIndex = Math.min(filteredImageCount, (endRow + 1) * gridColumnCount);
  const visibleImages = filteredImages.slice(
    Math.max(0, startIndex - filteredWindowStart),
    Math.max(0, endIndex - filteredWindowStart)
  );
  useLayoutEffect(() => {
    if (gridInnerRef.current) {
      gridInnerRef.current.style.height = `${totalRows * rowHeight}px`;
    }
  }, [rowHeight, totalRows]);

  const getRangeIds = useCallback(
    (start: number, end: number) => {
      const [from, to] = start < end ? [start, end] : [end, start];
      const ids = filteredImageIds.slice(from, to + 1);
      return new Set(ids);
    },
    [filteredImageIds]
  );

  const scrollToIndex = useCallback(
    (index: number) => {
      const grid = gridRef.current;
      if (!grid) return;
      const row = Math.floor(index / gridColumnCount);
      const rowTop = row * rowHeight;
      const rowBottom = rowTop + rowHeight;
      const viewTop = grid.scrollTop;
      const viewBottom = viewTop + grid.clientHeight;
      if (rowTop < viewTop) {
        grid.scrollTop = rowTop;
        setGridMetrics((prev) => (prev.scrollTop === rowTop ? prev : { ...prev, scrollTop: rowTop }));
      } else if (rowBottom > viewBottom) {
        const nextScrollTop = rowBottom - grid.clientHeight;
        grid.scrollTop = nextScrollTop;
        setGridMetrics((prev) => (prev.scrollTop === nextScrollTop ? prev : { ...prev, scrollTop: nextScrollTop }));
      }
    },
    [gridColumnCount, rowHeight]
  );

  useLayoutEffect(() => {
    if (focusedIndex === null) return;
    scrollToIndex(focusedIndex);
  }, [focusedIndex, scrollToIndex]);

  useEffect(() => {
    const visibleIds = new Set(filteredImageIds);
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setFocusedIndex((prev) => {
      if (prev === null) return prev;
      if (filteredImageCount === 0) return null;
      return Math.min(prev, filteredImageCount - 1);
    });
  }, [filteredImageIds, filteredImageCount]);

  useEffect(() => {
    const grid = gridRef.current;
    if (grid) {
      grid.scrollTop = 0;
      setGridMetrics((prev) => ({ ...prev, scrollTop: 0 }));
    }
    setFocusedIndex(filteredImageCount > 0 ? 0 : null);
    setSelectionAnchor(filteredImageCount > 0 ? 0 : null);
    if (filteredImageCount > 0) {
      const firstId = filteredImageIds[0];
      if (firstId) {
        setSelectedIds(new Set([firstId]));
      }
    } else {
      setSelectedIds(new Set());
    }
  }, [activeCollection]);

  const sortedCollections = useMemo(
    () => sortCollections(collections, collectionSort),
    [collections, collectionSort]
  );

  const collectionIds = useMemo(() => sortedCollections.map((collection) => collection.id), [sortedCollections]);

  const hydrateFileUrls = useCallback(
    (sourceImages: IndexedImage[]) => {
      if (!bridgeAvailable || sourceImages.length === 0) return () => undefined;
      let cancelled = false;
      let cursor = 0;

      type IdleHandle = ReturnType<typeof globalThis.setTimeout> | number;
      const requestIdle = (callback: () => void): IdleHandle => {
        if ("requestIdleCallback" in window) {
          return (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(callback);
        }
        return globalThis.setTimeout(callback, 0);
      };

      const cancelIdle = (id: IdleHandle) => {
        if ("cancelIdleCallback" in window) {
          (window as Window & { cancelIdleCallback: (cb: number) => void }).cancelIdleCallback(id as number);
        } else {
          globalThis.clearTimeout(id);
        }
      };

      let idleId: IdleHandle | null = null;

      const runBatch = async () => {
        if (cancelled) return;
        const batch = sourceImages.slice(cursor, cursor + FILE_URL_BATCH_SIZE);
        if (!batch.length) {
          console.log("[comfy-browser] File URL hydration complete");
          return;
        }

        const updates = await Promise.all(
          batch.map(async (image) => {
            if (image.fileUrl !== image.filePath) {
              return { id: image.id, fileUrl: image.fileUrl };
            }
            try {
              const fileUrl = await window.comfy.toFileUrl(image.filePath);
              return { id: image.id, fileUrl };
            } catch {
              return { id: image.id, fileUrl: image.filePath };
            }
          })
        );

        if (cancelled) return;
        const updateMap = new Map(updates.map((item) => [item.id, item.fileUrl]));
        setImages((prev) =>
          prev.map((image) => {
            const nextUrl = updateMap.get(image.id);
            return nextUrl ? { ...image, fileUrl: nextUrl } : image;
          })
        );

        cursor += FILE_URL_BATCH_SIZE;
        idleId = requestIdle(() => {
          void runBatch();
        });
      };

      console.log("[comfy-browser] Starting file URL hydration", { total: sourceImages.length });
      idleId = requestIdle(() => {
        void runBatch();
      });

      return () => {
        cancelled = true;
        if (idleId !== null) {
          cancelIdle(idleId);
        }
      };
    },
    [bridgeAvailable]
  );

  const flushLiveIndexQueue = useCallback(() => {
    const queue = liveIndexQueueRef.current;
    if (queue.timer) {
      window.clearTimeout(queue.timer);
      queue.timer = null;
    }
    if (queue.collections.length > 0) {
      setCollections((prev) => [...prev, ...queue.collections]);
      queue.collections = [];
    }
    if (queue.images.length > 0) {
      const baseImages = queue.images.map((image) => ({ ...image, fileUrl: image.filePath }));
      setImages((prev) => [...prev, ...baseImages]);
      hydrateFileUrls(baseImages);
      queue.images = [];
    }
  }, [hydrateFileUrls]);

  const applyResolvedTabUrls = useCallback((updates: IndexedImage[]) => {
    if (updates.length === 0) return;
    const updateMap = new Map(updates.map((entry) => [entry.id, entry.fileUrl]));
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.type !== "image") return tab;
        const nextUrl = updateMap.get(tab.image.id);
        return nextUrl ? { ...tab, image: { ...tab.image, fileUrl: nextUrl } } : tab;
      })
    );
    setActiveTab((current) => {
      if (current.type !== "image") return current;
      const nextUrl = updateMap.get(current.image.id);
      return nextUrl ? { ...current, image: { ...current.image, fileUrl: nextUrl } } : current;
    });
  }, []);

  const resolveFileUrlsForTabs = useCallback(
    async (imagesToOpen: IndexedImage[]) => {
      if (!bridgeAvailable) return imagesToOpen;
      const updates = await Promise.all(
        imagesToOpen.map(async (image) => {
          if (image.fileUrl !== image.filePath) return image;
          try {
            const fileUrl = await window.comfy.toFileUrl(image.filePath);
            return { ...image, fileUrl };
          } catch {
            return image;
          }
        })
      );

      return updates;
    },
    [bridgeAvailable]
  );

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const load = async () => {
      console.log("[comfy-browser] Loading collections and images...");
      const [
        collectionRows,
        imageRows,
        favoriteRows,
        storedIconSize,
        storedCollection,
        storedCollectionSort,
        storedImageSort,
      ] = await Promise.all([
        getCollections(),
        getImages(),
        getFavorites(),
        getAppPref<number>("iconSize"),
        getAppPref<string>("activeCollection"),
        getAppPref<CollectionSort>("collectionSort"),
        getAppPref<ImageSort>("imageSort"),
      ]);
      const baseImages = imageRows.map((image: IndexedImage) => ({ ...image, fileUrl: image.filePath }));
      const fallbackActiveCollection = storedCollection;
      const fallbackCollectionSort = storedCollectionSort;
      console.log("[comfy-browser] Loaded", {
        collections: collectionRows.length,
        images: baseImages.length,
      });
      setCollections(collectionRows);
      setImages(baseImages);
      setFavoriteIds(new Set(favoriteRows));
      cleanup = hydrateFileUrls(baseImages);
      if (storedIconSize) {
        setIconSize(storedIconSize);
      }
      if (fallbackActiveCollection === FAVORITES_ID || fallbackActiveCollection === "all") {
        setActiveCollection(fallbackActiveCollection as string | "all");
      } else if (
        fallbackActiveCollection &&
        collectionRows.some((collection: Collection) => collection.id === fallbackActiveCollection)
      ) {
        setActiveCollection(fallbackActiveCollection as string | "all");
      } else if (fallbackActiveCollection) {
        setActiveCollection("all");
      }
      if (fallbackCollectionSort) {
        setCollectionSort(fallbackCollectionSort);
      }
      if (storedImageSort) {
        setImageSort(storedImageSort);
      }
    };
    load();
    return () => cleanup?.();
  }, [hydrateFileUrls]);

  useEffect(() => {
    if (!bridgeAvailable) return;
    thumbnailTokenRef.current += 1;
  }, [bridgeAvailable, visibleImages, pruneThumbnailCache, removeLoadedThumbs]);


  useEffect(() => {
    if (!bridgeAvailable || !window.comfy?.getCachedThumbnails) return;
    let cancelled = false;
    const token = thumbnailTokenRef.current;

    const prefill = async () => {
      const currentMap = thumbnailMapRef.current;
      const missing = visibleImages.filter((image) => !currentMap[image.id]);
      if (!missing.length) return;

      const results = await window.comfy.getCachedThumbnails(
        missing.map((image) => ({ id: image.id, filePath: image.filePath }))
      );

      if (cancelled || token !== thumbnailTokenRef.current) return;

      let removedIds: string[] = [];
      setThumbnailMap((prev) => {
        const additions: Record<string, string> = {};
        for (const result of results) {
          if (result.url) {
            additions[result.id] = result.url;
          }
        }
        const pruned = pruneThumbnailCache(prev, additions);
        removedIds = pruned.removedIds;
        return pruned.next;
      });
      removeLoadedThumbs(removedIds);
    };

    void prefill();
    return () => {
      cancelled = true;
    };
  }, [bridgeAvailable, visibleImages]);

  useEffect(() => {
    if (!bridgeAvailable || activeTab.type !== "image") return;
    const image = activeTab.image;
    if (image.fileUrl !== image.filePath) return;
    let cancelled = false;

    const resolve = async () => {
      if (!window.comfy?.toFileUrl) return;
      try {
        const fileUrl = await window.comfy.toFileUrl(image.filePath);
        if (cancelled) return;
        applyResolvedTabUrls([{ ...image, fileUrl }]);
      } catch {
        // ignore resolve failure
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [activeTab, bridgeAvailable, applyResolvedTabUrls]);

  useEffect(() => {
    if (!bridgeAvailable) return;
    let cancelled = false;
    const token = thumbnailTokenRef.current;
    type IdleHandle = ReturnType<typeof globalThis.setTimeout> | number;
    let idleId: IdleHandle | null = null;

    const requestIdle = (callback: () => void): IdleHandle => {
      if ("requestIdleCallback" in window) {
        return (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(callback);
      }
      return globalThis.setTimeout(callback, 0);
    };

    const cancelIdle = (id: IdleHandle) => {
      if ("cancelIdleCallback" in window) {
        (window as Window & { cancelIdleCallback: (cb: number) => void }).cancelIdleCallback(id as number);
      } else {
        globalThis.clearTimeout(id);
      }
    };

    const scheduleRetry = () => {
      if (thumbnailRetryRef.current) return;
      thumbnailRetryRef.current = window.setTimeout(() => {
        if (token !== thumbnailTokenRef.current) return;
        thumbnailRetryRef.current = null;
        setThumbnailRetryTick((tick) => tick + 1);
      }, THUMBNAIL_RETRY_MS);
    };

    const fetchThumbs = async () => {
      const currentMap = thumbnailMapRef.current;
      const missing = visibleImages.filter((image) => !currentMap[image.id]);
      if (!missing.length) return;

      console.log("[comfy-browser] Fetching thumbnails", {
        visible: visibleImages.length,
        missing: missing.length,
        batch: Math.min(THUMBNAIL_BATCH_SIZE, missing.length),
      });

      const batch = missing.slice(0, THUMBNAIL_BATCH_SIZE).filter((image) => {
        if (token !== thumbnailTokenRef.current || cancelled) return false;
        if (thumbnailPendingRef.current.has(image.id)) return false;
        thumbnailPendingRef.current.add(image.id);
        return true;
      });

      if (!batch.length) return;

      const results = await Promise.all(
        batch.map(async (image) => {
          try {
            const url = await window.comfy.getThumbnail(image.filePath);
            return { id: image.id, url };
          } catch (error) {
            console.log("[comfy-browser] Thumbnail fetch failed", {
              filePath: image.filePath,
              error,
            });
            return { id: image.id, url: null };
          }
        })
      );

      if (cancelled || token !== thumbnailTokenRef.current) return;

      let shouldRetry = false;
      let removedIds: string[] = [];
      setThumbnailMap((prev) => {
        const additions: Record<string, string> = {};
        for (const result of results) {
          thumbnailPendingRef.current.delete(result.id);
          if (result.url) {
            additions[result.id] = result.url;
          } else {
            shouldRetry = true;
          }
        }
        const pruned = pruneThumbnailCache(prev, additions);
        removedIds = pruned.removedIds;
        return pruned.next;
      });
      removeLoadedThumbs(removedIds);

      if (shouldRetry) {
        scheduleRetry();
      }
    };

    idleId = requestIdle(() => {
      void fetchThumbs();
    });
    return () => {
      cancelled = true;
      if (idleId !== null) {
        cancelIdle(idleId);
      }
      if (thumbnailRetryRef.current) {
        window.clearTimeout(thumbnailRetryRef.current);
        thumbnailRetryRef.current = null;
      }
      thumbnailPendingRef.current.clear();
    };
  }, [visibleImages, bridgeAvailable, thumbnailRetryTick, pruneThumbnailCache, removeLoadedThumbs]);

  const toggleSelection = useCallback((id: string, multi: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!multi) {
        if (next.size === 1 && next.has(id)) {
          next.clear();
        } else {
          next.clear();
          next.add(id);
        }
        return next;
      }
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleImageClick = useCallback(
    (image: IndexedImage, absoluteIndex: number, event: MouseEvent<HTMLButtonElement>) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (event.shiftKey && filteredImageCount > 0) {
        const anchor = selectionAnchor ?? absoluteIndex;
        const rangeIds = getRangeIds(anchor, absoluteIndex);
        setSelectedIds((prev) => {
          if (isMeta) {
            return new Set([...prev, ...rangeIds]);
          }
          return rangeIds;
        });
        setSelectionAnchor(anchor);
      } else {
        toggleSelection(image.id, isMeta);
        setSelectionAnchor(absoluteIndex);
      }
      setFocusedIndex(absoluteIndex);
    },
    [filteredImageCount, getRangeIds, selectionAnchor, toggleSelection, setFocusedIndex, setSelectionAnchor]
  );

  const handleOpenImages = async (
    imagesToOpen: IndexedImage[],
    options: { activate?: boolean } = {}
  ) => {
    setTabs((prev) => {
      const existingIds = new Set(prev.map((tab) => tab.id));
      const additions = imagesToOpen
        .filter((image: IndexedImage) => !existingIds.has(image.id))
        .map((image: IndexedImage) => ({
          id: image.id,
          title: image.fileName,
          type: "image" as const,
          image,
        }));
  return [CollectionTab, ...prev.filter((tab) => tab.id !== "collection"), ...additions];
    });
    const shouldActivate = options.activate ?? activeTab.type === "image";
    if (shouldActivate && imagesToOpen.length > 0) {
      const targetImage = imagesToOpen[0];
      setActiveTab({
        id: targetImage.id,
        title: targetImage.fileName,
        type: "image",
        image: targetImage,
      });
    }

    const resolvedImages = await resolveFileUrlsForTabs(imagesToOpen);
    applyResolvedTabUrls(resolvedImages);
  };

  const handleNavigateImage = async (target: IndexedImage) => {
    if (activeTab.type !== "image") {
      await handleOpenImages([target], { activate: true });
      return;
    }

    const currentTabId = activeTab.id;

    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === currentTabId
          ? {
            id: currentTabId,
            title: target.fileName,
            type: "image" as const,
            image: target,
          }
          : tab
      )
    );
    setActiveTab({
      id: currentTabId,
      title: target.fileName,
      type: "image" as const,
      image: target,
    });

    const [resolved] = await resolveFileUrlsForTabs([target]);
    if (!resolved) return;
    applyResolvedTabUrls([resolved]);
  };

  useEffect(() => {
    keyNavContextRef.current = {
      ...keyNavContextRef.current,
      activeTab,
      selectedIds,
      selectedCollectionIds,
      images,
      collections,
      activeCollection,
      collectionById,
      filteredImageIds,
      filteredImageCount,
      focusedIndex,
      selectionAnchor,
      gridColumnCount,
      gridHeight: gridMetrics.height,
      rowHeight,
      tabs,
      navigationImageIds,
      imageById,
      getRangeIds,
      startRenameImage,
      startRenameCollection,
      toggleFavoriteImage,
      handleOpenImages,
      handleNavigateImage,
      handleCloseTab,
      handleDuplicateTab,
      handleCloseOtherTabs,
      handleCloseAllTabs,
    };
  }, [
    activeTab,
    selectedIds,
    selectedCollectionIds,
    images,
    collections,
    activeCollection,
    collectionById,
    filteredImageIds,
    filteredImageCount,
    focusedIndex,
    selectionAnchor,
    gridColumnCount,
    gridMetrics.height,
    rowHeight,
    tabs,
    navigationImageIds,
    imageById,
    getRangeIds,
    startRenameImage,
    startRenameCollection,
    toggleFavoriteImage,
    handleOpenImages,
    handleNavigateImage,
    handleCloseTab,
    handleDuplicateTab,
    handleCloseOtherTabs,
    handleCloseAllTabs,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const context = keyNavContextRef.current;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        if (event.shiftKey) {
          const collectionTarget =
            context.selectedCollectionIds.size === 1
              ? context.collections.find((collection) => context.selectedCollectionIds.has(collection.id))
              : context.activeCollection !== "all"
                ? context.collectionById.get(context.activeCollection) ?? null
                : null;
          if (collectionTarget) {
            context.startRenameCollection(collectionTarget);
          }
        } else {
          const imageTarget =
            context.activeTab.type === "image"
              ? context.activeTab.image
              : context.selectedIds.size === 1
                ? context.images.find((image) => context.selectedIds.has(image.id))
                : null;
          if (imageTarget) {
            context.startRenameImage(imageTarget);
          }
        }
        return;
      }
  if (event.key === "Enter" && context.activeTab.type === "collection" && context.selectedIds.size > 0) {
        event.preventDefault();
        const selected = Array.from(context.selectedIds)
          .map((id) => context.imageById.get(id))
          .filter((image): image is IndexedImage => Boolean(image));
        void context.handleOpenImages(selected);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        const input = searchInputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      if (event.key === "F3") {
        event.preventDefault();
        const input = searchInputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        const target =
          context.activeTab.type === "image"
            ? context.activeTab.image
            : context.selectedIds.size === 1
              ? context.images.find((image) => context.selectedIds.has(image.id))
              : null;
        if (target) {
          void context.toggleFavoriteImage(target);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void window.comfy?.toggleDevTools?.();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (event.shiftKey) {
          context.handleSelectAllCollections();
  } else if (context.activeTab.type === "collection") {
          context.handleSelectAllImages();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
        event.preventDefault();
        if (event.shiftKey) {
          context.handleInvertCollectionSelection();
  } else if (context.activeTab.type === "collection") {
          context.handleInvertImageSelection();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Backspace") {
        event.preventDefault();
        if (event.shiftKey) {
          context.handleClearCollectionSelection();
  } else if (context.activeTab.type === "collection") {
          context.handleClearImageSelection();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        context.handleDuplicateTab();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w" && event.shiftKey) {
        event.preventDefault();
        context.handleCloseOtherTabs(context.activeTab.id);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w" && event.altKey) {
        event.preventDefault();
        context.handleCloseAllTabs();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
  if (context.activeTab.id !== "collection") {
          context.handleCloseTab(context.activeTab.id);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "tab") {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        if (context.tabs.length === 0) return;
        const currentIndex = context.tabs.findIndex((tab) => tab.id === context.activeTab.id);
        if (currentIndex === -1) return;
        const nextIndex = (currentIndex + direction + context.tabs.length) % context.tabs.length;
        setActiveTab(context.tabs[nextIndex]);
        return;
      }
  if (context.activeTab.type === "collection") {
        if (context.filteredImageCount === 0) return;
        const isNavigationKey =
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "Home" ||
          event.key === "End" ||
          event.key === "PageUp" ||
          event.key === "PageDown";
        if (!isNavigationKey) return;
        event.preventDefault();

        const columns = Math.max(1, context.gridColumnCount);
        const currentIndex = Math.min(context.focusedIndex ?? 0, context.filteredImageCount - 1);
        let nextIndex = currentIndex;
        const rowStart = Math.floor(currentIndex / columns) * columns;
        const rowEnd = Math.min(context.filteredImageCount - 1, rowStart + columns - 1);
        const pageRows = Math.max(1, Math.floor(context.gridHeight / context.rowHeight));
        const pageSize = pageRows * columns;

        if (event.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
        if (event.key === "ArrowRight") nextIndex = Math.min(context.filteredImageCount - 1, currentIndex + 1);
        if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - columns);
        if (event.key === "ArrowDown") nextIndex = Math.min(context.filteredImageCount - 1, currentIndex + columns);
        const isCtrlHomeEnd =
          (event.key === "Home" || event.key === "End") && (event.ctrlKey || event.metaKey);
        if (event.key === "Home") {
          nextIndex = isCtrlHomeEnd ? 0 : rowStart;
        }
        if (event.key === "End") {
          nextIndex = isCtrlHomeEnd ? context.filteredImageCount - 1 : rowEnd;
        }
        if (event.key === "PageUp") {
          nextIndex = Math.max(0, currentIndex - pageSize);
        }
        if (event.key === "PageDown") {
          nextIndex = Math.min(context.filteredImageCount - 1, currentIndex + pageSize);
        }

        const nextId = context.filteredImageIds[nextIndex];
        if (!nextId) return;
        setFocusedIndex(nextIndex);

        if (event.shiftKey) {
          const anchor = context.selectionAnchor ?? currentIndex;
          const rangeIds = context.getRangeIds(anchor, nextIndex);
          setSelectedIds((prev) => {
            if (event.ctrlKey || event.metaKey) {
              return new Set([...prev, ...rangeIds]);
            }
            return rangeIds;
          });
          setSelectionAnchor(anchor);
          return;
        }

        if (isCtrlHomeEnd) {
          setSelectedIds(new Set([nextId]));
          setSelectionAnchor(nextIndex);
          return;
        }

        if (event.ctrlKey || event.metaKey) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(nextId)) {
              next.delete(nextId);
            } else {
              next.add(nextId);
            }
            return next;
          });
          setSelectionAnchor(nextIndex);
          return;
        }

        setSelectedIds(new Set([nextId]));
        setSelectionAnchor(nextIndex);
        return;
      }
      if (context.activeTab.type !== "image") return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const currentImageId = context.activeTab.image.id;
        const currentIndex = context.navigationImageIds.findIndex((id) => id === currentImageId);
        if (currentIndex === -1) return;
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        const total = context.navigationImageIds.length;
        if (total === 0) return;
        const nextIndex = (currentIndex + delta + total) % total;
        event.preventDefault();
        const nextId = context.navigationImageIds[nextIndex];
        const nextImage = context.imageById.get(nextId);
        if (nextImage) {
          void context.handleNavigateImage(nextImage);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [searchInputRef]);

  function handleCloseTab(tabId: string) {
    if (tabId === "collection") return;
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === tabId);
      const nextTabs = prev.filter((tab) => tab.id !== tabId);

      setActiveTab((current) => {
        if (current.id !== tabId) return current;
  if (nextTabs.length === 0) return CollectionTab;
        const leftIndex = Math.max(0, index - 1);
        const fallbackIndex = Math.min(leftIndex, nextTabs.length - 1);
        return nextTabs[fallbackIndex];
      });

      return nextTabs;
    });
  }

  function handleCloseAllTabs() {
  setTabs([CollectionTab]);
  setActiveTab(CollectionTab);
  }

  function handleCloseOtherTabs(tabId: string) {
    setTabs((prev) => {
      const keep = prev.filter((tab) => tab.id === "collection" || tab.id === tabId);
      return keep.length ? keep : [CollectionTab];
    });
    setActiveTab((current) => (current.id === tabId ? current : CollectionTab));
  }

  function handleCycleTab(direction: number) {
    if (tabs.length === 0) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab.id);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIndex]);
  }

  function handleDuplicateTab() {
    if (activeTab.type !== "image") return;
    const baseId = activeTab.image.id;
    const uniqueSuffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
    const duplicateId = `${baseId}-dup-${uniqueSuffix}`;
    const duplicateTab: Tab = {
      id: duplicateId,
      title: activeTab.image.fileName,
      type: "image",
      image: activeTab.image,
    };

    setZoomByTab((prev) => {
      const current = prev[activeTab.id] ?? { mode: "fit", level: 1 };
      return { ...prev, [duplicateId]: { ...current } };
    });

    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === activeTab.id);
      if (index === -1) {
        return [...prev, duplicateTab];
      }
      const next = [...prev];
      next.splice(index + 1, 0, duplicateTab);
      return next;
    });
    setActiveTab(duplicateTab);
    requestAnimationFrame(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement && typeof activeElement.blur === "function") {
        activeElement.blur();
      }
      viewerFocusRef.current?.focus();
    });
  }

  const handleRemoveImages = async (
    ids: string[],
    options: {
      confirm?: boolean;
      label?: string;
    } = {}
  ) => {
    if (ids.length === 0) return;
    const shouldConfirm = options.confirm ?? true;
    if (shouldConfirm) {
      const label = options.label ?? (ids.length === 1 ? "this image" : `${ids.length} images`);
      const confirmed = window.confirm(`Remove ${label} from the index?`);
      if (!confirmed) return;
    }
    const items = ids.map((id) => ({ id, label: imageById.get(id)?.fileName ?? "Image" }));
    setRemovalImageProgress({ current: 0, total: items.length, label: "" });
    await yieldToPaint();
    await runRemovalTask(
      { type: "remove-images", items, batchSize: REMOVAL_BATCH_SIZE },
      (progress) => setRemovalImageProgress(progress),
      async () => {
        let batch: string[] = [];
        for (const item of items) {
          if (removalCancelRef.current.cancelled) {
            throw new Error("Removal cancelled");
          }
          batch.push(item.id);
          if (batch.length >= REMOVAL_BATCH_SIZE) {
            await removeImagesById(batch);
            batch = [];
          }
        }
        if (batch.length > 0) {
          await removeImagesById(batch);
        }
      }
    );
    setRemovalImageProgress(null);
    const idSet = new Set(ids);
    setFavoriteIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setImages((prev) => prev.filter((image) => !idSet.has(image.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setTabs((prev) => prev.filter((tab) => tab.type === "collection" || !idSet.has(tab.id)));
    setActiveTab((current) => (current.type === "image" && idSet.has(current.id) ? CollectionTab : current));
    if (ids.length > 1) {
      setRemovalImageProgress({ current: ids.length, total: ids.length, label: "" });
      setRemovalImageProgress(null);
    }
  };

  const removeMissingImages = async (imagesToCheck: IndexedImage[]) => {
    if (!imagesToCheck.length || !bridgeAvailable || !window.comfy?.findMissingFiles) {
      return new Set<string>();
    }
    try {
      const missingPaths = await window.comfy.findMissingFiles(imagesToCheck.map((image) => image.filePath));
      if (!missingPaths.length) {
        return new Set<string>();
      }
      const missingPathSet = new Set(missingPaths);
      const missingIds = imagesToCheck
        .filter((image) => missingPathSet.has(image.filePath))
        .map((image) => image.id);
      if (missingIds.length) {
        await handleRemoveImages(missingIds, { confirm: false });
      }
      return missingPathSet;
    } catch {
      return new Set<string>();
    }
  };

  function startRenameImage(image: IndexedImage) {
    setRenameState({ type: "image", id: image.id, value: image.fileName });
  }

  function startRenameCollection(collection: Collection) {
    setRenameState({ type: "collection", id: collection.id, value: collection.name });
  }

  function cancelRename() {
    setRenameState(null);
  }

  async function commitRename() {
    if (!renameState) return;
    const current = renameState;
    const trimmed = current.value.trim();
    if (!trimmed) {
      setRenameState(null);
      return;
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setToastMessage("Name cannot include path separators");
      setLastCopied("Name cannot include path separators");
      return;
    }
    if (current.type === "image") {
      const image = images.find((entry) => entry.id === current.id);
      if (!image || !window.comfy?.renamePath) {
        setRenameState(null);
        return;
      }
      const originalExtension = getFileExtension(image.fileName);
      const nextExtension = getFileExtension(trimmed);
      const fileName = nextExtension ? trimmed : `${trimmed}${originalExtension}`;
      if (fileName === image.fileName) {
        setRenameState(null);
        return;
      }
      const parentPath = getParentPath(image.filePath);
      const newPath = joinPath(parentPath, fileName);
      const result = await window.comfy.renamePath({ oldPath: image.filePath, newPath, kind: "file" });
      if (!result?.success) {
        setToastMessage(result?.message ?? "Failed to rename image");
        setLastCopied(result?.message ?? "Failed to rename image");
        return;
      }
      await updateImageFileInfo(image.id, newPath, fileName);
      setImages((prev) =>
        prev.map((entry) =>
          entry.id === image.id ? { ...entry, filePath: newPath, fileName, fileUrl: newPath } : entry
        )
      );
      setTabs((prev) =>
        prev.map((tab) =>
          tab.type === "image" && tab.image.id === image.id
            ? { ...tab, title: fileName, image: { ...tab.image, filePath: newPath, fileName, fileUrl: newPath } }
            : tab
        )
      );
      setActiveTab((currentTab) =>
        currentTab.type === "image" && currentTab.image.id === image.id
          ? { ...currentTab, title: fileName, image: { ...currentTab.image, filePath: newPath, fileName, fileUrl: newPath } }
          : currentTab
      );
      removeThumbnailEntries([image.id]);
      hydrateFileUrls([{ ...image, filePath: newPath, fileName, fileUrl: newPath }]);
      setToastMessage(`Renamed image to ${fileName}`);
      setLastCopied(`Renamed image to ${fileName}`);
      setRenameState(null);
      return;
    }

    const collection = collections.find((entry) => entry.id === current.id);
    if (!collection || !window.comfy?.renamePath) {
      setRenameState(null);
      return;
    }
    if (trimmed === collection.name) {
      setRenameState(null);
      return;
    }
    const parentPath = getParentPath(collection.rootPath);
    const newRootPath = joinPath(parentPath, trimmed);
    const result = await window.comfy.renamePath({
      oldPath: collection.rootPath,
      newPath: newRootPath,
      kind: "folder",
    });
    if (!result?.success) {
      setToastMessage(result?.message ?? "Failed to rename collection");
      setLastCopied(result?.message ?? "Failed to rename collection");
      return;
    }
    await updateCollectionInfo(collection.id, { name: trimmed, rootPath: newRootPath });
    const prefix = ensureTrailingSeparator(collection.rootPath);
    const nextPrefix = ensureTrailingSeparator(newRootPath);
    const updatedImages = images
      .filter((entry) => entry.collectionId === collection.id)
      .map((entry) => {
        const nextPath = entry.filePath.startsWith(prefix)
          ? `${nextPrefix}${entry.filePath.slice(prefix.length)}`
          : entry.filePath;
        return { ...entry, filePath: nextPath, fileUrl: nextPath };
      });
    await Promise.all(
      updatedImages.map((entry) => updateImageFileInfo(entry.id, entry.filePath, entry.fileName))
    );
    const updatedMap = new Map(updatedImages.map((entry) => [entry.id, entry]));
    setCollections((prev) =>
      prev.map((entry) => (entry.id === collection.id ? { ...entry, name: trimmed, rootPath: newRootPath } : entry))
    );
    setImages((prev) => prev.map((entry) => updatedMap.get(entry.id) ?? entry));
    setTabs((prev) =>
      prev.map((tab) =>
        tab.type === "image" && tab.image.collectionId === collection.id
          ? {
            ...tab,
            image: updatedMap.get(tab.image.id) ?? tab.image,
          }
          : tab
      )
    );
    setActiveTab((currentTab) =>
      currentTab.type === "image" && currentTab.image.collectionId === collection.id
        ? { ...currentTab, image: updatedMap.get(currentTab.image.id) ?? currentTab.image }
        : currentTab
    );
    removeThumbnailEntries(updatedImages.map((entry) => entry.id));
    hydrateFileUrls(updatedImages);
    setToastMessage(`Renamed collection to ${trimmed}`);
    setLastCopied(`Renamed collection to ${trimmed}`);
    setRenameState(null);
  }

  const handleOpenBulkRename = useCallback(() => {
    if (selectedOrderedImages.length === 0) return;
    setBulkRenameError(null);
    setBulkRenameDigits(calculateBulkRenameDigits(selectedOrderedImages.length));
    setBulkRenameBase(deriveBulkRenameBase(selectedOrderedImages[0]));
    setBulkRenameOpen(true);
  }, [deriveBulkRenameBase, selectedOrderedImages]);

  const handleBulkRename = useCallback(async () => {
    if (!window.comfy?.renamePath) {
      setBulkRenameError("Bridge unavailable");
      return;
    }
    if (selectedOrderedImages.length === 0) return;
    if (!bulkRenameBase.length) {
      setBulkRenameError("Enter a base name");
      return;
    }
    if (bulkRenameBase.includes("/") || bulkRenameBase.includes("\\")) {
      setBulkRenameError("Name cannot include path separators");
      return;
    }
    const baseName = bulkRenameBase;
    const digits = Math.max(1, bulkRenameDigits);
    setBulkRenaming(true);
    setBulkRenameError(null);
    try {
      const renameResults: Array<{ id: string; fileName: string; filePath: string }> = [];
      for (let index = 0; index < selectedOrderedImages.length; index += 1) {
        const image = selectedOrderedImages[index];
        const nextName = formatBulkRenameName(image, baseName, digits, index);
        if (nextName === image.fileName) {
          renameResults.push({ id: image.id, fileName: image.fileName, filePath: image.filePath });
          continue;
        }
        const parentPath = getParentPath(image.filePath);
        const newPath = joinPath(parentPath, nextName);
        const result = await window.comfy.renamePath({ oldPath: image.filePath, newPath, kind: "file" });
        if (!result?.success) {
          const message = result?.message ?? "Failed to rename files";
          setBulkRenameError(message);
          setToastMessage(message);
          setLastCopied(message);
          return;
        }
        await updateImageFileInfo(image.id, newPath, nextName);
        renameResults.push({ id: image.id, fileName: nextName, filePath: newPath });
      }
      if (renameResults.length === 0) {
        setToastMessage("No files were renamed");
        setLastCopied("No files were renamed");
        return;
      }
      const renameMap = new Map(renameResults.map((entry) => [entry.id, entry]));
      setImages((prev) =>
        prev.map((image) => {
          const update = renameMap.get(image.id);
          if (!update) return image;
          return { ...image, fileName: update.fileName, filePath: update.filePath, fileUrl: update.filePath };
        })
      );
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.type !== "image") return tab;
          const update = renameMap.get(tab.image.id);
          if (!update) return tab;
          return {
            ...tab,
            title: update.fileName,
            image: { ...tab.image, fileName: update.fileName, filePath: update.filePath, fileUrl: update.filePath },
          };
        })
      );
      setActiveTab((current) => {
        if (current.type !== "image") return current;
        const update = renameMap.get(current.image.id);
        if (!update) return current;
        return {
          ...current,
          title: update.fileName,
          image: { ...current.image, fileName: update.fileName, filePath: update.filePath, fileUrl: update.filePath },
        };
      });
      const renamedIds = renameResults.map((entry) => entry.id);
      removeThumbnailEntries(renamedIds);
      const renamedForHydration = renameResults
        .map((entry) => {
          const original = imageById.get(entry.id);
          if (!original) return null;
          return {
            ...original,
            fileName: entry.fileName,
            filePath: entry.filePath,
            fileUrl: entry.filePath,
          };
        })
        .filter((entry): entry is IndexedImage => Boolean(entry));
      hydrateFileUrls(renamedForHydration);
      const successMessage = `Renamed ${renameResults.length} image${renameResults.length === 1 ? "" : "s"}`;
      setToastMessage(successMessage);
      setLastCopied(successMessage);
      setBulkRenameOpen(false);
    } finally {
      setBulkRenaming(false);
    }
  }, [bulkRenameBase, bulkRenameDigits, hydrateFileUrls, removeThumbnailEntries, selectedOrderedImages, setToastMessage, setLastCopied]);

  useEffect(() => {
    if (bulkRenameOpen && selectedOrderedImages.length === 0) {
      setBulkRenameOpen(false);
    }
  }, [bulkRenameOpen, selectedOrderedImages.length]);

  const handleOpenMove = useCallback(() => {
    if (selectedOrderedImages.length === 0) return;
    setMoveError(null);
    setMoveDestination(getParentPath(selectedOrderedImages[0].filePath));
    setMoveOpen(true);
  }, [selectedOrderedImages]);

  const handlePickMoveDestination = useCallback(async () => {
    if (!bridgeAvailable || !window.comfy?.selectFolders) return;
    try {
      const choices = await window.comfy.selectFolders();
      if (choices.length > 0) {
        setMoveDestination(choices[0]);
      }
    } catch {
      // ignore user cancellation or errors
    }
  }, [bridgeAvailable]);

  const handleMoveCancel = useCallback(() => {
    setMoveOpen(false);
    setMoveError(null);
  }, []);

  const handleMove = useCallback(async () => {
    if (!window.comfy?.renamePath || !window.comfy?.findMissingFiles) {
      setMoveError("Bridge unavailable");
      return;
    }
    if (selectedOrderedImages.length === 0) return;
    const destination = moveDestination.trim();
    if (!destination) {
      setMoveError("Enter a destination path");
      return;
    }
    const shouldMove = selectedOrderedImages.some(
      (image) => joinPath(destination, image.fileName) !== image.filePath
    );
    if (!shouldMove) {
      setMoveError("Destination is the same as the current folder");
      return;
    }
    const targetPaths = selectedOrderedImages.map((image) => joinPath(destination, image.fileName));
    let conflictingPaths: string[] = [];
    try {
      const missingPaths = await window.comfy.findMissingFiles(targetPaths);
      const missingSet = new Set(missingPaths);
      conflictingPaths = targetPaths.filter((path) => !missingSet.has(path));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to inspect destination";
      setMoveError(message);
      setToastMessage(message);
      setLastCopied(message);
      return;
    }
    let shouldOverwrite = false;
    if (conflictingPaths.length > 0) {
      const preview = conflictingPaths.slice(0, 3).map((path) => `• ${path}`).join("\n");
      const extra = conflictingPaths.length > 3 ? `\n...and ${conflictingPaths.length - 3} more file(s)` : "";
      const confirmed = window.confirm(
        `The following file(s) already exist:\n${preview}${extra}\n\nOverwrite them and replace the files?`
      );
      if (!confirmed) {
        const message = "Move canceled";
        setMoveError(message);
        setLastCopied(message);
        return;
      }
      shouldOverwrite = true;
    }
    setMoving(true);
    setMoveError(null);
    try {
      if (window.comfy?.ensureDirectory) {
        try {
          await window.comfy.ensureDirectory(destination);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to prepare destination";
          setMoveError(message);
          setToastMessage(message);
          setLastCopied(message);
          return;
        }
      }
      const moveResults: Array<{ id: string; fileName: string; filePath: string }> = [];
      for (const image of selectedOrderedImages) {
        const targetPath = joinPath(destination, image.fileName);
        if (targetPath === image.filePath) {
          moveResults.push({ id: image.id, fileName: image.fileName, filePath: image.filePath });
          continue;
        }
        const result = await window.comfy.renamePath({
          oldPath: image.filePath,
          newPath: targetPath,
          kind: "file",
          overwrite: shouldOverwrite,
        });
        if (!result?.success) {
          const message = result?.message ?? "Failed to move files";
          setMoveError(message);
          setToastMessage(message);
          setLastCopied(message);
          return;
        }
        moveResults.push({ id: image.id, fileName: image.fileName, filePath: targetPath });
      }
      if (moveResults.length === 0) {
        setToastMessage("No files were moved");
        setLastCopied("No files were moved");
        return;
      }
      let finalCollection = collections.find((collection) => pathsAreEquivalent(collection.rootPath, destination));
      if (!finalCollection) {
        const created = await addCollectionRecord(destination);
        finalCollection = created;
        setCollections((prev) => [...prev, created]);
      }
      const targetCollectionId = finalCollection.id;
      const moveMap = new Map(
        moveResults.map((entry) => [entry.id, { ...entry, collectionId: targetCollectionId }])
      );
      await Promise.all(
        moveResults.map((entry) => updateImageFileInfo(entry.id, entry.filePath, entry.fileName, targetCollectionId))
      );
      setImages((prev) =>
        prev.map((image) => {
          const update = moveMap.get(image.id);
          if (!update) return image;
          return {
            ...image,
            filePath: update.filePath,
            fileUrl: update.filePath,
            collectionId: update.collectionId,
          };
        })
      );
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.type !== "image") return tab;
          const update = moveMap.get(tab.image.id);
          if (!update) return tab;
          return {
            ...tab,
            image: {
              ...tab.image,
              filePath: update.filePath,
              fileUrl: update.filePath,
              collectionId: update.collectionId,
            },
          };
        })
      );
      setActiveTab((current) => {
        if (current.type !== "image") return current;
        const update = moveMap.get(current.image.id);
        if (!update) return current;
        return {
          ...current,
          image: {
            ...current.image,
            filePath: update.filePath,
            fileUrl: update.filePath,
            collectionId: update.collectionId,
          },
        };
      });
      const movedIds = moveResults.map((entry) => entry.id);
      removeThumbnailEntries(movedIds);
      const hydrated = moveResults
        .map((entry) => {
          const original = imageById.get(entry.id);
          if (!original) return null;
          return {
            ...original,
            filePath: entry.filePath,
            fileUrl: entry.filePath,
            collectionId: targetCollectionId,
          };
        })
        .filter((entry): entry is IndexedImage => Boolean(entry));
      hydrateFileUrls(hydrated);
      const successMessage = `Moved ${movedIds.length} file${movedIds.length === 1 ? "" : "s"} to ${destination}`;
      setToastMessage(successMessage);
      setLastCopied(successMessage);
      setMoveOpen(false);
    } finally {
      setMoving(false);
    }
  }, [collections, hydrateFileUrls, imageById, moveDestination, removeThumbnailEntries, selectedOrderedImages, setCollections, setLastCopied, setToastMessage]);

  useEffect(() => {
    if (moveOpen && selectedOrderedImages.length === 0) {
      setMoveOpen(false);
    }
  }, [moveOpen, selectedOrderedImages.length]);

  const handleRemoveSelected = async () => {
    if (selectedIds.size === 0) return;
    await handleRemoveImages(Array.from(selectedIds), { label: `${selectedIds.size} selected images` });
  };

  async function addFavoriteImages(ids: string[], label?: string) {
    const unique = ids.filter((id) => !favoriteIds.has(id));
    if (unique.length === 0) return;
    await addFavorites(unique);
    setFavoriteIds((prev) => new Set([...prev, ...unique]));
    if (label) {
      setToastMessage(label);
      setLastCopied(label);
    }
  }

  async function removeFavoriteImages(ids: string[], label?: string) {
    if (ids.length === 0) return;
    await removeFavorites(ids);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (label) {
      setToastMessage(label);
      setLastCopied(label);
    }
  }

  async function toggleFavoriteImage(image: IndexedImage) {
    if (favoriteIds.has(image.id)) {
      await removeFavoriteImages([image.id], `${image.fileName} removed from favourites`);
    } else {
      await addFavoriteImages([image.id], `${image.fileName} added to favourites`);
    }
  }

  async function addCollectionToFavorites(collection: Collection) {
    const collectionImages = images
      .filter((image) => image.collectionId === collection.id)
      .map((image) => image.id);
    if (collectionImages.length === 0) return;
    await addFavoriteImages(collectionImages, `${collection.name} added to favourites`);
  }

  async function removeCollectionFromFavorites(collection: Collection) {
    const collectionImages = images
      .filter((image) => image.collectionId === collection.id)
      .map((image) => image.id);
    if (collectionImages.length === 0) return;
    await removeFavoriteImages(collectionImages, `${collection.name} removed from favourites`);
  }

  const removeCollectionFromIndex = async (collectionId: string) => {
    console.log("[comfy-browser] removing collection from index", collectionId);
    const removedImages = images.filter((image) => image.collectionId === collectionId);
    const removedItems = removedImages.map((image) => ({ id: image.id, label: image.fileName }));
    const removedImageIds = removedItems.map((item) => item.id);
    if (removedItems.length > 0) {
      setRemovalImageProgress({ current: 0, total: removedItems.length, label: "" });
      await yieldToPaint();
    }
    await runRemovalTask(
      { type: "remove-collection", collectionId, items: removedItems, batchSize: REMOVAL_BATCH_SIZE },
      (progress) => {
        setRemovalImageProgress(progress);
        console.log("[comfy-browser] removing collection image", {
          collectionId,
          index: progress.current,
          total: progress.total,
          fileName: progress.label,
        });
      },
      async () => {
        let batch: string[] = [];
        for (const item of removedItems) {
          if (removalCancelRef.current.cancelled) {
            throw new Error("Removal cancelled");
          }
          batch.push(item.id);
          if (batch.length >= REMOVAL_BATCH_SIZE) {
            await removeImagesById(batch);
            batch = [];
          }
        }
        if (batch.length > 0) {
          await removeImagesById(batch);
        }
        await removeCollectionRecord(collectionId);
      }
    );
    setRemovalImageProgress(null);
    console.log("[comfy-browser] removed collection images", {
      collectionId,
      count: removedImageIds.length,
    });
    const removedIdSet = new Set(removedImageIds);
    setCollections((prev) => prev.filter((collection) => collection.id !== collectionId));
    setFavoriteIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      removedImageIds.forEach((id) => next.delete(id));
      return next;
    });
    setImages((prev) => prev.filter((image) => !removedIdSet.has(image.id)));
  setTabs((prev) => prev.filter((tab) => tab.type === "collection" || !removedIdSet.has(tab.image.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      removedImageIds.forEach((id) => next.delete(id));
      return next;
    });
    if (activeCollection === collectionId) {
      setActiveCollection("all");
    }
    setSelectedCollectionIds((prev) => {
      const next = new Set(prev);
      next.delete(collectionId);
      return next;
    });
  };

  const handleRemoveCollection = async (collectionId: string) => {
    const collectionName =
      collections.find((collection) => collection.id === collectionId)?.name ?? "this collection";
    const confirmed = window.confirm(`Remove ${collectionName} from the index?`);
    if (!confirmed) return;
    console.log("[comfy-browser] starting collection removal", { collectionId, collectionName });
    setRemovalCollectionProgress({ current: 0, total: 1, label: collectionName });
    await yieldToPaint();
    await removeCollectionFromIndex(collectionId);
    await yieldToPaint();
    setRemovalCollectionProgress(null);
    console.log("[comfy-browser] finished collection removal", { collectionId, collectionName });
  };

  const handleRemoveSelectedCollections = async () => {
    if (selectedCollectionIds.size === 0) return;
    const confirmed = window.confirm(`Remove ${selectedCollectionIds.size} collection(s) from the index?`);
    if (!confirmed) return;
    const ids = Array.from(selectedCollectionIds);
    let index = 0;
    console.log("[comfy-browser] starting bulk collection removal", { count: ids.length });
    setRemovalCollectionProgress({ current: 0, total: ids.length, label: "" });
    await yieldToPaint();
    for (const id of ids) {
      index += 1;
      const name = collections.find((collection) => collection.id === id)?.name ?? "Collection";
      console.log("[comfy-browser] removing collection", { index, total: ids.length, collectionId: id, name });
      setRemovalCollectionProgress({ current: index, total: ids.length, label: name });
      await yieldToPaint();
      await removeCollectionFromIndex(id);
      await yieldToPaint();
    }
    setRemovalCollectionProgress(null);
    console.log("[comfy-browser] finished bulk collection removal", { count: ids.length });
  };

  const handleSelectAllImages = () => {
    if (filteredImages.length === 0) return;
    setSelectedIds(new Set(filteredImages.map((image) => image.id)));
  };

  const handleInvertImageSelection = () => {
    if (filteredImages.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set<string>();
      filteredImages.forEach((image) => {
        if (!prev.has(image.id)) {
          next.add(image.id);
        }
      });
      return next;
    });
  };

  const handleClearImageSelection = () => {
    setSelectedIds(new Set());
  };

  const handleSelectAllCollections = () => {
    if (collections.length === 0) return;
    setSelectedCollectionIds(new Set(collections.map((collection) => collection.id)));
  };

  const handleInvertCollectionSelection = () => {
    if (collections.length === 0) return;
    setSelectedCollectionIds((prev) => {
      const next = new Set<string>();
      collections.forEach((collection) => {
        if (!prev.has(collection.id)) {
          next.add(collection.id);
        }
      });
      return next;
    });
  };

  const handleClearCollectionSelection = () => {
    setSelectedCollectionIds(new Set());
  };

  useEffect(() => {
    keyNavContextRef.current = {
      ...keyNavContextRef.current,
      handleSelectAllImages,
      handleInvertImageSelection,
      handleClearImageSelection,
      handleSelectAllCollections,
      handleInvertCollectionSelection,
      handleClearCollectionSelection,
    };
  }, [
    handleSelectAllImages,
    handleInvertImageSelection,
    handleClearImageSelection,
    handleSelectAllCollections,
    handleInvertCollectionSelection,
    handleClearCollectionSelection,
  ]);

  const handleRevealInFolder = async (filePath: string | undefined) => {
    if (!bridgeAvailable || !filePath || !window.comfy?.revealInFolder) return;
    await window.comfy.revealInFolder(filePath);
  };

  const handleOpenInEditor = async (filePath: string | undefined) => {
    if (!bridgeAvailable || !filePath || !window.comfy?.openInEditor) return;
    await window.comfy.openInEditor(filePath);
  };

  const handleDeleteImagesFromDisk = async (ids: string[], label: string) => {
    if (!bridgeAvailable || !window.comfy?.deleteFilesFromDisk) return [];
    if (!ids.length) return [];
    if (isDeletingFiles) return [];
    const filePaths = ids
      .map((id) => imageById.get(id)?.filePath)
      .filter((path): path is string => Boolean(path));
    if (!filePaths.length) return [];
    setIsDeletingFiles(true);
    try {
      const result = await window.comfy.deleteFilesFromDisk({
        paths: filePaths,
        label,
        detail: "This will permanently delete the file(s) from disk. This action cannot be undone.",
      });
      if (!result || result.canceled || result.deletedPaths.length === 0) return [];
      const deletedPathSet = new Set(result.deletedPaths);
      const deletedIds = ids.filter((id) => deletedPathSet.has(imageById.get(id)?.filePath ?? ""));
      if (!deletedIds.length) return [];
      await handleRemoveImages(deletedIds, { confirm: false });
      return deletedIds;
    } finally {
      setIsDeletingFiles(false);
    }
  };

  const handleDeleteCollectionFromDisk = async (collectionId: string) => {
    const collection = collections.find((entry) => entry.id === collectionId);
    if (!collection) return;
    const collectionImageIds = images
      .filter((image) => image.collectionId === collectionId)
      .map((image) => image.id);
    if (!collectionImageIds.length) return;
    const deletedIds = await handleDeleteImagesFromDisk(collectionImageIds, `${collection.name} images`);
    if (!deletedIds || deletedIds.length === 0) return;
    const deletedSet = new Set(deletedIds);
    const remaining = images.filter(
      (image) => image.collectionId === collectionId && !deletedSet.has(image.id)
    );
    if (remaining.length === 0) {
      await removeCollectionFromIndex(collectionId);
    }
  };

  const handleDeleteSelectedCollectionsFromDisk = async () => {
    if (!selectedCollectionIds.size) return;
    const ids = Array.from(selectedCollectionIds);
    const collectionImageIds = images
      .filter((image) => selectedCollectionIds.has(image.collectionId))
      .map((image) => image.id);
    if (!collectionImageIds.length) return;
    const deletedIds = await handleDeleteImagesFromDisk(collectionImageIds, `${ids.length} collection(s) images`);
    if (!deletedIds || deletedIds.length === 0) return;
    const deletedSet = new Set(deletedIds);
    const remainingImages = images.filter((image) => !deletedSet.has(image.id));
    const remainingCollectionIds = new Set(remainingImages.map((image) => image.collectionId));
    for (const collectionId of ids) {
      if (!remainingCollectionIds.has(collectionId)) {
        await removeCollectionFromIndex(collectionId);
      }
    }
  };


  const handleRescanCollections = async (collectionIds: string[]) => {
    if (!bridgeAvailable || !window.comfy?.indexFolders) return;
    const targets = collections.filter((collection) => collectionIds.includes(collection.id));
    if (targets.length === 0) return;
    setIsIndexing(true);
    const token = { cancelled: false };
    indexingTokenRef.current = token;
    setCancelingIndex(false);
    setFolderProgress(null);
    setImageProgress(null);
    liveIndexRef.current = {
      active: true,
      basePaths: new Set(images.map((image) => image.filePath)),
      addedPaths: new Set(),
      addedCollectionRoots: new Set(),
    };
    liveIndexQueueRef.current.collections = [];
    liveIndexQueueRef.current.images = [];
    if (liveIndexQueueRef.current.timer) {
      window.clearTimeout(liveIndexQueueRef.current.timer);
      liveIndexQueueRef.current.timer = null;
    }
    try {
      const targetImageList = images.filter((image) =>
        targets.some((collection) => collection.id === image.collectionId)
      );
      const missingPathSet = await removeMissingImages(targetImageList);
      const rootPaths = targets.map((collection) => collection.rootPath);
      const imagesForIndex = missingPathSet.size > 0
        ? images.filter((image) => !missingPathSet.has(image.filePath))
        : images;
      const payload = (await window.comfy.indexFolders(
        rootPaths,
        imagesForIndex.map((image) => image.filePath),
        { returnPayload: false }
      )) as Array<{
        rootPath: string;
        images: IndexedImagePayload[];
      }>;

      const existingFilePaths = new Set(images.map((image) => image.filePath));
      const liveIndex = liveIndexRef.current;
      if (liveIndex) {
        liveIndex.basePaths.forEach((path) => existingFilePaths.add(path));
        liveIndex.addedPaths.forEach((path) => existingFilePaths.add(path));
      }
      const collectionByRoot = new Map(targets.map((collection) => [collection.rootPath, collection]));
      const newImages: IndexedImage[] = [];

      if (payload.length > 0) {
        for (const collectionPayload of payload) {
          const collection = collectionByRoot.get(collectionPayload.rootPath);
          if (!collection) continue;
          const filtered = collectionPayload.images.filter((image) => !existingFilePaths.has(image.filePath));
          if (filtered.length === 0) continue;
          filtered.forEach((image) => existingFilePaths.add(image.filePath));
          const result = await runIndexingTask<{ collection: Collection | null; images: IndexedImage[] }>(
            { type: "add-images", data: { collectionId: collection.id, images: filtered } },
            async () => ({ collection: null, images: await addImagesToCollection(collection.id, filtered) })
          );
          newImages.push(...result.images);
        }
      }

      const liveAddedImages = liveIndexRef.current?.addedPaths.size ?? 0;
      const totalImages = liveAddedImages + newImages.length;
      const totalCollections = liveIndexRef.current?.addedCollectionRoots.size ?? 0;
      const summary = formatIndexSummary("Rescan", totalCollections, totalImages, token.cancelled);
      setToastMessage(summary);
      setLastCopied(summary);

      if (newImages.length > 0) {
        const baseImages = newImages.map((image) => ({ ...image, fileUrl: image.filePath }));
        setImages((prev) => [...prev, ...baseImages]);
        hydrateFileUrls(baseImages);
      }
    } finally {
      if (liveIndexRef.current) {
        liveIndexRef.current.active = false;
      }
      setIsIndexing(false);
    }

  };

  const { handleImageContextMenu, handleCollectionContextMenu } = useContextMenuDispatcher({
    bridgeAvailable,
    selectedIds,
    selectedCollectionIds,
    collections,
    startRenameImage,
    startRenameCollection,
    addFavoriteImages,
    removeFavoriteImages,
    addCollectionToFavorites,
    removeCollectionFromFavorites,
    handleRemoveImages,
    handleRevealInFolder,
    handleOpenInEditor,
    handleDeleteImagesFromDisk,
    handleOpenBulkRename,
  handleOpenMove,
    handleRescanCollections,
    handleRemoveSelectedCollections,
    handleDeleteSelectedCollectionsFromDisk,
    handleSelectAllImages,
    handleInvertImageSelection,
    handleClearImageSelection,
    handleSelectAllCollections,
    handleInvertCollectionSelection,
    handleClearCollectionSelection,
  });

  const handleAddFolder = async () => {
    if (isIndexing) return;
    if (!bridgeAvailable) {
      setBridgeError("Electron bridge unavailable. Launch the app via Electron (not the browser) to add folders.");
      return;
    }
    setIsIndexing(true);
    const token = { cancelled: false };
    indexingTokenRef.current = token;
    setCancelingIndex(false);
    setFolderProgress(null);
    setImageProgress(null);
    liveIndexRef.current = {
      active: true,
      basePaths: new Set(images.map((image) => image.filePath)),
      addedPaths: new Set(),
      addedCollectionRoots: new Set(),
    };
    liveIndexQueueRef.current.collections = [];
    liveIndexQueueRef.current.images = [];
    if (liveIndexQueueRef.current.timer) {
      window.clearTimeout(liveIndexQueueRef.current.timer);
      liveIndexQueueRef.current.timer = null;
    }
    try {
      const folderPaths = await window.comfy.selectFolders();
      if (!folderPaths.length) {
        return;
      }
      const uniquePaths = Array.from(new Set(folderPaths));
      if (uniquePaths.length === 0) {
        return;
      }
      const affectedCollections = collections.filter((collection) =>
        uniquePaths.some((rootPath) => isPathWithinRoot(collection.rootPath, rootPath))
      );
      const affectedCollectionIds = new Set(affectedCollections.map((collection) => collection.id));
      const affectedImages = images.filter((image) => affectedCollectionIds.has(image.collectionId));
      const missingPathSet = await removeMissingImages(affectedImages);
      const imagesForIndex = missingPathSet.size > 0
        ? images.filter((image) => !missingPathSet.has(image.filePath))
        : images;
      const payload = (await window.comfy.indexFolders(
        uniquePaths,
        imagesForIndex.map((image) => image.filePath),
        { returnPayload: false }
      )) as Array<{
        rootPath: string;
        images: IndexedImagePayload[];
      }>;

      const existingFilePaths = new Set(images.map((image) => image.filePath));
      const liveIndex = liveIndexRef.current;
      if (liveIndex) {
        liveIndex.basePaths.forEach((path) => existingFilePaths.add(path));
        liveIndex.addedPaths.forEach((path) => existingFilePaths.add(path));
      }
      const collectionByRoot = new Map(collections.map((collection) => [collection.rootPath, collection]));
      const newCollections: Collection[] = [];
      const newImages: IndexedImage[] = [];

      if (payload.length > 0) {
        for (const collectionPayload of payload) {
          const filtered = collectionPayload.images.filter((image) => !existingFilePaths.has(image.filePath));
          if (filtered.length === 0) continue;
          filtered.forEach((image) => existingFilePaths.add(image.filePath));

          const existingCollection = collectionByRoot.get(collectionPayload.rootPath);
          if (existingCollection) {
            const result = await runIndexingTask<{ collection: Collection | null; images: IndexedImage[] }>(
              { type: "add-images", data: { collectionId: existingCollection.id, images: filtered } },
              async () => ({
                collection: null,
                images: await addImagesToCollection(existingCollection.id, filtered),
              })
            );
            newImages.push(...result.images);
            continue;
          }

          const result = await runIndexingTask<{ collection: Collection | null; images: IndexedImage[] }>(
            { type: "add-collection", data: { rootPath: collectionPayload.rootPath, images: filtered } },
            async () => addCollectionWithImages(collectionPayload.rootPath, filtered)
          );
          if (result.collection) {
            newCollections.push(result.collection);
          }
          newImages.push(...result.images);
        }
      }

      const liveAddedImages = liveIndexRef.current?.addedPaths.size ?? 0;
      const liveAddedCollections = liveIndexRef.current?.addedCollectionRoots.size ?? 0;
      const totalImages = liveAddedImages + newImages.length;
      const totalCollections = liveAddedCollections + newCollections.length;
      const summary = formatIndexSummary("Indexing", totalCollections, totalImages, token.cancelled);
      setToastMessage(summary);
      setLastCopied(summary);

      if (newCollections.length > 0) {
        setCollections((prev) => [...prev, ...newCollections]);
      }
      if (newImages.length > 0) {
        const baseImages = newImages.map((image) => ({ ...image, fileUrl: image.filePath }));
        setImages((prev) => [...prev, ...baseImages]);
        hydrateFileUrls(baseImages);
      }
    } finally {
      if (liveIndexRef.current) {
        liveIndexRef.current.active = false;
      }
      setIsIndexing(false);
    }
  };

  const handleCancelIndexing = async () => {
    if (!bridgeAvailable || !window.comfy?.cancelIndexing) return;
    if (cancelingIndex) return;
    indexingTokenRef.current.cancelled = true;
    setCancelingIndex(true);
    setIsIndexing(false);
    setFolderProgress(null);
    setImageProgress(null);
    await window.comfy.cancelIndexing();
    setToastMessage("Indexing canceled");
    setLastCopied("Indexing canceled");
  };

  const handleCancelRemoval = () => {
    if (removalCanceling) return;
    removalCancelRef.current.cancelled = true;
    setRemovalCanceling(true);
    const requestId = removalRequestIdRef.current;
    const worker = removalWorkerRef.current;
    if (requestId && worker) {
      worker.postMessage({ type: "cancel", requestId });
    }
  };


  const activeTabContent = useMemo(() => {
  if (activeTab.type === "collection") return null;
    return activeTab.image;
  }, [activeTab]);

  const activeImageId = activeTab.type === "image" ? activeTab.image.id : null;

  useEffect(() => {
    if (activeTab.type !== "image") {
      setIsImageLoading(false);
      return;
    }
    setIsImageLoading(true);
    const image = activeImageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setIsImageLoading(false);
    }
  }, [activeTab.type, activeTabContent?.fileUrl]);

  const activeZoom = activeTab.type === "image"
    ? zoomByTab[activeTab.id] ?? { mode: "fit", level: 1 }
    : { mode: "fit", level: 1 };

  const setActiveZoomMode = (mode: ZoomMode) => {
    if (activeTab.type !== "image") return;
    setZoomByTab((prev) => {
      const current = prev[activeTab.id] ?? { mode: "fit", level: 1 };
      return { ...prev, [activeTab.id]: { ...current, mode } };
    });
  };

  const setActiveZoomLevel = (level: number) => {
    if (activeTab.type !== "image") return;
    setZoomByTab((prev) => ({
      ...prev,
      [activeTab.id]: { mode: "manual", level },
    }));
  };

  useEffect(() => {
    const target = viewerRef.current;
    if (!target) return;

    const updateSize = () => {
      const rect = target.getBoundingClientRect();
      setViewerSize({ width: rect.width, height: rect.height });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(target);
    return () => observer.disconnect();
  }, [activeTab.id]);

  const derivedZoom = useMemo(() => {
    if (activeZoom.mode === "manual") return activeZoom.level;
    if (activeZoom.mode === "actual") return 1;
    if (!imageSize.width || !imageSize.height || !viewerSize.width || !viewerSize.height) {
      return 1;
    }
    const widthScale = viewerSize.width / imageSize.width;
    const heightScale = viewerSize.height / imageSize.height;
    if (activeZoom.mode === "width") return widthScale;
    if (activeZoom.mode === "height") return heightScale;
    return Math.min(widthScale, heightScale);
  }, [activeZoom.mode, activeZoom.level, imageSize, viewerSize]);

  const viewerSizingClass = useMemo(() => {
    if (activeZoom.mode === "fit") return "max-h-full max-w-full";
    if (activeZoom.mode === "width") return "w-full h-auto";
    if (activeZoom.mode === "height") return "h-full w-auto";
    return "h-auto w-auto";
  }, [activeZoom.mode]);

  useEffect(() => {
    const value = activeZoom.mode === "manual" ? activeZoom.level : 1;
    document.documentElement.style.setProperty("--viewer-zoom", `${value}`);
  }, [activeZoom.mode, activeZoom.level]);

  useEffect(() => {
    if (activeTab.type !== "image") {
      setMetadataSummary(null);
      return;
    }
    const cached = metadataCacheRef.current.get(activeTab.image.id);
    if (cached) {
      setMetadataSummary(cached);
      return;
    }
    setMetadataSummary(null);
    let cancelled = false;
    const compute = () => {
      if (cancelled) return;
      const summary = extractMetadataSummary(activeTab.image.metadataText);
      metadataCacheRef.current.set(activeTab.image.id, summary);
      setMetadataSummary(summary);
    };
    if ("requestIdleCallback" in window) {
      const id = (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(compute);
      return () => {
        cancelled = true;
        (window as Window & { cancelIdleCallback: (cb: number) => void }).cancelIdleCallback(id);
      };
    }
    const timeout = globalThis.setTimeout(compute, 0);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeout);
    };
  }, [activeTab.type, activeImageId]);

  useEffect(() => {
    const node = tabRefs.current[activeTab.id];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [activeTab]);

  const copyToClipboard = async (value: string, label: string) => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setToastMessage(`${label} copied`);
      setLastCopied(label);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const target = event.currentTarget;
      setImageSize({ width: target.naturalWidth, height: target.naturalHeight });
      setIsImageLoading(false);
    },
    [setImageSize, setIsImageLoading]
  );

  const handleImageError = useCallback(() => {
    setIsImageLoading(false);
  }, [setIsImageLoading]);

  useEffect(() => {
    if (!toastMessage) return;
    setToastVisibleMessage(toastMessage);
    setToastLeaving(false);
    const timeout = window.setTimeout(() => setToastMessage(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    if (toastMessage || !toastVisibleMessage) return;
    setToastLeaving(true);
    const timeout = window.setTimeout(() => {
      setToastVisibleMessage(null);
      setToastLeaving(false);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [toastMessage, toastVisibleMessage]);

  useEffect(() => {
    if (!bridgeAvailable) return;
    const unsubscribeFolder = window.comfy.onIndexingFolder((payload) => {
      setFolderProgress({ current: payload.current, total: payload.total, label: payload.folder });
    });
    const unsubscribeImage = window.comfy.onIndexingImage((payload) => {
      setImageProgress({ current: payload.current, total: payload.total, label: payload.fileName });
    });
    const unsubscribeCollection = window.comfy.onIndexingCollection(async (payload) => {
      const liveIndex = liveIndexRef.current;
      if (!liveIndex?.active) return;
      const existingCollection = collections.find((collection) => collection.rootPath === payload.rootPath);
      const existingPaths = new Set<string>();
      liveIndex.basePaths.forEach((path) => existingPaths.add(path));
      liveIndex.addedPaths.forEach((path) => existingPaths.add(path));
      const filtered = payload.images.filter((image) => !existingPaths.has(image.filePath));
      if (filtered.length === 0) return;
      filtered.forEach((image) => liveIndex.addedPaths.add(image.filePath));

      if (existingCollection) {
        const result = await runIndexingTask<{ collection: Collection | null; images: IndexedImage[] }>(
          { type: "add-images", data: { collectionId: existingCollection.id, images: filtered } },
          async () => ({
            collection: null,
            images: await addImagesToCollection(existingCollection.id, filtered),
          })
        );
        if (result.images.length > 0) {
          liveIndexQueueRef.current.images.push(...result.images);
        }
      } else {
        const result = await runIndexingTask<{ collection: Collection | null; images: IndexedImage[] }>(
          { type: "add-collection", data: { rootPath: payload.rootPath, images: filtered } },
          async () => addCollectionWithImages(payload.rootPath, filtered)
        );
        if (result.collection) {
          setCollections((prev) =>
            prev.some((collection) => collection.rootPath === result.collection!.rootPath)
              ? prev
              : [...prev, result.collection!]
          );
          liveIndexRef.current?.addedCollectionRoots.add(payload.rootPath);
        }
        if (result.images.length > 0) {
          liveIndexQueueRef.current.images.push(...result.images);
        }
      }

      if (!liveIndexQueueRef.current.timer) {
        liveIndexQueueRef.current.timer = window.setTimeout(() => {
          flushLiveIndexQueue();
        }, 120);
      }
    });
    const unsubscribeComplete = window.comfy.onIndexingComplete(() => {
      flushLiveIndexQueue();
      setFolderProgress(null);
      setImageProgress(null);
      if (liveIndexRef.current) {
        liveIndexRef.current.active = false;
      }
    });

    return () => {
      unsubscribeFolder();
      unsubscribeImage();
      unsubscribeCollection();
      unsubscribeComplete();
    };
  }, [bridgeAvailable, collections, flushLiveIndexQueue, runIndexingTask]);

  useEffect(() => {
    const target = gridRef.current;
    if (!target) return;

    const update = () => {
      setGridMetrics((prev) => ({
        ...prev,
        width: target.clientWidth,
        height: target.clientHeight,
      }));
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(() => update());
    observer.observe(target);
    return () => observer.disconnect();
  }, [gridRef, filteredImages.length, iconSize, activeTab.type]);

  useEffect(() => {
    if (!lastCopied) return;
    const timeout = window.setTimeout(() => setLastCopied(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [lastCopied]);

  return (
    <div className="flex h-screen flex-col">
      {toastVisibleMessage ? (
        <div
          className={`pointer-events-none fixed bottom-6 right-6 z-50 rounded-lg border border-slate-200/60 bg-slate-100/95 px-4 py-2 text-xs text-slate-900 shadow-xl duration-200 ${toastLeaving
              ? "animate-out fade-out slide-out-to-bottom-2"
              : "animate-in fade-in slide-in-from-bottom-2"
            }`}
        >
          {toastVisibleMessage}
        </div>
      ) : null}
      {bridgeError ? (
        <div className="border-b border-amber-500/40 bg-amber-500/10 px-6 py-3 text-sm text-amber-200">
          {bridgeError}
        </div>
      ) : null}
      <AboutDialog
        open={aboutOpen}
        appInfo={appInfo}
        graphicUrl={ABOUT_GRAPHIC_PUBLIC_PATH}
        onClose={() => setAboutOpen(false)}
      />
      <MenuActionBridge
        bridgeAvailable={bridgeAvailable}
        favoritesId={FAVORITES_ID}
        selectedIds={selectedIds}
        selectedCollectionIds={selectedCollectionIds}
        images={images}
        collections={collections}
        activeTabId={activeTab.id}
        activeTabType={activeTab.type}
        activeTabImage={activeTab.type === "image" ? activeTab.image : null}
        activeCollection={activeCollection}
        collectionById={collectionById}
        imageById={imageById}
        filteredImages={filteredImages}
        selectedOrderedImages={selectedOrderedImages}
        isIndexing={isIndexing}
        removalCollectionProgress={removalCollectionProgress}
        removalImageProgress={removalImageProgress}
        isDeletingFiles={isDeletingFiles}
        handleAddFolder={handleAddFolder}
        handleRemoveSelected={handleRemoveSelected}
        handleRemoveSelectedCollections={handleRemoveSelectedCollections}
        handleDeleteSelectedCollectionsFromDisk={handleDeleteSelectedCollectionsFromDisk}
        handleDeleteImagesFromDisk={handleDeleteImagesFromDisk}
        handleRevealInFolder={handleRevealInFolder}
        handleOpenInEditor={handleOpenInEditor}
        startRenameImage={startRenameImage}
        startRenameCollection={startRenameCollection}
        addFavoriteImages={addFavoriteImages}
        removeFavoriteImages={removeFavoriteImages}
        addCollectionToFavorites={addCollectionToFavorites}
        removeCollectionFromFavorites={removeCollectionFromFavorites}
        handleRescanCollections={handleRescanCollections}
        handleSelectAllImages={handleSelectAllImages}
        handleInvertImageSelection={handleInvertImageSelection}
        handleClearImageSelection={handleClearImageSelection}
        handleSelectAllCollections={handleSelectAllCollections}
        handleInvertCollectionSelection={handleInvertCollectionSelection}
        handleClearCollectionSelection={handleClearCollectionSelection}
        handleCycleTab={handleCycleTab}
        handleDuplicateTab={handleDuplicateTab}
        handleCloseTab={handleCloseTab}
        handleCloseOtherTabs={handleCloseOtherTabs}
        handleCloseAllTabs={handleCloseAllTabs}
        handleOpenBulkRename={handleOpenBulkRename}
        handleOpenMove={handleOpenMove}
        setAboutOpen={setAboutOpen}
      />
      <BulkRenameModal
        open={bulkRenameOpen}
        fileCount={selectedOrderedImages.length}
        baseValue={bulkRenameBase}
        digitsValue={bulkRenameDigits}
        renaming={bulkRenaming}
        error={bulkRenameError}
        previewEntries={bulkRenamePreviewEntries}
        additionalCount={bulkRenameAdditionalCount}
        onBaseChange={handleBulkRenameBaseChange}
        onDigitsChange={handleBulkRenameDigitsChange}
        onCancel={handleBulkRenameCancel}
        onRename={handleBulkRename}
      />
      <MoveFilesModal
        open={moveOpen}
        fileCount={selectedOrderedImages.length}
        destination={moveDestination}
        moving={moving}
        disabled={!moveReady}
        error={moveError}
        previewEntries={movePreviewEntries}
        additionalCount={movePreviewAdditionalCount}
        onDestinationChange={setMoveDestination}
        onCancel={handleMoveCancel}
        onMove={handleMove}
        onPickDestination={handlePickMoveDestination}
      />

      <div className="flex flex-1 overflow-hidden">
        <CollectionSidebar
          bridgeAvailable={bridgeAvailable}
          collectionSort={collectionSort}
          onCollectionSortChange={(value) => setCollectionSort(value)}
          sortedCollections={sortedCollections}
          collectionIds={collectionIds}
          collectionHighlightId={collectionHighlightId}
          favoritesId={FAVORITES_ID}
          selectedCollectionIds={selectedCollectionIds}
          collectionFocusedId={collectionFocusedId}
          collectionSelectionAnchor={collectionSelectionAnchor}
          setCollectionFocusedId={setCollectionFocusedId}
          setCollectionSelectionAnchor={setCollectionSelectionAnchor}
          setSelectedCollectionIds={setSelectedCollectionIds}
          setActiveCollection={setActiveCollection}
          renameState={renameState}
          renameInputRef={renameInputRef}
          renameCancelRef={renameCancelRef}
          setRenameState={setRenameState}
          commitRename={commitRename}
          cancelRename={cancelRename}
          handleCollectionContextMenu={handleCollectionContextMenu}
          handleAddFolder={handleAddFolder}
          isIndexing={isIndexing}
          folderProgress={folderProgress}
          imageProgress={imageProgress}
          handleCancelIndexing={handleCancelIndexing}
          cancelingIndex={cancelingIndex}
          removalCollectionProgress={removalCollectionProgress}
          removalImageProgress={removalImageProgress}
          handleRemoveSelectedCollections={handleRemoveSelectedCollections}
          removalCanceling={removalCanceling}
          handleCancelRemoval={handleCancelRemoval}
        />

        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-800 bg-slate-950/40 px-4 py-3">
            <div className="relative flex-1">
              <input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                placeholder="Search by filename, collection, or metadata…"
                aria-label="Search images"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-8 text-sm text-slate-100"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-slate-200"
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>
            <button
              onClick={() => handleOpenImages(selectedImages)}
              disabled={selectedImages.length === 0}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-40"
            >
              Open selected
            </button>
            <button
              type="button"
              onClick={handleOpenBulkRename}
              disabled={selectedOrderedImages.length === 0}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-40"
            >
              Bulk rename
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Icon size</span>
              <input
                type="range"
                min={120}
                max={280}
                value={iconSize}
                onChange={(event) => setIconSize(Number(event.target.value))}
                aria-label="Adjust icon size"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Sort</span>
              <select
                value={imageSort}
                onChange={(event) => setImageSort(event.target.value as ImageSort)}
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                aria-label="Sort images"
              >
                <option value="date-desc">Newest</option>
                <option value="date-asc">Oldest</option>
                <option value="name-asc">Name A → Z</option>
                <option value="name-desc">Name Z → A</option>
                <option value="size-desc">Size large → small</option>
                <option value="size-asc">Size small → large</option>
              </select>
            </div>
          </div>

          <TabStrip
            tabs={tabs}
            activeTab={activeTab}
            collectionTab={CollectionTab}
            onSelectTab={(tab) => setActiveTab(tab)}
            onDuplicateTab={handleDuplicateTab}
            onCloseTab={handleCloseTab}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseAllTabs={handleCloseAllTabs}
            tabRefs={tabRefs}
            tabScrollRef={tabScrollRef}
          />

          {activeTab.type === "collection" ? (
            <section className="flex-1 overflow-hidden">
              <div
                ref={gridRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  setGridMetrics((prev) => ({ ...prev, scrollTop: target.scrollTop }));
                }}
                className="h-full overflow-auto p-4 scrollbar-thin"
              >
                <ImageGrid
                  innerRef={gridInnerRef}
                  gridGap={GRID_GAP}
                  iconSize={iconSize}
                  rowHeight={rowHeight}
                  gridColumnCount={gridColumnCount}
                  startIndex={startIndex}
                  visibleImages={visibleImages}
                  selectedIds={selectedIds}
                  favoriteIds={favoriteIds}
                  thumbnailMap={thumbnailMap}
                  loadedThumbs={loadedThumbs}
                  renameState={renameState}
                  renameInputRef={renameInputRef}
                  renameCancelRef={renameCancelRef}
                  setRenameState={setRenameState}
                  commitRename={commitRename}
                  cancelRename={cancelRename}
                  handleImageContextMenu={handleImageContextMenu}
                  onImageClick={handleImageClick}
                  onImageDoubleClick={(image) => {
                    void handleOpenImages([image], { activate: true });
                  }}
                  onFavoriteToggle={toggleFavoriteImage}
                  markThumbLoaded={markThumbLoaded}
                  focusedIndex={focusedIndex}
                />
              </div>
            </section>
          ) : activeTabContent ? (
            <ImageViewer
              image={activeTabContent}
              imageUrl={
                activeTabContent.fileUrl === activeTabContent.filePath
                  ? toComfyUrl(activeTabContent.filePath)
                  : activeTabContent.fileUrl
              }
              viewerRef={viewerRef}
              viewerFocusRef={viewerFocusRef}
              activeImageRef={activeImageRef}
              onImageLoad={handleImageLoad}
              onImageError={handleImageError}
              isImageLoading={isImageLoading}
              viewerSizingClass={viewerSizingClass}
              derivedZoom={derivedZoom}
              setActiveZoomMode={setActiveZoomMode}
              setActiveZoomLevel={setActiveZoomLevel}
              toggleFavoriteImage={toggleFavoriteImage}
              favoriteIds={favoriteIds}
              renameState={renameState}
              renameInputRef={renameInputRef}
              renameCancelRef={renameCancelRef}
              setRenameState={setRenameState}
              commitRename={commitRename}
              cancelRename={cancelRename}
              collectionById={collectionById}
              metadataSummary={metadataSummary}
              copyToClipboard={copyToClipboard}
              lastCopied={lastCopied}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
