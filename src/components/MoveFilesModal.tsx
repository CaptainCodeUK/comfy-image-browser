import { KeyboardEvent, useCallback, useEffect, useId, useRef } from "react";

type MovePreviewEntry = {
  id: string;
  fileName: string;
  filePath: string;
};

type MoveFilesModalProps = {
  open: boolean;
  fileCount: number;
  destination: string;
  moving: boolean;
  disabled: boolean;
  error: string | null;
  previewEntries: MovePreviewEntry[];
  additionalCount: number;
  onDestinationChange: (value: string) => void;
  onCancel: () => void;
  onMove: () => void;
  onPickDestination: () => void;
};

export function MoveFilesModal({
  open,
  fileCount,
  destination,
  moving,
  disabled,
  error,
  previewEntries,
  additionalCount,
  onDestinationChange,
  onCancel,
  onMove,
  onPickDestination,
}: MoveFilesModalProps) {
  const destinationId = useId();
  const helperId = `${destinationId}-helper`;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const destinationRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      destinationRef.current?.focus();
      destinationRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!open) return;
      const focusableSelector = "button:not([disabled]), input:not([disabled])";
      const modal = dialogRef.current;
      if (event.key === "Tab" && modal) {
        const focusable = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector));
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (event.key === "Enter") {
        if (
          document.activeElement instanceof HTMLButtonElement &&
          document.activeElement.dataset.action === "cancel"
        ) {
          return;
        }
        if (!disabled && !moving) {
          event.preventDefault();
          onMove();
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
    [open, disabled, moving, onMove, onCancel]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4">
      <div
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        className="pointer-events-auto w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/90 p-6 text-sm text-slate-100 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">Move {fileCount} file(s)</div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
            data-action="cancel"
            aria-label="Close move dialog"
          >
            ×
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <label htmlFor={destinationId} className="block text-[11px] uppercase tracking-wide text-slate-400">
            Destination folder
          </label>
          <div className="flex items-center gap-2">
            <input
              id={destinationId}
              ref={destinationRef}
              value={destination}
              onChange={(event) => onDestinationChange(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder="Enter destination folder path"
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              aria-describedby={helperId}
            />
            <button
              type="button"
              onClick={onPickDestination}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500"
            >
              Browse…
            </button>
          </div>
          <div className="text-[11px] text-slate-400" id={helperId}>
            Files will be moved into this folder. It will be created if it does not exist.
          </div>
          {error ? (
            <div className="rounded-md border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              {error}
            </div>
          ) : null}
          <div className="space-y-2 text-[11px] text-slate-300">
            <div className="font-semibold text-slate-100">Preview</div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-900">
              <ul className="space-y-1">
                {previewEntries.map((entry) => (
                  <li key={entry.id} className="rounded-md bg-slate-950/60 px-2 py-1">
                    <div className="truncate text-sm font-medium text-slate-100">{entry.fileName}</div>
                    <div className="truncate text-[11px] text-slate-500">{entry.filePath}</div>
                  </li>
                ))}
              </ul>
              {additionalCount > 0 ? (
                <div className="text-[11px] text-slate-500">And {additionalCount} more file(s).</div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300"
            data-action="cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onMove}
            disabled={disabled || moving}
            className="rounded-md bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {moving ? "Moving…" : "Move files"}
          </button>
        </div>
      </div>
    </div>
  );
}
