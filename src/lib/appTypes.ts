import type { Collection, IndexedImage } from "./types";

export type CollectionSort = "name-asc" | "name-desc" | "added-desc" | "added-asc";

export type ProgressState = { current: number; total: number; label: string } | null;

export type RenameState = { type: "image" | "collection"; id: string; value: string } | null;

export type Tab =
	| { id: "collection"; title: string; type: "collection" }
	| { id: string; title: string; type: "image"; image: IndexedImage };

export type ZoomMode = "fit" | "actual" | "width" | "height" | "manual";

export type MetadataSummary = {
	promptText: string | null;
	width: string | null;
	height: string | null;
	batchSize: string | null;
	checkpoint: string | null;
	seed: string | null;
	loras: Array<{ name: string; strength?: number }>;
	parametersText: string | null;
};

export type CollectionNode = {
	collection: Collection;
	depth: number;
	children: CollectionNode[];
};
