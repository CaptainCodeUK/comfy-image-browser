export type CollectionSort = "name-asc" | "name-desc" | "added-desc" | "added-asc";

export type ProgressState = { current: number; total: number; label: string } | null;

export type RenameState = { type: "image" | "collection"; id: string; value: string } | null;
