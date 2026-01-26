import { useEffect, useMemo, useState } from "react";
import { addAlbumWithImages, getAlbums, getImages, removeImagesById } from "./lib/db";
import { attachFileUrls } from "./lib/imageMapper";
import type { Album, IndexedImage, IndexedImagePayload } from "./lib/types";

const DEFAULT_ICON_SIZE = 180;

type Tab =
  | { id: "library"; title: "Library"; type: "library" }
  | { id: string; title: string; type: "image"; image: IndexedImage };

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

  const bridgeAvailable = typeof window !== "undefined" && !!window.comfy;

  useEffect(() => {
    const load = async () => {
      const [albumRows, imageRows] = await Promise.all([getAlbums(), getImages()]);
      const imagesWithUrls = await attachFileUrls(imageRows);
      setAlbums(albumRows);
      setImages(imagesWithUrls);
    };
    load();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--icon-size", `${iconSize}px`);
  }, [iconSize]);

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

  const selectedImages = images.filter((image) => selectedIds.has(image.id));

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
            <div className="flex gap-2 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full px-4 py-1 text-sm ${
                    activeTab.id === tab.id ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-200"
                  }`}
                >
                  {tab.title}
                </button>
              ))}
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
                      <div className="aspect-square overflow-hidden rounded-lg bg-slate-950">
                        <img
                          src={image.fileUrl}
                          alt={image.fileName}
                          className="h-full w-full object-cover"
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
              <div className="flex-1 overflow-auto p-6">
                <img src={activeTabContent.fileUrl} alt={activeTabContent.fileName} className="max-h-full" />
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
                  <pre className="mt-2 max-h-[60vh] overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-300">
                    {JSON.stringify(activeTabContent.metadataText, null, 2)}
                  </pre>
                </div>
              </aside>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
