import {
  Check,
  DownloadCloud,
  FolderCog,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { SiteRole } from "../shared/types";

interface HeaderProps {
  siteName: string;
  role: SiteRole;
  port: number;
  configFile: string;
  dirCount: number;
  isBusy: boolean;
  onUpdateSiteName: (nextName: string) => Promise<void>;
  onOpenDirlistModal: () => void;
  onRescan: () => Promise<void>;
}

export function Header({
  siteName,
  role,
  port,
  configFile,
  dirCount,
  isBusy,
  onUpdateSiteName,
  onOpenDirlistModal,
  onRescan,
}: HeaderProps) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(siteName);

  const handleStartEdit = () => {
    setDraftName(siteName);
    setEditingName(true);
  };

  const handleSubmitName = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === siteName) {
      setEditingName(false);
      return;
    }
    await onUpdateSiteName(trimmed);
    setEditingName(false);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md shadow-xs">
      <div className="mx-auto max-w-7xl px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Brand + Single Active Site Role Indicator + Site Name */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-xs ${
                  role === "A"
                    ? "border-sky-200 bg-sky-50 text-sky-600"
                    : "border-emerald-200 bg-emerald-50 text-emerald-600"
                }`}
              >
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-bold tracking-tight text-slate-900">
                    CipherDuct
                  </span>

                  {/* Show ONLY the current role badge (never show both A and B menus) */}
                  {role === "A" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-bold text-sky-700">
                      <Send className="h-3 w-3" aria-hidden="true" />
                      Aサイト（送信元）:{port}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                      <DownloadCloud className="h-3 w-3" aria-hidden="true" />
                      Bサイト（受信側）:{port}
                    </span>
                  )}

                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    <Terminal className="h-3 w-3 text-slate-500" aria-hidden="true" />
                    SSH Port-Forward E2EE
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  設定: <code className="font-mono text-slate-700">{configFile}</code> / ハイブリッド暗号（RSA-OAEP + AES-256-GCM）
                </p>
              </div>
            </div>

            <div className="hidden h-7 w-px bg-slate-200 sm:block" />

            {/* Site Name inline editor */}
            {editingName ? (
              <form onSubmit={handleSubmitName} className="flex items-center gap-1.5">
                <label htmlFor="site-name-input" className="sr-only">
                  サイト名
                </label>
                <input
                  id="site-name-input"
                  type="text"
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  className="rounded-lg border border-sky-500 bg-white px-2.5 py-1 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isBusy}
                  className="inline-flex items-center justify-center rounded-lg bg-sky-600 p-1.5 text-white hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                  aria-label="サイト名を保存"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 cursor-pointer"
                  aria-label="キャンセル"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <span className="text-xs text-slate-500">拠点名:</span>
                <span className="text-sm font-semibold text-slate-900">{siteName}</span>
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="ml-1 rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 cursor-pointer"
                  aria-label="拠点名を編集"
                  title="拠点名を編集"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {/* Actions (No dual role switcher!) */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onOpenDirlistModal}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 cursor-pointer"
            >
              <FolderCog className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span>対象ディレクトリ ({dirCount})</span>
            </button>

            <button
              type="button"
              onClick={onRescan}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 cursor-pointer"
              title="ディレクトリを再スキャンして最新状態を取得"
            >
              <RefreshCw
                className={`h-4 w-4 text-slate-500 ${isBusy ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span>再スキャン</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
