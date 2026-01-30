import { sortCollections } from "../src/lib/collectionSort";
import { expect, test } from "vitest";

const mockCollections = [
  {
    id: "newest",
    name: "Zeta",
    rootPath: "/path/zeta",
    addedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "middle",
    name: "Alpha",
    rootPath: "/path/alpha",
    addedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "oldest",
    name: "Gamma",
    rootPath: "/path/gamma",
    addedAt: "2023-01-01T00:00:00.000Z",
  },
];

test("added-asc sorts oldest first", () => {
  const sorted = sortCollections(mockCollections, "added-asc");
  expect(sorted.map((collection) => collection.id)).toEqual(["oldest", "middle", "newest"]);
});

test("added-desc sorts newest first", () => {
  const sorted = sortCollections(mockCollections, "added-desc");
  expect(sorted.map((collection) => collection.id)).toEqual(["newest", "middle", "oldest"]);
});
