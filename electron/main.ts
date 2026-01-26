import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { parsePngMetadata, readPngDimensions, type ParsedPngMetadata } from "../src/lib/pngMetadata";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const COMFY_PROTOCOL = "comfy";

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

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0b1220",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
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

app.whenReady().then(() => {
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
  createWindow();

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

ipcMain.handle("comfy:index-folders", async (_event: IpcMainInvokeEvent, rootPaths: string[]) => {
  const albums: Array<{ rootPath: string; images: IndexedImagePayload[] }> = [];

  for (const rootPath of rootPaths) {
    const files = await collectImageFiles(rootPath);
    const images = await Promise.all(files.map((filePath) => buildImagePayload(filePath, rootPath)));
    albums.push({ rootPath, images });
  }

  return albums;
});

ipcMain.handle("comfy:to-file-url", async (_event: IpcMainInvokeEvent, filePath: string) => {
  return `${COMFY_PROTOCOL}://local?path=${encodeURIComponent(filePath)}`;
});
