import type { ProgressState } from "../lib/appTypes";

interface CollectionActionsProps {
  bridgeAvailable: boolean;
  isIndexing: boolean;
  folderProgress: ProgressState;
  imageProgress: ProgressState;
  cancelingIndex: boolean;
  onAddFolder: () => Promise<void>;
  onCancelIndexing: () => Promise<void>;
  selectionCount: number;
  removalCollectionProgress: ProgressState;
  removalImageProgress: ProgressState;
  onRemoveSelectedCollections: () => Promise<void>;
  removalCanceling: boolean;
  onCancelRemoval: () => void;
}

export function CollectionActions({
  bridgeAvailable,
  isIndexing,
  folderProgress,
  imageProgress,
  cancelingIndex,
  onAddFolder,
  onCancelIndexing,
  selectionCount,
  removalCollectionProgress,
  removalImageProgress,
  onRemoveSelectedCollections,
  removalCanceling,
  onCancelRemoval,
}: CollectionActionsProps) {
  const showRemovalOverlay = !!(removalCollectionProgress || removalImageProgress);

  return (
    <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
      <div className="relative">
        <button
          onClick={onAddFolder}
          disabled={!bridgeAvailable || isIndexing}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
        >
          {isIndexing ? "Indexing…" : "Add Folder"}
        </button>
        {isIndexing ? (
          <div className="pointer-events-auto absolute bottom-full left-0 right-0 z-10 mb-2 min-h-[110px] rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-[11px] text-slate-200 shadow-lg">
            <div className="flex items-center gap-2 text-xs">
              <div className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
              <span>Indexing…</span>
            </div>
            <div className="mt-2 space-y-2">
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
                  <div className="mt-1 truncate text-[10px] text-slate-400" title={folderProgress.label}>
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
                  <div className="mt-1 truncate text-[10px] text-slate-400" title={imageProgress.label}>
                    {imageProgress.label}
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onCancelIndexing}
                  disabled={cancelingIndex}
                  className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-900 disabled:opacity-60"
                >
                  {cancelingIndex ? "Canceling…" : "Cancel"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between">
        <div className="relative">
          <button
            onClick={onRemoveSelectedCollections}
            disabled={selectionCount === 0 || showRemovalOverlay}
            className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-200 disabled:opacity-40"
          >
            Remove selected
          </button>
          {showRemovalOverlay ? (
            <div className="pointer-events-auto absolute bottom-full left-0 z-10 mb-2 w-56 min-h-[110px] rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-[11px] text-slate-200 shadow-lg">
              <div className="flex items-center gap-2 text-xs">
                <div className="h-2 w-2 animate-pulse rounded-full bg-rose-400" />
                <span>{removalCollectionProgress ? "Removing collections…" : "Removing images…"}</span>
              </div>
              <div className="mt-2 space-y-2">
                {removalCollectionProgress ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Collections</span>
                      <span>{`${removalCollectionProgress.current} / ${removalCollectionProgress.total}`}</span>
                    </div>
                    <progress
                      className="progress-bar"
                      value={removalCollectionProgress.current}
                      max={removalCollectionProgress.total}
                    />
                    <div
                      className="mt-1 truncate text-[10px] text-slate-400"
                      title={removalCollectionProgress.label}
                    >
                      {removalCollectionProgress.label}
                    </div>
                  </div>
                ) : null}
                {removalImageProgress ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Images</span>
                      <span>{`${removalImageProgress.current} / ${removalImageProgress.total}`}</span>
                    </div>
                    <progress
                      className="progress-bar"
                      value={removalImageProgress.current}
                      max={removalImageProgress.total}
                    />
                    <div
                      className="mt-1 truncate text-[10px] text-slate-400"
                      title={removalImageProgress.label}
                    >
                      {removalImageProgress.label}
                    </div>
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onCancelRemoval}
                    disabled={removalCanceling}
                    className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-900 disabled:opacity-60"
                  >
                    {removalCanceling ? "Canceling…" : "Cancel"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="text-[11px] text-slate-500">{selectionCount} selected</div>
      </div>
    </div>
  );
}
