import type { Dispatch, MutableRefObject, RefObject, SetStateAction, SyntheticEvent } from "react";
import type { Collection, IndexedImage } from "../lib/types";
import { formatBytes } from "../lib/formatBytes";
import type { MetadataSummary, RenameState, ZoomMode } from "../lib/appTypes";

interface ImageViewerProps {
  image: IndexedImage;
  imageUrl: string;
  viewerRef: MutableRefObject<HTMLDivElement | null>;
  viewerFocusRef: MutableRefObject<HTMLDivElement | null>;
  activeImageRef: MutableRefObject<HTMLImageElement | null>;
  onImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  onImageError: () => void;
  isImageLoading: boolean;
  viewerSizingClass: string;
  derivedZoom: number;
  setActiveZoomMode: (mode: ZoomMode) => void;
  setActiveZoomLevel: (level: number) => void;
  toggleFavoriteImage: (image: IndexedImage) => Promise<void>;
  favoriteIds: Set<string>;
  renameState: RenameState;
  renameInputRef: RefObject<HTMLInputElement>;
  renameCancelRef: MutableRefObject<boolean>;
  setRenameState: Dispatch<SetStateAction<RenameState>>;
  commitRename: () => Promise<void>;
  cancelRename: () => void;
  collectionById: Map<string, Collection>;
  metadataSummary: MetadataSummary | null;
  copyToClipboard: (value: string, label: string) => Promise<void>;
  lastCopied: string | null;
}

export function ImageViewer({
  image,
  imageUrl,
  viewerRef,
  viewerFocusRef,
  activeImageRef,
  onImageLoad,
  onImageError,
  isImageLoading,
  viewerSizingClass,
  derivedZoom,
  setActiveZoomMode,
  setActiveZoomLevel,
  toggleFavoriteImage,
  favoriteIds,
  renameState,
  renameInputRef,
  renameCancelRef,
  setRenameState,
  commitRename,
  cancelRename,
  collectionById,
  metadataSummary,
  copyToClipboard,
  lastCopied,
}: ImageViewerProps) {
  return (
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
            ref={activeImageRef}
            src={imageUrl}
            alt={image.fileName}
            decoding="async"
            loading="eager"
            className={`viewer-image object-contain ${viewerSizingClass}`}
            onLoad={onImageLoad}
            onError={onImageError}
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
              <button onClick={() => setActiveZoomMode("fit")} className="rounded-md border border-slate-700 px-2 py-1">
                Fit
              </button>
              <button onClick={() => setActiveZoomMode("actual")} className="rounded-md border border-slate-700 px-2 py-1">
                100%
              </button>
              <button onClick={() => setActiveZoomMode("width")} className="rounded-md border border-slate-700 px-2 py-1">
                Fit width
              </button>
              <button onClick={() => setActiveZoomMode("height")} className="rounded-md border border-slate-700 px-2 py-1">
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
                onChange={(event) => setActiveZoomLevel(Number(event.target.value))}
                aria-label="Zoom image"
              />
              <span className="w-12 text-right">{Math.round(derivedZoom * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
      <aside className="w-96 border-l border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-200">
        {renameState?.type === "image" && renameState.id === image.id ? (
          <input
            ref={renameInputRef}
            value={renameState.value}
            onChange={(event) =>
              setRenameState((prev) =>
                prev && prev.type === "image" && prev.id === image.id ? { ...prev, value: event.target.value } : prev
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
          <div className="text-lg font-semibold">{image.fileName}</div>
        )}
        <div className="mt-2 text-xs text-slate-500">{image.filePath}</div>
        <div className="mt-3">
          <button
            onClick={() => void toggleFavoriteImage(image)}
            className={`rounded-md border px-2 py-1 text-xs transition ${favoriteIds.has(image.id)
              ? "border-amber-400/70 bg-amber-500/10 text-amber-200"
              : "border-slate-700 text-slate-300 hover:border-slate-500"
              }`}
          >
            {favoriteIds.has(image.id) ? "★ Remove from favourites" : "☆ Add to favourites"}
          </button>
        </div>
        <div className="mt-4 space-y-2">
          <div>Collection: {collectionById.get(image.collectionId)?.name ?? "Unknown"}</div>
          <div>Size: {formatBytes(image.sizeBytes)}</div>
          {image.width && image.height ? (
            <div>
              Dimensions: {image.width} × {image.height}
            </div>
          ) : null}
        </div>
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">Metadata</div>
            <button
              onClick={() => copyToClipboard(JSON.stringify(image?.metadataText ?? {}, null, 2), "Decoded metadata")}
              className={`rounded-[10px] border px-2.5 py-1.5 text-sm text-slate-200 transition ${lastCopied === "Decoded metadata"
                ? "border-indigo-400 bg-indigo-500/20"
                : "border-slate-700 bg-slate-950/40 hover:border-slate-500"
                }`}
              aria-label="Copy decoded metadata"
              title="Copy decoded metadata"
            >
              ⧉ Copy
            </button>
          </div>
          <div className="mt-2 rounded-lg bg-slate-900 p-3 text-xs text-slate-300">
            {metadataSummary ? (
              <div className="grid gap-2">
                {metadataSummary.promptText ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-3">
                    <div className="break-words text-slate-400">Prompt</div>
                    <div className="break-words text-slate-100">{metadataSummary.promptText}</div>
                    <button
                      onClick={() => copyToClipboard(metadataSummary.promptText ?? "", "Prompt")}
                      className={`rounded-[10px] border px-2.5 py-1.5 text-sm text-slate-200 transition ${lastCopied === "Prompt"
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
                      className={`rounded-[10px] border px-2.5 py-1.5 text-sm text-slate-200 transition ${lastCopied === "Checkpoint"
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
                      className={`rounded-[10px] border px-2.5 py-1.5 text-sm text-slate-200 transition ${lastCopied === "Seed"
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
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide text-slate-400">LoRAs</div>
                    <ul className="space-y-2 text-slate-100">
                      {metadataSummary.loras.map((lora) => {
                        const label = lora.strength !== undefined ? `${lora.name} (${lora.strength})` : lora.name;
                        const copyLabel = `LoRA: ${lora.name}`;
                        return (
                          <li key={lora.name} className="flex items-start gap-3">
                            <span className="min-w-0 flex-1 break-words">• {label}</span>
                            <button
                              onClick={() => copyToClipboard(label, copyLabel)}
                              className={`shrink-0 rounded-[10px] border px-2 py-1 text-xs text-slate-200 transition ${lastCopied === copyLabel
                                ? "border-indigo-400 bg-indigo-500/20"
                                : "border-slate-700 bg-slate-950/40 hover:border-slate-500"
                                }`}
                              aria-label={`Copy LoRA ${lora.name}`}
                              title={`Copy ${lora.name}`}
                            >
                              ⧉
                            </button>
                          </li>
                        );
                      })}
                    </ul>
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
  );
}
