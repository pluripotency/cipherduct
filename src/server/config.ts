import { existsSync } from "node:fs";
import { mkdir, readFile, rename, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import type {
  AppConfig,
  BSiteKeysPublicView,
  RecipientConfig,
  RecipientPublicView,
  SiteRole,
} from "../shared/types";
import { computePublicKeyFingerprint } from "./crypto";

export const CONFIG_A_PATH = path.resolve(process.cwd(), "data/config_a.toml");
export const CONFIG_B_PATH = path.resolve(process.cwd(), "data/config_b.toml");
export const LEGACY_CONFIG_PATH = path.resolve(process.cwd(), "data/config.toml");

/**
 * Resolve startup config path from CLI arguments (`bun dev a`, `bun dev b`, or `.toml` path)
 * or `CIPHERDUCT_CONFIG_PATH` environment variable.
 */
export function resolveStartupConfigPath(cliArgs: string[] = process.argv.slice(2)): string {
  const positional = cliArgs.filter(arg => !arg.startsWith("-"));
  const first = positional[0]?.trim();

  if (first) {
    const lower = first.toLowerCase();
    if (lower === "a") {
      return CONFIG_A_PATH;
    }
    if (lower === "b") {
      return CONFIG_B_PATH;
    }
    if (lower.endsWith(".toml")) {
      return path.resolve(process.cwd(), first);
    }
  }

  if (process.env.CIPHERDUCT_CONFIG_PATH) {
    return path.resolve(process.env.CIPHERDUCT_CONFIG_PATH);
  }

  return CONFIG_A_PATH;
}

export function resolveConfigPath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  if (process.env.CIPHERDUCT_CONFIG_PATH) {
    return path.resolve(process.env.CIPHERDUCT_CONFIG_PATH);
  }
  return CONFIG_A_PATH;
}

export function createDefaultConfigForRole(role: SiteRole = "A"): AppConfig {
  if (role === "B") {
    return {
      site_name: "支社Bサイト",
      role: "B",
      port: 3001,
      dirlist: ["./target_dirs_b/dataset_alpha", "./target_dirs_b/dataset_beta"],
      recipients: [],
      b_site_keys: {
        private_key: "",
        public_key: "",
        fingerprint: "",
        created_at: "",
      },
    };
  }

  return {
    site_name: "本社Aサイト",
    role: "A",
    port: 3000,
    dirlist: ["./target_dirs_a/dataset_alpha", "./target_dirs_a/dataset_beta"],
    recipients: [],
  };
}

/**
 * Convert single-line escaped PEM blocks emitted by smol-toml into readable TOML multiline strings """..."""
 * matching the APP.md specification while remaining 100% valid TOML 1.0.
 */
function formatMultilinePemInToml(tomlText: string): string {
  return tomlText.replace(
    /^(\s*(?:public_key|private_key)\s*=\s*)"(-----BEGIN [A-Z0-9 ]+-----(?:\\n|[^"])+-----END [A-Z0-9 ]+-----)"$/gm,
    (_match, prefix: string, escapedPem: string) => {
      const unescaped = escapedPem.replace(/\\n/g, "\n").replace(/\\r/g, "");
      return `${prefix}"""${unescaped}"""`;
    },
  );
}

export function serializeConfigToToml(config: AppConfig): string {
  const defaultPort = config.role === "B" ? 3001 : 3000;
  const normalized: Record<string, unknown> = {
    site_name: config.site_name,
    role: config.role,
    port: config.port ?? defaultPort,
    dirlist: config.dirlist,
  };

  if (config.role === "A" || config.recipients.length > 0) {
    normalized.recipients = config.recipients.map(r => ({
      id: r.id,
      name: r.name,
      public_key: r.public_key.trim(),
    }));
  }

  if (
    config.role === "B" ||
    Boolean(config.b_site_keys?.private_key || config.b_site_keys?.public_key)
  ) {
    normalized.b_site_keys = {
      private_key: config.b_site_keys?.private_key?.trim() ?? "",
      public_key: config.b_site_keys?.public_key?.trim() ?? "",
      fingerprint: config.b_site_keys?.fingerprint ?? "",
      created_at: config.b_site_keys?.created_at ?? "",
    };
  }

  const rawToml = stringify(normalized);
  return formatMultilinePemInToml(rawToml) + "\n";
}

