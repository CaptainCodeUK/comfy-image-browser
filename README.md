# Comfy Image Browser

Comfy Image Browser is a desktop image viewer and cataloger, with some special features for images generated using [ComfyUI](https://www.comfy.org/). Point it at your image folders, index ComfyUI PNG metadata into a local IndexedDB database, and browse everything in a fast, searchable grid with a tabbed viewer.

## Feature highlights

- Add folders (including subfolders) from the UI and rescan albums for new images.
- Icon grid with adjustable thumbnail size and keyboard navigation.
- Tabbed image viewer with easy tab management and keyboard shortcuts.
- Simple image and album management, including rename for images and albums.
- Favourites virtual album with star toggles, searchable like any album easy favaourites management.
- Local thumbnail cache (`.thumbs`) for faster repeat browsing.
- Parse ComfyUI PNG metadata and search by filename, album, or metadata fields.
- Easily add and remove images, albums or even folders full of albums.

## Local-only storage

All metadata lives in your local IndexedDB database. Images are never uploaded anywhere or leave your machine.

## Pre-built releases

Pre-built binaries are published on the GitHub Releases page for this repository. Download the version that matches your OS and run it directly.

## Keyboard Shortcuts
#### Tab management

- **Ctrl/Cmd + D**: Duplicate active tab.
- **Ctrl/Cmd + W**: Close active tab.
- **Ctrl/Cmd + Shift + W**: Close other tabs.
- **Ctrl/Cmd + Alt + W**: Close all tabs.
- **Ctrl + Tab / Ctrl + Shift + Tab**: Cycle tabs (next/previous).

#### Image and Album Management
- **Ctrl/Cmd + B**: Toggle favourite for the active image or a single selected image.
- **F2**: Rename selected image.
- **Shift+F2**: Rename selected album.
- **Ctrl/Cmd + A**: Select all images (Shift to select all albums).
- **Ctrl/Cmd + I**: Invert selection (Shift to invert album selection).
- **Ctrl/Cmd + Backspace**: Clear selection (Shift to clear album selection).

## Favourites

- Use the star toggle (★ / ☆) in the grid or image viewer to add or remove favourites.
- Adding an album to favourites marks all images in that album as favourites.
- The **Favourites** virtual album is always visible and fully searchable.

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
