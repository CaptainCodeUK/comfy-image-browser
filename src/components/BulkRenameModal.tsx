import { KeyboardEvent, useCallback, useEffect, useId, useRef } from "react";

type BulkRenamePreviewEntry = {
  id: string;
  fileName: string;
  nextName: string;
};

type BulkRenameModalProps = {
  open: boolean;
  fileCount: number;
  baseValue: string;
  digitsValue: number;
  renaming: boolean;
  error: string | null;
  previewEntries: BulkRenamePreviewEntry[];
  additionalCount: number;
  onBaseChange: (value: string) => void;
  onDigitsChange: (value: number) => void;
  onCancel: () => void;
  onRename: () => void;
};

export function BulkRenameModal({
  open,
  fileCount,
  baseValue,
  digitsValue,
  renaming,
  error,
  previewEntries,
  additionalCount,
  onBaseChange,
  onDigitsChange,
  onCancel,
  onRename,
}: BulkRenameModalProps) {
  const baseId = useId();
  const digitsId = useId();
  const helperId = `${digitsId}-helper`;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const baseInputRef = useRef<HTMLInputElement | null>(null);
  const digitsInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (baseInputRef.current) {
        baseInputRef.current.focus();
        baseInputRef.current.select();
      }
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
        event.preventDefault();
        if (!renaming) {
          onRename();
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
    [open, renaming, onRename, onCancel]
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
          <div className="text-base font-semibold">Bulk rename {fileCount} file(s)</div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
            data-action="cancel"
            aria-label="Close bulk rename"
          >
            ×
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <label htmlFor={baseId} className="block text-[11px] uppercase tracking-wide text-slate-400">
            Base name
          </label>
          <input
            id={baseId}
            ref={baseInputRef}
            value={baseValue}
            onChange={(event) => onBaseChange(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="Enter a new base name"
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <label htmlFor={digitsId} className="block text-[11px] uppercase tracking-wide text-slate-400">
            Digits
          </label>
          <input
            id={digitsId}
            ref={digitsInputRef}
            type="number"
            min={1}
            value={digitsValue}
            onChange={(event) => onDigitsChange(Number(event.target.value))}
            onFocus={(event) => event.currentTarget.select()}
            className="w-24 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            title="Number of digits to pad for each file"
            aria-describedby={helperId}
          />
          <div className="text-[11px] text-slate-400" id={helperId}>
            Numbers will be padded to {Math.max(1, digitsValue)} digit(s).
          </div>
          {error ? (
            <div className="rounded-md border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              {error}
            </div>
          ) : null}
          <div className="space-y-2 text-[11px] text-slate-300">
            <div className="font-semibold text-slate-100">Preview</div>
            <ul className="space-y-1">
              {previewEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-md bg-slate-900/60 px-3 py-1"
                >
                  <span className="truncate pr-2">{entry.fileName}</span>
                  <span className="text-slate-400">→ {entry.nextName}</span>
                </li>
              ))}
            </ul>
            {additionalCount > 0 ? (
              <div className="text-[11px] text-slate-500">And {additionalCount} more file(s).</div>
            ) : null}
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
            onClick={onRename}
            disabled={renaming}
            className="rounded-md bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {renaming ? "Renaming…" : "Rename files"}
          </button>
        </div>
      </div>
    </div>
  );
}