export function parseConfigFromToml(tomlContent: string): AppConfig {
  const raw = parse(tomlContent) as Record<string, unknown>;

  const role: SiteRole = raw.role === "B" ? "B" : "A";

  const site_name =
    typeof raw.site_name === "string" && raw.site_name.trim().length > 0
      ? raw.site_name.trim()
      : role === "B"
        ? "支社Bサイト"
        : "本社Aサイト";

  const defaultPort = role === "B" ? 3001 : 3000;
  const port =
    typeof raw.port === "number" &&
    Number.isInteger(raw.port) &&
    raw.port > 0 &&
    raw.port <= 65535
      ? raw.port
      : defaultPort;

  const dirlist = Array.isArray(raw.dirlist)
    ? raw.dirlist.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];

  const recipients: RecipientConfig[] = [];
  if (Array.isArray(raw.recipients)) {
    for (const item of raw.recipients) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (
          typeof rec.id === "string" &&
          typeof rec.name === "string" &&
          typeof rec.public_key === "string"
        ) {
          recipients.push({
            id: rec.id.trim(),
            name: rec.name.trim(),
            public_key: rec.public_key.trim(),
          });
        }
      }
    }
  }

  let b_site_keys = {
    private_key: "",
    public_key: "",
    fingerprint: "",
    created_at: "",
  };

  if (raw.b_site_keys && typeof raw.b_site_keys === "object") {
    const bk = raw.b_site_keys as Record<string, unknown>;
    b_site_keys = {
      private_key: typeof bk.private_key === "string" ? bk.private_key.trim() : "",
      public_key: typeof bk.public_key === "string" ? bk.public_key.trim() : "",
      fingerprint: typeof bk.fingerprint === "string" ? bk.fingerprint.trim() : "",
      created_at: typeof bk.created_at === "string" ? bk.created_at.trim() : "",
    };
  }

  return {
    site_name,
    role,
    port,
    dirlist,
    recipients,
    b_site_keys,
  };
}

/**
 * Seed initial sample datasets for A-site so `bun dev a` immediately displays hierarchical files.
 */
