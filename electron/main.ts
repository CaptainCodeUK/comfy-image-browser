import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { parsePngMetadata, readPngDimensions, type ParsedPngMetadata } from "../src/lib/pngMetadata";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const COMFY_PROTOCOL = "comfy";
const WINDOW_STATE_FILE = "window-state.json";
const APP_NAME = "comfy-browser";
const THUMBNAIL_DIR = ".thumbs";
const THUMBNAIL_SIZE = 320;
const THUMBNAIL_QUEUE_DELAY_MS = 10;

const thumbnailQueue: string[] = [];
const thumbnailInFlight = new Set<string>();
let thumbnailQueueRunning = false;
const indexingCancels = new Map<number, { cancelled: boolean }>();

app.setName(APP_NAME);
app.setAppUserModelId(APP_NAME);

protocol.registerSchemesAsPrivileged([
  {
    scheme: COMFY_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

type IndexedImagePayload = {
  filePath: string;
  fileName: string;
  albumRoot: string;
  sizeBytes: number;
  createdAt: string;
  width?: number;
  height?: number;
  metadataText: Record<string, string> | null;
  metadataJson: Record<string, unknown> | null;
};

type WindowState = {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized?: boolean;
};

const readWindowState = async (): Promise<WindowState | null> => {
  try {
    const statePath = path.join(app.getPath("userData"), WINDOW_STATE_FILE);
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as WindowState;
    if (parsed.width && parsed.height) {
      return parsed;
    }
  } catch {
    // ignore missing or invalid state
  }
  return null;
};

const persistWindowState = async (window: BrowserWindow) => {
  const bounds = window.isMaximized() || window.isMinimized() ? window.getNormalBounds() : window.getBounds();
  const statePath = path.join(app.getPath("userData"), WINDOW_STATE_FILE);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const payload: WindowState = {
    ...bounds,
    isMaximized: window.isMaximized(),
  };
  await fs.writeFile(statePath, JSON.stringify(payload, null, 2));
};

const createWindow = async () => {
  const previousState = await readWindowState();
  const mainWindow = new BrowserWindow({
    width: previousState?.width ?? 1400,
    height: previousState?.height ?? 900,
    x: previousState?.x,
    y: previousState?.y,
    backgroundColor: "#0b1220",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (previousState?.isMaximized) {
    mainWindow.maximize();
  }

  let saveTimeout: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      void persistWindowState(mainWindow);
    }, 300);
  };

  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);
  mainWindow.on("close", () => {
    void persistWindowState(mainWindow);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // mainWindow.webContents.openDevTools({ mode: "right" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
};

const sendMenuAction = (action: string) => {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (target) {
    target.webContents.send("comfy:menu-action", action);
  }
};

const updateMenuItemEnabled = (id: string, enabled: boolean) => {
  const menu = Menu.getApplicationMenu();
  const item = menu?.getMenuItemById(id);
  if (item) {
    item.enabled = enabled;
  }
};

const buildAppMenu = () => {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push({
    label: "File",
    submenu: [
      {
        label: "Add Folder…",
        accelerator: "CmdOrCtrl+O",
        click: () => sendMenuAction("add-folder"),
      },
      { type: "separator" },
      process.platform === "darwin" ? { role: "close" } : { role: "quit" },
    ],
  });

  template.push({
    label: "Album",
    submenu: [
      {
        id: "menu-reveal-active-album",
        label: "Reveal Active Album in File Manager",
        enabled: false,
        click: () => sendMenuAction("reveal-active-album"),
      },
      {
        id: "menu-rename-selected-album",
        label: "Rename Selected Album…",
        enabled: false,
        click: () => sendMenuAction("rename-selected-album"),
      },
      {
        id: "menu-rescan-selected-albums",
        label: "Rescan Selected Albums",
        enabled: false,
        click: () => sendMenuAction("rescan-selected-albums"),
      },
      { type: "separator" },
      {
        id: "menu-remove-selected-albums",
        label: "Remove Selected Albums from Index…",
        enabled: false,
        click: () => sendMenuAction("remove-selected-albums"),
      },
      {
        id: "menu-delete-selected-albums-disk",
        label: "Delete Selected Albums from Disk…",
        enabled: false,
        click: () => sendMenuAction("delete-selected-albums-disk"),
      },
      { type: "separator" },
      {
        id: "menu-select-all-albums",
        label: "Select All Albums",
        enabled: false,
        accelerator: "CmdOrCtrl+Shift+A",
        click: () => sendMenuAction("select-all-albums"),
      },
      {
        id: "menu-invert-album-selection",
        label: "Invert Album Selection",
        enabled: false,
        accelerator: "CmdOrCtrl+Shift+I",
        click: () => sendMenuAction("invert-album-selection"),
      },
      {
        id: "menu-clear-album-selection",
        label: "Clear Album Selection",
        enabled: false,
        accelerator: "CmdOrCtrl+Shift+Backspace",
        click: () => sendMenuAction("clear-album-selection"),
      },
    ],
  });

  template.push({
    label: "Image",
    submenu: [
      {
        id: "menu-reveal-active-image",
        label: "Reveal Active Image in File Manager",
        enabled: false,
        click: () => sendMenuAction("reveal-active-image"),
      },
      {
        id: "menu-edit-active-image",
        label: "Edit Active Image in Default App",
        enabled: false,
        click: () => sendMenuAction("edit-active-image"),
      },
      {
        id: "menu-rename-selected-image",
        label: "Rename Selected Image…",
        enabled: false,
        click: () => sendMenuAction("rename-selected-image"),
      },
      { type: "separator" },
      {
        id: "menu-remove-selected-images",
        label: "Remove Selected Images from Index…",
        enabled: false,
        click: () => sendMenuAction("remove-selected-images"),
      },
      {
        id: "menu-delete-selected-images-disk",
        label: "Delete Selected Images from Disk…",
        enabled: false,
        click: () => sendMenuAction("delete-selected-images-disk"),
      },
      { type: "separator" },
      {
        id: "menu-select-all-images",
        label: "Select All Images",
        enabled: false,
        accelerator: "CmdOrCtrl+A",
        click: () => sendMenuAction("select-all-images"),
      },
      {
        id: "menu-invert-image-selection",
        label: "Invert Image Selection",
        enabled: false,
        accelerator: "CmdOrCtrl+I",
        click: () => sendMenuAction("invert-image-selection"),
      },
      {
        id: "menu-clear-image-selection",
        label: "Clear Image Selection",
        enabled: false,
        accelerator: "CmdOrCtrl+Backspace",
        click: () => sendMenuAction("clear-image-selection"),
      },
    ],
  });

  template.push({
    label: "Tab",
    submenu: [
      {
        label: "Next Tab",
        accelerator: "Ctrl+Tab",
        click: () => sendMenuAction("tab-next"),
      },
      {
        label: "Previous Tab",
        accelerator: "Ctrl+Shift+Tab",
        click: () => sendMenuAction("tab-prev"),
      },
      { type: "separator" },
      {
        label: "Duplicate Tab",
        accelerator: "CmdOrCtrl+D",
        click: () => sendMenuAction("tab-duplicate"),
      },
      {
        label: "Close Tab",
        accelerator: "CmdOrCtrl+W",
        click: () => sendMenuAction("tab-close"),
      },
      {
        label: "Close Other Tabs",
        accelerator: "CmdOrCtrl+Shift+W",
        click: () => sendMenuAction("tab-close-others"),
      },
      {
        label: "Close All Tabs",
        accelerator: "CmdOrCtrl+Alt+W",
        click: () => sendMenuAction("tab-close-all"),
      },
    ],
  });

//   template.push({
//     label: "Dev",
//     submenu: [
//       { role: "reload" },
//       { role: "forceReload" },
//       { role: "toggleDevTools" },
//       { type: "separator" },
//       { role: "resetZoom" },
//       { role: "zoomIn" },
//       { role: "zoomOut" },
//       { type: "separator" },
//       { role: "togglefullscreen" },
//     ],
//   });

//   template.push({
//     label: "Window",
//     submenu: [{ role: "minimize" }, { role: "close" }],
//   });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

const applyContentSecurityPolicy = () => {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const isDev = Boolean(devServerUrl);
  const csp = [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-eval' 'unsafe-inline'" : ""}${devServerUrl ? ` ${devServerUrl}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: file: comfy:",
    `connect-src 'self'${devServerUrl ? ` ${devServerUrl} ws://localhost:5173` : ""}`,
    "font-src 'self' data:",
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
};

app.whenReady().then(async () => {
  if (process.env.VITE_DEV_SERVER_URL) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  }
  protocol.registerFileProtocol(COMFY_PROTOCOL, (request, callback) => {
    try {
      const url = new URL(request.url);
      const encodedPath = url.searchParams.get("path");
      if (!encodedPath) {
        callback({ error: -6 });
        return;
      }
      const decodedPath = decodeURIComponent(encodedPath);
      callback({ path: decodedPath });
    } catch {
      callback({ error: -6 });
    }
  });
  applyContentSecurityPolicy();
  await createWindow();
  buildAppMenu();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const collectImageFiles = async (rootPath: string) => {
  const results: string[] = [];
  const stack = [rootPath];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(resolved);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          results.push(resolved);
        }
      }
    }
  }

  return results;
};

const scanFolderTree = async (rootPath: string, existingFiles: Set<string>) => {
  const folders: string[] = [rootPath];
  const files: string[] = [];
  const stack = [rootPath];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === THUMBNAIL_DIR) {
        continue;
      }
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        folders.push(resolved);
        stack.push(resolved);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext) && !existingFiles.has(resolved)) {
          files.push(resolved);
        }
      }
    }
  }

  return { folders, files };
};

