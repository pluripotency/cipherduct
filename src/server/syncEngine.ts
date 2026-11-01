import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import type {
  AppConfig,
  RecipientConfig,
  SyncFileDiffItem,
  SyncImportReport,
} from "../shared/types";
import {
  createDirectoriesZipArchive,
  extractZipToTempDirectory,
  type BundleDirectoryEntry,
} from "./archiver";
import { decryptBundle, encryptBundle } from "./crypto";
import { computeFileSha256, MANIFEST_FILENAME } from "./scanner";

export interface BuildBundleResult {
  bundleBytes: Uint8Array;
  filename: string;
  recipient: RecipientConfig;
}

export async function buildEncryptedBundleForRecipient(
  config: AppConfig,
  recipientId: string,
  baseDir: string = process.cwd(),
): Promise<BuildBundleResult> {
  const recipient = config.recipients.find(r => r.id === recipientId);
  if (!recipient) {
    throw new Error(`指定された受信先（ID: ${recipientId}）が見つかりません。`);
  }

  if (config.dirlist.length === 0) {
    throw new Error("対象ディレクトリ（dirlist）が1つも設定されていません。");
  }

  const zipBytes = await createDirectoriesZipArchive(config.dirlist, config.site_name, baseDir);
  const bundleBytes = encryptBundle(zipBytes, recipient.public_key);

  const safeId = recipient.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `cipherduct_${safeId}_${ts}.enc`;

  return {
    bundleBytes,
    filename,
    recipient,
  };
}

interface DirectoryMapping {
  entry: BundleDirectoryEntry;
  extractedPath: string;
  targetDisplayPath: string;
  targetResolvedPath: string;
}

/**
 * Resolve each archive dataset folder to its corresponding B-site target directory in dirlist.
 * Priority:
 * 1. Exact path string match
 * 2. Directory basename match (e.g. ./site_a/dataset_alpha -> ./site_b/dataset_alpha)
 * 3. Positional 1-to-1 match when dirlist has the exact same length
 * 4. Subdirectory inside dirlist[0] (or ./target_dirs/<archive_dir> if dirlist is empty)
 */
function resolveTargetDirectoryMappings(
  entries: BundleDirectoryEntry[],
  bSiteDirlist: string[],
  extractDir: string,
  baseDir: string,
): DirectoryMapping[] {
  const usedTargetIndices = new Set<number>();
  const resolvedBDirs = bSiteDirlist.map(d => ({
    raw: d,
    normalized: path.normalize(d),
    resolved: path.resolve(baseDir, d),
    basename: path.basename(path.resolve(baseDir, d)),
  }));

  const mappings: Array<DirectoryMapping | null> = new Array(entries.length).fill(null);

  // Pass 1: Exact normalized path match
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const normOrig = path.normalize(entry.original_path);
    const matchIdx = resolvedBDirs.findIndex(
      (b, idx) => !usedTargetIndices.has(idx) && b.normalized === normOrig,
    );
    if (matchIdx !== -1) {
      usedTargetIndices.add(matchIdx);
      const target = resolvedBDirs[matchIdx]!;
      mappings[i] = {
        entry,
        extractedPath: path.join(extractDir, entry.archive_dir),
        targetDisplayPath: target.raw,
        targetResolvedPath: target.resolved,
      };
    }
  }

  // Pass 2: Basename match
  for (let i = 0; i < entries.length; i++) {
    if (mappings[i]) continue;
    const entry = entries[i]!;
    const matchIdx = resolvedBDirs.findIndex(
      (b, idx) =>
        !usedTargetIndices.has(idx) &&
        (b.basename === entry.basename || b.basename === entry.archive_dir),
    );
    if (matchIdx !== -1) {
      usedTargetIndices.add(matchIdx);
      const target = resolvedBDirs[matchIdx]!;
      mappings[i] = {
        entry,
        extractedPath: path.join(extractDir, entry.archive_dir),
        targetDisplayPath: target.raw,
        targetResolvedPath: target.resolved,
      };
    }
  }

  // Pass 3: Positional 1-to-1 or fallback under primary root
  for (let i = 0; i < entries.length; i++) {
    if (mappings[i]) continue;
    const entry = entries[i]!;
    if (resolvedBDirs.length === entries.length && !usedTargetIndices.has(i)) {
      usedTargetIndices.add(i);
      const target = resolvedBDirs[i]!;
      mappings[i] = {
        entry,
        extractedPath: path.join(extractDir, entry.archive_dir),
        targetDisplayPath: target.raw,
        targetResolvedPath: target.resolved,
      };
    } else if (resolvedBDirs.length > 0) {
      const root = resolvedBDirs[0]!;
      mappings[i] = {
        entry,
        extractedPath: path.join(extractDir, entry.archive_dir),
        targetDisplayPath: path.posix.join(root.raw.replace(/\\/g, "/"), entry.archive_dir),
        targetResolvedPath: path.join(root.resolved, entry.archive_dir),
      };
    } else {
      const fallbackRaw = `./target_dirs/${entry.archive_dir}`;
      mappings[i] = {
        entry,
        extractedPath: path.join(extractDir, entry.archive_dir),
        targetDisplayPath: fallbackRaw,
        targetResolvedPath: path.resolve(baseDir, fallbackRaw),
      };
    }
  }

  return mappings.filter((m): m is DirectoryMapping => m !== null);
}

