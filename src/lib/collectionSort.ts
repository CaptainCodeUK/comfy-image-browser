import type { Collection } from "./types";
import type { CollectionSort } from "./appTypes";

const makeDateValue = (input: string) => {
  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const sortCollections = (collections: Collection[], sort: CollectionSort) => {
  const compareDates = (a: Collection, b: Collection) => makeDateValue(a.addedAt) - makeDateValue(b.addedAt);
  const sorted = [...collections];
  sorted.sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "name-desc":
        return b.name.localeCompare(a.name);
      case "added-asc":
        return compareDates(a, b);
      case "added-desc":
        return compareDates(b, a);
      default:
        return 0;
    }
  });
  return sorted;
};