const buildImagePayload = async (filePath: string, albumRoot: string): Promise<IndexedImagePayload> => {
  const stats = await fs.stat(filePath);
  const fileName = path.basename(filePath);
  const payload: IndexedImagePayload = {
    filePath,
    fileName,
    albumRoot,
    sizeBytes: stats.size,
    createdAt: stats.birthtime.toISOString(),
    metadataText: null,
    metadataJson: null,
  };

  if (path.extname(filePath).toLowerCase() === ".png") {
    const buffer = await fs.readFile(filePath);
    const dimensions = readPngDimensions(buffer);
    payload.width = dimensions?.width;
    payload.height = dimensions?.height;
    const metadata = parsePngMetadata(buffer);
    payload.metadataText = Object.keys(metadata.textChunks).length ? metadata.textChunks : null;
    payload.metadataJson = Object.keys(metadata.jsonChunks).length ? metadata.jsonChunks : null;
  }

  return payload;
};

ipcMain.handle("comfy:select-folders", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "multiSelections"],
  });

  if (result.canceled) {
    return [] as string[];
  }

  return result.filePaths;
});

ipcMain.handle(
  "comfy:index-folders",
  async (_event: IpcMainInvokeEvent, rootPaths: string[], existingPaths: string[] = []) => {
    const existingFiles = new Set(existingPaths);
  const cancelToken = { cancelled: false };
  indexingCancels.set(_event.sender.id, cancelToken);
  const albums: Array<{ rootPath: string; images: IndexedImagePayload[] }> = [];
    const scans = await Promise.all(rootPaths.map((rootPath) => scanFolderTree(rootPath, existingFiles)));
  const albumFolders: Array<{ rootPath: string; folderPath: string; files: string[] }> = [];

    for (let i = 0; i < rootPaths.length; i += 1) {
      const rootPath = rootPaths[i];
      const files = scans[i].files;
      const folderMap = new Map<string, string[]>();

      for (const filePath of files) {
        const folder = path.dirname(filePath);
        const existing = folderMap.get(folder);
        if (existing) {
          existing.push(filePath);
        } else {
          folderMap.set(folder, [filePath]);
        }
      }

      for (const [folderPath, folderFiles] of folderMap.entries()) {
        if (!folderFiles.length) continue;
        albumFolders.push({ rootPath: folderPath, folderPath, files: folderFiles });
      }
    }

    const totalImages = albumFolders.reduce((sum, album) => sum + album.files.length, 0);
    let folderIndex = 0;
    let imageIndex = 0;

    for (const albumFolder of albumFolders) {
      if (cancelToken.cancelled) {
        _event.sender.send("comfy:indexing-complete");
        indexingCancels.delete(_event.sender.id);
        return [];
      }
      folderIndex += 1;
      _event.sender.send("comfy:indexing-folder", {
        current: folderIndex,
        total: albumFolders.length,
        folder: albumFolder.folderPath,
      });

      const images: IndexedImagePayload[] = [];
      for (const filePath of albumFolder.files) {
        if (cancelToken.cancelled) {
          _event.sender.send("comfy:indexing-complete");
          indexingCancels.delete(_event.sender.id);
          return [];
        }
        imageIndex += 1;
        _event.sender.send("comfy:indexing-image", {
          current: imageIndex,
          total: totalImages,
          fileName: path.basename(filePath),
        });
        images.push(await buildImagePayload(filePath, albumFolder.rootPath));
      }

      albums.push({ rootPath: albumFolder.rootPath, images });
    }

    _event.sender.send("comfy:indexing-complete");
    indexingCancels.delete(_event.sender.id);
    return albums;
  }
);

