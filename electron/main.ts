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
import { Worker } from "node:worker_threads";
import { parsePngMetadata, readPngDimensions, type ParsedPngMetadata } from "../src/lib/pngMetadata";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".dib"]);

const COMFY_PROTOCOL = "comfy";
const WINDOW_STATE_FILE = "window-state.json";
const APP_NAME = "comfy-browser";
const APP_DISPLAY_NAME = "Comfy Image Browser";
const THUMBNAIL_DIR = ".thumbs";
const THUMBNAIL_SIZE = 320;
const PREVIEW_MAX_SIZE = 1600;
const THUMBNAIL_QUEUE_DELAY_MS = 10;

const thumbnailQueue: string[] = [];
const thumbnailInFlight = new Set<string>();
let thumbnailQueueRunning = false;
const indexingCancels = new Map<number, { cancelled: boolean; worker?: Worker }>();
const menuLocks = {
    isIndexing: false,
    isRemoving: false,
    isDeleting: false,
};

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
    collectionRoot: string;
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
    try {
        if (window.isDestroyed() || window.webContents.isDestroyed()) return;
        const bounds = window.isMaximized() || window.isMinimized() ? window.getNormalBounds() : window.getBounds();
        const statePath = path.join(app.getPath("userData"), WINDOW_STATE_FILE);
        await fs.mkdir(path.dirname(statePath), { recursive: true });
        const payload: WindowState = {
            ...bounds,
            isMaximized: window.isMaximized(),
        };
        await fs.writeFile(statePath, JSON.stringify(payload, null, 2));
    } catch (error) {
        if (error instanceof Error && error.message.includes("Object has been destroyed")) {
            return;
        }
        console.warn("[comfy-browser] failed to persist window state", error);
    }
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
            if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
                void persistWindowState(mainWindow);
            }
        }, 300);
    };

    mainWindow.on("resize", scheduleSave);
    mainWindow.on("move", scheduleSave);
    mainWindow.on("close", () => {
        if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
            void persistWindowState(mainWindow);
        }
    });

    mainWindow.on("closed", () => {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools({ mode: "right" });
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
                id: "menu-add-folder",
                label: "Add Folder…",
                accelerator: "CmdOrCtrl+O",
                click: () => sendMenuAction("add-folder"),
            },
            { type: "separator" },
            process.platform === "darwin" ? { role: "close" } : { role: "quit" },
        ],
    });

    template.push({
        label: "Collection",
        submenu: [
            {
                id: "menu-reveal-active-collection",
                label: "Reveal Active Collection in File Manager",
                enabled: false,
                click: () => sendMenuAction("reveal-active-collection"),
            },
            {
                id: "menu-rename-selected-collection",
                label: "Rename Selected Collection…",
                enabled: false,
                click: () => sendMenuAction("rename-selected-collection"),
            },
            {
                id: "menu-add-selected-collections-favorites",
                label: "Add Selected Collections to Favourites",
                enabled: false,
                click: () => sendMenuAction("add-selected-collections-favorites"),
            },
            {
                id: "menu-remove-selected-collections-favorites",
                label: "Remove Selected Collections from Favourites",
                enabled: false,
                click: () => sendMenuAction("remove-selected-collections-favorites"),
            },
            {
                id: "menu-rescan-selected-collections",
                label: "Rescan Selected Collections",
                enabled: false,
                click: () => sendMenuAction("rescan-selected-collections"),
            },
            { type: "separator" },
            {
                id: "menu-remove-selected-collections",
                label: "Remove Selected Collections from Index…",
                enabled: false,
                click: () => sendMenuAction("remove-selected-collections"),
            },
            {
                id: "menu-delete-selected-collections-disk",
                label: "Delete Selected Collections from Disk…",
                enabled: false,
                click: () => sendMenuAction("delete-selected-collections-disk"),
            },
            { type: "separator" },
            {
                id: "menu-select-all-collections",
                label: "Select All Collections",
                enabled: false,
                accelerator: "CmdOrCtrl+Shift+A",
                click: () => sendMenuAction("select-all-collections"),
            },
            {
                id: "menu-invert-collection-selection",
                label: "Invert Collection Selection",
                enabled: false,
                accelerator: "CmdOrCtrl+Shift+I",
                click: () => sendMenuAction("invert-collection-selection"),
            },
            {
                id: "menu-clear-collection-selection",
                label: "Clear Collection Selection",
                enabled: false,
                accelerator: "CmdOrCtrl+Shift+Backspace",
                click: () => sendMenuAction("clear-collection-selection"),
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
            {
                id: "menu-add-selected-images-favorites",
                label: "Add Selected Images to Favourites",
                enabled: false,
                click: () => sendMenuAction("add-selected-images-favorites"),
            },
            {
                id: "menu-remove-selected-images-favorites",
                label: "Remove Selected Images from Favourites",
                enabled: false,
                click: () => sendMenuAction("remove-selected-images-favorites"),
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

    template.push({
        label: "Help",
        submenu: [
            {
                label: "About Comfy Image Browser",
                accelerator: "F1",
                click: () => sendMenuAction("show-about"),
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
            const rawPath = url.searchParams.get("path") ?? (url.pathname && url.pathname !== "/" ? url.pathname : "");
            if (!rawPath) {
                callback({ error: -6 });
                return;
            }
            let decodedPath = rawPath;
            try {
                decodedPath = decodeURIComponent(rawPath);
            } catch {
                decodedPath = rawPath;
            }
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

const buildImagePayload = async (filePath: string, collectionRoot: string): Promise<IndexedImagePayload> => {
    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const payload: IndexedImagePayload = {
        filePath,
        fileName,
    collectionRoot,
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
    async (
        _event: IpcMainInvokeEvent,
        rootPaths: string[],
        existingPaths: string[] = [],
        options: { returnPayload?: boolean } = {}
    ) => {
        const cancelToken = { cancelled: false, worker: undefined as Worker | undefined };
        indexingCancels.set(_event.sender.id, cancelToken);
        const worker = new Worker(path.join(__dirname, "indexingWorker.js"));
        cancelToken.worker = worker;
        const returnPayload = options.returnPayload ?? true;

        return await new Promise<Array<{ rootPath: string; images: IndexedImagePayload[] }>>((resolve) => {
            const collections: Array<{ rootPath: string; images: IndexedImagePayload[] }> = [];
            const cleanup = () => {
                worker.removeAllListeners();
                worker.terminate();
                indexingCancels.delete(_event.sender.id);
            };

            const sendComplete = () => {
                _event.sender.send("comfy:indexing-complete");
            };

            worker.on("message", (message: any) => {
                if (!message || typeof message !== "object" || !message.type) return;
                if (message.type === "progress-folder") {
                    _event.sender.send("comfy:indexing-folder", {
                        current: message.current,
                        total: message.total,
                        folder: message.folder,
                    });
                    return;
                }
                if (message.type === "progress-image") {
                    _event.sender.send("comfy:indexing-image", {
                        current: message.current,
                        total: message.total,
                        fileName: message.fileName,
                    });
                    return;
                }
                if (message.type === "collection") {
                    _event.sender.send("comfy:indexing-collection", {
                        rootPath: message.rootPath,
                        images: message.images,
                    });
                    collections.push({ rootPath: message.rootPath, images: message.images });
                    return;
                }
                if (message.type === "cancelled") {
                    sendComplete();
                    cleanup();
                    resolve(message.collections ?? collections);
                    return;
                }
                if (message.type === "done") {
                    sendComplete();
                    cleanup();
                    resolve(message.collections ?? collections);
                    return;
                }
                if (message.type === "error") {
                    console.error("[comfy-browser] indexing worker error", message.message);
                    sendComplete();
                    cleanup();
                    resolve([]);
                }
            });

            worker.on("error", (error) => {
                console.error("[comfy-browser] indexing worker crashed", error);
                sendComplete();
                cleanup();
                resolve([]);
            });

            worker.on("exit", (code) => {
                if (code !== 0) {
                    console.error("[comfy-browser] indexing worker exited", code);
                }
            });

            worker.postMessage({ type: "start", rootPaths, existingPaths, returnPayload });
        });
    }
);

ipcMain.handle("comfy:cancel-indexing", (event) => {
    const token = indexingCancels.get(event.sender.id);
    if (token) {
        token.cancelled = true;
        token.worker?.postMessage({ type: "cancel" });
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

const getPreviewPath = async (filePath: string) => {
    const directory = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const thumbDir = path.join(directory, THUMBNAIL_DIR);
    const previewName = `${fileName}.preview.jpg`;
    const previewPath = path.join(thumbDir, previewName);
    await fs.mkdir(thumbDir, { recursive: true });
    return previewPath;
};

const getCachedPreview = async (filePath: string) => {
    const previewPath = await getPreviewPath(filePath);
    try {
        await fs.access(previewPath);
        return previewPath;
    } catch {
        return null;
    }
};

const ensurePreview = async (filePath: string) => {
    const cached = await getCachedPreview(filePath);
    if (cached) return cached;
    const previewPath = await getPreviewPath(filePath);
    try {
        const image = nativeImage.createFromPath(filePath);
        if (image.isEmpty()) {
            return null;
        }
        const resized = image.resize({
            width: PREVIEW_MAX_SIZE,
            height: PREVIEW_MAX_SIZE,
            quality: "good",
        });
        await fs.writeFile(previewPath, resized.toJPEG(82));
        return previewPath;
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

ipcMain.handle("comfy:get-preview", async (_event: IpcMainInvokeEvent, filePath: string) => {
    const cached = await getCachedPreview(filePath);
    if (cached) {
        return `${COMFY_PROTOCOL}://local?path=${encodeURIComponent(cached)}`;
    }
    const preview = await ensurePreview(filePath);
    if (preview) {
        return `${COMFY_PROTOCOL}://local?path=${encodeURIComponent(preview)}`;
    }
    return null;
});

ipcMain.handle(
    "comfy:get-cached-thumbnails",
    async (
        _event: IpcMainInvokeEvent,
        payload: Array<{ id: string; filePath: string }>
    ) => {
        if (!Array.isArray(payload) || payload.length === 0) return [];
        const results = await Promise.all(
            payload.map(async (item) => {
                if (!item?.filePath || !item?.id) {
                    return { id: item?.id ?? "", url: null };
                }
                try {
                    const cached = await getCachedThumbnail(item.filePath);
                    return cached
                        ? {
                              id: item.id,
                              url: `${COMFY_PROTOCOL}://local?path=${encodeURIComponent(cached)}`,
                          }
                        : { id: item.id, url: null };
                } catch {
                    return { id: item.id, url: null };
                }
            })
        );
        return results;
    }
);

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

ipcMain.handle("comfy:get-app-info", () => {
    return {
        name: APP_DISPLAY_NAME,
        version: app.getVersion(),
    };
});

ipcMain.handle("comfy:open-external", async (_event: IpcMainInvokeEvent, url: string) => {
    if (!url) return false;
    try {
        await shell.openExternal(url);
        return true;
    } catch {
        return false;
    }
});

ipcMain.handle("comfy:toggle-devtools", () => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!target) return false;
    target.webContents.toggleDevTools();
    return true;
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
            hasActiveCollection: boolean;
            hasSelectedImages: boolean;
            hasSelectedCollections: boolean;
            hasSingleSelectedImage: boolean;
            hasSingleSelectedCollection: boolean;
            hasImages: boolean;
            hasCollections: boolean;
            isIndexing: boolean;
            isRemoving: boolean;
            isDeleting: boolean;
        }
    ) => {
        menuLocks.isIndexing = state.isIndexing;
        menuLocks.isRemoving = state.isRemoving;
        menuLocks.isDeleting = state.isDeleting;
        const removalLocked = menuLocks.isRemoving || menuLocks.isDeleting;

        updateMenuItemEnabled("menu-add-folder", !state.isIndexing);
        updateMenuItemEnabled("menu-reveal-active-image", state.hasActiveImage);
        updateMenuItemEnabled("menu-edit-active-image", state.hasActiveImage);
        updateMenuItemEnabled("menu-reveal-active-collection", state.hasActiveCollection);
        updateMenuItemEnabled("menu-rename-selected-collection", state.hasSingleSelectedCollection);
        updateMenuItemEnabled("menu-add-selected-collections-favorites", state.hasSelectedCollections);
        updateMenuItemEnabled("menu-remove-selected-collections-favorites", state.hasSelectedCollections);
        updateMenuItemEnabled("menu-remove-selected-collections", state.hasSelectedCollections && !removalLocked);
        updateMenuItemEnabled("menu-delete-selected-collections-disk", state.hasSelectedCollections && !removalLocked);
        updateMenuItemEnabled("menu-rescan-selected-collections", state.hasSelectedCollections);
        updateMenuItemEnabled("menu-select-all-collections", state.hasCollections);
        updateMenuItemEnabled("menu-invert-collection-selection", state.hasCollections);
        updateMenuItemEnabled("menu-clear-collection-selection", state.hasSelectedCollections);
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
            | { type: "collection"; collectionId: string; label: string; selectedCount: number; isSelected: boolean }
    ) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return null;
        const removalLocked = menuLocks.isRemoving || menuLocks.isDeleting;

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
                    const countLabel = payload.selectedCount > 1 ? ` (${payload.selectedCount})` : "";
                    items.push({
                        label: `Add Selected Images${countLabel} to Favourites`,
                        click: () => finish("add-selected-images-favorites"),
                    });
                    items.push({
                        label: `Remove Selected Images${countLabel} from Favourites`,
                        click: () => finish("remove-selected-images-favorites"),
                    });
                }
                if (payload.selectedCount >= 1) {
                    items.push({
                        label: `Remove Selected Images from Index${payload.selectedCount > 1 ? ` (${payload.selectedCount})` : ""}…`,
                        click: () => finish("remove-selected-images"),
                        enabled: !removalLocked,
                    });
                    items.push({
                        label: `Delete Selected Images${payload.selectedCount > 1 ? ` (${payload.selectedCount})` : ""} from Disk…`,
                        click: () => finish("delete-selected-images-disk"),
                        enabled: !removalLocked,
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

            if (payload.type === "collection") {
                items.push({
                    label: "Reveal in File Manager",
                    click: () => finish("reveal-collection"),
                });
                items.push({
                    label: "Rescan Collection",
                    click: () => finish("rescan-collection"),
                });
                if (payload.selectedCount <= 1) {
                    items.push({
                        label: "Rename Collection…",
                        click: () => finish("rename-collection"),
                    });
                }
                if (payload.selectedCount >= 1) {
                    const countLabel = payload.selectedCount > 1 ? ` (${payload.selectedCount})` : "";
                    items.push({
                        label: `Add Selected Collections${countLabel} to Favourites`,
                        click: () => finish("add-selected-collections-favorites"),
                    });
                    items.push({
                        label: `Remove Selected Collections${countLabel} from Favourites`,
                        click: () => finish("remove-selected-collections-favorites"),
                    });
                }
                if (payload.selectedCount >= 1) {
                    items.push({
                        label: `Remove Selected Collections from Index${payload.selectedCount > 1 ? ` (${payload.selectedCount})` : ""}…`,
                        click: () => finish("remove-selected-collections"),
                        enabled: !removalLocked,
                    });
                    items.push({
                        label: `Delete Selected Collections${payload.selectedCount > 1 ? ` (${payload.selectedCount})` : ""} from Disk…`,
                        click: () => finish("delete-selected-collections-disk"),
                        enabled: !removalLocked,
                    });
                }
                items.push({ type: "separator" });
                items.push({
                    label: "Select All Collections",
                    click: () => finish("select-all-collections"),
                });
                items.push({
                    label: "Invert Collection Selection",
                    click: () => finish("invert-collection-selection"),
                });
                items.push({
                    label: "Clear Collection Selection",
                    click: () => finish("clear-collection-selection"),
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
