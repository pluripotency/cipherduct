import { existsSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import type { FilePreviewLanguage, FilePreviewResponse } from "../shared/types";
import { computeFileSha256 } from "./scanner";

export const MAX_PREVIEW_BYTES = 512 * 1024; // 512 KB

const BINARY_EXTENSIONS = new Set([
  ".enc",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".ico",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".sqlite",
  ".db",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

export function detectPreviewLanguage(fileName: string): FilePreviewLanguage {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".jsonc") || lower.endsWith(".geojson")) {
    return "json";
  }
  if (lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) {
    return "ndjson";
  }
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    return "csv";
  }
  if (lower.endsWith(".toml")) {
    return "toml";
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "yaml";
  }
  if (lower.endsWith(".xml") || lower.endsWith(".svg") || lower.endsWith(".html")) {
    return "xml";
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "markdown";
  }
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".css") ||
    lower.endsWith(".py") ||
    lower.endsWith(".sh") ||
    lower.endsWith(".sql")
  ) {
    return "code";
  }
  const ext = path.extname(lower);
  if (ext && BINARY_EXTENSIONS.has(ext)) {
    return "binary";
  }
  return "text";
}

/**
 * Trim incomplete trailing UTF-8 continuation sequence when a file buffer was truncated mid-character.
 */
function trimIncompleteUtf8Tail(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength === 0) return bytes;
  let i = bytes.byteLength - 1;
  let continuationCount = 0;
  while (i >= 0 && continuationCount < 4 && (bytes[i]! & 0b1100_0000) === 0b1000_0000) {
    continuationCount += 1;
    i -= 1;
  }
  if (i < 0) return bytes;
  const lead = bytes[i]!;
  let expectedLen = 1;
  if ((lead & 0b1000_0000) === 0) expectedLen = 1;
  else if ((lead & 0b1110_0000) === 0b1100_0000) expectedLen = 2;
  else if ((lead & 0b1111_0000) === 0b1110_0000) expectedLen = 3;
  else if ((lead & 0b1111_1000) === 0b1111_0000) expectedLen = 4;
  else return bytes;

  const actualSeqLen = bytes.byteLength - i;
  if (actualSeqLen < expectedLen) {
    return bytes.subarray(0, i);
  }
  return bytes;
}

function decodeIfTextBuffer(
  rawBytes: Uint8Array,
  truncated: boolean,
): { isText: boolean; text: string | null } {
  // Check for NUL bytes in the first 16 KB (strong indicator of binary content)
  const checkLen = Math.min(rawBytes.byteLength, 16 * 1024);
  for (let i = 0; i < checkLen; i++) {
    if (rawBytes[i] === 0x00) {
      return { isText: false, text: null };
    }
  }

  const safeSlice = truncated ? trimIncompleteUtf8Tail(rawBytes) : rawBytes;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const text = decoder.decode(safeSlice);
    return { isText: true, text };
  } catch {
    return { isText: false, text: null };
  }
}

export interface ReadFilePreviewParams {
  allowedDirlist: string[];
  dirPath: string;
  relativePath: string;
  baseDir?: string;
}

export async function readSafeFilePreview(
  params: ReadFilePreviewParams,
): Promise<FilePreviewResponse> {
  const baseDir = params.baseDir ?? process.cwd();
  const requestedDir = params.dirPath.trim();
  const relPath = params.relativePath.trim().replace(/\\/g, "/");

  if (!requestedDir || !relPath) {
    throw new Error("dirPath と relativePath を指定してください。");
  }
  if (
    relPath.startsWith("/") ||
    relPath.includes("\0") ||
    relPath.split("/").includes("..")
  ) {
    throw new Error("不正なファイルパスが指定されました。");
  }

  // Ensure requestedDir matches one of the configured dirlist entries
  const allowedMatch = params.allowedDirlist.find(
    d => path.resolve(baseDir, d) === path.resolve(baseDir, requestedDir),
  );
  if (!allowedMatch) {
    throw new Error("指定されたディレクトリは対象ディレクトリ（dirlist）に含まれていません。");
  }

  const rootResolved = path.resolve(baseDir, allowedMatch);
  const fileResolved = path.resolve(rootResolved, relPath);

  if (!fileResolved.startsWith(rootResolved + path.sep)) {
    throw new Error("対象ディレクトリ外のファイル参照は許可されていません。");
  }

  if (!existsSync(fileResolved)) {
    throw new Error("指定されたファイルが存在しません。");
  }

  const lst = await lstat(fileResolved);
  if (lst.isSymbolicLink() || !lst.isFile()) {
    throw new Error("通常ファイル以外はプレビューできません。");
  }

  const size = lst.size;
  const mtimeMs = Math.floor(lst.mtimeMs);
  const sha256 = await computeFileSha256(fileResolved);
  const fileName = path.basename(fileResolved);
  const datasetName = path.basename(rootResolved) || allowedMatch;
  const initialLang = detectPreviewLanguage(fileName);

  if (initialLang === "binary") {
    return {
      dirPath: allowedMatch,
      datasetName,
      relativePath: relPath,
      fileName,
      size,
      mtimeMs,
      mtime: new Date(mtimeMs).toISOString(),
      sha256,
      isText: false,
      truncated: false,
      maxPreviewBytes: MAX_PREVIEW_BYTES,
      language: "binary",
      content: null,
    };
  }

  const readLen = Math.min(size, MAX_PREVIEW_BYTES);
  const truncated = size > MAX_PREVIEW_BYTES;
  const buffer = Buffer.allocUnsafe(readLen);

  const fh = await open(fileResolved, "r");
  let bytesReadTotal = 0;
  try {
    while (bytesReadTotal < readLen) {
      const { bytesRead } = await fh.read(
        buffer,
        bytesReadTotal,
        readLen - bytesReadTotal,
        bytesReadTotal,
      );
      if (bytesRead === 0) break;
      bytesReadTotal += bytesRead;
    }
  } finally {
    await fh.close();
  }

  const slice = new Uint8Array(buffer.buffer, buffer.byteOffset, bytesReadTotal);
  const decoded = decodeIfTextBuffer(slice, truncated);

  return {
    dirPath: allowedMatch,
    datasetName,
    relativePath: relPath,
    fileName,
    size,
    mtimeMs,
    mtime: new Date(mtimeMs).toISOString(),
    sha256,
    isText: decoded.isText,
    truncated,
    maxPreviewBytes: MAX_PREVIEW_BYTES,
    language: decoded.isText ? initialLang : "binary",
    content: decoded.text,
  };
}
