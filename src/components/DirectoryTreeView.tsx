import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  FileCheck2,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderX,
  Hash,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DirectoryRootTree,
  FilePreviewResponse,
  FileTreeNode,
  FolderTreeNode,
  SiteRole,
  TreeNode,
} from "../shared/types";
import { FilePreviewModal } from "./FilePreviewModal";
import { formatBytes, formatDateTime, formatRelativeAge } from "./formatters";

type TimePreset = "1h" | "24h" | "3d" | "7d" | "30d" | "all" | "custom";
type CustomUnit = "minutes" | "hours" | "days";

interface DirectoryTreeViewProps {
  role: SiteRole;
  trees: DirectoryRootTree[];
  scannedAt: string;
}

const KNOWN_BINARY_EXTS = new Set([
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

function isPreviewableTextCandidate(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx === -1) return true;
  const ext = lower.slice(dotIdx);
  return !KNOWN_BINARY_EXTS.has(ext);
}

function isStructuredDataFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith(".json") ||
    lower.endsWith(".ndjson") ||
    lower.endsWith(".jsonl") ||
    lower.endsWith(".toml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".xml")
  );
}

function getThresholdMs(
  preset: TimePreset,
  customValue: number,
  customUnit: CustomUnit,
): number | null {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  switch (preset) {
    case "1h":
      return 1 * HOUR;
    case "24h":
      return 24 * HOUR;
    case "3d":
      return 3 * DAY;
    case "7d":
      return 7 * DAY;
    case "30d":
      return 30 * DAY;
    case "all":
      return null;
    case "custom": {
      const safeVal = Number.isFinite(customValue) && customValue > 0 ? customValue : 1;
      if (customUnit === "minutes") return safeVal * 60 * 1000;
      if (customUnit === "hours") return safeVal * HOUR;
      return safeVal * DAY;
    }
  }
}

function filterTreeNodes(
  nodes: TreeNode[],
  datasetName: string,
  queryLower: string,
  cutoffMs: number | null,
): { filtered: TreeNode[]; matchedCount: number } {
  const filtered: TreeNode[] = [];
  let matchedCount = 0;

  for (const node of nodes) {
    if (node.type === "file") {
      const passesTime = cutoffMs === null || node.mtimeMs >= cutoffMs;
      if (!passesTime) continue;

      const fullSearchTarget = `${datasetName}/${node.relativePath}`.toLowerCase();
      const passesQuery = !queryLower || fullSearchTarget.includes(queryLower);
      if (!passesQuery) continue;

      filtered.push(node);
      matchedCount += 1;
    } else {
      const childRes = filterTreeNodes(node.children, datasetName, queryLower, cutoffMs);
      if (childRes.matchedCount > 0) {
        filtered.push({
          ...node,
          children: childRes.filtered,
          fileCount: childRes.matchedCount,
        });
        matchedCount += childRes.matchedCount;
      }
    }
  }

  return { filtered, matchedCount };
}

function collectAllFolderKeys(dirKey: string, nodes: TreeNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === "folder") {
      out.push(`${dirKey}::${node.relativePath}`);
      collectAllFolderKeys(dirKey, node.children, out);
    }
  }
}