ipcMain.handle("comfy:cancel-indexing", (event) => {
  const token = indexingCancels.get(event.sender.id);
  if (token) {
    token.cancelled = true;
  }
});

ipcMain.handle("comfy:to-file-url", async (_event: IpcMainInvokeEvent, filePath: string) => {
  return `${COMFY_PROTOCOL}://local?path=${encodeURIComponent(filePath)}`;
});

const getThumbnailPath = async (filePath: string) => {
  const directory = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const thumbDir = path.join(directory, THUMBNAIL_DIR);
  const thumbPath = path.join(thumbDir, fileName);
  await fs.mkdir(thumbDir, { recursive: true });
  return thumbPath;
};

const getCachedThumbnail = async (filePath: string) => {
  const thumbPath = await getThumbnailPath(filePath);
  try {
    await fs.access(thumbPath);
    return thumbPath;
  } catch {
    return null;
  }
};

const ensureThumbnail = async (filePath: string) => {
  const cached = await getCachedThumbnail(filePath);
  if (cached) return cached;
  const thumbPath = await getThumbnailPath(filePath);
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    throw new Error(`Failed to load image for thumbnail: ${filePath}`);
  }
  const resized = image.resize({ width: THUMBNAIL_SIZE });
  await fs.writeFile(thumbPath, resized.toPNG());
  return thumbPath;
};

