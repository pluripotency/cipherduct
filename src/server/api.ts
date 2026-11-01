import { randomBytes } from "node:crypto";
import path from "node:path";
import type { AppConfig, PublicAppState, SiteRole } from "../shared/types";
import {
  buildPublicBSiteKeysView,
  buildPublicRecipientsView,
  loadConfig,
  resolveConfigPath,
  updateConfig,
} from "./config";
import { computePublicKeyFingerprint, generateRsaKeyPair } from "./crypto";
import { scanDirlist } from "./scanner";
import {
  buildEncryptedBundleForRecipient,
  importEncryptedBundleOnBSite,
} from "./syncEngine";

export interface ApiContextOptions {
  configPath?: string;
  baseDir?: string;
}

export async function buildPublicState(
  config: AppConfig,
  options: ApiContextOptions = {},
): Promise<PublicAppState> {
  const baseDir = options.baseDir ?? process.cwd();
  const resolvedCfgPath = resolveConfigPath(options.configPath);
  const relCfg = path.relative(baseDir, resolvedCfgPath).split(path.sep).join("/");
  const configFileDisplay = relCfg.startsWith("..") ? resolvedCfgPath : relCfg;

  const trees = await scanDirlist(config.dirlist, {
    writeManifest: config.role === "A",
    baseDir,
  });

  return {
    site_name: config.site_name,
    role: config.role,
    port: config.port ?? (config.role === "B" ? 3001 : 3000),
    config_file: configFileDisplay,
    dirlist: config.dirlist,
    recipients: buildPublicRecipientsView(config.recipients),
    b_site_keys: buildPublicBSiteKeysView(config),
    trees,
    scannedAt: new Date().toISOString(),
  };
}

function jsonError(message: string, status: number = 400): Response {
  return Response.json({ error: message }, { status });
}

