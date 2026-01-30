import { useCallback } from "react";
import type { Collection, IndexedImage } from "../lib/types";
import type { MouseEvent } from "react";

type ContextMenuDispatcherProps = {
  bridgeAvailable: boolean;
  selectedIds: Set<string>;
  selectedCollectionIds: Set<string>;
  collections: Collection[];
  startRenameImage: (image: IndexedImage) => void;
  startRenameCollection: (collection: Collection) => void;
  addFavoriteImages: (ids: string[], label?: string) => Promise<void>;
  removeFavoriteImages: (ids: string[], label?: string) => Promise<void>;
  addCollectionToFavorites: (collection: Collection) => Promise<void>;
  removeCollectionFromFavorites: (collection: Collection) => Promise<void>;
  handleRemoveImages: (ids: string[]) => Promise<void>;
  handleRevealInFolder: (filePath?: string) => Promise<void>;
  handleOpenInEditor: (filePath?: string) => Promise<void>;
  handleDeleteImagesFromDisk: (ids: string[], label: string) => Promise<string[]>;
  handleOpenBulkRename: () => void;
  handleRescanCollections: (collectionIds: string[]) => Promise<void>;
  handleRemoveSelectedCollections: () => Promise<void>;
  handleDeleteSelectedCollectionsFromDisk: () => Promise<void>;
  handleSelectAllImages: () => void;
  handleInvertImageSelection: () => void;
  handleClearImageSelection: () => void;
  handleSelectAllCollections: () => void;
  handleInvertCollectionSelection: () => void;
  handleClearCollectionSelection: () => void;
};

export function useContextMenuDispatcher({
  bridgeAvailable,
  selectedIds,
  selectedCollectionIds,
  collections,
  startRenameImage,
  startRenameCollection,
  addFavoriteImages,
  removeFavoriteImages,
  addCollectionToFavorites,
  removeCollectionFromFavorites,
  handleRemoveImages,
  handleRevealInFolder,
  handleOpenInEditor,
  handleDeleteImagesFromDisk,
  handleOpenBulkRename,
  handleRescanCollections,
  handleRemoveSelectedCollections,
  handleDeleteSelectedCollectionsFromDisk,
  handleSelectAllImages,
  handleInvertImageSelection,
  handleClearImageSelection,
  handleSelectAllCollections,
  handleInvertCollectionSelection,
  handleClearCollectionSelection,
}: ContextMenuDispatcherProps) {
  const handleImageContextMenu = useCallback(
    async (event: MouseEvent, image: IndexedImage) => {
      event.preventDefault();
      if (!bridgeAvailable || !window.comfy?.showContextMenu) return;
      const action = await window.comfy.showContextMenu({
        type: "image",
        imageId: image.id,
        label: image.fileName,
        selectedCount: selectedIds.size,
        isSelected: selectedIds.has(image.id),
      });
      if (action === "rename-image") {
        startRenameImage(image);
      }
      if (action === "add-selected-images-favorites") {
        await addFavoriteImages(Array.from(selectedIds), `${selectedIds.size} image(s) added to favourites`);
      }
      if (action === "remove-selected-images-favorites") {
        await removeFavoriteImages(Array.from(selectedIds), `${selectedIds.size} image(s) removed from favourites`);
      }
      if (action === "remove-selected-images") {
        await handleRemoveImages(Array.from(selectedIds));
      }
      if (action === "delete-selected-images-disk") {
        await handleDeleteImagesFromDisk(Array.from(selectedIds), `${selectedIds.size} selected images`);
      }
      if (action === "reveal-image") {
        await handleRevealInFolder(image.filePath);
      }
      if (action === "edit-image") {
        await handleOpenInEditor(image.filePath);
      }
      if (action === "select-all-images") {
        handleSelectAllImages();
      }
      if (action === "invert-image-selection") {
        handleInvertImageSelection();
      }
      if (action === "clear-image-selection") {
        handleClearImageSelection();
      }
      if (action === "bulk-rename-selected-images") {
        handleOpenBulkRename();
      }
    },
    [
      bridgeAvailable,
      selectedIds,
      startRenameImage,
      addFavoriteImages,
      removeFavoriteImages,
      handleRemoveImages,
      handleDeleteImagesFromDisk,
      handleRevealInFolder,
      handleOpenInEditor,
      handleSelectAllImages,
      handleInvertImageSelection,
      handleClearImageSelection,
      handleOpenBulkRename,
    ]
  );

  const handleCollectionContextMenu = useCallback(
    async (event: MouseEvent, collection: Collection) => {
      event.preventDefault();
      if (!bridgeAvailable || !window.comfy?.showContextMenu) return;
      const action = await window.comfy.showContextMenu({
        type: "collection",
        collectionId: collection.id,
        label: collection.name,
        selectedCount: selectedCollectionIds.size,
        isSelected: selectedCollectionIds.has(collection.id),
      });
      if (action === "rename-collection") {
        startRenameCollection(collection);
      }
      if (action === "add-selected-collections-favorites") {
        const targets = selectedCollectionIds.size ? selectedCollectionIds : new Set([collection.id]);
        for (const id of targets) {
          const targetCollection = collections.find((entry) => entry.id === id);
          if (targetCollection) {
            await addCollectionToFavorites(targetCollection);
          }
        }
      }
      if (action === "remove-selected-collections-favorites") {
        const targets = selectedCollectionIds.size ? selectedCollectionIds : new Set([collection.id]);
        for (const id of targets) {
          const targetCollection = collections.find((entry) => entry.id === id);
          if (targetCollection) {
            await removeCollectionFromFavorites(targetCollection);
          }
        }
      }
      if (action === "rescan-collection") {
        await handleRescanCollections([collection.id]);
      }
      if (action === "remove-selected-collections") {
        await handleRemoveSelectedCollections();
      }
      if (action === "delete-selected-collections-disk") {
        await handleDeleteSelectedCollectionsFromDisk();
      }
      if (action === "reveal-collection") {
        await handleRevealInFolder(collection.rootPath);
      }
      if (action === "select-all-collections") {
        handleSelectAllCollections();
      }
      if (action === "invert-collection-selection") {
        handleInvertCollectionSelection();
      }
      if (action === "clear-collection-selection") {
        handleClearCollectionSelection();
      }
    },
    [
      bridgeAvailable,
      selectedCollectionIds,
      collections,
      startRenameCollection,
      addCollectionToFavorites,
      removeCollectionFromFavorites,
      handleRescanCollections,
      handleRemoveSelectedCollections,
      handleDeleteSelectedCollectionsFromDisk,
      handleRevealInFolder,
      handleSelectAllCollections,
      handleInvertCollectionSelection,
      handleClearCollectionSelection,
    ]
  );

  return { handleImageContextMenu, handleCollectionContextMenu };
}