export function DirectoryTreeView({
  role,
  trees,
  scannedAt,
}: DirectoryTreeViewProps) {
  // Default OFF per APP.md specification
  const [showSha256, setShowSha256] = useState(false);

  // Default 24 hours ("1日以内") per APP.md specification
  const [timePreset, setTimePreset] = useState<TimePreset>("24h");
  const [customAmount, setCustomAmount] = useState<number>(12);
  const [customUnit, setCustomUnit] = useState<CustomUnit>("hours");

  // Incremental search query
  const [searchQuery, setSearchQuery] = useState("");

  // Track folders explicitly collapsed by user; empty = all matching ancestor paths auto-expanded
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const [copiedHashKey, setCopiedHashKey] = useState<string | null>(null);

  // Text / JSON file preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<FilePreviewResponse | null>(null);

  // Auto-expand matching folder paths whenever search or time filter changes
  useEffect(() => {
    setCollapsedKeys(new Set());
  }, [searchQuery, timePreset, customAmount, customUnit]);

  const referenceNowMs = useMemo(() => {
    const parsed = Date.parse(scannedAt);
    return Number.isNaN(parsed) ? Date.now() : Math.max(Date.now(), parsed);
  }, [scannedAt, timePreset, customAmount, customUnit, searchQuery]);

  const thresholdMs = useMemo(
    () => getThresholdMs(timePreset, customAmount, customUnit),
    [timePreset, customAmount, customUnit],
  );

  const queryLower = searchQuery.trim().toLowerCase();

  const { filteredRoots, totalScannedFiles, totalMatchedFiles } = useMemo(() => {
    const cutoffMs = thresholdMs === null ? null : referenceNowMs - thresholdMs;
    let scannedSum = 0;
    let matchedSum = 0;

    const roots = trees.map(root => {
      scannedSum += root.totalFiles;
      const res = filterTreeNodes(root.children, root.name, queryLower, cutoffMs);
      matchedSum += res.matchedCount;
      return {
        ...root,
        filteredChildren: res.filtered,
        matchedFilesCount: res.matchedCount,
      };
    });

    return {
      filteredRoots: roots,
      totalScannedFiles: scannedSum,
      totalMatchedFiles: matchedSum,
    };
  }, [trees, queryLower, thresholdMs, referenceNowMs]);

  const toggleFolder = (key: string) => {
    setCollapsedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    setCollapsedKeys(new Set());
  };

  const handleCollapseSubfolders = () => {
    const keys: string[] = [];
    for (const root of filteredRoots) {
      collectAllFolderKeys(root.dirPath, root.filteredChildren, keys);
    }
    setCollapsedKeys(new Set(keys));
  };

  const handleCopySha = async (sha: string, key: string) => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopiedHashKey(key);
      setTimeout(() => {
        setCopiedHashKey(curr => (curr === key ? null : curr));
      }, 1600);
    } catch {
      // Ignore clipboard failures in restricted contexts
    }
  };

  const handleOpenPreview = useCallback(async (dirPath: string, relativePath: string) => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);

    try {
      const params = new URLSearchParams({
        dirPath,
        relativePath,
      });
      const res = await fetch(`/api/files/preview?${params.toString()}`);
      const body = (await res.json()) as FilePreviewResponse & { error?: string };
      if (!res.ok) {
        throw new Error(body.error || `プレビュー取得エラー (HTTP ${res.status})`);
      }
      setPreviewData(body);
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : "ファイルの読み込みに失敗しました。",
      );
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewOpen(false);
  }, []);

  const hiddenByFilterCount = Math.max(0, totalScannedFiles - totalMatchedFiles);

  const renderFileRow = (file: FileTreeNode, rootDirPath: string, depth: number) => {
    const rowKey = `${rootDirPath}::file::${file.relativePath}`;
    const isCopied = copiedHashKey === rowKey;
    const canPreview = isPreviewableTextCandidate(file.name);
    const isCodeOrJson = isStructuredDataFile(file.name);

    return (
      <div
        key={rowKey}
        style={{ paddingLeft: `${depth * 18 + 14}px` }}
        className="group border-t border-slate-100 bg-white py-2 pr-4 hover:bg-sky-50/40 transition-colors"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {isCodeOrJson ? (
              <FileCode2
                className="h-4 w-4 shrink-0 text-sky-500 group-hover:text-sky-600 transition-colors"
                aria-hidden="true"
              />
            ) : (
              <FileText
                className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-sky-600 transition-colors"
                aria-hidden="true"
              />
            )}

            {canPreview ? (
              <button
                type="button"
                onClick={() => handleOpenPreview(rootDirPath, file.relativePath)}
                className="truncate text-left text-sm font-medium text-slate-800 hover:text-sky-700 hover:underline underline-offset-2 cursor-pointer"
                title={`${file.relativePath} の内容を表示`}
              >
                {file.name}
              </button>
            ) : (
              <span
                className="truncate text-sm font-medium text-slate-800"
                title={file.relativePath}
              >
                {file.name}
              </span>
            )}

            <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
              {formatBytes(file.size)}
            </span>
          </div>

          <div className="flex items-center gap-2 pl-6 sm:pl-0 shrink-0 text-xs text-slate-500">
            {canPreview && (
              <button
                type="button"
                onClick={() => handleOpenPreview(rootDirPath, file.relativePath)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-700 hover:border-sky-300 hover:bg-sky-50 transition-colors cursor-pointer"
                aria-label={`${file.name} の内容を表示`}
              >
                <Eye className="h-3 w-3" aria-hidden="true" />
                <span>表示</span>
              </button>
            )}
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
              {formatRelativeAge(file.mtimeMs, referenceNowMs)}
            </span>
            <time
              dateTime={file.mtime}
              className="font-mono text-xs text-slate-700 tabular-nums"
              title={`最終更新日時 (mtime): ${file.mtime}`}
            >
              {formatDateTime(file.mtimeMs)}
            </time>
          </div>
        </div>

        {showSha256 && (
          <div className="mt-1.5 flex items-center gap-2 pl-6">
            <span className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-[11px] text-sky-800 break-all">
              <Hash className="h-3 w-3 shrink-0 text-sky-600" aria-hidden="true" />
              {file.sha256}
            </span>
            <button
              type="button"
              onClick={() => handleCopySha(file.sha256, rowKey)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer shrink-0"
              aria-label={`${file.name} の SHA-256 をコピー`}
              title="SHA-256ハッシュをコピー"
            >
              {isCopied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                  <span className="font-medium text-emerald-700">コピー済</span>
                </>
              ) : (
                <Copy className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderFolderNode = (folder: FolderTreeNode, rootKey: string, depth: number) => {
    const folderKey = `${rootKey}::${folder.relativePath}`;
    const isOpen = !collapsedKeys.has(folderKey);

    return (
      <div key={folderKey} className="border-t border-slate-100 bg-white">
        <button
          type="button"
          onClick={() => toggleFolder(folderKey)}
          aria-expanded={isOpen}
          style={{ paddingLeft: `${depth * 18 + 10}px` }}
          className="flex w-full items-center justify-between py-2 pr-4 text-left hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2 min-w-0">
            {isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            )}
            {isOpen ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-amber-500/85" aria-hidden="true" />
            )}
            <span className="truncate text-sm font-semibold text-slate-800">
              {folder.name}
            </span>
          </span>
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {folder.fileCount} 件
          </span>
        </button>

        {isOpen && (
          <div>
            {folder.children.map(child =>
              child.type === "folder"
                ? renderFolderNode(child, rootKey, depth + 1)
                : renderFileRow(child, rootKey, depth + 1),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      aria-labelledby="directory-tree-heading"
      className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
    >
      {/* Card Header */}
      <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="directory-tree-heading"
              className="text-base font-bold text-slate-900 flex items-center gap-2 flex-wrap"
            >
              {role === "A"
                ? "送信対象ディレクトリツリー"
                : "反映先本ディレクトリツリー"}
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                表示 {totalMatchedFiles} / 全 {totalScannedFiles} ファイル
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {role === "A"
                ? "対象ディレクトリ配下の変更を検知して .manifest.json を自動管理します。ファイル名または「表示」でテキスト内容を確認できます。"
                : "復号・差分反映された本ディレクトリの最新ファイル階層を表示します。ファイル名または「表示」でテキスト内容を確認できます。"}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleExpandAll}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              すべて展開
            </button>
            <button
              type="button"
              onClick={handleCollapseSubfolders}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              サブフォルダ収納
            </button>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-center">
          {/* Incremental Search */}
          <div className="relative lg:col-span-5">
            <label htmlFor="tree-incremental-search" className="sr-only">
              ファイル名・パスでインクリメンタル検索
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="tree-incremental-search"
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ファイル名・パスで即時絞り込み..."
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="検索語句をクリア"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Time Filter */}
          <div className="flex flex-wrap items-center gap-2 lg:col-span-4">
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <Clock className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
              <label htmlFor="time-filter-select" className="sr-only">
                更新期間フィルタ
              </label>
              <select
                id="time-filter-select"
                value={timePreset}
                onChange={e => setTimePreset(e.target.value as TimePreset)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              >
                <option value="1h">更新: 1時間以内</option>
                <option value="24h">更新: 1日以内（24時間・デフォルト）</option>
                <option value="3d">更新: 3日以内</option>
                <option value="7d">更新: 7日以内</option>
                <option value="30d">更新: 30日以内</option>
                <option value="all">更新: 全期間を表示</option>
                <option value="custom">更新: カスタム期間指定...</option>
              </select>
            </div>

            {timePreset === "custom" && (
              <div className="flex items-center gap-1.5">
                <label htmlFor="custom-time-amount" className="sr-only">
                  期間数値
                </label>
                <input
                  id="custom-time-amount"
                  type="number"
                  min={1}
                  max={9999}
                  value={customAmount}
                  onChange={e => setCustomAmount(Math.max(1, Number(e.target.value) || 1))}
                  className="w-18 rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-900 focus:border-sky-500 focus:outline-none"
                />
                <label htmlFor="custom-time-unit" className="sr-only">
                  期間単位
                </label>
                <select
                  id="custom-time-unit"
                  value={customUnit}
                  onChange={e => setCustomUnit(e.target.value as CustomUnit)}
                  className="rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs font-medium text-slate-900 focus:border-sky-500 focus:outline-none"
                >
                  <option value="minutes">分以内</option>
                  <option value="hours">時間以内</option>
                  <option value="days">日以内</option>
                </select>
              </div>
            )}
          </div>

          {/* SHA256 Toggle Checkbox (Default OFF) */}
          <div className="flex items-center lg:justify-end lg:col-span-3">
            <label
              htmlFor="toggle-sha256-checkbox"
              className={`inline-flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer select-none ${
                showSha256
                  ? "border-sky-300 bg-sky-50 text-sky-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <input
                id="toggle-sha256-checkbox"
                type="checkbox"
                checked={showSha256}
                onChange={e => setShowSha256(e.target.checked)}
                className="h-4 w-4 rounded cursor-pointer"
              />
              <span>SHA-256を表示</span>
            </label>
          </div>
        </div>

        {/* Filter hint bar when older files are hidden */}
        {hiddenByFilterCount > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-600">
            <span>
              フィルタ条件外のため{" "}
              <strong className="font-semibold text-slate-900">
                {hiddenByFilterCount} 件
              </strong>{" "}
              のファイルが非表示になっています。
            </span>
            {timePreset !== "all" && (
              <button
                type="button"
                onClick={() => setTimePreset("all")}
                className="font-semibold text-sky-600 hover:text-sky-700 underline underline-offset-2 cursor-pointer"
              >
                全期間を表示する
              </button>
            )}
          </div>
        )}
      </div>

      {/* Directory Roots List */}
      <div className="divide-y divide-slate-200">
        {filteredRoots.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            対象ディレクトリ（dirlist）が未設定です。上部「対象ディレクトリ」ボタンから追加してください。
          </div>
        ) : (
          filteredRoots.map(root => {
            const rootCollapseKey = `${root.dirPath}::__ROOT__`;
            const isRootOpen = !collapsedKeys.has(rootCollapseKey);

            return (
              <div key={root.dirPath} className="bg-white">
                {/* Root Directory Accordion Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100/70 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleFolder(rootCollapseKey)}
                    aria-expanded={isRootOpen}
                    className="flex items-center gap-2.5 text-left min-w-0 cursor-pointer group"
                  >
                    {isRootOpen ? (
                      <ChevronDown
                        className="h-4 w-4 shrink-0 text-slate-500"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-slate-500"
                        aria-hidden="true"
                      />
                    )}
                    {root.exists ? (
                      <FolderOpen
                        className="h-5 w-5 shrink-0 text-sky-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <FolderX
                        className="h-5 w-5 shrink-0 text-amber-500"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900 group-hover:text-sky-700 transition-colors">
                          {root.name}
                        </span>
                        <code className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600">
                          {root.dirPath}
                        </code>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 text-xs">
                    {!root.exists ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                        {role === "B" ? "未作成（初回反映時に自動生成）" : "ディレクトリ未存在"}
                      </span>
                    ) : (
                      <>
                        {role === "A" && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700"
                            title="ディレクトリ直下に .manifest.json を自動出力・更新済"
                          >
                            <FileCheck2 className="h-3 w-3" aria-hidden="true" />
                            .manifest.json 同期済
                          </span>
                        )}
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                          {root.matchedFilesCount} / {root.totalFiles} 件 ({formatBytes(root.totalBytes)})
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Root Directory Children */}
                {isRootOpen && root.exists && (
                  <div>
                    {root.filteredChildren.length === 0 ? (
                      <div className="border-t border-slate-100 px-8 py-5 text-xs text-slate-500">
                        現在のフィルタ・検索条件に一致するファイルはありません（全{" "}
                        {root.totalFiles} ファイル）。
                      </div>
                    ) : (
                      root.filteredChildren.map(child =>
                        child.type === "folder"
                          ? renderFolderNode(child, root.dirPath, 1)
                          : renderFileRow(child, root.dirPath, 1),
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <FilePreviewModal
        open={previewOpen}
        loading={previewLoading}
        error={previewError}
        preview={previewData}
        onClose={handleClosePreview}
      />
    </section>
  );
}
