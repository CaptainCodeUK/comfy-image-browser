import { useEffect, useRef } from "react";
import type { Collection, IndexedImage } from "../lib/types";

type MenuActionBridgeProps = {
  bridgeAvailable: boolean;
  favoritesId: string;
  selectedIds: Set<string>;
  selectedCollectionIds: Set<string>;
  images: IndexedImage[];
  collections: Collection[];
  activeTabId: string;
  activeTabType: "collection" | "image";
  activeTabImage: IndexedImage | null;
  activeCollection: string | "all";
  collectionById: Map<string, Collection>;
  imageById: Map<string, IndexedImage>;
  filteredImages: IndexedImage[];
  selectedOrderedImages: IndexedImage[];
  isIndexing: boolean;
  removalCollectionProgress: { current: number; total: number; label: string } | null;
  removalImageProgress: { current: number; total: number; label: string } | null;
  isDeletingFiles: boolean;
  handleAddFolder: () => Promise<void>;
  handleRemoveSelected: () => Promise<void>;
  handleRemoveSelectedCollections: () => Promise<void>;
  handleDeleteSelectedCollectionsFromDisk: () => Promise<void>;
  handleDeleteImagesFromDisk: (ids: string[], label: string) => Promise<string[]>;
  handleRevealInFolder: (path?: string) => Promise<void>;
  handleOpenInEditor: (path?: string) => Promise<void>;
  startRenameImage: (image: IndexedImage) => void;
  startRenameCollection: (collection: Collection) => void;
  addFavoriteImages: (ids: string[], label?: string) => Promise<void>;
  removeFavoriteImages: (ids: string[], label?: string) => Promise<void>;
  addCollectionToFavorites: (collection: Collection) => Promise<void>;
  removeCollectionFromFavorites: (collection: Collection) => Promise<void>;
  handleRescanCollections: (collectionIds: string[]) => Promise<void>;
  handleSelectAllImages: () => void;
  handleInvertImageSelection: () => void;
  handleClearImageSelection: () => void;
  handleSelectAllCollections: () => void;
  handleInvertCollectionSelection: () => void;
  handleClearCollectionSelection: () => void;
  handleCycleTab: (direction: number) => void;
  handleDuplicateTab: () => void;
  handleCloseTab: (tabId: string) => void;
  handleCloseOtherTabs: (tabId: string) => void;
  handleCloseAllTabs: () => void;
  handleOpenBulkRename: () => void;
  setAboutOpen: (open: boolean) => void;
};

type MenuContext = {
  selectedIds: Set<string>;
  selectedCollectionIds: Set<string>;
  images: IndexedImage[];
  collections: Collection[];
  activeTabId: string;
  activeTabType: "collection" | "image";
  activeTabImage: IndexedImage | null;
  activeCollection: string | "all";
  collectionById: Map<string, Collection>;
  handleAddFolder: () => Promise<void>;
  handleRemoveSelected: () => Promise<void>;
  handleRemoveSelectedCollections: () => Promise<void>;
  handleDeleteSelectedCollectionsFromDisk: () => Promise<void>;
  handleDeleteImagesFromDisk: (ids: string[], label: string) => Promise<string[]>;
  handleRevealInFolder: (path?: string) => Promise<void>;
  handleOpenInEditor: (path?: string) => Promise<void>;
  startRenameImage: (image: IndexedImage) => void;
  startRenameCollection: (collection: Collection) => void;
  addFavoriteImages: (ids: string[], label?: string) => Promise<void>;
  removeFavoriteImages: (ids: string[], label?: string) => Promise<void>;
  addCollectionToFavorites: (collection: Collection) => Promise<void>;
  removeCollectionFromFavorites: (collection: Collection) => Promise<void>;
  handleRescanCollections: (collectionIds: string[]) => Promise<void>;
  handleSelectAllImages: () => void;
  handleInvertImageSelection: () => void;
  handleClearImageSelection: () => void;
  handleSelectAllCollections: () => void;
  handleInvertCollectionSelection: () => void;
  handleClearCollectionSelection: () => void;
  handleCycleTab: (direction: number) => void;
  handleDuplicateTab: () => void;
  handleCloseTab: (tabId: string) => void;
  handleCloseOtherTabs: (tabId: string) => void;
  handleCloseAllTabs: () => void;
  handleOpenBulkRename: () => void;
  setAboutOpen: (open: boolean) => void;
};

