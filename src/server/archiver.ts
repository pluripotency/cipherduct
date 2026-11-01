import { unzipSync, zipSync, type Zippable } from "fflate";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DirectoryManifest } from "../shared/types";
import { MANIFEST_FILENAME, scanDirlist } from "./scanner";

export const BUNDLE_META_FILENAME = "_bundle_meta.json";

export interface BundleDirectoryEntry {
  index: number;
  archive_dir: string;
  original_path: string;
  basename: string;
}

export interface BundleMetadata {
  version: 1;
  created_at: string;
  source_site: string;
  directories: BundleDirectoryEntry[];
}

export interface ExtractedBundleInfo {
  extractDir: string;
  meta: BundleMetadata;
}

function toPosixRelative(fromDir: string, targetPath: string): string {
  return path.relative(fromDir, targetPath).split(path.sep).join("/");
}

async function collectAllFilesForZip(
  rootDir: string,
  currentDir: string,
  archivePrefix: string,
  zipEntries: Zippable,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectAllFilesForZip(rootDir, fullPath, archivePrefix, zipEntries);
    } else if (entry.isFile()) {
      const relPath = toPosixRelative(rootDir, fullPath);
      const zipKey = `${archivePrefix}/${relPath}`;
      const st = await stat(fullPath);
      const data = new Uint8Array(await readFile(fullPath));
      zipEntries[zipKey] = [
        data,
        {
          level: 6,
          mtime: new Date(Math.floor(st.mtimeMs)),
        },
      ];
    }
  }
}

/**
 * Scan all dirlist directories (updating each top-level .manifest.json) and compress them
 * into a single ZIP archive preserving folder hierarchy.
 */
export async function createDirectoriesZipArchive(
  dirlist: string[],
  siteName: string,
  baseDir: string = process.cwd(),
): Promise<Uint8Array> {
  // Ensure all manifests are freshly calculated and written at the top of each directory
  await scanDirlist(dirlist, { writeManifest: true, baseDir });

  const zipEntries: Zippable = {};
  const usedArchiveNames = new Set<string>();
  const directoriesMeta: BundleDirectoryEntry[] = [];

  for (let i = 0; i < dirlist.length; i++) {
    const dirPath = dirlist[i]!;
    const resolvedPath = path.resolve(baseDir, dirPath);
    const basename = path.basename(resolvedPath) || `dataset_${i}`;

    let archiveDir = basename;
    if (usedArchiveNames.has(archiveDir)) {
      archiveDir = `${basename}_${i}`;
    }
    usedArchiveNames.add(archiveDir);

    directoriesMeta.push({
      index: i,
      archive_dir: archiveDir,
      original_path: dirPath,
      basename,
    });

    if (existsSync(resolvedPath)) {
      const st = await stat(resolvedPath);
      if (st.isDirectory()) {
        await collectAllFilesForZip(resolvedPath, resolvedPath, archiveDir, zipEntries);
      }
    }
  }

  const meta: BundleMetadata = {
    version: 1,
    created_at: new Date().toISOString(),
    source_site: siteName,
    directories: directoriesMeta,
  };

  zipEntries[BUNDLE_META_FILENAME] = [
    new TextEncoder().encode(JSON.stringify(meta, null, 2) + "\n"),
    { level: 6 },
  ];

  return zipSync(zipEntries);
}

/**
 * Safely extract a ZIP archive into ./temp/extract_<timestamp>_<rand>, enforcing path-traversal
 * checks and restoring exact millisecond mtimes from each dataset's .manifest.json.
 */
export async function extractZipToTempDirectory(
  zipBytes: Uint8Array,
  baseDir: string = process.cwd(),
): Promise<ExtractedBundleInfo> {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipBytes);
  } catch (err) {
    throw new Error(
      `ZIPアーカイブの展開に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const tempRoot = path.resolve(baseDir, "temp");
  const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
  const extractDir = path.join(tempRoot, `extract_${suffix}`);
  await mkdir(extractDir, { recursive: true });

  for (const [rawEntryPath, fileData] of Object.entries(unzipped)) {
    const normalizedRel = rawEntryPath.replace(/\\/g, "/");
    if (!normalizedRel || normalizedRel.endsWith("/")) {
      continue;
    }
    if (normalizedRel.startsWith("/") || normalizedRel.split("/").includes("..")) {
      throw new Error(`不正なアーカイブパスを検出しました（Path Traversal拒否）: ${rawEntryPath}`);
    }

    const destPath = path.resolve(extractDir, normalizedRel);
    if (!destPath.startsWith(extractDir + path.sep)) {
      throw new Error(`展開先ディレクトリ外への書き込みを拒否しました: ${rawEntryPath}`);
    }

    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, fileData);
  }

  // Parse _bundle_meta.json or infer from extracted top-level folders
  let meta: BundleMetadata | null = null;
  const metaFilePath = path.join(extractDir, BUNDLE_META_FILENAME);
  if (existsSync(metaFilePath)) {
    try {
      meta = JSON.parse(await readFile(metaFilePath, "utf8")) as BundleMetadata;
    } catch {
      meta = null;
    }
  }

  if (!meta || !Array.isArray(meta.directories)) {
    const topEntries = await readdir(extractDir, { withFileTypes: true });
    const inferredDirs: BundleDirectoryEntry[] = topEntries
      .filter(e => e.isDirectory())
      .map((e, idx) => ({
        index: idx,
        archive_dir: e.name,
        original_path: e.name,
        basename: e.name,
      }));
    meta = {
      version: 1,
      created_at: new Date().toISOString(),
      source_site: "Unknown",
      directories: inferredDirs,
    };
  }

  // Restore exact millisecond mtimes recorded in each dataset's .manifest.json
  for (const dirEntry of meta.directories) {
    const datasetExtractPath = path.join(extractDir, dirEntry.archive_dir);
    const manifestPath = path.join(datasetExtractPath, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as DirectoryManifest;
      if (manifest && manifest.files) {
        for (const [relFile, info] of Object.entries(manifest.files)) {
          if (relFile.startsWith("/") || relFile.split("/").includes("..")) continue;
          const extractedFile = path.resolve(datasetExtractPath, relFile);
          if (
            extractedFile.startsWith(datasetExtractPath + path.sep) &&
            existsSync(extractedFile) &&
            typeof info.mtimeMs === "number"
          ) {
            const dt = new Date(info.mtimeMs);
            await utimes(extractedFile, dt, dt);
          }
        }
      }
    } catch {
      // Ignore malformed manifest during mtime restoration; stat comparison will still work
    }
  }

  return { extractDir, meta };
}
