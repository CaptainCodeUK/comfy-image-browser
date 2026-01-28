import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addAlbumWithImages,
  addImagesToAlbum,
  addFavorites,
  getAlbums,
  getAppPref,
  getFavorites,
  getImages,
  removeFavorites,
  removeAlbumById,
  removeImagesById,
  setAppPref,
  updateAlbumInfo,
  updateImageFileInfo,
} from "./lib/db";
import type { Album, IndexedImage, IndexedImagePayload } from "./lib/types";

const DEFAULT_ICON_SIZE = 180;
const GRID_GAP = 16;
const CARD_META_HEIGHT = 56;
const THUMBNAIL_BATCH_SIZE = 12;
const THUMBNAIL_RETRY_MS = 1200;
const FILE_URL_BATCH_SIZE = 30;
const FAVORITES_ID = "favorites";

type Tab =
  | { id: "library"; title: "Library"; type: "library" }
  | { id: string; title: string; type: "image"; image: IndexedImage };

type ZoomMode = "fit" | "actual" | "width" | "height" | "manual";
type AlbumSort = "name-asc" | "name-desc" | "added-desc" | "added-asc";
type ImageSort = "name-asc" | "name-desc" | "date-desc" | "date-asc" | "size-desc" | "size-asc";
type ProgressState = { current: number; total: number; label: string } | null;
type RenameState = { type: "image" | "album"; id: string; value: string } | null;

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
  const fallback = (parsedWorkflow && typeof parsedWorkflow === "object" ? parsedWorkflow : {}) as Record<
    string,
    MetadataValue
  >;

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

  const loraValue =
    parsed.loras ||
    parsed.lora ||
    findNodeInput(promptNodes, "lora_name") ||
    findNodeInput(workflowNodes, "lora_name");
  let loras: string[] = [];
  if (Array.isArray(loraValue)) {
    loras = loraValue.map((item) => pickString(item) ?? "").filter(Boolean);
  } else if (typeof loraValue === "string") {
    loras = loraValue.split(",").map((entry) => entry.trim()).filter(Boolean);
  } else if (loraValue && typeof loraValue === "object") {
    loras = Object.keys(loraValue).filter(Boolean);
  }

  return {
    promptText,
    width,
    height,
    batchSize,
    checkpoint,
    seed,
    loras,
  };
};

const LibraryTab: Tab = { id: "library", title: "Library", type: "library" };

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
};