export function MenuActionBridge({
  bridgeAvailable,
  favoritesId,
  selectedIds,
  selectedCollectionIds,
  images,
  collections,
  activeTabId,
  activeTabType,
  activeTabImage,
  activeCollection,
  collectionById,
  imageById,
  filteredImages,
  selectedOrderedImages,
  isIndexing,
  removalCollectionProgress,
  removalImageProgress,
  isDeletingFiles,
  handleAddFolder,
  handleRemoveSelected,
  handleRemoveSelectedCollections,
  handleDeleteSelectedCollectionsFromDisk,
  handleDeleteImagesFromDisk,
  handleRevealInFolder,
  handleOpenInEditor,
  startRenameImage,
  startRenameCollection,
  addFavoriteImages,
  removeFavoriteImages,
  addCollectionToFavorites,
  removeCollectionFromFavorites,
  handleRescanCollections,
  handleSelectAllImages,
  handleInvertImageSelection,
  handleClearImageSelection,
  handleSelectAllCollections,
  handleInvertCollectionSelection,
  handleClearCollectionSelection,
  handleCycleTab,
  handleDuplicateTab,
  handleCloseTab,
  handleCloseOtherTabs,
  handleCloseAllTabs,
  handleOpenBulkRename,
  setAboutOpen,
}: MenuActionBridgeProps) {
  const contextRef = useRef<MenuContext>({
    selectedIds,
    selectedCollectionIds,
    images,
    collections,
    activeTabId,
    activeTabType,
    activeTabImage,
    activeCollection,
    collectionById,
    handleAddFolder,
    handleRemoveSelected,
    handleRemoveSelectedCollections,
    handleDeleteSelectedCollectionsFromDisk,
    handleDeleteImagesFromDisk,
    handleRevealInFolder,
    handleOpenInEditor,
    startRenameImage,
    startRenameCollection,
    addFavoriteImages,
    removeFavoriteImages,
    addCollectionToFavorites,
    removeCollectionFromFavorites,
    handleRescanCollections,
    handleSelectAllImages,
    handleInvertImageSelection,
    handleClearImageSelection,
    handleSelectAllCollections,
    handleInvertCollectionSelection,
    handleClearCollectionSelection,
    handleCycleTab,
    handleDuplicateTab,
    handleCloseTab,
    handleCloseOtherTabs,
    handleCloseAllTabs,
    handleOpenBulkRename,
    setAboutOpen,
  });

  useEffect(() => {
    contextRef.current = {
      selectedIds,
      selectedCollectionIds,
      images,
      collections,
      activeTabId,
      activeTabType,
      activeTabImage,
      activeCollection,
      collectionById,
      handleAddFolder,
      handleRemoveSelected,
      handleRemoveSelectedCollections,
      handleDeleteSelectedCollectionsFromDisk,
      handleDeleteImagesFromDisk,
      handleRevealInFolder,
      handleOpenInEditor,
      startRenameImage,
      startRenameCollection,
      addFavoriteImages,
      removeFavoriteImages,
      addCollectionToFavorites,
      removeCollectionFromFavorites,
      handleRescanCollections,
      handleSelectAllImages,
      handleInvertImageSelection,
      handleClearImageSelection,
      handleSelectAllCollections,
      handleInvertCollectionSelection,
      handleClearCollectionSelection,
      handleCycleTab,
      handleDuplicateTab,
      handleCloseTab,
      handleCloseOtherTabs,
      handleCloseAllTabs,
      handleOpenBulkRename,
      setAboutOpen,
    };
  }, [
    selectedIds,
    selectedCollectionIds,
    images,
    collections,
    activeTabId,
    activeTabType,
    activeTabImage,
    activeCollection,
    collectionById,
    handleAddFolder,
    handleRemoveSelected,
    handleRemoveSelectedCollections,
    handleDeleteSelectedCollectionsFromDisk,
    handleDeleteImagesFromDisk,
    handleRevealInFolder,
    handleOpenInEditor,
    startRenameImage,
    startRenameCollection,
    addFavoriteImages,
    removeFavoriteImages,
    addCollectionToFavorites,
    removeCollectionFromFavorites,
    handleRescanCollections,
    handleSelectAllImages,
    handleInvertImageSelection,
    handleClearImageSelection,
    handleSelectAllCollections,
    handleInvertCollectionSelection,
    handleClearCollectionSelection,
    handleCycleTab,
    handleDuplicateTab,
    handleCloseTab,
    handleCloseOtherTabs,
    handleCloseAllTabs,
    handleOpenBulkRename,
    setAboutOpen,
  ]);

  useEffect(() => {
    if (!bridgeAvailable || !window.comfy?.onMenuAction) return undefined;
    return window.comfy.onMenuAction((action) => {
      const context = contextRef.current;
      const firstSelectedId = context.selectedIds.values().next().value as string | undefined;
      const fallbackImage =
        context.activeTabType === "image"
          ? context.activeTabImage
          : firstSelectedId
            ? context.images.find((image) => image.id === firstSelectedId)
            : undefined;
      if (action === "add-folder") {
        void context.handleAddFolder();
        return;
      }
      if (action === "remove-selected-images") {
        void context.handleRemoveSelected();
        return;
      }
      if (action === "remove-selected-collections") {
        void context.handleRemoveSelectedCollections();
        return;
      }
      if (action === "rescan-selected-collections") {
        void context.handleRescanCollections(Array.from(context.selectedCollectionIds));
        return;
      }
      if (action === "select-all-images") {
        context.handleSelectAllImages();
        return;
      }
      if (action === "invert-image-selection") {
        context.handleInvertImageSelection();
        return;
      }
      if (action === "clear-image-selection") {
        context.handleClearImageSelection();
        return;
      }
      if (action === "select-all-collections") {
        context.handleSelectAllCollections();
        return;
      }
      if (action === "invert-collection-selection") {
        context.handleInvertCollectionSelection();
        return;
      }
      if (action === "clear-collection-selection") {
        context.handleClearCollectionSelection();
        return;
      }
      if (action === "delete-selected-images-disk") {
        const ids = Array.from(context.selectedIds);
        void context.handleDeleteImagesFromDisk(ids, `${ids.length} selected images`);
        return;
      }
      if (action === "delete-selected-collections-disk") {
        void context.handleDeleteSelectedCollectionsFromDisk();
        return;
      }
      if (action === "add-selected-images-favorites") {
        const ids = Array.from(context.selectedIds);
        void context.addFavoriteImages(ids, `${ids.length} image(s) added to favourites`);
        return;
      }
      if (action === "remove-selected-images-favorites") {
        const ids = Array.from(context.selectedIds);
        void context.removeFavoriteImages(ids, `${ids.length} image(s) removed from favourites`);
        return;
      }
      if (action === "add-selected-collections-favorites") {
        void (async () => {
          for (const id of context.selectedCollectionIds) {
            const targetCollection = context.collections.find((entry) => entry.id === id);
            if (targetCollection) {
              await context.addCollectionToFavorites(targetCollection);
            }
          }
        })();
        return;
      }
      if (action === "remove-selected-collections-favorites") {
        void (async () => {
          for (const id of context.selectedCollectionIds) {
            const targetCollection = context.collections.find((entry) => entry.id === id);
            if (targetCollection) {
              await context.removeCollectionFromFavorites(targetCollection);
            }
          }
        })();
        return;
      }
      if (action === "rename-selected-image") {
        const target =
          context.activeTabType === "image"
            ? context.activeTabImage
            : context.selectedIds.size === 1
              ? context.images.find((image) => context.selectedIds.has(image.id))
              : null;
        if (target) {
          context.startRenameImage(target);
        }
        return;
      }
      if (action === "bulk-rename-selected-images") {
        context.handleOpenBulkRename();
        return;
      }
      if (action === "rename-selected-collection") {
        const target =
          context.selectedCollectionIds.size === 1
            ? context.collections.find((collection) => context.selectedCollectionIds.has(collection.id))
            : context.activeCollection !== "all"
              ? context.collectionById.get(context.activeCollection) ?? null
              : null;
        if (target) {
          context.startRenameCollection(target);
        }
        return;
      }
      if (action === "reveal-active-image") {
        void context.handleRevealInFolder(fallbackImage?.filePath);
        return;
      }
      if (action === "edit-active-image") {
        void context.handleOpenInEditor(fallbackImage?.filePath);
        return;
      }
      if (action === "reveal-active-collection") {
        const targetCollectionId =
          context.activeTabType === "image" ? context.activeTabImage?.collectionId : context.activeCollection;
        const collection = targetCollectionId === "all" ? null : context.collectionById.get(targetCollectionId ?? "");
        void context.handleRevealInFolder(collection?.rootPath);
        return;
      }
      if (action === "tab-next") {
        context.handleCycleTab(1);
        return;
      }
      if (action === "tab-prev") {
        context.handleCycleTab(-1);
        return;
      }
      if (action === "tab-duplicate") {
        context.handleDuplicateTab();
        return;
      }
      if (action === "tab-close") {
  if (context.activeTabType !== "collection") {
          context.handleCloseTab(context.activeTabId);
        }
        return;
      }
      if (action === "tab-close-others") {
        context.handleCloseOtherTabs(context.activeTabId);
        return;
      }
      if (action === "tab-close-all") {
        context.handleCloseAllTabs();
        return;
      }
      if (action === "show-about") {
        context.setAboutOpen(true);
        return;
      }
    });
  }, [bridgeAvailable]);

  useEffect(() => {
    if (!bridgeAvailable || !window.comfy?.updateMenuState) return undefined;
    const firstSelectedId = selectedIds.values().next().value as string | undefined;
    const activeImage =
      activeTabType === "image"
        ? activeTabImage
        : firstSelectedId
          ? imageById.get(firstSelectedId)
          : undefined;
    const hasActiveImage = Boolean(activeImage);
    const collectionTargetId = activeTabType === "image" ? activeTabImage?.collectionId ?? "" : activeCollection;
    const hasActiveCollection =
      collectionTargetId !== "all" && collectionTargetId !== favoritesId && Boolean(collectionById.get(collectionTargetId ?? ""));
  const isCollectionTab = activeTabType === "collection";
    window.comfy.updateMenuState({
      hasActiveImage,
      hasActiveCollection,
  hasSelectedImages: isCollectionTab && selectedIds.size > 0,
      hasSelectedCollections: selectedCollectionIds.size > 0,
  hasSingleSelectedImage: activeTabType === "image" || (isCollectionTab && selectedIds.size === 1),
      hasSingleSelectedCollection:
        selectedCollectionIds.size === 1 ||
  (activeCollection !== "all" && activeCollection !== favoritesId && selectedCollectionIds.size === 0),
  hasImages: isCollectionTab && filteredImages.length > 0,
      hasCollections: collections.length > 0,
      canBulkRenameImages: selectedOrderedImages.length > 0,
      isIndexing,
      isRemoving: !!(removalCollectionProgress || removalImageProgress),
      isDeleting: isDeletingFiles,
    });
    return undefined;
  }, [
    bridgeAvailable,
    activeTabType,
    activeTabImage,
    activeCollection,
    filteredImages,
    collections,
    selectedIds,
    selectedCollectionIds,
    collectionById,
    imageById,
    isIndexing,
    removalCollectionProgress,
    removalImageProgress,
    isDeletingFiles,
    selectedOrderedImages,
    favoritesId,
  ]);

  return null;
}