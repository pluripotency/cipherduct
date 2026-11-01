# CipherDuct 実装完了ウォークスルー（WalkThrough）

Bサイト（受信側）からAサイト（送信元）への片方向SSHポートフォワード接続環境で利用できる、拠点間E2Eハイブリッド暗号化データ配信Webアプリケーション **CipherDuct** の実装・ライトテーマUI対応・設定分離・自動テストがすべて完了しました。

---

## 1. 機能別実装まとめ

### 1.1 A/B個別TOML設定（`port=3000` / `3001`）と起動制御
- **実装ファイル**: `data/config_a.toml`, `data/config_b.toml`, `src/server/config.ts`, `src/index.ts`
- **主な機能**:
  - Aサイト用の `data/config_a.toml`（`role = "A"`, `port = 3000`, `dirlist = ["./target_dirs_a/..."]`）と、Bサイト用の `data/config_b.toml`（`role = "B"`, `port = 3001`, `dirlist = ["./target_dirs_b/..."]`）を個別に用意しました。
  - `bun dev a` で `data/config_a.toml`（ポート `3000`）、`bun dev b` で `data/config_b.toml`（ポート `3001`）を読み込んで独立起動できます。
  - **単一ロールUI表示 & ライトテーマ**:
    - Aで起動した際はAサイト専用画面・バッジのみ、Bで起動した際はBサイト専用画面・バッジのみを表示し、ヘッダーにA/B両方の切替メニューを出さない構成としています。
    - Web UI全体を視認性の高い **Light テーマ**（`color-scheme: light`）に統一しています。

### 1.2 共通UI・ディレクトリツリー表示 & テキストファイルプレビュー
- **実装ファイル**: `src/components/DirectoryTreeView.tsx`, `src/components/FilePreviewModal.tsx`, `src/server/filePreview.ts`
- アコーディオン階層ツリー、`mtime` 表示、SHA-256表示チェックボックス（デフォルトOFF）、期間フィルタ（デフォルト24時間以内＋プリセット／カスタム期間）、インクリメンタルサーチ＆親ディレクトリ階層の維持・自動展開に加え、テキスト系ファイル（JSON整形切替・CSVテーブル切替・行番号・コピー対応）のプレビュー機能を実装しています。

### 1.3 【Aサイト（送信元）】
- **実装ファイル**: `src/server/scanner.ts`, `src/server/archiver.ts`, `src/server/crypto.ts`, `src/components/ASiteWorkspace.tsx`
- `.manifest.json` 自動生成・更新、公開鍵管理（`data/config_a.toml` 保存）、単一ZIP圧縮＋ハイブリッド暗号化（`ENC_BUNDLE_V1`: `AES-256-GCM` + `RSA-OAEP`）による `.enc` ダウンロード配信を実装しています。

### 1.4 【Bサイト（受信側）】
- **実装ファイル**: `src/server/syncEngine.ts`, `src/components/BSiteWorkspace.tsx`
- RSA鍵ペア生成（`data/config_b.toml` 保存）＆公開鍵PEMダウンロード、`.enc` ファイルのドラッグ＆ドロップ取り込み、`./temp/extract_<timestamp>` への安全な一時展開と `mtime` / `sha256` 比較による差分反映（無変更ファイル未接触・一時フォルダ自動削除）を実装しています。

---

## 2. 起動コマンドと動作確認手順

```bash
# Aサイト起動（data/config_a.toml / http://localhost:3000）
bun dev a

# Bサイト起動（data/config_b.toml / http://localhost:3001）
bun dev b

# 自動E2Eテスト実行
bun test

# 本番ビルド & 本番起動
bun run build
bun start a
bun start b
```
