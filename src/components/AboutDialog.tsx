import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";

type AboutDialogProps = {
  open: boolean;
  appInfo: { name: string; version: string } | null;
  graphicUrl: string;
  onClose: () => void;
};

export const ABOUT_GRAPHIC_PUBLIC_PATH = "/about/about-image-256.png";

export function AboutDialog({ open, appInfo, graphicUrl, onClose }: AboutDialogProps) {
  const displayName = appInfo?.name ?? "Comfy Image Browser";
  const displayVersion = appInfo?.version ?? "—";
  const baseReleaseUrl = "https://github.com/CaptainCodeUK/comfy-image-browser/releases";
  const [latestRelease, setLatestRelease] = useState<{ version: string; url: string } | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [checkingRelease, setCheckingRelease] = useState(false);
  const currentVersion = useMemo(() => displayVersion.replace(/^v/i, ""), [displayVersion]);
  const isNewerRelease = useMemo(() => {
    if (!latestRelease) return false;
    const normalize = (value: string) => value.replace(/^v/i, "");
    const toParts = (value: string) => normalize(value).split(".").map((part) => Number(part) || 0);
    const latestParts = toParts(latestRelease.version);
    const currentParts = toParts(currentVersion);
    const length = Math.max(latestParts.length, currentParts.length);
    for (let i = 0; i < length; i += 1) {
      const latestPart = latestParts[i] ?? 0;
      const currentPart = currentParts[i] ?? 0;
      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }
    return false;
  }, [currentVersion, latestRelease]);

  const handleKoFiClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (window.comfy) {
      window.comfy.openExternal("https://ko-fi.com/captaincodeuk");
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
  setReleaseError(null);
  setLatestRelease(null);
  setCheckingRelease(true);
    let cancelled = false;
    const fetchRelease = async () => {
      const getRelease = window.comfy?.getLatestRelease;
      if (!getRelease) {
        return;
      }
      try {
        const release = await getRelease();
        if (cancelled || !release) return;
        setLatestRelease(release);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to check for updates";
        if (message.includes("404")) {
          setReleaseError("You are running the latest version.");
        } else {
          setReleaseError(message);
        }
      } finally {
        if (!cancelled) {
          setCheckingRelease(false);
        }
      }
    };
    void fetchRelease();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70">
      <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/90 px-6 py-5 text-sm text-slate-100 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">{displayName}</div>
            <div className="mt-1 text-xs text-slate-400">Version {displayVersion}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
            aria-label="Close about dialog"
          >
            ×
          </button>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-[auto,1fr]">
          <div className="h-[256px] w-[256px] max-w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <img
              src={graphicUrl}
              alt={`${displayName} illustration`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="space-y-3 text-sm text-slate-300">
            <p>
              Thanks for using Comfy Image Browser! It is built to stay local, fast, and easy to browse through generated
              images.
            </p>
            <p>
              If you would like to support future work, consider buying me a cup of coffee over on Ko‑Fi.
            </p>
            <button
              type="button"
              onClick={handleKoFiClick}
              className="inline-flex items-center gap-2 rounded-md border border-amber-400/70 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 hover:border-amber-300"
            >
              ☕ Ko‑Fi
            </button>
            <div className="text-xs text-slate-400">
              {checkingRelease ? (
                <div className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
                  Checking for updates…
                </div>
              ) : isNewerRelease ? (
                <p className="rounded-md border border-emerald-500/70 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  A newer version ({latestRelease?.version}) is available. Grab it on the
                  <a
                    href={latestRelease?.url ?? baseReleaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 font-semibold text-emerald-300 underline-offset-2 hover:text-emerald-100"
                  >
                    releases page
                  </a>
                  .
                </p>
              ) : releaseError ? (
                <p className="text-xs text-slate-400">{releaseError}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