export async function ensureSampleDatasetsForASite(
  dirlist: string[],
  baseDir: string = process.cwd(),
): Promise<void> {
  if (dirlist.length === 0) return;

  const alphaDir = path.resolve(baseDir, dirlist[0]!);
  const betaDir = dirlist[1] ? path.resolve(baseDir, dirlist[1]) : null;

  if (existsSync(alphaDir) || (betaDir && existsSync(betaDir))) {
    return;
  }

  await mkdir(path.join(alphaDir, "reports/2026-11"), { recursive: true });
  await mkdir(path.join(alphaDir, "master"), { recursive: true });

  const now = Date.now();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
  const thirtyMinsAgo = new Date(now - 30 * 60 * 1000);
  const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000);

  const f1 = path.join(alphaDir, "reports/2026-11/daily_settlement.csv");
  await writeFile(
    f1,
    "date,branch_code,amount_jpy,status\n2026-11-01,TYO-01,1482000,CONFIRMED\n2026-11-01,OSA-02,935000,CONFIRMED\n",
  );
  await utimes(f1, thirtyMinsAgo, thirtyMinsAgo);

  const f2 = path.join(alphaDir, "master/routing_table.json");
  await writeFile(
    f2,
    JSON.stringify(
      {
        version: "2026.11.1",
        routes: [
          { id: "TYO-01", tunnel: "ssh-forward:22022", priority: 1 },
          { id: "OSA-02", tunnel: "ssh-forward:22023", priority: 2 },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  await utimes(f2, twoHoursAgo, twoHoursAgo);

  const f3 = path.join(alphaDir, "reports/archive_october_summary.txt");
  await writeFile(
    f3,
    "October 2026 Monthly Settlement Summary\nTotal Transactions: 12,845\nIntegrity: VERIFIED\n",
  );
  await utimes(f3, fiveDaysAgo, fiveDaysAgo);

  if (betaDir) {
    await mkdir(path.join(betaDir, "telemetry/edge-nodes"), { recursive: true });
    await mkdir(path.join(betaDir, "schemas"), { recursive: true });

    const f4 = path.join(betaDir, "telemetry/edge-nodes/gateway_metrics.ndjson");
    await writeFile(
      f4,
      '{"node":"gw-east-01","latency_ms":11.4,"packet_loss":0.0}\n{"node":"gw-west-02","latency_ms":18.9,"packet_loss":0.0}\n',
    );
    await utimes(f4, thirtyMinsAgo, thirtyMinsAgo);

    const f5 = path.join(betaDir, "schemas/payload_v1.schema.json");
    await writeFile(
      f5,
      JSON.stringify(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          title: "CipherDuctSyncRecord",
          type: "object",
          required: ["id", "timestamp", "checksum"],
        },
        null,
        2,
      ) + "\n",
    );
    await utimes(f5, fiveDaysAgo, fiveDaysAgo);
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueConfigWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

export async function loadConfig(customPath?: string): Promise<AppConfig> {
  const configPath = resolveConfigPath(customPath);
  if (!existsSync(configPath)) {
    const inferredRole: SiteRole =
      path.basename(configPath).toLowerCase().includes("_b.") || configPath === CONFIG_B_PATH
        ? "B"
        : "A";
    const defaultCfg = createDefaultConfigForRole(inferredRole);
    await mkdir(path.dirname(configPath), { recursive: true });
    if (inferredRole === "A" && (configPath === CONFIG_A_PATH || configPath === LEGACY_CONFIG_PATH)) {
      await ensureSampleDatasetsForASite(defaultCfg.dirlist, process.cwd());
    }
    await writeFile(configPath, serializeConfigToToml(defaultCfg), "utf8");
    return defaultCfg;
  }

  const content = await readFile(configPath, "utf8");
  const parsed = parseConfigFromToml(content);
  if (parsed.role === "A" && configPath === CONFIG_A_PATH) {
    await ensureSampleDatasetsForASite(parsed.dirlist, process.cwd());
  }
  return parsed;
}

export async function saveConfig(config: AppConfig, customPath?: string): Promise<AppConfig> {
  return enqueueConfigWrite(async () => {
    const configPath = resolveConfigPath(customPath);
    await mkdir(path.dirname(configPath), { recursive: true });
    const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    const serialized = serializeConfigToToml(config);
    await writeFile(tmpPath, serialized, "utf8");
    await rename(tmpPath, configPath);
    return config;
  });
}

export async function updateConfig(
  updater: (current: AppConfig) => AppConfig | Promise<AppConfig>,
  customPath?: string,
): Promise<AppConfig> {
  return enqueueConfigWrite(async () => {
    const configPath = resolveConfigPath(customPath);
    const current = await loadConfig(configPath);
    const updated = await updater(current);
    await mkdir(path.dirname(configPath), { recursive: true });
    const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    const serialized = serializeConfigToToml(updated);
    await writeFile(tmpPath, serialized, "utf8");
    await rename(tmpPath, configPath);
    return updated;
  });
}

export function buildPublicRecipientsView(recipients: RecipientConfig[]): RecipientPublicView[] {
  return recipients.map(r => {
    try {
      const meta = computePublicKeyFingerprint(r.public_key);
      return {
        id: r.id,
        name: r.name,
        public_key: r.public_key,
        fingerprint: meta.fingerprint,
        keyBits: meta.keyBits,
      };
    } catch {
      return {
        id: r.id,
        name: r.name,
        public_key: r.public_key,
        fingerprint: "INVALID_KEY",
      };
    }
  });
}

export function buildPublicBSiteKeysView(config: AppConfig): BSiteKeysPublicView {
  const bk = config.b_site_keys;
  const hasKeys = Boolean(bk && bk.private_key && bk.public_key);
  if (!hasKeys || !bk) {
    return {
      hasKeys: false,
      public_key: "",
      fingerprint: "",
      created_at: "",
    };
  }

  let keyBits: number | undefined;
  let fingerprint = bk.fingerprint;
  try {
    const meta = computePublicKeyFingerprint(bk.public_key);
    keyBits = meta.keyBits;
    if (!fingerprint) {
      fingerprint = meta.fingerprint;
    }
  } catch {
    // Keep stored fingerprint if any
  }

  return {
    hasKeys: true,
    public_key: bk.public_key,
    fingerprint,
    created_at: bk.created_at,
    keyBits,
  };
}
