import {
  AlertCircle,
  Check,
  Copy,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileWarning,
  Hash,
  Loader2,
  WrapText,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FilePreviewResponse } from "../shared/types";
import { formatBytes, formatDateTime } from "./formatters";

interface FilePreviewModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  preview: FilePreviewResponse | null;
  onClose: () => void;
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // skip CR
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function FilePreviewModal({
  open,
  loading,
  error,
  preview,
  onClose,
}: FilePreviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [viewMode, setViewMode] = useState<"default" | "raw" | "table">("default");
  const [wordWrap, setWordWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setViewMode("default");
    setCopied(false);
  }, [preview?.dirPath, preview?.relativePath]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    // Light-dismiss fallback when clicking outside dialog bounds
    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener("pointerdown", onPointerDown);
    dialog.addEventListener("pointerup", onPointerUp);

    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("pointerup", onPointerUp);
    };
  }, [onClose]);

  const formattedJsonInfo = useMemo(() => {
    if (!preview?.isText || preview.content === null) {
      return { canPretty: false, prettyText: "" };
    }
    if (preview.language === "json") {
      try {
        const parsed = JSON.parse(preview.content);
        return {
          canPretty: true,
          prettyText: JSON.stringify(parsed, null, 2),
        };
      } catch {
        return { canPretty: false, prettyText: preview.content };
      }
    }
    if (preview.language === "ndjson") {
      try {
        const lines = preview.content
          .split(/\r?\n/)
          .filter(l => l.trim().length > 0)
          .map((line, idx) => `// Record #${idx + 1}\n${JSON.stringify(JSON.parse(line), null, 2)}`);
        return {
          canPretty: lines.length > 0,
          prettyText: lines.join("\n\n"),
        };
      } catch {
        return { canPretty: false, prettyText: preview.content };
      }
    }
    return { canPretty: false, prettyText: preview.content };
  }, [preview]);

  const csvTable = useMemo(() => {
    if (!preview?.isText || preview.content === null || preview.language !== "csv") {
      return null;
    }
    const delimiter = preview.fileName.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    const rows = parseCsvRows(preview.content, delimiter);
    return rows.length > 0 ? rows : null;
  }, [preview]);

  const displayedText = useMemo(() => {
    if (!preview?.isText || preview.content === null) return "";
    if (formattedJsonInfo.canPretty && viewMode === "default") {
      return formattedJsonInfo.prettyText;
    }
    return preview.content;
  }, [preview, formattedJsonInfo, viewMode]);

  const lines = useMemo(() => {
    if (!displayedText) return [""];
    const normalized = displayedText.replace(/\r\n/g, "\n");
    const split = normalized.split("\n");
    if (split.length > 1 && split[split.length - 1] === "") {
      split.pop();
    }
    return split;
  }, [displayedText]);

  const handleCopyContent = async () => {
    if (!displayedText) return;
    try {
      await navigator.clipboard.writeText(displayedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard restrictions
    }
  };

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby="file-preview-title"
      className="m-auto w-[95vw] max-w-4xl rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl"
    >
      {/* Modal Header */}
      <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-3.5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-600">
            {preview?.language === "csv" ? (
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            ) : preview?.language === "json" ||
              preview?.language === "ndjson" ||
              preview?.language === "code" ? (
              <FileCode2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <FileText className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2
                id="file-preview-title"
                className="truncate text-base font-bold text-slate-900"
              >
                {preview ? preview.fileName : "ファイルプレビュー"}
              </h2>
              {preview && (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-sky-700">
                  {preview.language}
                </span>
              )}
            </div>

            {preview && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <code className="font-mono text-[11px] text-slate-700">
                  {preview.datasetName}/{preview.relativePath}
                </code>
                <span>サイズ: {formatBytes(preview.size)}</span>
                <span>更新: {formatDateTime(preview.mtimeMs)}</span>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          autoFocus
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 cursor-pointer shrink-0"
          aria-label="プレビューを閉じる"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Toolbar (when text content is available) */}
      {preview?.isText && preview.content !== null && !loading && !error && (
        <div className="border-b border-slate-200 bg-white px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {formattedJsonInfo.canPretty && (
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("default")}
                  className={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                    viewMode === "default"
                      ? "bg-white text-sky-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  JSON整形
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("raw")}
                  className={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                    viewMode === "raw"
                      ? "bg-white text-sky-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  原文 (Raw)
                </button>
              </div>
            )}

            {csvTable && (
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("default")}
                  className={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                    viewMode !== "table"
                      ? "bg-white text-sky-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  テキスト
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                    viewMode === "table"
                      ? "bg-white text-sky-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  テーブル表示
                </button>
              </div>
            )}

            <span className="text-slate-400">{lines.length} 行</span>
          </div>

          <div className="flex items-center gap-2">
            {viewMode !== "table" && (
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={wordWrap}
                  onChange={e => setWordWrap(e.target.checked)}
                  className="h-3.5 w-3.5 rounded cursor-pointer"
                />
                <WrapText className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                <span>行の折り返し</span>
              </label>
            )}

            <button
              type="button"
              onClick={handleCopyContent}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  <span className="text-emerald-700">コピー済</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                  <span>内容をコピー</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Modal Content Body */}
      <div className="max-h-[68vh] overflow-auto bg-slate-50">
        {loading ? (
          <div className="flex items-center justify-center gap-2.5 py-20 text-sm text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin text-sky-600" aria-hidden="true" />
            <span>ファイルを読み込み中...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center space-y-2">
            <AlertCircle className="mx-auto h-7 w-7 text-rose-500" aria-hidden="true" />
            <p className="text-sm font-semibold text-rose-700">{error}</p>
          </div>
        ) : !preview ? null : !preview.isText || preview.content === null ? (
          <div className="p-12 text-center space-y-2">
            <FileWarning className="mx-auto h-8 w-8 text-amber-500" aria-hidden="true" />
            <p className="text-sm font-bold text-slate-800">
              バイナリファイルのためテキスト表示できません
            </p>
            <p className="text-xs text-slate-500">
              ファイルサイズ: {formatBytes(preview.size)} / SHA-256: {preview.sha256}
            </p>
          </div>
        ) : viewMode === "table" && csvTable ? (
          <div className="overflow-x-auto bg-white">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="bg-slate-100 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="w-12 border-r border-slate-200 px-3 py-2 text-right font-mono text-[11px] text-slate-400">
                    #
                  </th>
                  {csvTable[0]!.map((headerCell, idx) => (
                    <th
                      key={idx}
                      className="border-r border-slate-200 px-3 py-2 font-bold text-slate-800 last:border-r-0"
                    >
                      {headerCell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {csvTable.slice(1).map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-sky-50/40">
                    <td className="border-r border-slate-200 bg-slate-50 px-3 py-1.5 text-right font-mono text-[11px] text-slate-400">
                      {rIdx + 1}
                    </td>
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        className="border-r border-slate-100 px-3 py-1.5 font-mono text-slate-800 last:border-r-0"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div>
            {preview.truncated && (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
                ファイルサイズが大きいため、先頭{" "}
                <strong>{formatBytes(preview.maxPreviewBytes)}</strong>{" "}
                のみプレビュー表示しています（全体: {formatBytes(preview.size)}）。
              </div>
            )}

            <div className="py-3 font-mono text-xs leading-5">
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="flex hover:bg-sky-100/40 px-2"
                >
                  <span className="w-12 shrink-0 select-none pr-3 text-right text-[11px] text-slate-400">
                    {idx + 1}
                  </span>
                  <span
                    className={`flex-1 pl-3 border-l border-slate-200 text-slate-800 ${
                      wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
                    }`}
                  >
                    {line || " "}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modal Footer with SHA-256 */}
      <div className="border-t border-slate-200 bg-white px-5 py-3 flex flex-wrap items-center justify-between gap-2 rounded-b-2xl text-xs">
        {preview ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500 break-all">
            <Hash className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            SHA-256: <span className="text-slate-700">{preview.sha256}</span>
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          閉じる
        </button>
      </div>
    </dialog>
  );
}
