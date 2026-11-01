import { FolderPlus, FolderTree, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SiteRole } from "../shared/types";

interface DirlistModalProps {
  open: boolean;
  role: SiteRole;
  configFile: string;
  dirlist: string[];
  onClose: () => void;
  onSave: (nextDirlist: string[]) => Promise<void>;
}

export function DirlistModal({
  open,
  role,
  configFile,
  dirlist,
  onClose,
  onSave,
}: DirlistModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<string[]>(dirlist);
  const [newPath, setNewPath] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItems(dirlist);
  }, [dirlist, open]);

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
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newPath.trim();
    if (!trimmed) return;
    if (!items.includes(trimmed)) {
      setItems(prev => [...prev, trimmed]);
    }
    setNewPath("");
  };

  const handleRemove = (target: string) => {
    setItems(prev => prev.filter(p => p !== target));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(items);
      dialogRef.current?.close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="dirlist-modal-title"
      className="m-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl"
    >
      <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <FolderTree className="h-5 w-5 text-sky-600" aria-hidden="true" />
          <h2 id="dirlist-modal-title" className="text-base font-bold text-slate-900">
            対象ディレクトリ設定（dirlist）
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
          aria-label="閉じる"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-xs leading-relaxed text-slate-600">
          <code className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-800">
            {configFile}
          </code>{" "}
          の{" "}
          <code className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-800">
            dirlist
          </code>{" "}
          を管理します。
          {role === "A"
            ? "スキャン・マニフェスト生成・暗号化アーカイブの送信対象となります。"
            : "復号アーカイブの差分比較および反映先ルートとなります。"}
        </p>

        <form onSubmit={handleAdd} className="flex gap-2">
          <label htmlFor="new-dir-input" className="sr-only">
            追加するディレクトリパス
          </label>
          <input
            id="new-dir-input"
            type="text"
            value={newPath}
            onChange={e => setNewPath(e.target.value)}
            placeholder={
              role === "A"
                ? "例: ./target_dirs_a/dataset_gamma"
                : "例: ./target_dirs_b/dataset_gamma"
            }
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <FolderPlus className="h-4 w-4 text-sky-600" aria-hidden="true" />
            追加
          </button>
        </form>

        <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 divide-y divide-slate-200">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              ディレクトリが登録されていません。上の入力欄から追加してください。
            </div>
          ) : (
            items.map(dir => (
              <div
                key={dir}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm bg-white"
              >
                <code className="truncate font-mono text-xs text-slate-800">{dir}</code>
                <button
                  type="button"
                  onClick={() => handleRemove(dir)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                  aria-label={`${dir} を削除`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-6 py-3.5 flex items-center justify-end gap-2.5 rounded-b-2xl">
        <button
          type="button"
          autoFocus
          onClick={() => dialogRef.current?.close()}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          キャンセル
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
        >
          {saving ? "保存中..." : "TOMLへ保存"}
        </button>
      </div>
    </dialog>
  );
}
