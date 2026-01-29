# Comfy Image Browser

Comfy Image Browser is a desktop image viewer and cataloger, with some special features for images generated using [ComfyUI](https://www.comfy.org/). Point it at your image folders, index ComfyUI PNG metadata into a local IndexedDB database, and browse everything in a fast, searchable grid with a tabbed viewer.

## Feature highlights

- Add folders (including subfolders) from the UI and rescan collections for new images.
- Icon grid with adjustable thumbnail size and keyboard navigation.
- Tabbed image viewer with easy tab management and keyboard shortcuts.
- Simple image and collection management, including rename for images and collections.
- Favourites virtual collection with star toggles, searchable like any collection easy favaourites management.
- Local thumbnail cache (`.thumbs`) for faster repeat browsing.
- Parse ComfyUI PNG metadata and search by filename, collection, or metadata fields.
- Easily add and remove images, collections or even folders full of collections.

## Local-only storage

All metadata lives in your local IndexedDB database. Images are never uploaded anywhere or leave your machine.

## Image processing note

This project intentionally avoids using `sharp` due to stability issues in Electron. Preview and thumbnail generation use Electron's `nativeImage` instead.

## Pre-built releases

Pre-built binaries are published on the GitHub Releases page for this repository. Download the version that matches your OS and run it directly.

## Keyboard Shortcuts
#### Tab management

- **Ctrl/Cmd + D**: Duplicate active tab.
- **Ctrl/Cmd + W**: Close active tab.
- **Ctrl/Cmd + Shift + W**: Close other tabs.
- **Ctrl/Cmd + Alt + W**: Close all tabs.
- **Ctrl + Tab / Ctrl + Shift + Tab**: Cycle tabs (next/previous).

#### Image and Collection Management
- **Ctrl/Cmd + B**: Toggle favourite for the active image or a single selected image.
- **Ctrl/Cmd + Alt + D**: Toggle DevTools.
- **F2**: Rename selected image.
- **Shift+F2**: Rename selected collection.
- **Ctrl/Cmd + A**: Select all images (Shift to select all collections).
- **Ctrl/Cmd + I**: Invert selection (Shift to invert collection selection).
- **Ctrl/Cmd + Backspace**: Clear selection (Shift to clear collection selection).

## Favourites

- Use the star toggle (★ / ☆) in the grid or image viewer to add or remove favourites.
- Adding a collection to favourites marks all images in that collection as favourites.
- The **Favourites** virtual collection is always visible and fully searchable.

## Development (Vite + Electron)
### (if you want to build it yourself or contribute code)

Install dependencies, then start the dev workflow:

```fish
npm install
npm run dev
```

## Production build

Build the renderer and Electron main process:

```fish
npm run build
```

Then launch Electron from the project root (uses the bundled `electron-dist` output):

```fish
npx electron .
```

## Tests

```fish
npm test
```

## Troubleshooting

- If the Electron window is blank on first run, stop and re-run `npm run dev` to rebuild the main process bundle.
- Ensure the app has filesystem access permissions on your OS.
```
