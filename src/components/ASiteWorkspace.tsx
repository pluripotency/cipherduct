import {
  CheckCircle2,
  Download,
  FileKey2,
  KeyRound,
  Lock,
  PackageCheck,
  Plus,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { DirectoryRootTree, RecipientPublicView } from "../shared/types";
import { formatBytes } from "./formatters";

interface ASiteWorkspaceProps {
  configFile: string;
  recipients: RecipientPublicView[];
  trees: DirectoryRootTree[];
  isBusy: boolean;
  onAddRecipient: (payload: {
    id?: string;
    name: string;
    public_key: string;
  }) => Promise<void>;
  onDeleteRecipient: (id: string) => Promise<void>;
  onGenerateBundle: (
    recipientId: string,
  ) => Promise<{ filename: string; byteLength: number }>;
}

export function ASiteWorkspace({
  configFile,
  recipients,
  trees,
  isBusy,
  onAddRecipient,
  onDeleteRecipient,
  onGenerateBundle,
}: ASiteWorkspaceProps) {
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>(
    recipients[0]?.id ?? "",
  );
  const [nameInput, setNameInput] = useState("");
  const [idInput, setIdInput] = useState("");
  const [pemInput, setPemInput] = useState("");
  const [showAddForm, setShowAddForm] = useState(recipients.length === 0);
  const [bundling, setBundling] = useState(false);
  const [lastBundleResult, setLastBundleResult] = useState<{
    filename: string;
    byteLength: number;
    recipientName: string;
  } | null>(null);

  const pemFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (
      recipients.length > 0 &&
      !recipients.some(r => r.id === selectedRecipientId)
    ) {
      setSelectedRecipientId(recipients[0]!.id);
    } else if (recipients.length === 0) {
      setSelectedRecipientId("");
      setShowAddForm(true);
    }
  }, [recipients, selectedRecipientId]);

  const totalFiles = trees.reduce((acc, t) => acc + t.totalFiles, 0);
  const totalBytes = trees.reduce((acc, t) => acc + t.totalBytes, 0);

  const handlePemFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setPemInput(text.trim());
    if (!nameInput.trim()) {
      const base = file.name.replace(/(_public_key)?\.(pem|pub|txt)$/i, "");
      if (base) setNameInput(base);
    }
    e.target.value = "";
  };

  const handleSubmitRecipient = async (e: FormEvent) => {
    e.preventDefault();
    await onAddRecipient({
      id: idInput.trim() || undefined,
      name: nameInput.trim(),
      public_key: pemInput.trim(),
    });
    setNameInput("");
    setIdInput("");
    setPemInput("");
    setShowAddForm(false);
  };

  const handleDownloadBundle = async () => {
    if (!selectedRecipientId) return;
    setBundling(true);
    setLastBundleResult(null);
    try {
      const targetRec = recipients.find(r => r.id === selectedRecipientId);
      const res = await onGenerateBundle(selectedRecipientId);
      setLastBundleResult({
        filename: res.filename,
        byteLength: res.byteLength,
        recipientName: targetRec?.name ?? selectedRecipientId,
      });
    } finally {
      setBundling(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Encrypted Archive Builder */}
      <section
        aria-labelledby="a-bundle-heading"
        className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between"
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-600">
                <Lock className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 id="a-bundle-heading" className="text-base font-bold text-slate-900">
                  暗号化パッケージ配信（.enc）
                </h2>
                <p className="text-xs text-slate-500">
                  全対象フォルダと .manifest.json を単一ZIP圧縮しハイブリッド暗号化します
                </p>
              </div>
            </div>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-sky-700">
              ENC_BUNDLE_V1
            </span>
          </div>

          {/* Archive Target Stats */}
          <div className="grid grid-cols-3 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
            <div>
              <div className="text-[11px] font-medium text-slate-500">対象ルート</div>
              <div className="mt-0.5 text-base font-bold text-slate-900">
                {trees.length} 箇所
              </div>
            </div>
            <div className="border-x border-slate-200">
              <div className="text-[11px] font-medium text-slate-500">総ファイル数</div>
              <div className="mt-0.5 text-base font-bold text-slate-900">
                {totalFiles} 件
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500">総データ容量</div>
              <div className="mt-0.5 text-base font-bold text-slate-900">
                {formatBytes(totalBytes)}
              </div>
            </div>
          </div>

          {/* Recipient Selection */}
          <div>
            <label
              htmlFor="recipient-select"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              配信先公開鍵の選択
            </label>
            {recipients.length === 0 ? (
              <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                配信先の公開鍵が未登録です。右側の「受信側公開鍵管理」からPEM公開鍵を登録してください。
              </div>
            ) : (
              <select
                id="recipient-select"
                value={selectedRecipientId}
                onChange={e => setSelectedRecipientId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              >
                {recipients.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.id}) — {r.fingerprint.slice(0, 24)}...
                  </option>
                ))}
              </select>
            )}
          </div>

          {lastBundleResult && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              <PackageCheck
                className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="font-semibold text-emerald-900">
                  「{lastBundleResult.recipientName}」宛ての暗号化パッケージを生成しました
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-emerald-700 truncate">
                  {lastBundleResult.filename} ({formatBytes(lastBundleResult.byteLength)})
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-200">
          <button
            type="button"
            disabled={
              isBusy ||
              bundling ||
              recipients.length === 0 ||
              !selectedRecipientId ||
              trees.length === 0
            }
            onClick={handleDownloadBundle}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-45 transition-all cursor-pointer"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>
              {bundling
                ? "マニフェスト更新・ZIP圧縮・ハイブリッド暗号化中..."
                : "暗号化パッケージ作成 & ダウンロード (.enc)"}
            </span>
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            一時AES-256-GCM鍵でアーカイブ本体を暗号化し、RSA-OAEP公開鍵で鍵カプセル化します
          </p>
        </div>
      </section>

      {/* Right: Public Key Registry */}
      <section
        aria-labelledby="a-pubkey-heading"
        className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-600">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="a-pubkey-heading" className="text-base font-bold text-slate-900">
                受信側公開鍵管理
              </h2>
              <p className="text-xs text-slate-500">
                登録した公開鍵は <code className="font-mono text-slate-700">{configFile}</code> の [[recipients]] に保存されます
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddForm(v => !v)}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
            <span>{showAddForm ? "入力フォームを閉じる" : "公開鍵を追加"}</span>
          </button>
        </div>

        {/* Add Public Key Form */}
        {showAddForm && (
          <form
            onSubmit={handleSubmitRecipient}
            className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="recipient-name-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  配信先表示名 <span className="text-rose-600">*</span>
                </label>
                <input
                  id="recipient-name-input"
                  type="text"
                  required
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  placeholder="例: 東京支社B"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="recipient-id-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  識別ID（省略時は自動採番）
                </label>
                <input
                  id="recipient-id-input"
                  type="text"
                  value={idInput}
                  onChange={e => setIdInput(e.target.value)}
                  placeholder="例: b-site-01"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="recipient-pem-textarea"
                  className="text-xs font-semibold text-slate-700"
                >
                  公開鍵（PEM形式） <span className="text-rose-600">*</span>
                </label>
                <input
                  ref={pemFileInputRef}
                  type="file"
                  accept=".pem,.pub,.txt"
                  onChange={handlePemFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => pemFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:text-sky-700 cursor-pointer"
                >
                  <Upload className="h-3 w-3" aria-hidden="true" />
                  PEMファイルから読み込む
                </button>
              </div>
              <textarea
                id="recipient-pem-textarea"
                required
                rows={4}
                value={pemInput}
                onChange={e => setPemInput(e.target.value)}
                placeholder={"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}
                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="submit"
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                TOMLに登録
              </button>
            </div>
          </form>
        )}

        {/* Registered Keys List */}
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/50">
          {recipients.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 bg-white">
              登録済みの公開鍵はありません。
            </div>
          ) : (
            recipients.map(rec => {
              const isSelected = rec.id === selectedRecipientId;
              return (
                <div
                  key={rec.id}
                  onClick={() => setSelectedRecipientId(rec.id)}
                  className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors cursor-pointer ${
                    isSelected ? "bg-sky-50/80" : "bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <FileKey2
                        className={`h-4 w-4 shrink-0 ${
                          isSelected ? "text-sky-600" : "text-slate-400"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-semibold text-slate-900">
                        {rec.name}
                      </span>
                      <code className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                        {rec.id}
                      </code>
                      {rec.keyBits && (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                          <Shield className="h-2.5 w-2.5" aria-hidden="true" />
                          RSA-{rec.keyBits}
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-slate-500">
                      {rec.fingerprint}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={e => {
                      e.stopPropagation();
                      onDeleteRecipient(rec.id);
                    }}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 cursor-pointer shrink-0"
                    aria-label={`${rec.name} の公開鍵を削除`}
                    title="この公開鍵を削除"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
