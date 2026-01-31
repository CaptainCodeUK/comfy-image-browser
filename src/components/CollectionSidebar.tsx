import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import type { Collection } from "../lib/types";
import type { CollectionSort, ProgressState, RenameState } from "../lib/appTypes";
import { CollectionActions } from "./CollectionActions";

interface CollectionSidebarProps {
  bridgeAvailable: boolean;
  collectionSort: CollectionSort;
  onCollectionSortChange: (sort: CollectionSort) => void;
  sortedCollections: Collection[];
  collectionIds: string[];
  collectionHighlightId: string | "all";
  favoritesId: string;
  selectedCollectionIds: Set<string>;
  collectionFocusedId: string | null;
  collectionSelectionAnchor: number | null;
  setCollectionFocusedId: React.Dispatch<React.SetStateAction<string | null>>;
  setCollectionSelectionAnchor: React.Dispatch<React.SetStateAction<number | null>>;
  setSelectedCollectionIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActiveCollection: React.Dispatch<React.SetStateAction<string | "all">>;
  renameState: RenameState;
  renameInputRef: React.RefObject<HTMLInputElement>;
  renameCancelRef: React.MutableRefObject<boolean>;
  setRenameState: React.Dispatch<React.SetStateAction<RenameState>>;
  commitRename: () => Promise<void>;
  cancelRename: () => void;
  handleCollectionContextMenu: (event: MouseEvent<HTMLButtonElement>, collection: Collection) => Promise<void>;
  handleAddFolder: () => Promise<void>;
  isIndexing: boolean;
  folderProgress: ProgressState;
  imageProgress: ProgressState;
  handleCancelIndexing: () => Promise<void>;
  removalCollectionProgress: ProgressState;
  removalImageProgress: ProgressState;
  handleRemoveSelectedCollections: () => Promise<void>;
  removalCanceling: boolean;
  handleCancelRemoval: () => void;
  cancelingIndex: boolean;
}

const COLLECTION_NAV_KEYS = ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];

