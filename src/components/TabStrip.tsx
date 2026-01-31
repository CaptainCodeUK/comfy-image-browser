import type { MutableRefObject, RefObject } from "react";
import type { Tab } from "../lib/appTypes";

interface TabStripProps {
  tabs: Tab[];
  activeTab: Tab;
  collectionTab: Tab;
  onSelectTab: (tab: Tab) => void;
  onDuplicateTab: () => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseAllTabs: () => void;
  tabRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  tabScrollRef: MutableRefObject<HTMLDivElement | null>;
}

export function TabStrip({
  tabs,
  activeTab,
  collectionTab,
  onSelectTab,
  onDuplicateTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  tabRefs,
  tabScrollRef,
}: TabStripProps) {
  const nonCollectionTabs = tabs.filter((tab) => tab.id !== collectionTab.id);
  const canCloseAll = tabs.length > 1;
  const canCloseOthers = tabs.length > 2 && activeTab.id !== collectionTab.id;

  return (
    <div className="border-b border-slate-800 bg-slate-950/20">
      <div className="flex items-center gap-3">
        <div
          ref={(node) => {
            tabRefs.current[collectionTab.id] = node;
          }}
          className={`flex h-7 flex-none items-center gap-2 px-4 py-0 text-sm ${activeTab.id === collectionTab.id
            ? "bg-indigo-500 text-white"
            : "bg-slate-800 text-slate-200"
            }`}
        >
          <button
            onClick={() => onSelectTab(collectionTab)}
            className="truncate"
            aria-current={activeTab.id === collectionTab.id ? "page" : undefined}
          >
            {collectionTab.title}
          </button>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => tabScrollRef.current?.scrollBy({ left: -200, behavior: "smooth" })}
            className="h-7 rounded-md border border-slate-700 px-2 py-0 text-xs text-slate-300"
            aria-label="Scroll tabs left"
          >
            ◀
          </button>
          <div
            ref={(node) => {
              tabScrollRef.current = node;
            }}
            className="min-w-0 flex-1 h-full overflow-x-auto tab-scroll"
          >
            <div className="flex items-center gap-2 pl-0">
              {nonCollectionTabs.map((tab) => {
                const isActive = activeTab.id === tab.id;
                return (
                  <div
                    key={tab.id}
                    ref={(node) => {
                      tabRefs.current[tab.id] = node;
                    }}
                    className={`flex h-7 flex-none items-center gap-2 rounded-lg px-4 py-0 text-sm ${isActive ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-200"
                      }`}
                  >
                    <button
                      onClick={() => onSelectTab(tab)}
                      onMouseDown={(event) => {
                        if (event.button === 1) {
                          event.preventDefault();
                          onCloseTab(tab.id);
                        }
                      }}
                      className="truncate"
                      aria-current={isActive ? "page" : undefined}
                    >
                      {tab.title}
                    </button>
                    {tab.type === "image" ? (
                      <button
                        onClick={() => onCloseTab(tab.id)}
                        className="rounded-md px-1 text-xs text-slate-200/80 hover:bg-white/10"
                        aria-label={`Close ${tab.title}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => tabScrollRef.current?.scrollBy({ left: 200, behavior: "smooth" })}
            className="h-7 rounded-md border border-slate-700 px-2 py-0 text-xs text-slate-300"
            aria-label="Scroll tabs right"
          >
            ▶
          </button>
        </div>
        <div className="flex flex-none items-center gap-2 px-2">
          <button
            onClick={onDuplicateTab}
            disabled={activeTab.type !== "image"}
            className="h-7 rounded-md border border-slate-700 px-3 py-0 text-xs text-slate-300 disabled:opacity-40"
          >
            Duplicate
          </button>
          <button
            onClick={onCloseAllTabs}
            disabled={!canCloseAll}
            className="h-7 rounded-md border border-slate-700 px-3 py-0 text-xs text-slate-300 disabled:opacity-40"
          >
            Close all
          </button>
          <button
            onClick={() => onCloseOtherTabs(activeTab.id)}
            disabled={!canCloseOthers}
            className="h-7 rounded-md border border-slate-700 px-3 py-0 text-xs text-slate-300 disabled:opacity-40"
          >
            Close others
          </button>
        </div>
      </div>
    </div>
  );
}