const enqueueThumbnail = (filePath: string) => {
  if (thumbnailInFlight.has(filePath) || thumbnailQueue.includes(filePath)) return;
  thumbnailQueue.push(filePath);
  void processThumbnailQueue();
};

const processThumbnailQueue = async () => {
  if (thumbnailQueueRunning) return;
  thumbnailQueueRunning = true;

  while (thumbnailQueue.length > 0) {
    const filePath = thumbnailQueue.shift();
    if (!filePath) break;
    if (thumbnailInFlight.has(filePath)) continue;

    thumbnailInFlight.add(filePath);
    try {
      await ensureThumbnail(filePath);
    } catch {
      // ignore thumbnail generation failures
    } finally {
      thumbnailInFlight.delete(filePath);
    }

    await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_QUEUE_DELAY_MS));
  }

  thumbnailQueueRunning = false;
};

ipcMain.handle("comfy:get-thumbnail", async (_event: IpcMainInvokeEvent, filePath: string) => {
  const cached = await getCachedThumbnail(filePath);
  if (cached) {
    return `${COMFY_PROTOCOL}://local?path=${encodeURIComponent(cached)}`;
  }

  enqueueThumbnail(filePath);
  return null;
});

ipcMain.handle("comfy:reveal-in-folder", async (_event: IpcMainInvokeEvent, filePath: string) => {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await shell.openPath(filePath);
      return;
    }
  } catch {
    // fall back to reveal attempt
  }
  shell.showItemInFolder(filePath);
});

ipcMain.handle("comfy:open-in-editor", async (_event: IpcMainInvokeEvent, filePath: string) => {
  await shell.openPath(filePath);
});

