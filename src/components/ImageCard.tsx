import type { MouseEvent } from "react";
import type { IndexedImage } from "../lib/types";

export type ImageCardProps = {
  image: IndexedImage;
  thumbUrl: string;
  setPosition: (node: HTMLButtonElement | null) => void;
  isSelected: boolean;
  isFocused: boolean;
  isLoaded: boolean;
  isFavorite: boolean;
  sizeLabel: string;
  markThumbLoaded: (id: string) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick: () => void;
  onFavoriteToggle: () => void | Promise<void>;
};

export function ImageCard({
  image,
  thumbUrl,
  setPosition,
  isSelected,
  isFocused,
  isLoaded,
  isFavorite,
  sizeLabel,
  markThumbLoaded,
  onContextMenu,
  onClick,
  onDoubleClick,
  onFavoriteToggle,
}: ImageCardProps) {
  return (
    <button
      type="button"
      ref={setPosition}
      onContextMenu={onContextMenu}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`absolute rounded-xl border p-2 text-left ${
        isSelected ? "border-indigo-500 bg-slate-900" : "border-slate-800 hover:border-slate-600"
      } ${isFocused ? "ring-2 ring-indigo-400" : ""}`}
    >
      <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-950 p-1">
        {!isLoaded ? (
          <div className="absolute inset-0 animate-pulse rounded-lg bg-slate-900" />
        ) : null}
        <img
          src={thumbUrl}
          alt={image.fileName}
          loading="lazy"
          className={`h-full w-full object-contain transition-opacity ${isLoaded ? "opacity-100" : "opacity-0"}`}
          draggable={false}
          onLoad={() => {
            markThumbLoaded(image.id);
          }}
        />
        <span
          onClick={(event) => {
            event.stopPropagation();
            void onFavoriteToggle();
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
      <div className="text-[11px] text-slate-500">{sizeLabel}</div>
    </button>
  );
}