async function listRelativeFilesRecursively(
  rootDir: string,
  currentDir: string,
  out: string[],
): Promise<void> {
  if (!existsSync(currentDir)) return;
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await listRelativeFilesRecursively(rootDir, fullPath, out);
    } else if (entry.isFile()) {
      const rel = path.relative(rootDir, fullPath).split(path.sep).join("/");
      out.push(rel);
    }
  }
}

export interface ImportBundleOptions {
  baseDir?: string;
  /** Optional lifecycle hook invoked after extraction & sync, right before temp cleanup (used in tests). */
  onBeforeTempCleanup?: (extractDir: string) => void | Promise<void>;
}

/**
 * Decrypt an uploaded .enc package with B-site's private key, safely extract to ./temp/extract_<ts>,
 * compare mtime & sha256 against B-site's target directories, apply only new/changed files,
 * and clean up the temporary directory.
 */
export async function importEncryptedBundleOnBSite(
  bundleBytes: Uint8Array,
  config: AppConfig,
  options: ImportBundleOptions = {},
): Promise<SyncImportReport> {
  const baseDir = options.baseDir ?? process.cwd();
  const privateKeyPem = config.b_site_keys?.private_key?.trim();
  if (!privateKeyPem) {
    throw new Error("Bサイトの秘密鍵が未生成です。先に「キーペア生成」を実行してください。");
  }

  // Step 1: Decrypt & verify GCM authentication tag before touching the filesystem
  const zipBytes = decryptBundle(bundleBytes, privateKeyPem);

  // Step 2: Safely extract full archive into ./temp/extract_<timestamp>
  const { extractDir, meta } = await extractZipToTempDirectory(zipBytes, baseDir);

  const diffItems: SyncFileDiffItem[] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  try {
    const mappings = resolveTargetDirectoryMappings(
      meta.directories,
      config.dirlist,
      extractDir,
      baseDir,
    );

    for (const mapping of mappings) {
      if (!existsSync(mapping.extractedPath)) {
        continue;
      }

      await mkdir(mapping.targetResolvedPath, { recursive: true });

      const relFiles: string[] = [];
      await listRelativeFilesRecursively(mapping.extractedPath, mapping.extractedPath, relFiles);
      relFiles.sort((a, b) => a.localeCompare(b));

      for (const relPath of relFiles) {
        const srcFile = path.join(mapping.extractedPath, relPath);
        const dstFile = path.join(mapping.targetResolvedPath, relPath);

        if (relPath === MANIFEST_FILENAME) {
          // Sync top-level .manifest.json when absent or changed, without inflating user file counts
          const srcSha = await computeFileSha256(srcFile);
          const dstExists = existsSync(dstFile);
          const dstSha = dstExists ? await computeFileSha256(dstFile) : "";
          if (!dstExists || srcSha !== dstSha) {
            const srcStat = await stat(srcFile);
            await copyFile(srcFile, dstFile);
            const dt = new Date(Math.floor(srcStat.mtimeMs));
            await utimes(dstFile, dt, dt);
          }
          continue;
        }

        const srcStat = await stat(srcFile);
        const srcMtimeMs = Math.floor(srcStat.mtimeMs);
        const srcSha256 = await computeFileSha256(srcFile);

        if (!existsSync(dstFile)) {
          await mkdir(path.dirname(dstFile), { recursive: true });
          await copyFile(srcFile, dstFile);
          const dt = new Date(srcMtimeMs);
          await utimes(dstFile, dt, dt);

          added += 1;
          diffItems.push({
            dataset: mapping.entry.basename,
            targetDir: mapping.targetDisplayPath,
            relativePath: relPath,
            action: "added",
            reason: "new_file",
          });
        } else {
          const dstStat = await stat(dstFile);
          const dstMtimeMs = Math.floor(dstStat.mtimeMs);
          const dstSha256 = await computeFileSha256(dstFile);

          const mtimeChanged = srcMtimeMs !== dstMtimeMs;
          const shaChanged = srcSha256 !== dstSha256;

          if (!mtimeChanged && !shaChanged) {
            // Leave untouched: do not write or utimes
            unchanged += 1;
            diffItems.push({
              dataset: mapping.entry.basename,
              targetDir: mapping.targetDisplayPath,
              relativePath: relPath,
              action: "unchanged",
            });
          } else {
            await copyFile(srcFile, dstFile);
            const dt = new Date(srcMtimeMs);
            await utimes(dstFile, dt, dt);

            updated += 1;
            diffItems.push({
              dataset: mapping.entry.basename,
              targetDir: mapping.targetDisplayPath,
              relativePath: relPath,
              action: "updated",
              reason:
                mtimeChanged && shaChanged
                  ? "mtime_and_sha256"
                  : shaChanged
                    ? "sha256_changed"
                    : "mtime_changed",
            });
          }
        }
      }
    }

    if (options.onBeforeTempCleanup) {
      await options.onBeforeTempCleanup(extractDir);
    }
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }

  return {
    importedAt: new Date().toISOString(),
    sourceSite: meta.source_site,
    summary: {
      added,
      updated,
      unchanged,
      total: added + updated + unchanged,
    },
    files: diffItems,
    tempDirPath: path.relative(baseDir, extractDir).split(path.sep).join("/"),
    tempDirCleaned: !existsSync(extractDir),
  };
}
