# Application Overview: Comfy Image Browser

## Purpose and Audience
Comfy Image Browser is a media-focused workspace that helps visual creators and researchers organize, inspect, and manage large numbers of images generated or collected across loosely structured folders. The app targets users who routinely index directories of art, AI-generated content, or photo shoots and need to treat those directories as curated collections with names, hierarchy, and contextual metadata. Its goal is to make navigating massive image libraries intuitive, keep related items grouped, and keep common workflows — browsing, tagging, moving, renaming, and cleaning — responsive even when tens of thousands of assets are involved.

## Conceptual Model
- **Collections** are named aggregations whose identity is derived from a folder root. Each collection can include nested subcollections implicitly created when folders exist inside parent root paths.
- **Images** live inside collections and carry metadata such as filename, file size, creation time, and any embedded descriptive data. The interface treats them as indexed entries that can be filtered, sorted, or opened in situ.
- **Tabs** let users keep multiple views open simultaneously, either landing on the generic "Collection" grid view or showing a specific image for detailed inspection.

## Key Features & Behaviors
1. **Collection Exploration:** The sidebar exposes the full tree of collections and their subcollections. Users can navigate the tree with keyboard and mouse, expand or collapse branches, and instantly jump to any collection’s images. Selection persists across operations so bulk actions can be applied to multiple collections at once.

2. **Dynamic Indexing:** A single “Add Folder” action scans one or more directories, creates new collection records for each root, and ingests the images inside. Incremental indexing keeps track of existing files so repeated scans only add new material, and a short-lived live index queue updates the main UI after each batch.

3. **Filtering & Search:** The main grid filters images based on the currently active collection or search query. Users can toggle whether subcollections should be included and can type free-form search text that matches filenames, metadata, or collection names. Sorting options let them order by name, size, or date.

4. **Image Management Actions:** Users can rename images individually or in bulk, move selected images to another folder while respecting conflicts, delete them from both the index and disk, and mark favorites. Each action provides progress feedback, conflict dialogs, and undo-friendly confirmations.

5. **Thumbnail Handling:** Image thumbnails are resolved lazily through background hydration. As soon as new images appear in the grid, a task queue converts their paths into preview URLs, updates the grid and open tabs, and caches relevant metadata so the UI stays responsive.

6. **Collection Actions:** Beyond indexing, the sidebar also exposes collection management such as renaming, flagging favorites, removing selections, and pruning magnetized folder indices. Removal runs through a worker that reports progress and can be cancelled mid-operation.

7. **Context Menus & Keyboard Shortcuts:** Common actions are available through right-click context menus and keyboard navigation, allowing users to activate bulk actions (e.g., select all, invert selection) or open the move/rename workflows without touching the mouse.

## Workflow Hints for Future Work
- When moving files, the UI yields periodically to keep the renderer responsive and disposes temporary buffers immediately, which is essential when handling thousands of files without running out of memory.
- Collection tree construction relies on relative folder containment; ensuring this tree stays accurate is critical because downstream views (search, selection, removal) assume every image references a collection ID that matches a node in this tree.

## How to Extend from Here
An agent joining the project can use this overview to understand where to plug in new capabilities — for example, tagging engines that assign keywords by writing to the image metadata store, or a new collection badge system that reads the collection tree to show nested status. Keeping the focus on folder/collection hierarchy, search/filter/reset flows, and background hydration tasks will maintain alignment with the core experience described here.
