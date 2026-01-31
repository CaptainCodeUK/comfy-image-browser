import type { Dispatch, MutableRefObject, MouseEvent, RefObject, SetStateAction } from "react";
import type { IndexedImage } from "../lib/types";
import type { RenameState } from "../lib/appTypes";
import { formatBytes } from "../lib/formatBytes";
import { toComfyUrl } from "../lib/fileUrl";
import { ImageCard } from "./ImageCard";

type ImageGridProps = {
  innerRef: RefObject<HTMLDivElement>;
  gridGap: number;
  iconSize: number;
  rowHeight: number;
  gridColumnCount: number;
  startIndex: number;
  visibleImages: IndexedImage[];
  selectedIds: Set<string>;
  favoriteIds: Set<string>;
  thumbnailMap: Record<string, string>;
  loadedThumbs: Set<string>;
  renameState: RenameState;
  renameInputRef: RefObject<HTMLInputElement>;
  renameCancelRef: MutableRefObject<boolean>;
  setRenameState: Dispatch<SetStateAction<RenameState>>;
  commitRename: () => Promise<void>;
  cancelRename: () => void;
  handleImageContextMenu: (event: MouseEvent<HTMLButtonElement>, image: IndexedImage) => void;
  onImageClick: (image: IndexedImage, absoluteIndex: number, event: MouseEvent<HTMLButtonElement>) => void;
  onImageDoubleClick: (image: IndexedImage) => void;
  onFavoriteToggle: (image: IndexedImage) => Promise<void>;
  markThumbLoaded: (id: string) => void;
  focusedIndex: number | null;
};

const assignVirtualPosition = (
  node: HTMLElement | null,
  top: number,
  left: number,
  width: number,
  height: number
) => {
  if (!node) return;
  node.style.top = `${top}px`;
  node.style.left = `${left}px`;
  node.style.width = `${width}px`;
  node.style.height = `${height}px`;
};

export function ImageGrid({
  innerRef,
  gridGap,
  iconSize,
  rowHeight,
  gridColumnCount,
  startIndex,
  visibleImages,
  selectedIds,
  favoriteIds,
  thumbnailMap,
  loadedThumbs,
  renameState,
  renameInputRef,
  renameCancelRef,
  setRenameState,
  commitRename,
  cancelRename,
  handleImageContextMenu,
  onImageClick,
  onImageDoubleClick,
  onFavoriteToggle,
  markThumbLoaded,
  focusedIndex,
}: ImageGridProps) {
  const cardHeight = rowHeight - gridGap;

  const renderThumbUrl = (image: IndexedImage) => {
    const cached = thumbnailMap[image.id];
    if (cached) return cached;
    return image.fileUrl === image.filePath ? toComfyUrl(image.filePath) : image.fileUrl;
  };

  const handleRenameChange = (imageId: string, value: string) => {
    setRenameState((prev) =>
      prev && prev.type === "image" && prev.id === imageId ? { ...prev, value } : prev
    );
  };

  return (
    <div className="relative" ref={innerRef}>
      {visibleImages.map((image, index) => {
        const absoluteIndex = startIndex + index;
        const row = Math.floor(absoluteIndex / gridColumnCount);
        const col = absoluteIndex % gridColumnCount;
        const top = row * rowHeight;
        const left = col * (iconSize + gridGap);
        const height = cardHeight;
        const isSelected = selectedIds.has(image.id);
        const thumbUrl = renderThumbUrl(image);
        const isLoaded = loadedThumbs.has(image.id);
        const isRenaming = renameState?.type === "image" && renameState.id === image.id;
        const isFavorite = favoriteIds.has(image.id);

        if (isRenaming) {
          return (
            <div
              key={image.id}
              ref={(node) => assignVirtualPosition(node, top, left, iconSize, height)}
              className={`absolute rounded-xl border p-2 text-left ${
                isSelected ? "border-indigo-500 bg-slate-900" : "border-slate-800"
              } ${absoluteIndex === focusedIndex ? "ring-2 ring-indigo-400" : ""}`}
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
                    markThumbLoaded(image.id);
                  }}
                />
              </div>
              <input
                ref={renameInputRef}
                value={renameState?.value ?? ""}
                onChange={(event) => handleRenameChange(image.id, event.target.value)}
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
                  cancelRename();
                }}
                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                aria-label="Rename image"
              />
              <div className="text-[11px] text-slate-500">{formatBytes(image.sizeBytes)}</div>
            </div>
          );
        }

        return (
          <ImageCard
            key={image.id}
            image={image}
            thumbUrl={thumbUrl}
            setPosition={(node) => assignVirtualPosition(node, top, left, iconSize, height)}
            isSelected={isSelected}
            isFocused={absoluteIndex === focusedIndex}
            isLoaded={isLoaded}
            isFavorite={isFavorite}
            sizeLabel={formatBytes(image.sizeBytes)}
            markThumbLoaded={markThumbLoaded}
            onContextMenu={(event) => handleImageContextMenu(event, image)}
            onClick={(event) => onImageClick(image, absoluteIndex, event)}
            onDoubleClick={() => onImageDoubleClick(image)}
            onFavoriteToggle={() => onFavoriteToggle(image)}
          />
        );
      })}
    </div>
  );
}
