import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DirectoryManifest,
  DirectoryRootTree,
  FileTreeNode,
  FolderTreeNode,
  ManifestFileEntry,
  TreeNode,
} from "../shared/types";

export const MANIFEST_FILENAME = ".manifest.json";

/**
 * Compute hex SHA-256 digest of a file using chunked reads (low memory footprint even on large files).
 */
export async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const fh = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const { bytesRead } = await fh.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(bytesRead === buffer.byteLength ? buffer : buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await fh.close();
  }
}

function toPosixRelative(fromDir: string, targetPath: string): string {
  return path.relative(fromDir, targetPath).split(path.sep).join("/");
}

async function readExistingManifest(manifestPath: string): Promise<DirectoryManifest | null> {
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as DirectoryManifest;
    if (parsed && parsed.version === 1 && parsed.files && typeof parsed.files === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function hasManifestChanged(
  existing: DirectoryManifest | null,
  nextFiles: Record<string, ManifestFileEntry>,
): boolean {
  if (!existing) return true;
  const oldKeys = Object.keys(existing.files);
  const newKeys = Object.keys(nextFiles);
  if (oldKeys.length !== newKeys.length) return true;

  for (const key of newKeys) {
    const prev = existing.files[key];
    const curr = nextFiles[key];
    if (!prev || !curr) return true;
    if (
      prev.sha256 !== curr.sha256 ||
      prev.mtimeMs !== curr.mtimeMs ||
      prev.size !== curr.size
    ) {
      return true;
    }
  }
  return false;
}

interface ScannedFlatFile {
  relativePath: string;
  name: string;
  size: number;
  mtimeMs: number;
  mtime: string;
  sha256: string;
}

async function walkDirectoryFiles(
  rootDir: string,
  currentDir: string,
  results: ScannedFlatFile[],
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relPath = toPosixRelative(rootDir, fullPath);

    // Skip the root-level .manifest.json so it never hashes itself recursively
    if (relPath === MANIFEST_FILENAME) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDirectoryFiles(rootDir, fullPath, results);
    } else if (entry.isFile()) {
      const st = await stat(fullPath);
      const mtimeMs = Math.floor(st.mtimeMs);
      const sha256 = await computeFileSha256(fullPath);
      results.push({
        relativePath: relPath,
        name: entry.name,
        size: st.size,
        mtimeMs,
        mtime: new Date(mtimeMs).toISOString(),
        sha256,
      });
    }
  }
}

interface MutableFolder {
  name: string;
  relativePath: string;
  folders: Map<string, MutableFolder>;
  files: FileTreeNode[];
}

function buildHierarchy(flatFiles: ScannedFlatFile[]): TreeNode[] {
  const root: MutableFolder = {
    name: "",
    relativePath: "",
    folders: new Map(),
    files: [],
  };

  for (const f of flatFiles) {
    const parts = f.relativePath.split("/");
    let current = root;
    let currentPath = "";

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let nextFolder = current.folders.get(part);
      if (!nextFolder) {
        nextFolder = {
          name: part,
          relativePath: currentPath,
          folders: new Map(),
          files: [],
        };
        current.folders.set(part, nextFolder);
      }
      current = nextFolder;
    }

    current.files.push({
      type: "file",
      name: f.name,
      relativePath: f.relativePath,
      size: f.size,
      mtimeMs: f.mtimeMs,
      mtime: f.mtime,
      sha256: f.sha256,
    });
  }

  function finalizeFolder(folder: MutableFolder): TreeNode[] {
    const folderNodes: FolderTreeNode[] = [];
    const sortedFolderNames = [...folder.folders.keys()].sort((a, b) => a.localeCompare(b));

    for (const fname of sortedFolderNames) {
      const sub = folder.folders.get(fname)!;
      const children = finalizeFolder(sub);
      let fileCount = 0;
      let latestMtimeMs = 0;
      for (const child of children) {
        if (child.type === "file") {
          fileCount += 1;
          if (child.mtimeMs > latestMtimeMs) latestMtimeMs = child.mtimeMs;
        } else {
          fileCount += child.fileCount;
          if (child.latestMtimeMs > latestMtimeMs) latestMtimeMs = child.latestMtimeMs;
        }
      }
      folderNodes.push({
        type: "folder",
        name: sub.name,
        relativePath: sub.relativePath,
        children,
        fileCount,
        latestMtimeMs,
      });
    }

    const sortedFiles = [...folder.files].sort((a, b) => a.name.localeCompare(b.name));
    return [...folderNodes, ...sortedFiles];
  }

  return finalizeFolder(root);
}

export interface ScanOptions {
  /** If true (A-site behavior), automatically create/update .manifest.json at the top of each directory. */
  writeManifest: boolean;
  /** Base working directory for resolving relative paths in dirlist. */
  baseDir?: string;
}

/**
 * Scan a single directory from dirlist, optionally maintaining its top-level .manifest.json.
 */
export async function scanSingleDirectory(
  dirPath: string,
  options: ScanOptions,
): Promise<DirectoryRootTree> {
  const baseDir = options.baseDir ?? process.cwd();
  const resolvedPath = path.resolve(baseDir, dirPath);
  const dirName = path.basename(resolvedPath) || dirPath;

  if (!existsSync(resolvedPath)) {
    return {
      dirPath,
      resolvedPath,
      name: dirName,
      exists: false,
      totalFiles: 0,
      totalBytes: 0,
      manifestUpdated: false,
      children: [],
    };
  }

  const st = await stat(resolvedPath);
  if (!st.isDirectory()) {
    return {
      dirPath,
      resolvedPath,
      name: dirName,
      exists: false,
      totalFiles: 0,
      totalBytes: 0,
      manifestUpdated: false,
      children: [],
    };
  }

  const flatFiles: ScannedFlatFile[] = [];
  await walkDirectoryFiles(resolvedPath, resolvedPath, flatFiles);

  // Sort deterministically by relativePath
  flatFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const manifestFiles: Record<string, ManifestFileEntry> = {};
  let totalBytes = 0;

  for (const f of flatFiles) {
    totalBytes += f.size;
    manifestFiles[f.relativePath] = {
      sha256: f.sha256,
      mtimeMs: f.mtimeMs,
      mtime: f.mtime,
      size: f.size,
    };
  }

  let manifestUpdated = false;
  if (options.writeManifest) {
    const manifestPath = path.join(resolvedPath, MANIFEST_FILENAME);
    const existing = await readExistingManifest(manifestPath);
    if (hasManifestChanged(existing, manifestFiles)) {
      const nextManifest: DirectoryManifest = {
        version: 1,
        directory: dirName,
        generated_at: new Date().toISOString(),
        files: manifestFiles,
      };
      const tmpManifest = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpManifest, JSON.stringify(nextManifest, null, 2) + "\n", "utf8");
      await rename(tmpManifest, manifestPath);
      manifestUpdated = true;
    }
  }

  const children = buildHierarchy(flatFiles);

  return {
    dirPath,
    resolvedPath,
    name: dirName,
    exists: true,
    totalFiles: flatFiles.length,
    totalBytes,
    manifestUpdated,
    children,
  };
}

/**
 * Scan all directories in dirlist.
 */
export async function scanDirlist(
  dirlist: string[],
  options: ScanOptions,
): Promise<DirectoryRootTree[]> {
  const results: DirectoryRootTree[] = [];
  for (const dirPath of dirlist) {
    const tree = await scanSingleDirectory(dirPath, options);
    results.push(tree);
  }
  return results;
}
