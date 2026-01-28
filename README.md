# Comfy Browser

Comfy Browser is a desktop catalog for ComfyUI images. Point it at your output folders, index PNG metadata into a local IndexedDB database, and browse everything in a fast, searchable grid with a tabbed viewer.

## Feature highlights

- Add folders (including subfolders) from the UI and rescan albums for new images.
- Parse ComfyUI PNG metadata and search by filename, album, or metadata fields.
- Virtualized icon grid with adjustable thumbnail size and keyboard navigation.
- Tabbed image viewer with duplication, close/close-others/close-all controls, and keyboard shortcuts.
- Local thumbnail cache (`.thumbs`) for faster repeat browsing.
- Non-destructive remove from index, plus optional delete-from-disk actions with confirmation.

## Local-only storage

All metadata lives in your local IndexedDB database. Images are never uploaded.

## Pre-built releases

Pre-built binaries are published on the GitHub Releases page for this repository. Download the version that matches your OS and run it directly.

## Development (Vite + Electron)

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