ipcMain.handle(
  "comfy:rename-path",
  async (
    _event: IpcMainInvokeEvent,
    payload: { oldPath: string; newPath: string; kind: "file" | "folder" }
  ) => {
    if (!payload?.oldPath || !payload?.newPath) {
      return { success: false, message: "Missing path" };
    }
    try {
      await fs.access(payload.oldPath);
    } catch {
      return { success: false, message: "Source path does not exist" };
    }
    try {
      await fs.access(payload.newPath);
      return { success: false, message: "Target already exists" };
    } catch {
      // target does not exist
    }

    await fs.rename(payload.oldPath, payload.newPath);

    if (payload.kind === "file") {
      const oldFolder = path.dirname(payload.oldPath);
      const newFolder = path.dirname(payload.newPath);
      const oldThumb = path.join(oldFolder, THUMBNAIL_DIR, path.basename(payload.oldPath));
      const newThumb = path.join(newFolder, THUMBNAIL_DIR, path.basename(payload.newPath));
      try {
        await fs.rename(oldThumb, newThumb);
      } catch {
        // ignore missing thumbnail
      }
    }

    return { success: true };
  }
);

ipcMain.handle("comfy:find-missing-files", async (_event: IpcMainInvokeEvent, filePaths: string[]) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return [] as string[];
  }
  const checks = await Promise.allSettled(filePaths.map((filePath) => fs.access(filePath)));
  return filePaths.filter((_path, index) => checks[index].status === "rejected");
});

ipcMain.on(
  "comfy:update-menu-state",
  (
    _event,
    state: {
      hasActiveImage: boolean;
      hasActiveAlbum: boolean;
      hasSelectedImages: boolean;
      hasSelectedAlbums: boolean;
      hasSingleSelectedImage: boolean;
      hasSingleSelectedAlbum: boolean;
      hasImages: boolean;
      hasAlbums: boolean;
    }
  ) => {
    updateMenuItemEnabled("menu-reveal-active-image", state.hasActiveImage);
    updateMenuItemEnabled("menu-edit-active-image", state.hasActiveImage);
    updateMenuItemEnabled("menu-reveal-active-album", state.hasActiveAlbum);
  updateMenuItemEnabled("menu-rename-selected-image", state.hasSingleSelectedImage);
  updateMenuItemEnabled("menu-rename-selected-album", state.hasSingleSelectedAlbum);
    updateMenuItemEnabled("menu-remove-selected-images", state.hasSelectedImages);
    updateMenuItemEnabled("menu-delete-selected-images-disk", state.hasSelectedImages);
    updateMenuItemEnabled("menu-remove-selected-albums", state.hasSelectedAlbums);
    updateMenuItemEnabled("menu-delete-selected-albums-disk", state.hasSelectedAlbums);
    updateMenuItemEnabled("menu-rescan-selected-albums", state.hasSelectedAlbums);
    updateMenuItemEnabled("menu-select-all-images", state.hasImages);
    updateMenuItemEnabled("menu-invert-image-selection", state.hasImages);
    updateMenuItemEnabled("menu-clear-image-selection", state.hasSelectedImages);
    updateMenuItemEnabled("menu-select-all-albums", state.hasAlbums);
    updateMenuItemEnabled("menu-invert-album-selection", state.hasAlbums);
    updateMenuItemEnabled("menu-clear-album-selection", state.hasSelectedAlbums);
  }
);

