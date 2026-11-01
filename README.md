# CipherDuct

拠点間（Aサイト送信元 ⇄ Bサイト受信側）の片方向SSHポートフォワード環境向け E2Eハイブリッド暗号化（`RSA-OAEP` + `AES-256-GCM`）データ配信Webアプリケーションです。

機能別の詳細と動作確認手順は [WalkThrough.md](./WalkThrough.md) を参照してください。

## クイックスタート

```bash
# Aサイト起動 (data/config_a.toml / http://localhost:3000)
bun dev a

# Bサイト起動 (data/config_b.toml / http://localhost:3001)
bun dev b

# 自動E2Eテスト実行
bun test
```
