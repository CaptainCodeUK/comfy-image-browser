# Comfy Browser

A desktop catalog for ComfyUI images. Add folders from disk, index PNG header metadata into a local IndexedDB database, and browse everything in a searchable icon grid.

## Features

- Add folders (including subfolders) from the UI.
- Index PNG metadata from ComfyUI into a local IndexedDB store.
- Search by filename, album, or metadata fields.
- Adjustable icon size and multi-select for opening images in tabs.
- Removing images only deletes them from the index, not from disk.

## Local-only Storage

All metadata is stored in your local IndexedDB database. Images are never uploaded.

## Development

Install dependencies, then run the dev script to start Vite + Electron.

```fish
npm install
npm run dev
```

## Tests

```fish
npm test
```

## Troubleshooting

- If the Electron window is blank on first run, stop and re-run `npm run dev` to rebuild the main process bundle.
- Ensure the app has filesystem access permissions on your OS.
```
