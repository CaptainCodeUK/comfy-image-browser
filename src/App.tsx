import { useEffect, useMemo, useRef, useState } from "react";
import {
  addAlbumWithImages,
  getAlbums,
  getAppPref,
  getImages,
  getImageViewPrefs,
  removeImagesById,
  setAppPref,
  setImageViewPrefs,
} from "./lib/db";
import { attachFileUrls } from "./lib/imageMapper";
import type { Album, IndexedImage, IndexedImagePayload } from "./lib/types";

const DEFAULT_ICON_SIZE = 180;

type Tab =
  | { id: "library"; title: "Library"; type: "library" }
  | { id: string; title: string; type: "image"; image: IndexedImage };

type ZoomMode = "fit" | "actual" | "width" | "height" | "manual";

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
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const bridgeAvailable = typeof window !== "undefined" && !!window.comfy;

  useEffect(() => {
    const load = async () => {
      const [albumRows, imageRows, storedIconSize, storedAlbum] = await Promise.all([
        getAlbums(),
        getImages(),
        getAppPref<number>("iconSize"),
        getAppPref<string>("activeAlbum"),
      ]);
      const imagesWithUrls = await attachFileUrls(imageRows);
      setAlbums(albumRows);
      setImages(imagesWithUrls);
      if (storedIconSize) {
        setIconSize(storedIconSize);
      }
      if (storedAlbum) {
        setActiveAlbum(storedAlbum as string | "all");
      }
    };
    load();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--icon-size", `${iconSize}px`);
  }, [iconSize]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void setAppPref("iconSize", iconSize);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [iconSize]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        if (activeTab.id !== "library") {
          handleCloseTab(activeTab.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void setAppPref("activeAlbum", activeAlbum);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [activeAlbum]);

  const albumById = useMemo(() => {
    return new Map(albums.map((album) => [album.id, album]));
  }, [albums]);

  const filteredImages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return images.filter((image) => {
      if (activeAlbum !== "all" && image.albumId !== activeAlbum) {
        return false;
      }
      if (!query) return true;
      const albumName = albumById.get(image.albumId)?.name ?? "";
      const metaString = JSON.stringify(image.metadataText ?? {}).toLowerCase();
      return (
        image.fileName.toLowerCase().includes(query) ||
        albumName.toLowerCase().includes(query) ||
        metaString.includes(query)
      );
    });
  }, [images, search, albumById, activeAlbum]);

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

  const handleOpenImages = (imagesToOpen: IndexedImage[]) => {
    setTabs((prev) => {
      const existingIds = new Set(prev.map((tab) => tab.id));
      const additions = imagesToOpen
        .filter((image) => !existingIds.has(image.id))
        .map((image) => ({
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
  };

  const handleCloseTab = (tabId: string) => {
    if (tabId === "library") return;
    setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    setActiveTab((current) => {
      if (current.id !== tabId) return current;
      return LibraryTab;
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

  const handleRemoveSelected = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    await removeImagesById(ids);
    setImages((prev) => prev.filter((image) => !selectedIds.has(image.id)));
    setSelectedIds(new Set());
    setTabs((prev) => prev.filter((tab) => tab.type === "library" || !selectedIds.has(tab.id)));
    setActiveTab((current) => (current.type === "image" && selectedIds.has(current.id) ? LibraryTab : current));
  };

  const handleAddFolder = async () => {
    if (!bridgeAvailable) {
      setBridgeError("Electron bridge unavailable. Launch the app via Electron (not the browser) to add folders.");
      return;
    }
    setIsIndexing(true);
    try {
      const folderPaths = await window.comfy.selectFolders();
      if (!folderPaths.length) {
        return;
      }
      const payload = (await window.comfy.indexFolders(folderPaths)) as Array<{
        rootPath: string;
        images: IndexedImagePayload[];
      }>;

      const results = await Promise.all(
        payload.map(async (albumPayload): Promise<{ album: Album; images: IndexedImage[] }> => {
          return addAlbumWithImages(albumPayload.rootPath, albumPayload.images);
        })
      );

      const newAlbums = results.flatMap((result) => result.album);
      const newImages = results.flatMap((result) => result.images);
      const newImagesWithUrls = await attachFileUrls(newImages);

      setAlbums((prev) => [...prev, ...newAlbums]);
      setImages((prev) => [...prev, ...newImagesWithUrls]);
    } finally {
      setIsIndexing(false);
    }
  };

  const activeTabContent = useMemo(() => {
    if (activeTab.type === "library") return null;
    return activeTab.image;
  }, [activeTab]);

  useEffect(() => {
    const loadPrefs = async () => {
      if (activeTab.type !== "image") {
        setZoomMode("fit");
        setZoomLevel(1);
        return;
      }
      const prefs = await getImageViewPrefs(activeTab.id);
      if (!prefs) {
        setZoomMode("fit");
        setZoomLevel(1);
        return;
      }
      setZoomMode(prefs.zoomMode);
      setZoomLevel(prefs.zoomLevel);
    };

    loadPrefs();
  }, [activeTab.id, activeTab.type]);

  useEffect(() => {
    if (activeTab.type !== "image") return;
    const timeout = window.setTimeout(() => {
      void setImageViewPrefs(activeTab.id, zoomMode, zoomLevel);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [activeTab.id, activeTab.type, zoomMode, zoomLevel]);

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
    if (zoomMode === "manual") return zoomLevel;
    if (zoomMode === "actual") return 1;
    if (!imageSize.width || !imageSize.height || !viewerSize.width || !viewerSize.height) {
      return 1;
    }
    const widthScale = viewerSize.width / imageSize.width;
    const heightScale = viewerSize.height / imageSize.height;
    if (zoomMode === "width") return widthScale;
    if (zoomMode === "height") return heightScale;
    return Math.min(widthScale, heightScale);
  }, [zoomMode, zoomLevel, imageSize, viewerSize]);

  useEffect(() => {
    const value = zoomMode === "manual" ? zoomLevel : 1;
    document.documentElement.style.setProperty("--viewer-zoom", `${value}`);
  }, [zoomMode, zoomLevel]);

  const selectedImages = images.filter((image) => selectedIds.has(image.id));
  const metadataSummary = activeTab.type === "image" ? extractMetadataSummary(activeTab.image.metadataText) : null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Comfy Browser</h1>
          <p className="text-sm text-slate-400">Browse and catalog ComfyUI generations.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAddFolder}
            disabled={!bridgeAvailable || isIndexing}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
          >
            {isIndexing ? "Indexing…" : "Add Folder"}
          </button>
          <button
            onClick={() => handleOpenImages(selectedImages)}
            disabled={selectedImages.length === 0}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-100 disabled:opacity-50"
          >
            Open Selected
          </button>
          <button
            onClick={handleRemoveSelected}
            disabled={selectedIds.size === 0}
            className="rounded-lg border border-rose-400/40 px-4 py-2 text-sm text-rose-200 disabled:opacity-50"
          >
            Remove from Index
          </button>
        </div>
      </header>

      {bridgeError ? (
        <div className="border-b border-amber-500/40 bg-amber-500/10 px-6 py-3 text-sm text-amber-200">
          {bridgeError}
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r border-slate-800 bg-slate-950/50 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Albums</div>
          <button
            onClick={() => setActiveAlbum("all")}
            className={`mt-3 w-full rounded-lg px-3 py-2 text-left text-sm ${
              activeAlbum === "all" ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-900"
            }`}
          >
            All Images
          </button>
          <div className="mt-2 space-y-2">
            {albums.map((album) => (
              <button
                key={album.id}
                onClick={() => setActiveAlbum(album.id)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                  activeAlbum === album.id ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-900"
                }`}
              >
                <div className="font-medium">{album.name}</div>
                <div className="text-xs text-slate-400">{album.rootPath}</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-4 border-b border-slate-800 bg-slate-950/40 px-4 py-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by filename, album, or metadata…"
              aria-label="Search images"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
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
          </div>

          <div className="border-b border-slate-800 bg-slate-950/20 px-4 py-2">
            <div className="flex items-center gap-2 overflow-x-auto">
              {tabs.map((tab) => {
                const isActive = activeTab.id === tab.id;
                return (
                  <div
                    key={tab.id}
                    className={`flex items-center gap-2 rounded-full px-4 py-1 text-sm ${
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
                        className="rounded-full px-1 text-xs text-slate-200/80 hover:bg-white/10"
                        aria-label={`Close ${tab.title}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                );
              })}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={handleCloseAllTabs}
                  disabled={tabs.length <= 1}
                  className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 disabled:opacity-40"
                >
                  Close all
                </button>
                <button
                  onClick={() => handleCloseOtherTabs(activeTab.id)}
                  disabled={tabs.length <= 2 || activeTab.id === "library"}
                  className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 disabled:opacity-40"
                >
                  Close others
                </button>
              </div>
            </div>
          </div>

          {activeTab.type === "library" ? (
            <section className="flex-1 overflow-auto p-4 scrollbar-thin">
              <div className="icon-grid grid gap-4">
                {filteredImages.map((image) => {
                  const isSelected = selectedIds.has(image.id);
                  return (
                    <button
                      key={image.id}
                      type="button"
                      onClick={(event) => toggleSelection(image.id, event.metaKey || event.ctrlKey)}
                      onDoubleClick={() => handleOpenImages([image])}
                      className={`rounded-xl border p-2 text-left transition ${
                        isSelected ? "border-indigo-500 bg-slate-900" : "border-slate-800 hover:border-slate-600"
                      }`}
                    >
                      <div className="aspect-square overflow-hidden rounded-lg bg-slate-950 p-1">
                        <img
                          src={image.fileUrl}
                          alt={image.fileName}
                          className="h-full w-full object-contain"
                          draggable={false}
                        />
                      </div>
                      <div className="mt-2 text-xs text-slate-300">{image.fileName}</div>
                      <div className="text-[11px] text-slate-500">{formatBytes(image.sizeBytes)}</div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : activeTabContent ? (
            <section className="flex flex-1 overflow-hidden">
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/40 px-4 py-2 text-xs text-slate-300">
                  <div className="font-semibold">Viewer</div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setZoomMode("fit")}
                      className="rounded-full border border-slate-700 px-3 py-1"
                    >
                      Fit
                    </button>
                    <button
                      onClick={() => setZoomMode("actual")}
                      className="rounded-full border border-slate-700 px-3 py-1"
                    >
                      100%
                    </button>
                    <button
                      onClick={() => setZoomMode("width")}
                      className="rounded-full border border-slate-700 px-3 py-1"
                    >
                      Fit width
                    </button>
                    <button
                      onClick={() => setZoomMode("height")}
                      className="rounded-full border border-slate-700 px-3 py-1"
                    >
                      Fit height
                    </button>
                    <div className="flex items-center gap-2">
                      <span>Zoom</span>
                      <input
                        type="range"
                        min={0.5}
                        max={3}
                        step={0.1}
                        value={derivedZoom}
                        onChange={(event) => {
                          setZoomMode("manual");
                          setZoomLevel(Number(event.target.value));
                        }}
                        aria-label="Zoom image"
                      />
                      <span className="w-12 text-right">{Math.round(derivedZoom * 100)}%</span>
                    </div>
                  </div>
                </div>
                <div ref={viewerRef} className="flex flex-1 items-center justify-center overflow-auto p-2">
                  <img
                    src={activeTabContent.fileUrl}
                    alt={activeTabContent.fileName}
                    className={`viewer-image object-contain ${
                      zoomMode === "fit"
                        ? "max-h-full max-w-full"
                        : zoomMode === "width"
                        ? "w-full h-auto"
                        : zoomMode === "height"
                        ? "h-full w-auto"
                        : "h-auto w-auto"
                    }`}
                    onLoad={(event) => {
                      const target = event.currentTarget;
                      setImageSize({ width: target.naturalWidth, height: target.naturalHeight });
                    }}
                  />
                </div>
              </div>
              <aside className="w-96 border-l border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-200">
                <div className="text-lg font-semibold">{activeTabContent.fileName}</div>
                <div className="mt-2 text-xs text-slate-500">{activeTabContent.filePath}</div>
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
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                            <div className="break-words text-slate-400">Prompt</div>
                            <div className="break-words text-slate-100">{metadataSummary.promptText}</div>
                          </div>
                        ) : null}
                        {metadataSummary.width && metadataSummary.height ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                            <div className="break-words text-slate-400">Resolution</div>
                            <div className="break-words text-slate-100">
                              {metadataSummary.width} × {metadataSummary.height}
                            </div>
                          </div>
                        ) : null}
                        {metadataSummary.batchSize ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                            <div className="break-words text-slate-400">Batch size</div>
                            <div className="break-words text-slate-100">{metadataSummary.batchSize}</div>
                          </div>
                        ) : null}
                        {metadataSummary.checkpoint ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                            <div className="break-words text-slate-400">Checkpoint</div>
                            <div className="break-words text-slate-100">{metadataSummary.checkpoint}</div>
                          </div>
                        ) : null}
                        {metadataSummary.seed ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                            <div className="break-words text-slate-400">Seed</div>
                            <div className="break-words text-slate-100">{metadataSummary.seed}</div>
                          </div>
                        ) : null}
                        {metadataSummary.loras.length ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                            <div className="break-words text-slate-400">LoRAs</div>
                            <div className="break-words text-slate-100">{metadataSummary.loras.join(", ")}</div>
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