ipcMain.handle(
  "comfy:delete-files-from-disk",
  async (
    event: IpcMainInvokeEvent,
    payload: { paths: string[]; label: string; detail?: string }
  ) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const target = window ?? BrowserWindow.getAllWindows()[0];
    const message = `Delete ${payload.label} from disk?`;
    const detail = payload.detail ?? "This will permanently delete the file(s) from disk.";
    const result = await dialog.showMessageBox(target, {
      type: "warning",
      buttons: ["Delete", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message,
      detail,
    });

    if (result.response !== 0) {
      return { deletedPaths: [], canceled: true };
    }

    const deletions = await Promise.allSettled(payload.paths.map((filePath) => fs.unlink(filePath)));
    const deletedPaths = payload.paths.filter((_path, index) => deletions[index].status === "fulfilled");

    const deletedFolders = new Set<string>();
    const thumbDeletions = await Promise.allSettled(
      deletedPaths.map(async (filePath) => {
        const folder = path.dirname(filePath);
        deletedFolders.add(folder);
        const thumbPath = path.join(folder, THUMBNAIL_DIR, path.basename(filePath));
        try {
          await fs.unlink(thumbPath);
        } catch {
          // ignore missing thumbnails
        }
      })
    );

    void thumbDeletions;

    const tryRemoveIfEmpty = async (dirPath: string) => {
      try {
        const entries = await fs.readdir(dirPath);
        if (entries.length === 0) {
          await fs.rmdir(dirPath);
          return true;
        }
      } catch {
        // ignore missing directories or permission issues
      }
      return false;
    };

    await Promise.all(
      Array.from(deletedFolders).map(async (folder) => {
        const thumbsDir = path.join(folder, THUMBNAIL_DIR);
        await tryRemoveIfEmpty(thumbsDir);
        await tryRemoveIfEmpty(folder);
      })
    );
    return { deletedPaths, canceled: false };
  }
);

ipcMain.handle(
  "comfy:show-context-menu",
  async (
    event: IpcMainInvokeEvent,
    payload:
      | { type: "image"; imageId: string; label: string; selectedCount: number; isSelected: boolean }
      | { type: "album"; albumId: string; label: string; selectedCount: number; isSelected: boolean }
  ) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    return new Promise<string | null>((resolve) => {
      let resolved = false;
      const finish = (value: string | null) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };

      const items: Electron.MenuItemConstructorOptions[] = [];

      if (payload.type === "image") {
        items.push({
          label: "Reveal in File Manager",
          click: () => finish("reveal-image"),
        });
        items.push({
          label: "Edit in Default App",
          click: () => finish("edit-image"),
        });
        if (payload.selectedCount <= 1) {
          items.push({
            label: "Rename Image…",
            click: () => finish("rename-image"),
          });
        }
        if (payload.selectedCount >= 1) {
          items.push({
            label: `Remove Selected Images from Index${payload.selectedCount > 1 ? ` (${payload.selectedCount})` : ""}…`,
            click: () => finish("remove-selected-images"),
          });
          items.push({
            label: `Delete Selected Images${payload.selectedCount > 1 ? ` (${payload.selectedCount})` : ""} from Disk…`,
            click: () => finish("delete-selected-images-disk"),
          });
        }
        items.push({ type: "separator" });
        items.push({
          label: "Select All Images",
          click: () => finish("select-all-images"),
        });
        items.push({
          label: "Invert Image Selection",
          click: () => finish("invert-image-selection"),
        });
        items.push({
          label: "Clear Image Selection",
          click: () => finish("clear-image-selection"),
        });
      }

      if (payload.type === "album") {
        items.push({
          label: "Reveal in File Manager",
          click: () => finish("reveal-album"),
        });
        items.push({
          label: "Rescan Album",
          click: () => finish("rescan-album"),
        });
        if (payload.selectedCount <= 1) {
          items.push({
            label: "Rename Album…",
            click: () => finish("rename-album"),
          });
        }
        if (payload.selectedCount >= 1) {
          items.push({
            label: `Remove Selected Albums from Index${payload.selectedCount > 1 ? ` (${payload.selectedCount})` : ""}…`,
            click: () => finish("remove-selected-albums"),
          });
          items.push({
            label: `Delete Selected Albums${payload.selectedCount > 1 ? ` (${payload.selectedCount})` : ""} from Disk…`,
            click: () => finish("delete-selected-albums-disk"),
          });
        }
        items.push({ type: "separator" });
        items.push({
          label: "Select All Albums",
          click: () => finish("select-all-albums"),
        });
        items.push({
          label: "Invert Album Selection",
          click: () => finish("invert-album-selection"),
        });
        items.push({
          label: "Clear Album Selection",
          click: () => finish("clear-album-selection"),
        });
      }

      if (items.length === 0) {
        finish(null);
        return;
      }

      const menu = Menu.buildFromTemplate(items);
      menu.popup({
        window,
        callback: () => finish(null),
      });
    });
  }
);
