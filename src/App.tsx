import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ASiteWorkspace } from "./components/ASiteWorkspace";
import { BSiteWorkspace } from "./components/BSiteWorkspace";
import { DirectoryTreeView } from "./components/DirectoryTreeView";
import { DirlistModal } from "./components/DirlistModal";
import { Header } from "./components/Header";
import { formatDateTime } from "./components/formatters";
import "./index.css";
import type { PublicAppState, SyncImportReport } from "./shared/types";

interface BannerMessage {
  type: "success" | "error";
  text: string;
}

async function parseApiJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `APIエラーが発生しました (HTTP ${res.status})`);
  }
  return data;
}

export function App() {
  const [appState, setAppState] = useState<PublicAppState | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [banner, setBanner] = useState<BannerMessage | null>(null);
  const [dirlistModalOpen, setDirlistModalOpen] = useState(false);

  const showSuccess = useCallback((text: string) => {
    setBanner({ type: "success", text });
  }, []);

  const showError = useCallback((err: unknown) => {
    const text = err instanceof Error ? err.message : String(err);
    setBanner({ type: "error", text });
  }, []);

  const fetchInitialState = useCallback(async () => {
    setInitialLoading(true);
    try {
      const res = await fetch("/api/state");
      const data = await parseApiJson<PublicAppState>(res);
      setAppState(data);
    } catch (err) {
      showError(err);
    } finally {
      setInitialLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    fetchInitialState();
  }, [fetchInitialState]);

  useEffect(() => {
    if (!appState) return;
    document.title = `CipherDuct [${appState.role}サイト: ${appState.site_name}]`;
  }, [appState]);

  const handleUpdateSiteName = async (nextName: string) => {
    setIsBusy(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_name: nextName }),
      });
      const nextState = await parseApiJson<PublicAppState>(res);
      setAppState(nextState);
      showSuccess(`拠点名を「${nextState.site_name}」に更新しました。`);
    } catch (err) {
      showError(err);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveDirlist = async (nextDirlist: string[]) => {
    setIsBusy(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dirlist: nextDirlist }),
      });
      const nextState = await parseApiJson<PublicAppState>(res);
      setAppState(nextState);
      showSuccess("対象ディレクトリ一覧（dirlist）を保存しました。");
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setIsBusy(false);
    }
  };

  const handleRescan = async () => {
    setIsBusy(true);
    try {
      const res = await fetch("/api/rescan", { method: "POST" });
      const nextState = await parseApiJson<PublicAppState>(res);
      setAppState(nextState);
      showSuccess("対象ディレクトリを再スキャンしました。");
    } catch (err) {
      showError(err);
    } finally {
      setIsBusy(false);
    }
  };

  const handleAddRecipient = async (payload: {
    id?: string;
    name: string;
    public_key: string;
  }) => {
    setIsBusy(true);
    try {
      const res = await fetch("/api/a/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const nextState = await parseApiJson<PublicAppState>(res);
      setAppState(nextState);
      showSuccess(`公開鍵「${payload.name}」を登録しました。`);
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteRecipient = async (id: string) => {
    setIsBusy(true);
    try {
      const res = await fetch(`/api/a/recipients/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const nextState = await parseApiJson<PublicAppState>(res);
      setAppState(nextState);
      showSuccess("公開鍵を削除しました。");
    } catch (err) {
      showError(err);
    } finally {
      setIsBusy(false);
    }
  };

  const handleGenerateBundle = async (
    recipientId: string,
  ): Promise<{ filename: string; byteLength: number }> => {
    setIsBusy(true);
    try {
      const res = await fetch("/api/a/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId }),
      });

      if (!res.ok) {
        const errData = (await res.json()) as { error?: string };
        throw new Error(errData.error || "パッケージ生成に失敗しました。");
      }

      const filename =
        res.headers.get("X-Bundle-Filename") || `cipherduct_${recipientId}.enc`;
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      const refreshRes = await fetch("/api/state");
      if (refreshRes.ok) {
        setAppState((await refreshRes.json()) as PublicAppState);
      }

      showSuccess(`暗号化パッケージ「${filename}」を生成・ダウンロードしました。`);
      return { filename, byteLength: blob.size };
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setIsBusy(false);
    }
  };

  const handleGenerateBKeys = async (modulusLength: 2048 | 4096) => {
    setIsBusy(true);
    try {
      const res = await fetch("/api/b/keys/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modulusLength }),
      });
      const nextState = await parseApiJson<PublicAppState>(res);
      setAppState(nextState);
      showSuccess(
        `RSA-${modulusLength} キーペアを生成し ${nextState.config_file} に保存しました。`,
      );
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportBundle = async (file: File): Promise<SyncImportReport> => {
    setIsBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/b/import", {
        method: "POST",
        body: formData,
      });

      const payload = await parseApiJson<{
        report: SyncImportReport;
        state: PublicAppState;
      }>(res);

      setAppState(payload.state);
      showSuccess(
        `復号・差分反映が完了しました（新規 ${payload.report.summary.added}件 / 更新 ${payload.report.summary.updated}件 / スキップ ${payload.report.summary.unchanged}件）。`,
      );
      return payload.report;
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setIsBusy(false);
    }
  };

  if (initialLoading && !appState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        <div className="flex items-center gap-3 text-sm font-medium">
          <Loader2 className="h-5 w-5 animate-spin text-sky-600" aria-hidden="true" />
          <span>CipherDuct 設定とディレクトリを読み込み中...</span>
        </div>
      </div>
    );
  }

  if (!appState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm space-y-4">
          <AlertCircle className="mx-auto h-8 w-8 text-rose-500" aria-hidden="true" />
          <p className="text-sm text-slate-700">
            {banner?.text || "サーバーからの状態取得に失敗しました。"}
          </p>
          <button
            type="button"
            onClick={fetchInitialState}
            className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 cursor-pointer"
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Header
        siteName={appState.site_name}
        role={appState.role}
        port={appState.port}
        configFile={appState.config_file}
        dirCount={appState.dirlist.length}
        isBusy={isBusy}
        onUpdateSiteName={handleUpdateSiteName}
        onOpenDirlistModal={() => setDirlistModalOpen(true)}
        onRescan={handleRescan}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Status / Error Notification Banner */}
        {banner && (
          <div
            role={banner.type === "error" ? "alert" : "status"}
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold shadow-2xs ${
              banner.type === "error"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {banner.type === "error" ? (
                <AlertCircle
                  className="h-4 w-4 shrink-0 text-rose-600"
                  aria-hidden="true"
                />
              ) : (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
              )}
              <span>{banner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="rounded p-1 hover:bg-black/5 cursor-pointer"
              aria-label="通知を閉じる"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Role-specific Operations Workspace (Strictly single-role per server instance) */}
        {appState.role === "A" ? (
          <ASiteWorkspace
            configFile={appState.config_file}
            recipients={appState.recipients}
            trees={appState.trees}
            isBusy={isBusy}
            onAddRecipient={handleAddRecipient}
            onDeleteRecipient={handleDeleteRecipient}
            onGenerateBundle={handleGenerateBundle}
          />
        ) : (
          <BSiteWorkspace
            configFile={appState.config_file}
            bSiteKeys={appState.b_site_keys}
            isBusy={isBusy}
            onGenerateKeys={handleGenerateBKeys}
            onImportBundle={handleImportBundle}
          />
        )}

        {/* Common Directory Tree View */}
        <DirectoryTreeView
          role={appState.role}
          trees={appState.trees}
          scannedAt={appState.scannedAt}
        />
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            設定ファイル: <code className="font-mono text-slate-700">{appState.config_file}</code>{" "}
            (Port {appState.port}) / 暗号方式:{" "}
            <code className="font-mono text-slate-700">
              ENC_BUNDLE_V1 (AES-256-GCM + RSA-OAEP)
            </code>
          </span>
          <span>最終スキャン: {formatDateTime(appState.scannedAt)}</span>
        </div>
      </footer>

      <DirlistModal
        open={dirlistModalOpen}
        role={appState.role}
        configFile={appState.config_file}
        dirlist={appState.dirlist}
        onClose={() => setDirlistModalOpen(false)}
        onSave={handleSaveDirlist}
      />
    </div>
  );
}

export default App;
