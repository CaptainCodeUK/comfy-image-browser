const path = require("node:path");
const fs = require("node:fs/promises");

const rootDir = path.resolve(__dirname, "..");
const sourceDir = path.join(rootDir, "electron", "assets", "icons");
const destDir = path.join(rootDir, "electron-dist", "icons");

const copyDirectory = async (src, dest) => {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
};

const run = async () => {
  try {
    await fs.access(sourceDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  try {
    await fs.rm(destDir, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await copyDirectory(sourceDir, destDir);
};

run().catch((error) => {
  console.error("Failed to copy electron assets:", error);
  process.exit(1);
});