export default function App() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [images, setImages] = useState<IndexedImage[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([LibraryTab]);
  const [activeTab, setActiveTab] = useState<Tab>(LibraryTab);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [iconSize, setIconSize] = useState(DEFAULT_ICON_SIZE);
  const [activeAlbum, setActiveAlbum] = useState<string | "all">("all");
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
  const [albumSort, setAlbumSort] = useState<AlbumSort>("name-asc");
  const [imageSort, setImageSort] = useState<ImageSort>("date-desc");
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<Set<string>>(new Set());
  const [folderProgress, setFolderProgress] = useState<ProgressState>(null);
  const [imageProgress, setImageProgress] = useState<ProgressState>(null);
  const [removalProgress, setRemovalProgress] = useState<ProgressState>(null);
  const indexingTokenRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [cancelingIndex, setCancelingIndex] = useState(false);
  const [gridMetrics, setGridMetrics] = useState({ width: 0, height: 0, scrollTop: 0 });
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [thumbnailMap, setThumbnailMap] = useState<Record<string, string>>({});
  const [loadedThumbs, setLoadedThumbs] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [renameState, setRenameState] = useState<RenameState>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<{ name: string; version: string } | null>(null);
  const [metadataSummary, setMetadataSummary] = useState<ReturnType<typeof extractMetadataSummary> | null>(null);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCancelRef = useRef(false);
  const renameTargetRef = useRef<string | null>(null);
  const thumbnailMapRef = useRef<Record<string, string>>({});
  const thumbnailPendingRef = useRef<Set<string>>(new Set());
  const thumbnailRetryRef = useRef<number | null>(null);
  const thumbnailTokenRef = useRef(0);
  const [thumbnailRetryTick, setThumbnailRetryTick] = useState(0);
  const metadataCacheRef = useRef<Map<string, ReturnType<typeof extractMetadataSummary>>>(new Map());

  const bridgeAvailable = typeof window !== "undefined" && !!window.comfy;

  useEffect(() => {
    console.log("[comfy-browser] UI mounted");
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
      void setAppPref("activeAlbum", activeAlbum);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [activeAlbum]);

  useEffect(() => {
    console.log("[comfy-browser] Active album changed", activeAlbum);
  }, [activeAlbum]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void setAppPref("albumSort", albumSort);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [albumSort]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void setAppPref("imageSort", imageSort);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [imageSort]);

  const albumById = useMemo(() => {
    return new Map(albums.map((album) => [album.id, album]));
  }, [albums]);

  const imageById = useMemo(() => {
    return new Map(images.map((image) => [image.id, image]));
  }, [images]);

  const createdAtMsById = useMemo(() => {
    return new Map(images.map((image) => [image.id, Date.parse(image.createdAt)]));
  }, [images]);

  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const image of images) {
      const albumName = albumById.get(image.albumId)?.name ?? "";
      const metaString = image.metadataText ? JSON.stringify(image.metadataText).toLowerCase() : "";
      map.set(image.id, `${image.fileName.toLowerCase()}|${albumName.toLowerCase()}|${metaString}`);
    }
    return map;
  }, [images, albumById]);

  const sortImages = useCallback(
    (items: IndexedImage[]) => {
      const sorted = [...items];
      sorted.sort((a, b) => {
        switch (imageSort) {
          case "name-asc":
            return a.fileName.localeCompare(b.fileName);
          case "name-desc":
            return b.fileName.localeCompare(a.fileName);
          case "date-asc": {
            const aTime = createdAtMsById.get(a.id) ?? 0;
            const bTime = createdAtMsById.get(b.id) ?? 0;
            return aTime - bTime;
          }
          case "date-desc": {
            const aTime = createdAtMsById.get(a.id) ?? 0;
            const bTime = createdAtMsById.get(b.id) ?? 0;
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
    [createdAtMsById, imageSort]
  );

  const filteredImages = useMemo(() => {
    const start = performance.now();
    const query = search.trim().toLowerCase();
    const visible = images.filter((image) => {
      if (activeAlbum === FAVORITES_ID && !favoriteIds.has(image.id)) {
        return false;
      }
      if (activeAlbum !== "all" && activeAlbum !== FAVORITES_ID && image.albumId !== activeAlbum) {
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
    return sorted;
  }, [images, search, activeAlbum, favoriteIds, searchIndex, sortImages]);

  const selectedImages = filteredImages.filter((image) => selectedIds.has(image.id));

  const albumIdForNav =
    activeTab.type === "image"
      ? activeAlbum === FAVORITES_ID && favoriteIds.has(activeTab.image.id)
        ? FAVORITES_ID
        : activeTab.image.albumId
      : activeAlbum;
  const albumHighlightId = albumIdForNav;

  const albumSortedImages = useMemo(() => {
    const trimmedQuery = search.trim();
    if (!trimmedQuery && albumIdForNav === activeAlbum) {
      return filteredImages;
    }
    const visible = images.filter((image) => {
      if (albumIdForNav === FAVORITES_ID && !favoriteIds.has(image.id)) {
        return false;
      }
      if (albumIdForNav !== "all" && albumIdForNav !== FAVORITES_ID && image.albumId !== albumIdForNav) {
        return false;
      }
      return true;
    });
    return sortImages(visible);
  }, [images, albumIdForNav, favoriteIds, activeAlbum, filteredImages, search, sortImages]);

  const navigationImages = useMemo(() => {
    if (activeTab.type === "image" && search.trim()) {
      return filteredImages;
    }
    return albumSortedImages;
  }, [activeTab.type, search, filteredImages, albumSortedImages]);

  const gridColumnCount = useMemo(() => {
    if (!gridMetrics.width) return 1;
    return Math.max(1, Math.floor((gridMetrics.width + GRID_GAP) / (iconSize + GRID_GAP)));
  }, [gridMetrics.width, iconSize]);

  const rowHeight = iconSize + CARD_META_HEIGHT + GRID_GAP;
  const totalRows = Math.ceil(filteredImages.length / gridColumnCount);
  const startRow = Math.max(0, Math.floor(gridMetrics.scrollTop / rowHeight) - 1);
  const endRow = Math.min(
    totalRows - 1,
    Math.ceil((gridMetrics.scrollTop + gridMetrics.height) / rowHeight) + 1
  );
  const startIndex = startRow * gridColumnCount;
  const endIndex = Math.min(filteredImages.length, (endRow + 1) * gridColumnCount);
  const visibleImages = filteredImages.slice(startIndex, endIndex);

  const getRangeIds = useCallback(
    (start: number, end: number) => {
      const [from, to] = start < end ? [start, end] : [end, start];
      const ids = filteredImages.slice(from, to + 1).map((image) => image.id);
      return new Set(ids);
    },
    [filteredImages]
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
      } else if (rowBottom > viewBottom) {
        grid.scrollTop = rowBottom - grid.clientHeight;
      }
    },
    [gridColumnCount, rowHeight]
  );

  useEffect(() => {
    if (focusedIndex === null) return;
    scrollToIndex(focusedIndex);
  }, [focusedIndex, scrollToIndex]);

  useEffect(() => {
    const visibleIds = new Set(filteredImages.map((image) => image.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setFocusedIndex((prev) => {
      if (prev === null) return prev;
      if (filteredImages.length === 0) return null;
      return Math.min(prev, filteredImages.length - 1);
    });
  }, [filteredImages]);

  const sortedAlbums = useMemo(() => {
    const sorted = [...albums];
    sorted.sort((a, b) => {
      switch (albumSort) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "added-asc":
          return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
        case "added-desc":
          return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
        default:
          return 0;
      }
    });
    return sorted;
  }, [albums, albumSort]);

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
  console.log("[comfy-browser] Loading albums and images...");
      const [
        albumRows,
        imageRows,
        favoriteRows,
        storedIconSize,
        storedAlbum,
        storedAlbumSort,
        storedImageSort,
      ] = await Promise.all([
        getAlbums(),
        getImages(),
        getFavorites(),
        getAppPref<number>("iconSize"),
        getAppPref<string>("activeAlbum"),
        getAppPref<AlbumSort>("albumSort"),
        getAppPref<ImageSort>("imageSort"),
      ]);
  const baseImages = imageRows.map((image: IndexedImage) => ({ ...image, fileUrl: image.filePath }));
      console.log("[comfy-browser] Loaded", {
        albums: albumRows.length,
        images: baseImages.length,
      });
      setAlbums(albumRows);
      setImages(baseImages);
      setFavoriteIds(new Set(favoriteRows));
      cleanup = hydrateFileUrls(baseImages);
      if (storedIconSize) {
        setIconSize(storedIconSize);
      }
      if (storedAlbum === FAVORITES_ID || storedAlbum === "all") {
        setActiveAlbum(storedAlbum as string | "all");
      } else if (storedAlbum && albumRows.some((album: Album) => album.id === storedAlbum)) {
        setActiveAlbum(storedAlbum as string | "all");
      } else if (storedAlbum) {
        setActiveAlbum("all");
      }
      if (storedAlbumSort) {
        setAlbumSort(storedAlbumSort);
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
  }, [bridgeAvailable, visibleImages]);


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

      setThumbnailMap((prev) => {
        const next = { ...prev };
        for (const result of results) {
          if (result.url) {
            next[result.id] = result.url;
          }
        }
        return next;
      });
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
      setThumbnailMap((prev) => {
        const next = { ...prev };
        for (const result of results) {
          thumbnailPendingRef.current.delete(result.id);
          if (result.url) {
            next[result.id] = result.url;
          } else {
            shouldRetry = true;
          }
        }
        return next;
      });

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
  }, [visibleImages, bridgeAvailable, thumbnailRetryTick]);

  const toggleSelection = (id: string, multi: boolean) => {
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
  };

  const handleOpenImages = async (imagesToOpen: IndexedImage[]) => {
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
      return [LibraryTab, ...prev.filter((tab) => tab.id !== "library"), ...additions];
    });
    setActiveTab((current) => {
      if (imagesToOpen.length === 1) {
        return {
          id: imagesToOpen[0].id,
          title: imagesToOpen[0].fileName,
          type: "image" as const,
          image: imagesToOpen[0],
        };
      }
      return current;
    });

    const resolvedImages = await resolveFileUrlsForTabs(imagesToOpen);
    applyResolvedTabUrls(resolvedImages);
  };

  const handleNavigateImage = async (target: IndexedImage) => {
    if (activeTab.type !== "image") {
      await handleOpenImages([target]);
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
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        if (event.shiftKey) {
          const albumTarget =
            selectedAlbumIds.size === 1
              ? albums.find((album) => selectedAlbumIds.has(album.id))
              : activeAlbum !== "all"
              ? albumById.get(activeAlbum) ?? null
              : null;
          if (albumTarget) {
            startRenameAlbum(albumTarget);
          }
        } else {
          const imageTarget =
            activeTab.type === "image"
              ? activeTab.image
              : selectedIds.size === 1
              ? images.find((image) => selectedIds.has(image.id))
              : null;
          if (imageTarget) {
            startRenameImage(imageTarget);
          }
        }
        return;
      }
      if (event.key === "Enter" && activeTab.type === "library" && selectedIds.size > 0) {
        event.preventDefault();
        void handleOpenImages(selectedImages);
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
          activeTab.type === "image"
            ? activeTab.image
            : selectedIds.size === 1
            ? images.find((image) => selectedIds.has(image.id))
            : null;
        if (target) {
          void toggleFavoriteImage(target);
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
          handleSelectAllAlbums();
        } else if (activeTab.type === "library") {
          handleSelectAllImages();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
        event.preventDefault();
        if (event.shiftKey) {
          handleInvertAlbumSelection();
        } else if (activeTab.type === "library") {
          handleInvertImageSelection();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Backspace") {
        event.preventDefault();
        if (event.shiftKey) {
          handleClearAlbumSelection();
        } else if (activeTab.type === "library") {
          handleClearImageSelection();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        handleDuplicateTab();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w" && event.shiftKey) {
        event.preventDefault();
        handleCloseOtherTabs(activeTab.id);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w" && event.altKey) {
        event.preventDefault();
        handleCloseAllTabs();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        if (activeTab.id !== "library") {
          handleCloseTab(activeTab.id);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "tab") {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        if (tabs.length === 0) return;
        const currentIndex = tabs.findIndex((tab) => tab.id === activeTab.id);
        if (currentIndex === -1) return;
        const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
        setActiveTab(tabs[nextIndex]);
        return;
      }
      if (activeTab.type === "library") {
        if (filteredImages.length === 0) return;
        const isArrow =
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown";
        if (!isArrow) return;
        event.preventDefault();

        const columns = Math.max(1, gridColumnCount);
        const currentIndex = focusedIndex ?? 0;
        let nextIndex = currentIndex;

        if (event.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
        if (event.key === "ArrowRight") nextIndex = Math.min(filteredImages.length - 1, currentIndex + 1);
        if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - columns);
        if (event.key === "ArrowDown") nextIndex = Math.min(filteredImages.length - 1, currentIndex + columns);

        const nextId = filteredImages[nextIndex].id;
        setFocusedIndex(nextIndex);

        if (event.shiftKey) {
          const anchor = selectionAnchor ?? currentIndex;
          const rangeIds = getRangeIds(anchor, nextIndex);
          setSelectedIds((prev) => {
            if (event.ctrlKey || event.metaKey) {
              return new Set([...prev, ...rangeIds]);
            }
            return rangeIds;
          });
          setSelectionAnchor(anchor);
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
      if (activeTab.type !== "image") return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const currentImageId = activeTab.image.id;
        const currentIndex = navigationImages.findIndex((image) => image.id === currentImageId);
        if (currentIndex === -1) return;
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        const total = navigationImages.length;
        const nextIndex = (currentIndex + delta + total) % total;
        event.preventDefault();
        void handleNavigateImage(navigationImages[nextIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    activeTab,
  albumSortedImages,
  navigationImages,
    albums,
    albumById,
    activeAlbum,
    filteredImages,
    focusedIndex,
    gridColumnCount,
    handleNavigateImage,
    selectedIds,
    selectedAlbumIds,
    selectedImages,
    startRenameImage,
    startRenameAlbum,
  toggleFavoriteImage,
  searchInputRef,
    selectionAnchor,
    getRangeIds,
    tabs,
  ]);

  const handleCloseTab = (tabId: string) => {
    if (tabId === "library") return;
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === tabId);
      const nextTabs = prev.filter((tab) => tab.id !== tabId);

      setActiveTab((current) => {
        if (current.id !== tabId) return current;
        if (nextTabs.length === 0) return LibraryTab;
        const leftIndex = Math.max(0, index - 1);
        const fallbackIndex = Math.min(leftIndex, nextTabs.length - 1);
        return nextTabs[fallbackIndex];
      });

      return nextTabs;
    });
  };

  const handleCloseAllTabs = () => {
    setTabs([LibraryTab]);
    setActiveTab(LibraryTab);
  };

  const handleCloseOtherTabs = (tabId: string) => {
    setTabs((prev) => {
      const keep = prev.filter((tab) => tab.id === "library" || tab.id === tabId);
      return keep.length ? keep : [LibraryTab];
    });
    setActiveTab((current) => (current.id === tabId ? current : LibraryTab));
  };

  const handleCycleTab = (direction: number) => {
    if (tabs.length === 0) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab.id);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIndex]);
  };

  const handleDuplicateTab = () => {
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
  };

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
    const idSet = new Set(ids);
    await removeImagesById(ids);
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
    setTabs((prev) => prev.filter((tab) => tab.type === "library" || !idSet.has(tab.id)));
    setActiveTab((current) => (current.type === "image" && idSet.has(current.id) ? LibraryTab : current));
  };

  function startRenameImage(image: IndexedImage) {
    setRenameState({ type: "image", id: image.id, value: image.fileName });
  }

  function startRenameAlbum(album: Album) {
    setRenameState({ type: "album", id: album.id, value: album.name });
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
      setThumbnailMap((prev) => {
        const next = { ...prev };
        delete next[image.id];
        return next;
      });
      setLoadedThumbs((prev) => {
        const next = new Set(prev);
        next.delete(image.id);
        return next;
      });
      hydrateFileUrls([{ ...image, filePath: newPath, fileName, fileUrl: newPath }]);
      setToastMessage(`Renamed image to ${fileName}`);
      setLastCopied(`Renamed image to ${fileName}`);
      setRenameState(null);
      return;
    }

    const album = albums.find((entry) => entry.id === current.id);
    if (!album || !window.comfy?.renamePath) {
      setRenameState(null);
      return;
    }
    if (trimmed === album.name) {
      setRenameState(null);
      return;
    }
    const parentPath = getParentPath(album.rootPath);
    const newRootPath = joinPath(parentPath, trimmed);
    const result = await window.comfy.renamePath({ oldPath: album.rootPath, newPath: newRootPath, kind: "folder" });
    if (!result?.success) {
      setToastMessage(result?.message ?? "Failed to rename album");
      setLastCopied(result?.message ?? "Failed to rename album");
      return;
    }
    await updateAlbumInfo(album.id, { name: trimmed, rootPath: newRootPath });
    const prefix = ensureTrailingSeparator(album.rootPath);
    const nextPrefix = ensureTrailingSeparator(newRootPath);
    const updatedImages = images
      .filter((entry) => entry.albumId === album.id)
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
    setAlbums((prev) => prev.map((entry) => (entry.id === album.id ? { ...entry, name: trimmed, rootPath: newRootPath } : entry)));
    setImages((prev) => prev.map((entry) => updatedMap.get(entry.id) ?? entry));
    setTabs((prev) =>
      prev.map((tab) =>
        tab.type === "image" && tab.image.albumId === album.id
          ? {
              ...tab,
              image: updatedMap.get(tab.image.id) ?? tab.image,
            }
          : tab
      )
    );
    setActiveTab((currentTab) =>
      currentTab.type === "image" && currentTab.image.albumId === album.id
        ? { ...currentTab, image: updatedMap.get(currentTab.image.id) ?? currentTab.image }
        : currentTab
    );
    setThumbnailMap((prev) => {
      const next = { ...prev };
      updatedImages.forEach((entry) => {
        delete next[entry.id];
      });
      return next;
    });
    setLoadedThumbs((prev) => {
      const next = new Set(prev);
      updatedImages.forEach((entry) => next.delete(entry.id));
      return next;
    });
    hydrateFileUrls(updatedImages);
    setToastMessage(`Renamed album to ${trimmed}`);
    setLastCopied(`Renamed album to ${trimmed}`);
    setRenameState(null);
  }

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

  async function addAlbumToFavorites(album: Album) {
    const albumImages = images.filter((image) => image.albumId === album.id).map((image) => image.id);
    if (albumImages.length === 0) return;
    await addFavoriteImages(albumImages, `${album.name} added to favourites`);
  }

  async function removeAlbumFromFavorites(album: Album) {
    const albumImages = images.filter((image) => image.albumId === album.id).map((image) => image.id);
    if (albumImages.length === 0) return;
    await removeFavoriteImages(albumImages, `${album.name} removed from favourites`);
  }

  const removeAlbumFromIndex = async (albumId: string) => {
    await removeAlbumById(albumId);
    setAlbums((prev) => prev.filter((album) => album.id !== albumId));
    setFavoriteIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      images.forEach((image) => {
        if (image.albumId === albumId) {
          next.delete(image.id);
        }
      });
      return next;
    });
    setImages((prev) => prev.filter((image) => image.albumId !== albumId));
    setTabs((prev) => prev.filter((tab) => tab.type === "library" || tab.image.albumId !== albumId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      images.forEach((image) => {
        if (image.albumId === albumId) {
          next.delete(image.id);
        }
      });
      return next;
    });
    if (activeAlbum === albumId) {
      setActiveAlbum("all");
    }
    setSelectedAlbumIds((prev) => {
      const next = new Set(prev);
      next.delete(albumId);
      return next;
    });
  };

  const handleRemoveAlbum = async (albumId: string) => {
    const albumName = albums.find((album) => album.id === albumId)?.name ?? "this album";
    const confirmed = window.confirm(`Remove ${albumName} from the index?`);
    if (!confirmed) return;
    setRemovalProgress({ current: 0, total: 1, label: albumName });
    await removeAlbumFromIndex(albumId);
    setRemovalProgress(null);
  };

  const handleToggleAlbumSelection = (albumId: string) => {
    setSelectedAlbumIds((prev) => {
      const next = new Set(prev);
      if (next.has(albumId)) {
        next.delete(albumId);
      } else {
        next.add(albumId);
      }
      return next;
    });
  };

  const handleRemoveSelectedAlbums = async () => {
    if (selectedAlbumIds.size === 0) return;
    const confirmed = window.confirm(`Remove ${selectedAlbumIds.size} album(s) from the index?`);
    if (!confirmed) return;
    const ids = Array.from(selectedAlbumIds);
    let index = 0;
    setRemovalProgress({ current: 0, total: ids.length, label: "" });
    for (const id of ids) {
      index += 1;
      const name = albums.find((album) => album.id === id)?.name ?? "Album";
      setRemovalProgress({ current: index, total: ids.length, label: name });
      await removeAlbumFromIndex(id);
    }
    setRemovalProgress(null);
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

  const handleSelectAllAlbums = () => {
    if (albums.length === 0) return;
    setSelectedAlbumIds(new Set(albums.map((album) => album.id)));
  };

  const handleInvertAlbumSelection = () => {
    if (albums.length === 0) return;
    setSelectedAlbumIds((prev) => {
      const next = new Set<string>();
      albums.forEach((album) => {
        if (!prev.has(album.id)) {
          next.add(album.id);
        }
      });
      return next;
    });
  };

  const handleClearAlbumSelection = () => {
    setSelectedAlbumIds(new Set());
  };

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
    const filePaths = ids
      .map((id) => imageById.get(id)?.filePath)
      .filter((path): path is string => Boolean(path));
    if (!filePaths.length) return [];
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
  };

  const handleDeleteAlbumFromDisk = async (albumId: string) => {
    const album = albums.find((entry) => entry.id === albumId);
    if (!album) return;
    const albumImageIds = images.filter((image) => image.albumId === albumId).map((image) => image.id);
    if (!albumImageIds.length) return;
    const deletedIds = await handleDeleteImagesFromDisk(albumImageIds, `${album.name} images`);
    if (!deletedIds || deletedIds.length === 0) return;
    const deletedSet = new Set(deletedIds);
    const remaining = images.filter((image) => image.albumId === albumId && !deletedSet.has(image.id));
    if (remaining.length === 0) {
      await removeAlbumFromIndex(albumId);
    }
  };

  const handleDeleteSelectedAlbumsFromDisk = async () => {
    if (!selectedAlbumIds.size) return;
    const ids = Array.from(selectedAlbumIds);
    const albumImageIds = images
      .filter((image) => selectedAlbumIds.has(image.albumId))
      .map((image) => image.id);
    if (!albumImageIds.length) return;
    const deletedIds = await handleDeleteImagesFromDisk(albumImageIds, `${ids.length} album(s) images`);
    if (!deletedIds || deletedIds.length === 0) return;
    const deletedSet = new Set(deletedIds);
    const remainingImages = images.filter((image) => !deletedSet.has(image.id));
    const remainingAlbumIds = new Set(remainingImages.map((image) => image.albumId));
    for (const albumId of ids) {
      if (!remainingAlbumIds.has(albumId)) {
        await removeAlbumFromIndex(albumId);
      }
    }
  };

  const handleImageContextMenu = async (event: React.MouseEvent, image: IndexedImage) => {
    event.preventDefault();
    if (!bridgeAvailable || !window.comfy?.showContextMenu) return;
    const action = await window.comfy.showContextMenu({
      type: "image",
      imageId: image.id,
      label: image.fileName,
      selectedCount: selectedIds.size,
      isSelected: selectedIds.has(image.id),
    });
    if (action === "rename-image") {
      startRenameImage(image);
    }
    if (action === "add-selected-images-favorites") {
      await addFavoriteImages(Array.from(selectedIds), `${selectedIds.size} image(s) added to favourites`);
    }
    if (action === "remove-selected-images-favorites") {
      await removeFavoriteImages(Array.from(selectedIds), `${selectedIds.size} image(s) removed from favourites`);
    }
    if (action === "remove-selected-images") {
      await handleRemoveImages(Array.from(selectedIds));
    }
    if (action === "delete-selected-images-disk") {
      await handleDeleteImagesFromDisk(Array.from(selectedIds), `${selectedIds.size} selected images`);
    }
    if (action === "reveal-image") {
      await handleRevealInFolder(image.filePath);
    }
    if (action === "edit-image") {
      await handleOpenInEditor(image.filePath);
    }
    if (action === "select-all-images") {
      handleSelectAllImages();
    }
    if (action === "invert-image-selection") {
      handleInvertImageSelection();
    }
    if (action === "clear-image-selection") {
      handleClearImageSelection();
    }
  };

  const handleAlbumContextMenu = async (event: React.MouseEvent, album: Album) => {
    event.preventDefault();
    if (!bridgeAvailable || !window.comfy?.showContextMenu) return;
    const action = await window.comfy.showContextMenu({
      type: "album",
      albumId: album.id,
      label: album.name,
      selectedCount: selectedAlbumIds.size,
      isSelected: selectedAlbumIds.has(album.id),
    });
    if (action === "rename-album") {
      startRenameAlbum(album);
    }
    if (action === "add-selected-albums-favorites") {
      const targets = selectedAlbumIds.size ? selectedAlbumIds : new Set([album.id]);
      for (const id of targets) {
        const targetAlbum = albums.find((entry) => entry.id === id);
        if (targetAlbum) {
          await addAlbumToFavorites(targetAlbum);
        }
      }
    }
    if (action === "remove-selected-albums-favorites") {
      const targets = selectedAlbumIds.size ? selectedAlbumIds : new Set([album.id]);
      for (const id of targets) {
        const targetAlbum = albums.find((entry) => entry.id === id);
        if (targetAlbum) {
          await removeAlbumFromFavorites(targetAlbum);
        }
      }
    }
    if (action === "rescan-album") {
      await handleRescanAlbums([album.id]);
    }
    if (action === "remove-selected-albums") {
      await handleRemoveSelectedAlbums();
    }
    if (action === "delete-selected-albums-disk") {
      await handleDeleteSelectedAlbumsFromDisk();
    }
    if (action === "reveal-album") {
      await handleRevealInFolder(album.rootPath);
    }
    if (action === "select-all-albums") {
      handleSelectAllAlbums();
    }
    if (action === "invert-album-selection") {
      handleInvertAlbumSelection();
    }
    if (action === "clear-album-selection") {
      handleClearAlbumSelection();
    }
  };

  const getPathSeparator = (value: string) => (value.includes("\\") ? "\\" : "/");
  const ensureTrailingSeparator = (value: string) =>
    value.endsWith("/") || value.endsWith("\\") ? value : `${value}${getPathSeparator(value)}`;
  const isPathWithinRoot = (candidate: string, root: string) =>
    candidate === root || candidate.startsWith(ensureTrailingSeparator(root));
  const getParentPath = (value: string) => {
    const separator = getPathSeparator(value);
    const parts = value.split(/[/\\]/).filter((segment) => segment.length > 0);
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

  const handleRescanAlbums = async (albumIds: string[]) => {
    if (!bridgeAvailable || !window.comfy?.indexFolders) return;
    const targets = albums.filter((album) => albumIds.includes(album.id));
    if (targets.length === 0) return;
    setIsIndexing(true);
    const token = { cancelled: false };
    indexingTokenRef.current = token;
    setCancelingIndex(false);
    setFolderProgress(null);
    setImageProgress(null);
    try {
      const targetImageList = images.filter((image) => targets.some((album) => album.id === image.albumId));
      const missingPaths = window.comfy?.findMissingFiles
        ? await window.comfy.findMissingFiles(targetImageList.map((image) => image.filePath))
        : [];
      const missingPathSet = new Set(missingPaths);
      if (missingPathSet.size > 0) {
        const missingIds = targetImageList
          .filter((image) => missingPathSet.has(image.filePath))
          .map((image) => image.id);
        await handleRemoveImages(missingIds, { confirm: false });
      }
      const rootPaths = targets.map((album) => album.rootPath);
      const imagesForIndex = missingPathSet.size > 0
        ? images.filter((image) => !missingPathSet.has(image.filePath))
        : images;
      const payload = (await window.comfy.indexFolders(
        rootPaths,
        imagesForIndex.map((image) => image.filePath)
      )) as Array<{
        rootPath: string;
        images: IndexedImagePayload[];
      }>;

      if (token.cancelled || payload.length === 0) {
        return;
      }

      const existingFilePaths = new Set(images.map((image) => image.filePath));
      const albumByRoot = new Map(targets.map((album) => [album.rootPath, album]));
      const newImages: IndexedImage[] = [];

      for (const albumPayload of payload) {
        const album = albumByRoot.get(albumPayload.rootPath);
        if (!album) continue;
        const filtered = albumPayload.images.filter((image) => !existingFilePaths.has(image.filePath));
        if (filtered.length === 0) continue;
        filtered.forEach((image) => existingFilePaths.add(image.filePath));
        const added = await addImagesToAlbum(album.id, filtered);
        newImages.push(...added);
      }

      if (newImages.length === 0) {
        setToastMessage("No new images to add");
        setLastCopied("No new images to add");
        return;
      }

      const baseImages = newImages.map((image) => ({ ...image, fileUrl: image.filePath }));
      setImages((prev) => [...prev, ...baseImages]);
      hydrateFileUrls(baseImages);
    } finally {
      setIsIndexing(false);
    }
  };

  const handleAddFolder = async () => {
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
    try {
      const folderPaths = await window.comfy.selectFolders();
      if (!folderPaths.length) {
        return;
      }
      const uniquePaths = Array.from(new Set(folderPaths));
      if (uniquePaths.length === 0) {
        return;
      }
      const affectedAlbums = albums.filter((album) =>
        uniquePaths.some((rootPath) => isPathWithinRoot(album.rootPath, rootPath))
      );
      const affectedAlbumIds = new Set(affectedAlbums.map((album) => album.id));
      const affectedImages = images.filter((image) => affectedAlbumIds.has(image.albumId));
      const missingPaths = window.comfy?.findMissingFiles
        ? await window.comfy.findMissingFiles(affectedImages.map((image) => image.filePath))
        : [];
      const missingPathSet = new Set(missingPaths);
      if (missingPathSet.size > 0) {
        const missingIds = affectedImages
          .filter((image) => missingPathSet.has(image.filePath))
          .map((image) => image.id);
        await handleRemoveImages(missingIds, { confirm: false });
      }
      const imagesForIndex = missingPathSet.size > 0
        ? images.filter((image) => !missingPathSet.has(image.filePath))
        : images;
      const payload = (await window.comfy.indexFolders(
        uniquePaths,
        imagesForIndex.map((image) => image.filePath)
      )) as Array<{
        rootPath: string;
        images: IndexedImagePayload[];
      }>;

      if (token.cancelled || payload.length === 0) {
        return;
      }

      const existingFilePaths = new Set(images.map((image) => image.filePath));
      const albumByRoot = new Map(albums.map((album) => [album.rootPath, album]));
      const newAlbums: Album[] = [];
      const newImages: IndexedImage[] = [];

      for (const albumPayload of payload) {
        const filtered = albumPayload.images.filter((image) => !existingFilePaths.has(image.filePath));
        if (filtered.length === 0) continue;
        filtered.forEach((image) => existingFilePaths.add(image.filePath));

        const existingAlbum = albumByRoot.get(albumPayload.rootPath);
        if (existingAlbum) {
          const added = await addImagesToAlbum(existingAlbum.id, filtered);
          newImages.push(...added);
          continue;
        }

        const result = await addAlbumWithImages(albumPayload.rootPath, filtered);
        newAlbums.push(result.album);
        newImages.push(...result.images);
      }

      if (newAlbums.length === 0 && newImages.length === 0) {
        setToastMessage("No new images to add");
        setLastCopied("No new images to add");
        return;
      }

      const baseImages = newImages.map((image) => ({ ...image, fileUrl: image.filePath }));

      if (newAlbums.length > 0) {
        setAlbums((prev) => [...prev, ...newAlbums]);
      }
      if (baseImages.length > 0) {
        setImages((prev) => [...prev, ...baseImages]);
        hydrateFileUrls(baseImages);
      }
    } finally {
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

  useEffect(() => {
    if (!bridgeAvailable || !window.comfy?.onMenuAction) return;
    return window.comfy.onMenuAction((action) => {
      const fallbackImage =
        activeTab.type === "image" ? activeTab.image : images.find((image) => selectedIds.has(image.id));
      if (action === "add-folder") {
        void handleAddFolder();
        return;
      }
      if (action === "remove-selected-images") {
        void handleRemoveSelected();
        return;
      }
      if (action === "remove-selected-albums") {
        void handleRemoveSelectedAlbums();
        return;
      }
      if (action === "rescan-selected-albums") {
        void handleRescanAlbums(Array.from(selectedAlbumIds));
        return;
      }
      if (action === "select-all-images") {
        handleSelectAllImages();
        return;
      }
      if (action === "invert-image-selection") {
        handleInvertImageSelection();
        return;
      }
      if (action === "clear-image-selection") {
        handleClearImageSelection();
        return;
      }
      if (action === "select-all-albums") {
        handleSelectAllAlbums();
        return;
      }
      if (action === "invert-album-selection") {
        handleInvertAlbumSelection();
        return;
      }
      if (action === "clear-album-selection") {
        handleClearAlbumSelection();
        return;
      }
      if (action === "delete-selected-images-disk") {
        void handleDeleteImagesFromDisk(Array.from(selectedIds), `${selectedIds.size} selected images`);
        return;
      }
      if (action === "delete-selected-albums-disk") {
        void handleDeleteSelectedAlbumsFromDisk();
        return;
      }
      if (action === "add-selected-images-favorites") {
        void addFavoriteImages(Array.from(selectedIds), `${selectedIds.size} image(s) added to favourites`);
        return;
      }
      if (action === "remove-selected-images-favorites") {
        void removeFavoriteImages(Array.from(selectedIds), `${selectedIds.size} image(s) removed from favourites`);
        return;
      }
      if (action === "add-selected-albums-favorites") {
        void (async () => {
          for (const id of selectedAlbumIds) {
            const targetAlbum = albums.find((entry) => entry.id === id);
            if (targetAlbum) {
              await addAlbumToFavorites(targetAlbum);
            }
          }
        })();
        return;
      }
      if (action === "remove-selected-albums-favorites") {
        void (async () => {
          for (const id of selectedAlbumIds) {
            const targetAlbum = albums.find((entry) => entry.id === id);
            if (targetAlbum) {
              await removeAlbumFromFavorites(targetAlbum);
            }
          }
        })();
        return;
      }
      if (action === "rename-selected-image") {
        const target =
          activeTab.type === "image"
            ? activeTab.image
            : selectedIds.size === 1
            ? images.find((image) => selectedIds.has(image.id))
            : null;
        if (target) {
          startRenameImage(target);
        }
        return;
      }
      if (action === "rename-selected-album") {
        const target =
          selectedAlbumIds.size === 1
            ? albums.find((album) => selectedAlbumIds.has(album.id))
            : activeAlbum !== "all"
            ? albumById.get(activeAlbum) ?? null
            : null;
        if (target) {
          startRenameAlbum(target);
        }
        return;
      }
      if (action === "reveal-active-image") {
        void handleRevealInFolder(fallbackImage?.filePath);
        return;
      }
      if (action === "edit-active-image") {
        void handleOpenInEditor(fallbackImage?.filePath);
        return;
      }
      if (action === "reveal-active-album") {
        const targetAlbum = activeTab.type === "image" ? activeTab.image.albumId : activeAlbum;
        const album = targetAlbum === "all" ? null : albumById.get(targetAlbum);
        void handleRevealInFolder(album?.rootPath);
        return;
      }
      if (action === "tab-next") {
        handleCycleTab(1);
        return;
      }
      if (action === "tab-prev") {
        handleCycleTab(-1);
        return;
      }
      if (action === "tab-duplicate") {
        handleDuplicateTab();
        return;
      }
      if (action === "tab-close") {
        if (activeTab.id !== "library") {
          handleCloseTab(activeTab.id);
        }
        return;
      }
      if (action === "tab-close-others") {
        handleCloseOtherTabs(activeTab.id);
        return;
      }
      if (action === "tab-close-all") {
        handleCloseAllTabs();
        return;
      }
      if (action === "show-about") {
        setAboutOpen(true);
        return;
      }
    });
  }, [
    bridgeAvailable,
    handleAddFolder,
    handleRemoveSelected,
    handleRemoveSelectedAlbums,
    handleDeleteSelectedAlbumsFromDisk,
    handleDeleteImagesFromDisk,
    handleRevealInFolder,
    selectedIds,
    images,
  albums,
    activeTab,
    activeAlbum,
    albumById,
    selectedAlbumIds,
    startRenameImage,
    startRenameAlbum,
    addFavoriteImages,
    removeFavoriteImages,
    addAlbumToFavorites,
    removeAlbumFromFavorites,
    setAboutOpen,
    tabs,
  ]);

  useEffect(() => {
    if (!bridgeAvailable || !window.comfy?.updateMenuState) return;
    const activeImage = activeTab.type === "image" ? activeTab.image : images.find((image) => selectedIds.has(image.id));
    const hasActiveImage = Boolean(activeImage);
    const albumTargetId = activeTab.type === "image" ? activeTab.image.albumId : activeAlbum;
    const hasActiveAlbum =
      albumTargetId !== "all" && albumTargetId !== FAVORITES_ID && Boolean(albumById.get(albumTargetId));
    const isLibraryTab = activeTab.type === "library";
    window.comfy.updateMenuState({
      hasActiveImage,
      hasActiveAlbum,
      hasSelectedImages: isLibraryTab && selectedIds.size > 0,
      hasSelectedAlbums: selectedAlbumIds.size > 0,
      hasSingleSelectedImage: activeTab.type === "image" || (isLibraryTab && selectedIds.size === 1),
      hasSingleSelectedAlbum:
        selectedAlbumIds.size === 1 ||
        (activeAlbum !== "all" && activeAlbum !== FAVORITES_ID && selectedAlbumIds.size === 0),
      hasImages: isLibraryTab && filteredImages.length > 0,
      hasAlbums: albums.length > 0,
    });
  }, [
    bridgeAvailable,
    activeTab,
    activeAlbum,
    images,
    filteredImages,
    albums,
    selectedIds,
    selectedAlbumIds,
    albumById,
  ]);

  const activeTabContent = useMemo(() => {
    if (activeTab.type === "library") return null;
    return activeTab.image;
  }, [activeTab]);

  const activeImageId = activeTab.type === "image" ? activeTab.image.id : null;

  useEffect(() => {
    if (activeTab.type !== "image") {
      setIsImageLoading(false);
      return;
    }
    setIsImageLoading(true);
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

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    if (!bridgeAvailable) return;
    const unsubscribeFolder = window.comfy.onIndexingFolder((payload) => {
      setFolderProgress({ current: payload.current, total: payload.total, label: payload.folder });
    });
    const unsubscribeImage = window.comfy.onIndexingImage((payload) => {
      setImageProgress({ current: payload.current, total: payload.total, label: payload.fileName });
    });
    const unsubscribeComplete = window.comfy.onIndexingComplete(() => {
      setFolderProgress(null);
      setImageProgress(null);
    });

    return () => {
      unsubscribeFolder();
      unsubscribeImage();
      unsubscribeComplete();
    };
  }, [bridgeAvailable]);

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
  }, [gridRef, filteredImages.length, iconSize]);

  useEffect(() => {
    if (!lastCopied) return;
    const timeout = window.setTimeout(() => setLastCopied(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [lastCopied]);

  return (
    <div className="flex h-screen flex-col">
      {toastMessage ? (
        <div className="pointer-events-none fixed right-6 top-6 z-50 rounded-lg bg-slate-900/90 px-4 py-2 text-xs text-slate-100 shadow-lg">
          {toastMessage}
        </div>
      ) : null}
      {isIndexing ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70">
          <div className="pointer-events-auto rounded-2xl border border-slate-800 bg-slate-950/90 px-6 py-4 text-sm text-slate-100 shadow-xl">
            <div className="flex items-center gap-3 h-full">
              <div className="h-3 w-3 animate-pulse rounded-full bg-indigo-400" />
              <span>Indexing images… this may take a moment.</span>
            </div>
            <div className="mt-4 space-y-3 text-xs text-slate-300">
              <div>
                <div className="flex items-center justify-between">
                  <span>Folders</span>
                  <span>{folderProgress ? `${folderProgress.current} / ${folderProgress.total}` : "…"}</span>
                </div>
                <progress
                  className="progress-bar"
                  value={folderProgress ? folderProgress.current : 0}
                  max={folderProgress ? folderProgress.total : 1}
                />
                {folderProgress ? (
                  <div className="mt-1 truncate text-[11px] text-slate-400" title={folderProgress.label}>
                    {folderProgress.label}
                  </div>
                ) : null}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span>Images</span>
                  <span>{imageProgress ? `${imageProgress.current} / ${imageProgress.total}` : "…"}</span>
                </div>
                <progress
                  className="progress-bar"
                  value={imageProgress ? imageProgress.current : 0}
                  max={imageProgress ? imageProgress.total : 1}
                />
                {imageProgress ? (
                  <div className="mt-1 truncate text-[11px] text-slate-400" title={imageProgress.label}>
                    {imageProgress.label}
                  </div>
                ) : null}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleCancelIndexing}
                  disabled={cancelingIndex}
                  className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-60"
                >
                  {cancelingIndex ? "Canceling…" : "Cancel"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {removalProgress ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70">
          <div className="pointer-events-auto rounded-2xl border border-slate-800 bg-slate-950/90 px-6 py-4 text-sm text-slate-100 shadow-xl">
            <div className="flex items-center gap-3 h-full">
              <div className="h-3 w-3 animate-pulse rounded-full bg-rose-400" />
              <span>Removing albums…</span>
            </div>
            <div className="mt-4 space-y-3 text-xs text-slate-300">
              <div>
                <div className="flex items-center justify-between">
                  <span>Albums</span>
                  <span>{`${removalProgress.current} / ${removalProgress.total}`}</span>
                </div>
                <progress className="progress-bar" value={removalProgress.current} max={removalProgress.total} />
                <div className="mt-1 truncate text-[11px] text-slate-400" title={removalProgress.label}>
                  {removalProgress.label}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {bridgeError ? (
        <div className="border-b border-amber-500/40 bg-amber-500/10 px-6 py-3 text-sm text-amber-200">
          {bridgeError}
        </div>
      ) : null}
      {aboutOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70">
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/90 px-6 py-5 text-sm text-slate-100 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{appInfo?.name ?? "Comfy Image Browser"}</div>
                <div className="mt-1 text-xs text-slate-400">Version {appInfo?.version ?? "—"}</div>
              </div>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <p>Thanks for using Comfy Image Browser! If you’d like to support development, consider buying me a cup of coffee, over on Ko‑Fi.</p>
              <button
                type="button"
                onClick={() => window.comfy?.openExternal("https://ko-fi.com/captaincodeuk")}
                className="inline-flex items-center gap-2 rounded-md border border-amber-400/70 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 hover:border-amber-300"
              >
                ☕ Ko‑Fi
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-950/50 p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-slate-400">Albums</div>
              <select
                value={albumSort}
                onChange={(event) => setAlbumSort(event.target.value as AlbumSort)}
                className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-300"
                aria-label="Sort albums"
              >
                <option value="name-asc">Name A → Z</option>
                <option value="name-desc">Name Z → A</option>
                <option value="added-desc">Newest</option>
                <option value="added-asc">Oldest</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setActiveAlbum("all")}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                  albumHighlightId === "all" ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-900"
                }`}
              >
                All Images
              </button>
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setActiveAlbum(FAVORITES_ID)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                  albumHighlightId === FAVORITES_ID
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-900"
                }`}
              >
                Favourites
              </button>
            </div>
          </div>
          <div className="mt-3 flex-1 space-y-2 overflow-auto">
            {sortedAlbums.map((album) => (
              <div
                key={album.id}
                onContextMenu={(event) => void handleAlbumContextMenu(event, album)}
                className={`rounded-lg px-3 py-2 text-left text-sm ${
                  albumHighlightId === album.id ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-900"
                }`}
              >
                <label className="flex min-w-0 cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedAlbumIds.has(album.id)}
                    onChange={() => handleToggleAlbumSelection(album.id)}
                    className="mt-1 h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
                    aria-label={`Select ${album.name}`}
                  />
                  {renameState?.type === "album" && renameState.id === album.id ? (
                    <div className="min-w-0 flex-1 text-left">
                      <input
                        ref={renameInputRef}
                        value={renameState.value}
                        onChange={(event) =>
                          setRenameState((prev) =>
                            prev && prev.type === "album" && prev.id === album.id
                              ? { ...prev, value: event.target.value }
                              : prev
                          )
                        }
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitRename();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            renameCancelRef.current = true;
                            cancelRename();
                          }
                        }}
                        onBlur={() => {
                          if (renameCancelRef.current) {
                            renameCancelRef.current = false;
                            return;
                          }
                          void commitRename();
                        }}
                        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                        aria-label="Rename album"
                      />
                      <div className="truncate text-xs text-slate-400" title={album.rootPath}>
                        {album.rootPath}
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setActiveAlbum(album.id)} className="min-w-0 flex-1 text-left">
                      <div className="font-medium">{album.name}</div>
                      <div className="truncate text-xs text-slate-400" title={album.rootPath}>
                        {album.rootPath}
                      </div>
                    </button>
                  )}
                </label>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
            <button
              onClick={handleAddFolder}
              disabled={!bridgeAvailable || isIndexing}
              className="w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
            >
              {isIndexing ? "Indexing…" : "Add Folder"}
            </button>
            <div className="flex items-center justify-between">
              <button
                onClick={handleRemoveSelectedAlbums}
                disabled={selectedAlbumIds.size === 0}
                className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-200 disabled:opacity-40"
              >
                Remove selected
              </button>
              <div className="text-[11px] text-slate-500">{selectedAlbumIds.size} selected</div>
            </div>
            <button
              type="button"
              onClick={() => window.comfy?.openExternal("https://ko-fi.com/captaincodeuk")}
              className="w-full text-left text-[11px] text-slate-500 hover:text-slate-300"
            >
              Support development on Ko‑Fi
            </button>
          </div>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-800 bg-slate-950/40 px-4 py-3">
            <div className="relative flex-1">
              <input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                placeholder="Search by filename, album, or metadata…"
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

          <div className="border-b border-slate-800 bg-slate-950/20">
            <div className="flex items-center gap-3">
              <div
                ref={(node) => {
                  tabRefs.current.library = node;
                }}
                className={`flex h-7 flex-none items-center gap-2 px-4 py-0 text-sm ${
                  activeTab.id === "library"
                    ? "bg-indigo-500 text-white"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                <button
                  onClick={() => setActiveTab(LibraryTab)}
                  className="truncate"
                  aria-current={activeTab.id === "library" ? "page" : undefined}
                >
                  Library
                </button>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => tabScrollRef.current?.scrollBy({ left: -200, behavior: "smooth" })}
                  className="h-7 rounded-md border border-slate-700 px-2 py-0 text-xs text-slate-300"
                  aria-label="Scroll tabs left"
                >
                  ◀
                </button>
                <div ref={tabScrollRef} className="min-w-0 flex-1 h-full overflow-x-auto tab-scroll">
                  <div className="flex items-center gap-2 pl-0">
                    {tabs
                      .filter((tab) => tab.id !== "library")
                      .map((tab) => {
                        const isActive = activeTab.id === tab.id;
                        return (
                          <div
                            key={tab.id}
                            ref={(node) => {
                              tabRefs.current[tab.id] = node;
                            }}
                            className={`flex h-7 flex-none items-center gap-2 rounded-lg px-4 py-0 text-sm ${
                              isActive ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-200"
                            }`}
                          >
                            <button
                              onClick={() => setActiveTab(tab)}
                              onMouseDown={(event) => {
                                if (event.button === 1) {
                                  event.preventDefault();
                                  handleCloseTab(tab.id);
                                }
                              }}
                              className="truncate"
                              aria-current={isActive ? "page" : undefined}
                            >
                              {tab.title}
                            </button>
                            {tab.type === "image" ? (
                              <button
                                onClick={() => handleCloseTab(tab.id)}
                                className="rounded-md px-1 text-xs text-slate-200/80 hover:bg-white/10"
                                aria-label={`Close ${tab.title}`}
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => tabScrollRef.current?.scrollBy({ left: 200, behavior: "smooth" })}
                  className="h-7 rounded-md border border-slate-700 px-2 py-0 text-xs text-slate-300"
                  aria-label="Scroll tabs right"
                >
                  ▶
                </button>
              </div>
              <div className="flex flex-none items-center gap-2 px-2">
                <button
                  onClick={handleDuplicateTab}
                  disabled={activeTab.type !== "image"}
                  className="h-7 rounded-md border border-slate-700 px-3 py-0 text-xs text-slate-300 disabled:opacity-40"
                >
                  Duplicate
                </button>
                <button
                  onClick={handleCloseAllTabs}
                  disabled={tabs.length <= 1}
                  className="h-7 rounded-md border border-slate-700 px-3 py-0 text-xs text-slate-300 disabled:opacity-40"
                >
                  Close all
                </button>
                <button
                  onClick={() => handleCloseOtherTabs(activeTab.id)}
                  disabled={tabs.length <= 2 || activeTab.id === "library"}
                  className="h-7 rounded-md border border-slate-700 px-3 py-0 text-xs text-slate-300 disabled:opacity-40"
                >
                  Close others
                </button>
              </div>
            </div>
          </div>

          {activeTab.type === "library" ? (
            <section className="flex-1 overflow-hidden">
              <div
                ref={gridRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  setGridMetrics((prev) => ({ ...prev, scrollTop: target.scrollTop }));
                }}
                className="h-full overflow-auto p-4 scrollbar-thin"
              >
                {/* eslint-disable-next-line react/forbid-dom-props */}
                <div className="relative" style={{ height: totalRows * rowHeight }}>
                  {visibleImages.map((image, index) => {
                    const absoluteIndex = startIndex + index;
                    const row = Math.floor(absoluteIndex / gridColumnCount);
                    const col = absoluteIndex % gridColumnCount;
                    const top = row * rowHeight;
                    const left = col * (iconSize + GRID_GAP);
                    const isSelected = selectedIds.has(image.id);
                    const thumbUrl = thumbnailMap[image.id] ?? image.fileUrl;
                    const isLoaded = loadedThumbs.has(image.id);

                    const isRenaming = renameState?.type === "image" && renameState.id === image.id;
                    const isFavorite = favoriteIds.has(image.id);

                    if (isRenaming) {
                      return (
                        <div
                          key={image.id}
                          className={`absolute rounded-xl border p-2 text-left transition ${
                            isSelected ? "border-indigo-500 bg-slate-900" : "border-slate-800"
                          } ${absoluteIndex === focusedIndex ? "ring-2 ring-indigo-400" : ""}`}
                          /* eslint-disable-next-line react/forbid-dom-props */
                          style={{ top, left, width: iconSize, height: rowHeight - GRID_GAP }}
                        >
                          <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-950 p-1">
                            {!isLoaded ? (
                              <div className="absolute inset-0 animate-pulse rounded-lg bg-slate-900" />
                            ) : null}
                            <img
                              src={thumbUrl}
                              alt={image.fileName}
                              loading="lazy"
                              className={`h-full w-full object-contain transition-opacity ${
                                isLoaded ? "opacity-100" : "opacity-0"
                              }`}
                              draggable={false}
                              onLoad={() => {
                                setLoadedThumbs((prev) => new Set(prev).add(image.id));
                              }}
                            />
                          </div>
                          <input
                            ref={renameInputRef}
                            value={renameState.value}
                            onChange={(event) =>
                              setRenameState((prev) =>
                                prev && prev.type === "image" && prev.id === image.id
                                  ? { ...prev, value: event.target.value }
                                  : prev
                              )
                            }
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void commitRename();
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                renameCancelRef.current = true;
                                cancelRename();
                              }
                            }}
                            onBlur={() => {
                              if (renameCancelRef.current) {
                                renameCancelRef.current = false;
                                return;
                              }
                              void commitRename();
                            }}
                            className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                            aria-label="Rename image"
                          />
                          <div className="text-[11px] text-slate-500">{formatBytes(image.sizeBytes)}</div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={image.id}
                        type="button"
                        onContextMenu={(event) => void handleImageContextMenu(event, image)}
                        onClick={(event) => {
                          const isMeta = event.metaKey || event.ctrlKey;
                          if (event.shiftKey && filteredImages.length > 0) {
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
                        }}
                        onDoubleClick={() => {
                          void handleOpenImages([image]);
                        }}
                        className={`absolute rounded-xl border p-2 text-left transition ${
                          isSelected ? "border-indigo-500 bg-slate-900" : "border-slate-800 hover:border-slate-600"
                        } ${absoluteIndex === focusedIndex ? "ring-2 ring-indigo-400" : ""}`}
                        /* eslint-disable-next-line react/forbid-dom-props */
                        style={{ top, left, width: iconSize, height: rowHeight - GRID_GAP }}
                      >
                        <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-950 p-1">
                          {!isLoaded ? (
                            <div className="absolute inset-0 animate-pulse rounded-lg bg-slate-900" />
                          ) : null}
                          <img
                            src={thumbUrl}
                            alt={image.fileName}
                            loading="lazy"
                            className={`h-full w-full object-contain transition-opacity ${
                              isLoaded ? "opacity-100" : "opacity-0"
                            }`}
                            draggable={false}
                            onLoad={() => {
                              setLoadedThumbs((prev) => new Set(prev).add(image.id));
                            }}
                          />
                          <span
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleFavoriteImage(image);
                            }}
                            className={`absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs transition ${
                              isFavorite
                                ? "bg-amber-400/90 text-slate-900"
                                : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                            }`}
                            title={isFavorite ? "Remove from favourites" : "Add to favourites"}
                          >
                            ★
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-slate-300">{image.fileName}</div>
                        <div className="text-[11px] text-slate-500">{formatBytes(image.sizeBytes)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : activeTabContent ? (
            <section className="flex flex-1 overflow-hidden">
              <div className="flex flex-1 flex-col overflow-hidden">
                <div
                  ref={(node) => {
                    viewerRef.current = node;
                    viewerFocusRef.current = node;
                  }}
                  tabIndex={0}
                  className="relative flex flex-1 items-center justify-center overflow-auto p-2 outline-none"
                >
                  <img
                    src={activeTabContent.fileUrl}
                    alt={activeTabContent.fileName}
                    decoding="async"
                    loading="eager"
                    className={`viewer-image object-contain ${viewerSizingClass}`}
                    onLoad={(event) => {
                      const target = event.currentTarget;
                      setImageSize({ width: target.naturalWidth, height: target.naturalHeight });
                      setIsImageLoading(false);
                    }}
                    onError={() => setIsImageLoading(false)}
                  />
                  {isImageLoading ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 shadow">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                        Loading image…
                      </div>
                    </div>
                  ) : null}
                  <div className="absolute bottom-4 right-4 flex flex-col items-end gap-3 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-200 shadow-lg">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() => setActiveZoomMode("fit")}
                        className="rounded-md border border-slate-700 px-2 py-1"
                      >
                        Fit
                      </button>
                      <button
                        onClick={() => setActiveZoomMode("actual")}
                        className="rounded-md border border-slate-700 px-2 py-1"
                      >
                        100%
                      </button>
                      <button
                        onClick={() => setActiveZoomMode("width")}
                        className="rounded-md border border-slate-700 px-2 py-1"
                      >
                        Fit width
                      </button>
                      <button
                        onClick={() => setActiveZoomMode("height")}
                        className="rounded-md border border-slate-700 px-2 py-1"
                      >
                        Fit height
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Zoom</span>
                      <input
                        type="range"
                        min={0.5}
                        max={3}
                        step={0.1}
                        value={derivedZoom}
                        onChange={(event) => {
                          setActiveZoomLevel(Number(event.target.value));
                        }}
                        aria-label="Zoom image"
                      />
                      <span className="w-12 text-right">{Math.round(derivedZoom * 100)}%</span>
                    </div>
                  </div>
                </div>
              </div>
              <aside className="w-96 border-l border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-200">
                {renameState?.type === "image" && renameState.id === activeTabContent.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameState.value}
                    onChange={(event) =>
                      setRenameState((prev) =>
                        prev && prev.type === "image" && prev.id === activeTabContent.id
                          ? { ...prev, value: event.target.value }
                          : prev
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitRename();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        renameCancelRef.current = true;
                        cancelRename();
                      }
                    }}
                    onBlur={() => {
                      if (renameCancelRef.current) {
                        renameCancelRef.current = false;
                        return;
                      }
                      void commitRename();
                    }}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-base text-slate-100"
                    aria-label="Rename image"
                  />
                ) : (
                  <div className="text-lg font-semibold">{activeTabContent.fileName}</div>
                )}
                <div className="mt-2 text-xs text-slate-500">{activeTabContent.filePath}</div>
                <div className="mt-3">
                  <button
                    onClick={() => void toggleFavoriteImage(activeTabContent)}
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      favoriteIds.has(activeTabContent.id)
                        ? "border-amber-400/70 bg-amber-500/10 text-amber-200"
                        : "border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {favoriteIds.has(activeTabContent.id) ? "★ Remove from favourites" : "☆ Add to favourites"}
                  </button>
                </div>
                <div className="mt-4 space-y-2">
                  <div>Album: {albumById.get(activeTabContent.albumId)?.name ?? "Unknown"}</div>
                  <div>Size: {formatBytes(activeTabContent.sizeBytes)}</div>
                  {activeTabContent.width && activeTabContent.height ? (
                    <div>
                      Dimensions: {activeTabContent.width} × {activeTabContent.height}
                    </div>
                  ) : null}
                </div>
                <div className="mt-6">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Metadata</div>
                  <div className="mt-2 rounded-lg bg-slate-900 p-3 text-xs text-slate-300">
                    {metadataSummary ? (
                      <div className="grid gap-2">
                        {metadataSummary.promptText ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-3">
                            <div className="break-words text-slate-400">Prompt</div>
                            <div className="break-words text-slate-100">{metadataSummary.promptText}</div>
                            <button
                              onClick={() => copyToClipboard(metadataSummary.promptText ?? "", "Prompt")}
                              className={`rounded-[10px] border px-2.5 py-1.5 text-sm text-slate-200 transition ${
                                lastCopied === "Prompt"
                                  ? "border-indigo-400 bg-indigo-500/20"
                                  : "border-slate-700 bg-slate-950/40 hover:border-slate-500"
                              }`}
                              aria-label="Copy prompt"
                              title="Copy prompt"
                            >
                              ⧉
                            </button>
                          </div>
                        ) : null}
                        {metadataSummary.width && metadataSummary.height ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-3">
                            <div className="break-words text-slate-400">Resolution</div>
                            <div className="break-words text-slate-100">
                              {metadataSummary.width} × {metadataSummary.height}
                            </div>
                            <div className="h-8 w-8" aria-hidden="true" />
                          </div>
                        ) : null}
                        {metadataSummary.batchSize ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-3">
                            <div className="break-words text-slate-400">Batch size</div>
                            <div className="break-words text-slate-100">{metadataSummary.batchSize}</div>
                            <div className="h-8 w-8" aria-hidden="true" />
                          </div>
                        ) : null}
                        {metadataSummary.checkpoint ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-3">
                            <div className="break-words text-slate-400">Checkpoint</div>
                            <div className="break-words text-slate-100">{metadataSummary.checkpoint}</div>
                            <button
                              onClick={() => copyToClipboard(metadataSummary.checkpoint ?? "", "Checkpoint")}
                              className={`rounded-[10px] border px-2.5 py-1.5 text-sm text-slate-200 transition ${
                                lastCopied === "Checkpoint"
                                  ? "border-indigo-400 bg-indigo-500/20"
                                  : "border-slate-700 bg-slate-950/40 hover:border-slate-500"
                              }`}
                              aria-label="Copy checkpoint"
                              title="Copy checkpoint"
                            >
                              ⧉
                            </button>
                          </div>
                        ) : null}
                        {metadataSummary.seed ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-3">
                            <div className="break-words text-slate-400">Seed</div>
                            <div className="break-words text-slate-100">{metadataSummary.seed}</div>
                            <button
                              onClick={() => copyToClipboard(metadataSummary.seed ?? "", "Seed")}
                              className={`rounded-[10px] border px-2.5 py-1.5 text-sm text-slate-200 transition ${
                                lastCopied === "Seed"
                                  ? "border-indigo-400 bg-indigo-500/20"
                                  : "border-slate-700 bg-slate-950/40 hover:border-slate-500"
                              }`}
                              aria-label="Copy seed"
                              title="Copy seed"
                            >
                              ⧉
                            </button>
                          </div>
                        ) : null}
                        {metadataSummary.loras.length ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-3">
                            <div className="break-words text-slate-400">LoRAs</div>
                            <div className="break-words text-slate-100">{metadataSummary.loras.join(", ")}</div>
                            <button
                              onClick={() => copyToClipboard(metadataSummary.loras.join(", "), "LoRAs")}
                              className={`rounded-[10px] border px-2.5 py-1.5 text-sm text-slate-200 transition ${
                                lastCopied === "LoRAs"
                                  ? "border-indigo-400 bg-indigo-500/20"
                                  : "border-slate-700 bg-slate-950/40 hover:border-slate-500"
                              }`}
                              aria-label="Copy LoRAs"
                              title="Copy LoRAs"
                            >
                              ⧉
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-slate-500">No metadata found for this image.</div>
                    )}
                  </div>
                </div>
              </aside>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
