# Component Boundary Proposal

Documenting how the existing `App.tsx` UI can be broken into discrete components. Each section captures the current responsibilities, the props it would need, and any shared state or handlers that would need to be lifted.

## 1. Menu & Menu Action Wiring
- **Existing location**: `menuActionContextRef`, the `window.comfy.onMenuAction` subscription, `handleOpenBulkRename`, all the `handle*` helpers invoked from menu commands, plus `window.comfy.updateMenuState` (App lines 2980-3250).
- **Responsibilities**:
	- Subscribe to native menu actions and dispatch the corresponding in-app handlers.
	- Update menu enabled/disabled state based on selection context (counts, active tab, favorites).
	- Provide a shared context that other parts of the UI can observe (selection sets, active tab, menu enablement).
- **Component idea**: `MenuActionBridge` (or `MenuActionProvider`). It receives the relevant slices of state and callbacks and manages the Electron bridge as side effects, possibly exposing a context for consumers.
- **Props**: `selectedIds`, `selectedCollectionIds`, `activeTab`, `activeCollection`, `images`, `collections`, along with handlers like `handleRemoveSelected`, `handleDeleteImagesFromDisk`, `handleOpenBulkRename`, `handleSelectAllImages`, etc.
- **Outcome**: Extracts Electron-specific wiring, keeps `App` focused on rendering, and gives a single spot to test/update menu behaviors.

## 2. Context Menu Dispatchers
- **Existing location**: `handleImageContextMenu` and `handleCollectionContextMenu` (App lines ~2550-2650).
- **Responsibilities**: Show the bridge-provided context menus for cards and run the resulting action handlers (rename, add to favorites, delete, reveal, edit, selection shortcuts, bulk rename).
- **Component idea**: `useContextMenuDispatcher` hook or exported helper returning per-item handlers (`getImageContextMenuHandler(image)`).
- **Dependencies**: `bridgeAvailable`, selection states, `collections`, `images`, and the handler set invoked in the switch statements.
- **Benefit**: Keeps cards declarative and keeps context-menu logic centralized.

## 3. Collections Sidebar
- **Existing location**: `<aside className="flex w-64...` block before the image grid, including sort controls, "All Images"/"Favorites" shortcuts, the collection list, and the action panel (App lines ~3470-3800).
- **Responsibilities**:
	- Render sorted collections with selection/focus styles and context menu hooks.
	- Support keyboard navigation and multi-select behavior within the list.
	- Show action buttons (Add Folder, Remove Selected, Ko-Fi link) plus progress overlays for indexing/removal.
- **Component idea**: `CollectionSidebar` or `CollectionPanel`.
- **Props**: `collections`, `collectionSort`, `collectionHighlightId`, `selectedCollectionIds`, `collectionFocusedId`, `collectionSelectionAnchor`, `isIndexing`, `cancelingIndex`, `folderProgress`, `imageProgress`, `removalCollectionProgress`, `removalImageProgress`, `removalCanceling`, `bridgeAvailable`.
- **Callbacks**: `onCollectionClick`, `onCollectionContextMenu`, `onCollectionKeyDown`, `onAddFolder`, `onRemoveSelectedCollections`, `onCancelIndexing`, `onCancelRemoval`, `onRescanCollections`, `onDeleteSelectedCollectionsFromDisk`, `onStartRenameCollection`.
- **Outcome**: The sidebar owns layout and UI states (keyboard focus, overlays), while `App` retains the selection logic/managers.

## 4. Icon Grid & Image Cards
- **Existing location**: The library grid section (`<section className="flex-1 overflow-hidden">`), virtualization math, and the `visibleImages.map` rendering each image card (App lines ~3960-4200).
- **Responsibilities**:
	- Compute positions for virtualized rendering and track scroll metrics.
	- Render each image tile, handling selection, focus ring, rename input, favorite toggle, thumbnails, and context menus.
- **Component splits**:
	1. `ImageGrid` for virtualization/layout: slices `visibleImages`, calculates positions, and renders `ImageCard` entries.
	2. `ImageCard` for a single tile: accepts `image`, `position`, `isSelected`, `isFocused`, `isFavorite`, `isRenaming`, `thumbnailUrl`, `isLoaded`, plus callbacks for interactions (`onClick`, `onDoubleClick`, `onContextMenu`, `onToggleFavorite`, `onStartRename`, `onRenameCommit`).
- **Data flow**: `App` keeps `selectedIds`, `focusedIndex`, `renameState`, `favoriteIds`, thumbnails, and helper handlers (e.g., `toggleSelection`, `startRenameImage`, `commitRename`, `markThumbLoaded`), then passes them down.
- **Outcome**: Separates layout math from card UI, making each portion easier to reason about.

## 5. Tab Strip
- **Existing location**: The tab bar between the toolbar and the viewer, including scroll buttons, the Library tab, dynamic image tabs, and the action buttons (App lines ~3820-3960).
- **Responsibilities**: Show tabs, highlight the active one, provide close/duplicate controls, and expose cycle actions.
- **Component**: `TabStrip` with props for `tabs`, `activeTabId`, and callbacks (`onActivateTab`, `onCloseTab`, `onDuplicateTab`, `onCloseOthers`, `onCloseAll`, `onCycleTab`).
- **Outcome**: Keeps tab rendering isolated, so `App` only needs to manage tab state.

## 6. Collection Action Controls & Progress Overlays
- **Existing location**: The bottom of the sidebar—Add Folder/Remove Selected buttons, Ko-Fi link, and the popups rendered when indexing/removal is active.
- **Responsibilities**: Offer action buttons plus overlayed progress indicators with cancel controls.
- **Component idea**: `ActionPanel` or `SidebarProgressPanel` inside the sidebar.
- **Props**: `bridgeAvailable`, `isIndexing`, `cancelingIndex`, `folderProgress`, `imageProgress`, `removalCollectionProgress`, `removalImageProgress`, `removalCanceling`.
- **Callbacks**: `onAddFolder`, `onRemoveSelectedCollections`, `onCancelIndexing`, `onCancelRemoval`.
- **Benefit**: Keeps the progress overlay markup out of the collection list itself.

## 7. Bulk Rename Modal
- Already extracted into `BulkRenameModal`, showing the desired pattern: the modal owns focus trapping and keyboard shortcuts while `App` just provides props/callbacks.

## Next Steps
1. Pick one of the above areas (e.g., `CollectionSidebar`) and extract it, keeping the shared state in `App`.
2. Continue moving bridge/context-menu wiring into dedicated helpers/providers so `App` can focus on composition.
3. Iterate on the remaining areas (tabs, grid/cards, action panels) to shrink `App.tsx` and improve testability.