import type { IndexedImage } from "./types";

export type CollectionSort = "name-asc" | "name-desc" | "added-desc" | "added-asc";

export type ProgressState = { current: number; total: number; label: string } | null;

export type RenameState = { type: "image" | "collection"; id: string; value: string } | null;

export type Tab =
	| { id: "library"; title: "Library"; type: "library" }
	| { id: string; title: string; type: "image"; image: IndexedImage };