export function createApiRoutes(options: ApiContextOptions = {}) {
  return {
    "/api/state": {
      async GET() {
        try {
          const config = await loadConfig(options.configPath);
          const state = await buildPublicState(config, options);
          return Response.json(state);
        } catch (err) {
          return jsonError(
            err instanceof Error ? err.message : "状態取得中にエラーが発生しました。",
            500,
          );
        }
      },
    },

    "/api/config": {
      async PUT(req: Request) {
        try {
          const body = (await req.json()) as {
            site_name?: unknown;
            role?: unknown;
            dirlist?: unknown;
          };

          const updated = await updateConfig(current => {
            const next = structuredClone(current);

            if (typeof body.site_name === "string") {
              const trimmed = body.site_name.trim();
              if (!trimmed) {
                throw new Error("サイト名を空にすることはできません。");
              }
              next.site_name = trimmed;
            }

            if (body.role !== undefined) {
              if (body.role !== "A" && body.role !== "B") {
                throw new Error('role は "A" または "B" を指定してください。');
              }
              next.role = body.role as SiteRole;
            }

            if (body.dirlist !== undefined) {
              if (!Array.isArray(body.dirlist)) {
                throw new Error("dirlist は文字列配列で指定してください。");
              }
              const cleaned = body.dirlist
                .filter((d): d is string => typeof d === "string")
                .map(d => d.trim())
                .filter(d => d.length > 0 && !d.includes("\0"));

              next.dirlist = [...new Set(cleaned)];
            }

            return next;
          }, options.configPath);

          const state = await buildPublicState(updated, options);
          return Response.json(state);
        } catch (err) {
          return jsonError(
            err instanceof Error ? err.message : "設定更新に失敗しました。",
            400,
          );
        }
      },
    },

    "/api/rescan": {
      async POST() {
        try {
          const config = await loadConfig(options.configPath);
          const state = await buildPublicState(config, options);
          return Response.json(state);
        } catch (err) {
          return jsonError(
            err instanceof Error ? err.message : "再スキャンに失敗しました。",
            500,
          );
        }
      },
    },

    "/api/a/recipients": {
      async POST(req: Request) {
        try {
          const body = (await req.json()) as {
            id?: unknown;
            name?: unknown;
            public_key?: unknown;
          };

          const name = typeof body.name === "string" ? body.name.trim() : "";
          const publicKeyRaw =
            typeof body.public_key === "string" ? body.public_key.trim() : "";

          if (!name) {
            return jsonError("登録名（Bサイト名）を入力してください。", 400);
          }
          if (!publicKeyRaw) {
            return jsonError("Bサイトの公開鍵（PEM形式）を入力してください。", 400);
          }

          const keyMeta = computePublicKeyFingerprint(publicKeyRaw);

          const updated = await updateConfig(current => {
            const next = structuredClone(current);
            const existingViews = buildPublicRecipientsView(next.recipients);
            const dup = existingViews.find(r => r.fingerprint === keyMeta.fingerprint);
            if (dup) {
              throw new Error(
                `同一の公開鍵が既に「${dup.name}」(${dup.fingerprint}) として登録されています。`,
              );
            }

            let candidateId =
              typeof body.id === "string" && body.id.trim().length > 0
                ? body.id.trim().replace(/[^a-zA-Z0-9_-]/g, "-")
                : `b-site-${randomBytes(3).toString("hex")}`;

            if (next.recipients.some(r => r.id === candidateId)) {
              candidateId = `${candidateId}-${randomBytes(2).toString("hex")}`;
            }

            next.recipients.push({
              id: candidateId,
              name,
              public_key: keyMeta.normalizedPem,
            });
            return next;
          }, options.configPath);

          const state = await buildPublicState(updated, options);
          return Response.json(state);
        } catch (err) {
          return jsonError(
            err instanceof Error ? err.message : "公開鍵の登録に失敗しました。",
            400,
          );
        }
      },
    },

    "/api/a/recipients/:id": {
      async DELETE(req: Request & { params: { id: string } }) {
        try {
          const targetId = decodeURIComponent(req.params.id);
          const updated = await updateConfig(current => {
            const next = structuredClone(current);
            const before = next.recipients.length;
            next.recipients = next.recipients.filter(r => r.id !== targetId);
            if (next.recipients.length === before) {
              throw new Error(`指定された公開鍵（ID: ${targetId}）が見つかりません。`);
            }
            return next;
          }, options.configPath);

          const state = await buildPublicState(updated, options);
          return Response.json(state);
        } catch (err) {
          return jsonError(
            err instanceof Error ? err.message : "公開鍵の削除に失敗しました。",
            400,
          );
        }
      },
    },

    "/api/a/bundle": {
      async POST(req: Request) {
        try {
          const body = (await req.json()) as { recipientId?: unknown };
          const recipientId =
            typeof body.recipientId === "string" ? body.recipientId.trim() : "";
          if (!recipientId) {
            return jsonError("暗号化対象のBサイト公開鍵を選択してください。", 400);
          }

          const config = await loadConfig(options.configPath);
          const { bundleBytes, filename } = await buildEncryptedBundleForRecipient(
            config,
            recipientId,
            options.baseDir,
          );

          return new Response(Buffer.from(bundleBytes), {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "X-Bundle-Filename": filename,
              "Content-Length": String(bundleBytes.byteLength),
            },
          });
        } catch (err) {
          return jsonError(
            err instanceof Error
              ? err.message
              : "暗号化パッケージの生成に失敗しました。",
            400,
          );
        }
      },
    },

    "/api/b/keys/generate": {
      async POST(req: Request) {
        try {
          let modulusLength: 2048 | 4096 = 2048;
          try {
            const body = (await req.json()) as { modulusLength?: unknown };
            if (body?.modulusLength === 4096) {
              modulusLength = 4096;
            }
          } catch {
            // Empty body defaults to 2048
          }

          const generated = await generateRsaKeyPair(modulusLength);
          const updated = await updateConfig(current => {
            const next = structuredClone(current);
            next.b_site_keys = {
              private_key: generated.privateKeyPem,
              public_key: generated.publicKeyPem,
              fingerprint: generated.fingerprint,
              created_at: generated.createdAt,
            };
            return next;
          }, options.configPath);

          const state = await buildPublicState(updated, options);
          return Response.json(state);
        } catch (err) {
          return jsonError(
            err instanceof Error ? err.message : "鍵ペアの生成に失敗しました。",
            500,
          );
        }
      },
    },

    "/api/b/keys/public.pem": {
      async GET() {
        try {
          const config = await loadConfig(options.configPath);
          const pubPem = config.b_site_keys?.public_key?.trim();
          if (!pubPem) {
            return jsonError("Bサイトの公開鍵がまだ生成されていません。", 404);
          }

          const safeSite =
            config.site_name.replace(/[^a-zA-Z0-9_-]/g, "_") || "b_site";
          const filename = `${safeSite}_public_key.pem`;

          return new Response(pubPem + "\n", {
            status: 200,
            headers: {
              "Content-Type": "application/x-pem-file; charset=utf-8",
              "Content-Disposition": `attachment; filename="${filename}"`,
            },
          });
        } catch (err) {
          return jsonError(
            err instanceof Error ? err.message : "公開鍵の取得に失敗しました。",
            500,
          );
        }
      },
    },

    "/api/b/import": {
      async POST(req: Request) {
        try {
          const contentType = req.headers.get("content-type") ?? "";
          let bundleBytes: Uint8Array;

          if (contentType.includes("multipart/form-data")) {
            const formData = await req.formData();
            const fileEntry = formData.get("file");
            if (!fileEntry || !(fileEntry instanceof Blob)) {
              return jsonError(
                "暗号化ファイル（.enc）がフォームデータに含まれていません。",
                400,
              );
            }
            bundleBytes = new Uint8Array(await fileEntry.arrayBuffer());
          } else {
            bundleBytes = new Uint8Array(await req.arrayBuffer());
          }

          if (bundleBytes.byteLength === 0) {
            return jsonError("アップロードされたファイルが空です。", 400);
          }

          const config = await loadConfig(options.configPath);
          const report = await importEncryptedBundleOnBSite(bundleBytes, config, {
            baseDir: options.baseDir,
          });
          const state = await buildPublicState(config, options);

          return Response.json({
            report,
            state,
          });
        } catch (err) {
          return jsonError(
            err instanceof Error
              ? err.message
              : "暗号化パッケージの復号・反映に失敗しました。",
            400,
          );
        }
      },
    },
  };
}