export function CollectionSidebar({
  bridgeAvailable,
  collectionSort,
  onCollectionSortChange,
  sortedCollections,
  collectionIds,
  collectionHighlightId,
  favoritesId,
  selectedCollectionIds,
  collectionFocusedId,
  collectionSelectionAnchor,
  setCollectionFocusedId,
  setCollectionSelectionAnchor,
  setSelectedCollectionIds,
  setActiveCollection,
  renameState,
  renameInputRef,
  renameCancelRef,
  setRenameState,
  commitRename,
  cancelRename,
  handleCollectionContextMenu,
  handleAddFolder,
  isIndexing,
  folderProgress,
  imageProgress,
  handleCancelIndexing,
  removalCollectionProgress,
  removalImageProgress,
  handleRemoveSelectedCollections,
  removalCanceling,
  handleCancelRemoval,
  cancelingIndex,
}: CollectionSidebarProps) {
  const collectionListRef = useRef<HTMLDivElement | null>(null);
  const collectionRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const getCollectionRangeIds = useCallback(
    (start: number, end: number) => {
      if (collectionIds.length === 0) return new Set<string>();
      const [from, to] = start < end ? [start, end] : [end, start];
      const clampedFrom = Math.max(0, Math.min(collectionIds.length - 1, from));
      const clampedTo = Math.max(0, Math.min(collectionIds.length - 1, to));
      const ids = collectionIds.slice(clampedFrom, clampedTo + 1);
      return new Set(ids);
    },
    [collectionIds]
  );

  const handleCollectionSelection = useCallback(
    (collectionId: string, index: number, shift: boolean, multiKey: boolean) => {
      setCollectionFocusedId(collectionId);
      if (shift) {
        const anchor = collectionSelectionAnchor ?? index;
        const rangeIds = getCollectionRangeIds(anchor, index);
        setSelectedCollectionIds((prev) => {
          if (multiKey) {
            return new Set([...prev, ...rangeIds]);
          }
          return rangeIds;
        });
        setCollectionSelectionAnchor(anchor);
        return;
      }
      if (multiKey) {
        setSelectedCollectionIds((prev) => {
          const next = new Set(prev);
          if (next.has(collectionId)) {
            next.delete(collectionId);
          } else {
            next.add(collectionId);
          }
          return next;
        });
        setCollectionSelectionAnchor(index);
        return;
      }
      setSelectedCollectionIds(new Set([collectionId]));
      setCollectionSelectionAnchor(index);
    },
    [collectionSelectionAnchor, getCollectionRangeIds, setCollectionFocusedId, setCollectionSelectionAnchor, setSelectedCollectionIds]
  );

  const handleCollectionRowClick = useCallback(
    (collection: Collection, index: number, event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const shift = event.shiftKey;
      const multi = event.ctrlKey || event.metaKey;
      handleCollectionSelection(collection.id, index, shift, multi);
      setActiveCollection(collection.id);
    },
    [handleCollectionSelection, setActiveCollection]
  );

  const handleCollectionRowKeyDown = useCallback(
    (collection: Collection, index: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      const shift = event.shiftKey;
      const multi = event.ctrlKey || event.metaKey;
      handleCollectionSelection(collection.id, index, shift, multi);
      setActiveCollection(collection.id);
    },
    [handleCollectionSelection, setActiveCollection]
  );

  const handleCollectionContextSelection = useCallback(
    (collection: Collection, index: number) => {
      setCollectionFocusedId(collection.id);
      setCollectionSelectionAnchor(index);
      setActiveCollection(collection.id);
      if (!selectedCollectionIds.has(collection.id)) {
        setSelectedCollectionIds(new Set([collection.id]));
      }
    },
    [selectedCollectionIds, setActiveCollection, setCollectionFocusedId, setCollectionSelectionAnchor, setSelectedCollectionIds]
  );

  const handleCollectionListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const navigationKeys = COLLECTION_NAV_KEYS;
      if (!navigationKeys.includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (collectionIds.length === 0) return;

      event.preventDefault();
      let currentIndex = collectionFocusedId ? collectionIds.indexOf(collectionFocusedId) : 0;
      if (currentIndex === -1) {
        currentIndex = 0;
      }
      let nextIndex = currentIndex;
      if (event.key === "ArrowUp") {
        nextIndex = Math.max(0, currentIndex - 1);
      }
      if (event.key === "ArrowDown") {
        nextIndex = Math.min(collectionIds.length - 1, currentIndex + 1);
      }
      if (event.key === "Home") {
        nextIndex = 0;
      }
      if (event.key === "End") {
        nextIndex = collectionIds.length - 1;
      }
      if (event.key === "PageUp" || event.key === "PageDown") {
        const listHeight = collectionListRef.current?.clientHeight ?? 1;
        const safeIndex = Math.min(Math.max(0, currentIndex), collectionIds.length - 1);
        const focusedRef = collectionRowRefs.current[collectionIds[safeIndex]];
        const rowHeight = focusedRef?.clientHeight ?? 44;
        const pageRows = Math.max(1, Math.floor(listHeight / rowHeight));
        if (event.key === "PageUp") {
          nextIndex = Math.max(0, currentIndex - pageRows);
        } else {
          nextIndex = Math.min(collectionIds.length - 1, currentIndex + pageRows);
        }
      }
      const isCtrlHomeEnd = (event.key === "Home" || event.key === "End") && (event.ctrlKey || event.metaKey);
      const nextId = collectionIds[nextIndex];
      if (!nextId) return;
      setCollectionFocusedId(nextId);
      const shift = event.shiftKey;
      const multi = event.ctrlKey || event.metaKey;
      if (shift) {
        const anchor = collectionSelectionAnchor ?? currentIndex;
        const rangeIds = getCollectionRangeIds(anchor, nextIndex);
        setSelectedCollectionIds((prev) => {
          if (multi) {
            return new Set([...prev, ...rangeIds]);
          }
          return rangeIds;
        });
        setCollectionSelectionAnchor(anchor);
        setActiveCollection(nextId);
        return;
      }

      if (isCtrlHomeEnd) {
        setSelectedCollectionIds(new Set([nextId]));
        setCollectionSelectionAnchor(nextIndex);
        setActiveCollection(nextId);
        return;
      }

      if (multi) {
        setSelectedCollectionIds((prev) => {
          const next = new Set(prev);
          if (next.has(nextId)) {
            next.delete(nextId);
          } else {
            next.add(nextId);
          }
          return next;
        });
        setCollectionSelectionAnchor(nextIndex);
        setActiveCollection(nextId);
        return;
      }

      setSelectedCollectionIds(new Set([nextId]));
      setCollectionSelectionAnchor(nextIndex);
      setActiveCollection(nextId);
    },
    [collectionFocusedId, collectionIds, collectionSelectionAnchor, getCollectionRangeIds, setActiveCollection, setCollectionFocusedId, setCollectionSelectionAnchor, setSelectedCollectionIds]
  );

  useEffect(() => {
    if (collectionFocusedId && !collectionIds.includes(collectionFocusedId)) {
      setCollectionFocusedId(collectionIds[0] ?? null);
      setCollectionSelectionAnchor(null);
      return;
    }
    if (!collectionFocusedId && collectionIds.length > 0) {
      setCollectionFocusedId(collectionIds[0]);
    }
  }, [collectionFocusedId, collectionIds, setCollectionFocusedId, setCollectionSelectionAnchor]);

  useEffect(() => {
    if (!collectionFocusedId) return;
    const node = collectionRowRefs.current[collectionFocusedId];
    if (node && document.activeElement !== node) {
      node.focus();
    }
  }, [collectionFocusedId]);

  const selectionCount = selectedCollectionIds.size;

  return (
    <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-950/50 p-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-slate-400">Collections</div>
          <select
            value={collectionSort}
            onChange={(event) => onCollectionSortChange(event.target.value as CollectionSort)}
            className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-300"
            aria-label="Sort collections"
          >
            <option value="name-asc">Name A → Z</option>
            <option value="name-desc">Name Z → A</option>
            <option value="added-desc">Newest</option>
            <option value="added-asc">Oldest</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setActiveCollection("all")}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm ${collectionHighlightId === "all"
                ? "bg-slate-800 text-white"
                : "text-slate-300 hover:bg-slate-900"
              }`}
          >
            All Images
          </button>
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setActiveCollection(favoritesId)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm ${collectionHighlightId === favoritesId
                ? "bg-slate-800 text-white"
                : "text-slate-300 hover:bg-slate-900"
              }`}
          >
            Favourites
          </button>
        </div>
      </div>
      <div
        ref={collectionListRef}
        onKeyDown={handleCollectionListKeyDown}
        className="mt-3 flex-1 space-y-2 overflow-auto"
      >
        {sortedCollections.map((collection, index) => {
          const isSelected = selectedCollectionIds.has(collection.id);
          const isFocused = collectionFocusedId === collection.id;
          const isActive = collectionHighlightId === collection.id;
          return (
            <div key={collection.id}>
              <button
                ref={(node) => {
                  collectionRowRefs.current[collection.id] = node;
                }}
                type="button"
                onContextMenu={(event) => {
                  event.preventDefault();
                  handleCollectionContextSelection(collection, index);
                  void handleCollectionContextMenu(event, collection);
                }}
                onClick={(event) => handleCollectionRowClick(collection, index, event)}
                onKeyDown={(event) => handleCollectionRowKeyDown(collection, index, event)}
                onFocus={() => setCollectionFocusedId(collection.id)}
                aria-pressed={isSelected}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-900"
                  } ${isSelected ? "bg-slate-900/70 border border-slate-700" : "border border-transparent"} ${isFocused ? "ring-1 ring-indigo-400 ring-inset" : ""
                  }`}
              >
                {renameState?.type === "collection" && renameState.id === collection.id ? (
                  <div className="min-w-0 text-left">
                    <input
                      ref={renameInputRef}
                      value={renameState.value}
                      onChange={(event) =>
                        setRenameState((prev) =>
                          prev && prev.type === "collection" && prev.id === collection.id
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
                        cancelRename();
                      }}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                      aria-label="Rename collection"
                    />
                    <div className="truncate text-xs text-slate-400" title={collection.rootPath}>
                      {collection.rootPath}
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 text-left">
                    <div className="font-medium">{collection.name}</div>
                    <div className="truncate text-xs text-slate-400" title={collection.rootPath}>
                      {collection.rootPath}
                    </div>
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <CollectionActions
        bridgeAvailable={bridgeAvailable}
        isIndexing={isIndexing}
        folderProgress={folderProgress}
        imageProgress={imageProgress}
        cancelingIndex={cancelingIndex}
        onAddFolder={handleAddFolder}
        onCancelIndexing={handleCancelIndexing}
        selectionCount={selectionCount}
        removalCollectionProgress={removalCollectionProgress}
        removalImageProgress={removalImageProgress}
        onRemoveSelectedCollections={handleRemoveSelectedCollections}
        removalCanceling={removalCanceling}
        onCancelRemoval={handleCancelRemoval}
      />
      <button
        type="button"
        onClick={() => window.comfy?.openExternal("https://ko-fi.com/captaincodeuk")}
        className="mt-4 w-full text-left text-[11px] text-slate-500 hover:text-slate-300"
      >
        Support development on Ko‑Fi
      </button>
    </aside>
  );
}
