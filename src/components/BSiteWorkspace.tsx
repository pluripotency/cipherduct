import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileArchive,
  FilePlus2,
  FileUp,
  Fingerprint,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { BSiteKeysPublicView, SyncImportReport } from "../shared/types";
import { formatDateTime } from "./formatters";

interface BSiteWorkspaceProps {
  configFile: string;
  bSiteKeys: BSiteKeysPublicView;
  isBusy: boolean;
  onGenerateKeys: (modulusLength: 2048 | 4096) => Promise<void>;
  onImportBundle: (file: File) => Promise<SyncImportReport>;
}

export function BSiteWorkspace({
  configFile,
  bSiteKeys,
  isBusy,
  onGenerateKeys,
  onImportBundle,
}: BSiteWorkspaceProps) {
  const [keyBitsChoice, setKeyBitsChoice] = useState<2048 | 4096>(2048);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [copiedPub, setCopiedPub] = useState(false);
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);

  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastReport, setLastReport] = useState<SyncImportReport | null>(null);
  const [reportFilter, setReportFilter] = useState<"all" | "changed">("all");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const regenDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = regenDialogRef.current;
    if (!dialog) return;
    if (confirmRegenOpen && !dialog.open) {
      dialog.showModal();
    } else if (!confirmRegenOpen && dialog.open) {
      dialog.close();
    }
  }, [confirmRegenOpen]);

  useEffect(() => {
    const dialog = regenDialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      dialog.returnValue = "";
      setConfirmRegenOpen(false);
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  const handleGenerate = async () => {
    setGeneratingKey(true);
    try {
      await onGenerateKeys(keyBitsChoice);
      setConfirmRegenOpen(false);
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleCopyPublicKey = async () => {
    if (!bSiteKeys.public_key) return;
    try {
      await navigator.clipboard.writeText(bSiteKeys.public_key);
      setCopiedPub(true);
      setTimeout(() => setCopiedPub(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const processEncFile = async (file: File) => {
    setImporting(true);
    try {
      const report = await onImportBundle(file);
      setLastReport(report);
    } finally {
      setImporting(false);
    }
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await processEncFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!bSiteKeys.hasKeys || importing || isBusy) return;
    setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (!bSiteKeys.hasKeys || importing || isBusy) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processEncFile(file);
  };

  const visibleReportFiles = lastReport
    ? reportFilter === "changed"
      ? lastReport.files.filter(f => f.action !== "unchanged")
      : lastReport.files
    : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Key Pair Management */}
        <section
          aria-labelledby="b-keypair-heading"
          className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="b-keypair-heading" className="text-base font-bold text-slate-900">
                    復号用鍵ペア管理
                  </h2>
                  <p className="text-xs text-slate-500">
                    RSA秘密鍵と配布用公開鍵（<code className="font-mono text-slate-700">{configFile}</code> 保存）
                  </p>
                </div>
              </div>
              {bSiteKeys.hasKeys && bSiteKeys.keyBits && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                  RSA-{bSiteKeys.keyBits}
                </span>
              )}
            </div>

            {!bSiteKeys.hasKeys ? (
              <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/80 p-4">
                <div className="flex items-start gap-2.5 text-xs text-amber-900">
                  <ShieldAlert
                    className="h-4 w-4 shrink-0 text-amber-600 mt-0.5"
                    aria-hidden="true"
                  />
                  <div>
                    <div className="font-bold text-amber-950">
                      キーペアが未生成です
                    </div>
                    <p className="mt-1 leading-relaxed text-amber-800">
                      キーペアを生成し、公開鍵（PEM形式）をダウンロードして送信元へ登録してください。秘密鍵はローカルの{" "}
                      <code className="rounded border border-amber-200 bg-white px-1 py-0.5 text-amber-900">
                        {configFile}
                      </code>{" "}
                      に安全に保存されます。
                    </p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="rsa-bits-select"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    RSA鍵長（RSA-OAEP SHA-256）
                  </label>
                  <select
                    id="rsa-bits-select"
                    value={keyBitsChoice}
                    onChange={e =>
                      setKeyBitsChoice(Number(e.target.value) === 4096 ? 4096 : 2048)
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value={2048}>2048 bit（標準・高速）</option>
                    <option value={4096}>4096 bit（高強度・長期運用向け）</option>
                  </select>
                </div>

                <button
                  type="button"
                  disabled={isBusy || generatingKey}
                  onClick={handleGenerate}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  <span>{generatingKey ? "RSA鍵ペア生成中..." : "キーペア生成"}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700">
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      秘密鍵・公開鍵ペア有効
                    </span>
                    {bSiteKeys.created_at && (
                      <span className="text-[11px] text-slate-500">
                        生成: {formatDateTime(bSiteKeys.created_at)}
                      </span>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                      <Fingerprint className="h-3 w-3 text-sky-600" aria-hidden="true" />
                      公開鍵フィンガープリント
                    </div>
                    <code className="mt-1 block break-all rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-sky-800">
                      {bSiteKeys.fingerprint}
                    </code>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <a
                    href="/api/b/keys/public.pem"
                    download
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    公開鍵ダウンロード（PEM形式）
                  </a>

                  <button
                    type="button"
                    onClick={handleCopyPublicKey}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    {copiedPub ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                        <span className="text-emerald-700">PEMをコピーしました</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 text-slate-500" aria-hidden="true" />
                        <span>公開鍵PEMをコピー</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {bSiteKeys.hasKeys && (
            <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>鍵ローテーションが必要な場合:</span>
              <button
                type="button"
                disabled={isBusy || generatingKey}
                onClick={() => setConfirmRegenOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-amber-700 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                鍵ペアを再生成...
              </button>
            </div>
          )}
        </section>

        {/* Right: Encrypted Package Upload & Safe Diff Sync */}
        <section
          aria-labelledby="b-import-heading"
          className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-600">
                  <FileArchive className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="b-import-heading" className="text-base font-bold text-slate-900">
                    暗号化ファイル取り込み & 安全差分反映
                  </h2>
                  <p className="text-xs text-slate-500">
                    一時展開後に mtime と SHA-256 を比較し、新規・変更ファイルのみ本ディレクトリへ反映します
                  </p>
                </div>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".enc,application/octet-stream"
              onChange={handleFileInputChange}
              className="hidden"
            />

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => {
                if (bSiteKeys.hasKeys && !importing && !isBusy) {
                  fileInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={bSiteKeys.hasKeys ? 0 : -1}
              onKeyDown={e => {
                if (
                  bSiteKeys.hasKeys &&
                  !importing &&
                  !isBusy &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              aria-disabled={!bSiteKeys.hasKeys || importing || isBusy}
              className={`rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
                !bSiteKeys.hasKeys
                  ? "border-slate-200 bg-slate-50 opacity-65 cursor-not-allowed"
                  : dragActive
                    ? "border-emerald-500 bg-emerald-50/70 scale-[1.01] cursor-copy"
                    : "border-slate-300 bg-slate-50/70 hover:border-sky-400 hover:bg-sky-50/40 cursor-pointer"
              }`}
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-100 bg-white text-sky-600 shadow-2xs mb-3">
                <UploadCloud
                  className={`h-6 w-6 ${importing ? "animate-bounce" : ""}`}
                  aria-hidden="true"
                />
              </div>

              {importing ? (
                <div className="space-y-1">
                  <p className="text-sm font-bold text-sky-700">
                    秘密鍵で復号 → ./temp 一時展開 → 差分比較・反映を実行中...
                  </p>
                  <p className="text-xs text-slate-500">
                    AES-256-GCM 認証タグを検証しています。しばらくお待ちください。
                  </p>
                </div>
              ) : !bSiteKeys.hasKeys ? (
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-600">
                    先に左パネルで「キーペア生成」を実行してください
                  </p>
                  <p className="text-xs text-slate-500">
                    秘密鍵が準備されると .enc ファイルの取り込みが可能になります
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-slate-900">
                    ここに <code className="font-mono text-sky-700">.enc</code>{" "}
                    ファイルをドラッグ＆ドロップ、またはクリックして選択
                  </p>
                  <p className="text-xs text-slate-500">
                    一時ディレクトリ（<code className="font-mono text-slate-700">./temp/extract_*</code>
                    ）で全展開・検証後、変更のないファイルには一切触れずに差分反映します
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Sync Diff Report Panel */}
      {lastReport && (
        <section
          aria-labelledby="sync-report-heading"
          className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              <div>
                <h3 id="sync-report-heading" className="text-sm font-bold text-slate-900">
                  差分反映完了レポート
                  {lastReport.sourceSite ? `（送信元: ${lastReport.sourceSite}）` : ""}
                </h3>
                <p className="text-xs text-slate-500">
                  反映日時: {formatDateTime(lastReport.importedAt)} / 一時展開先:{" "}
                  <code className="font-mono text-slate-700">{lastReport.tempDirPath}</code>{" "}
                  {lastReport.tempDirCleaned ? "（クリーンアップ削除済）" : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setReportFilter("all")}
                className={`rounded-lg px-2.5 py-1 font-semibold cursor-pointer ${
                  reportFilter === "all"
                    ? "bg-slate-800 text-white"
                    : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                全ファイル ({lastReport.summary.total})
              </button>
              <button
                type="button"
                onClick={() => setReportFilter("changed")}
                className={`rounded-lg px-2.5 py-1 font-semibold cursor-pointer ${
                  reportFilter === "changed"
                    ? "bg-sky-600 text-white"
                    : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                追加・更新のみ ({lastReport.summary.added + lastReport.summary.updated})
              </button>
            </div>
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-800">
                <FilePlus2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                新規追加
              </span>
              <span className="text-lg font-bold text-emerald-700">
                {lastReport.summary.added} 件
              </span>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-amber-900">
                <FileUp className="h-4 w-4 text-amber-600" aria-hidden="true" />
                変更上書き反映
              </span>
              <span className="text-lg font-bold text-amber-700">
                {lastReport.summary.updated} 件
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">
                変更なし（スキップ・未接触）
              </span>
              <span className="text-lg font-bold text-slate-800">
                {lastReport.summary.unchanged} 件
              </span>
            </div>
          </div>

          {/* File-by-file detail list */}
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/40 text-xs">
            {visibleReportFiles.length === 0 ? (
              <div className="px-4 py-5 text-center text-slate-500 bg-white">
                該当するファイルはありません（すべてのファイルが最新状態で一致しています）。
              </div>
            ) : (
              visibleReportFiles.map(item => (
                <div
                  key={`${item.targetDir}::${item.relativePath}`}
                  className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                      {item.dataset}
                    </span>
                    <code className="truncate font-mono text-slate-800">
                      {item.relativePath}
                    </code>
                  </div>

                  <div>
                    {item.action === "added" && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                        新規追加
                      </span>
                    )}
                    {item.action === "updated" && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                        上書き更新
                        {item.reason === "mtime_and_sha256"
                          ? " (mtime + SHA256)"
                          : item.reason === "sha256_changed"
                            ? " (SHA256変更)"
                            : " (mtime変更)"}
                      </span>
                    )}
                    {item.action === "unchanged" && (
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                        変更なし（スキップ）
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Confirm Key Regeneration Native Modal Dialog */}
      <dialog
        ref={regenDialogRef}
        aria-labelledby="regen-dialog-title"
        className="m-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl"
      >
        <div className="p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-amber-600">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <h3 id="regen-dialog-title" className="text-base font-bold text-slate-900">
              鍵ペアを再生成しますか？
            </h3>
          </div>
          <p className="text-xs leading-relaxed text-slate-600">
            新しいRSA鍵ペアを生成して{" "}
            <code className="rounded border border-slate-200 bg-slate-100 px-1 py-0.5 text-slate-800">
              {configFile}
            </code>{" "}
            を上書きします。以前の公開鍵で暗号化された{" "}
            <code className="rounded border border-slate-200 bg-slate-100 px-1 py-0.5 text-slate-800">
              .enc
            </code>{" "}
            ファイルは復号できなくなり、送信元への公開鍵再登録が必要になります。
          </p>

          <div>
            <label
              htmlFor="regen-bits-select"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              新しいRSA鍵長
            </label>
            <select
              id="regen-bits-select"
              value={keyBitsChoice}
              onChange={e =>
                setKeyBitsChoice(Number(e.target.value) === 4096 ? 4096 : 2048)
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
            >
              <option value={2048}>2048 bit（標準・高速）</option>
              <option value={4096}>4096 bit（高強度）</option>
            </select>
          </div>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3.5 flex justify-end gap-2 rounded-b-2xl">
          <button
            type="button"
            autoFocus
            onClick={() => regenDialogRef.current?.close()}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={generatingKey}
            onClick={handleGenerate}
            className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
          >
            {generatingKey ? "再生成中..." : "新しい鍵ペアを生成"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
