import { serve } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApiRoutes } from "../src/server/api";
import {
  CONFIG_A_PATH,
  CONFIG_B_PATH,
  loadConfig,
  parseConfigFromToml,
  resolveStartupConfigPath,
  saveConfig,
} from "../src/server/config";
import {
  decryptBundle,
  ENC_BUNDLE_MAGIC,
  encryptBundle,
  generateRsaKeyPair,
  parseEncBundle,
} from "../src/server/crypto";
import { computeFileSha256, MANIFEST_FILENAME, scanDirlist } from "../src/server/scanner";
import {
  buildEncryptedBundleForRecipient,
  importEncryptedBundleOnBSite,
} from "../src/server/syncEngine";
import type {
  DirectoryManifest,
  FilePreviewResponse,
  PublicAppState,
  SyncImportReport,
} from "../src/shared/types";

describe("CipherDuct E2E Workflow & Engine Verification", () => {
  let tmpWorkspace = "";
  let aConfigPath = "";
  let bConfigPath = "";

  let aServer: ReturnType<typeof serve>;
  let bServer: ReturnType<typeof serve>;
  let aBaseUrl = "";
  let bBaseUrl = "";

  beforeAll(async () => {
    tmpWorkspace = await mkdtemp(path.join(os.tmpdir(), "cipherduct-e2e-"));
    aConfigPath = path.join(tmpWorkspace, "data/config_a.toml");
    bConfigPath = path.join(tmpWorkspace, "data/config_b.toml");

    // Create dummy nested hierarchy in A-site's dirlist
    const aAlpha = path.join(tmpWorkspace, "site_a/dataset_alpha");
    const aBeta = path.join(tmpWorkspace, "site_a/dataset_beta");

    await mkdir(path.join(aAlpha, "finance/q4"), { recursive: true });
    await mkdir(path.join(aBeta, "logs/system"), { recursive: true });
    await mkdir(path.join(aBeta, "config"), { recursive: true });

    const baseTime = 1761955000000;
    const f1 = path.join(aAlpha, "finance/q4/ledger.csv");
    const f2 = path.join(aAlpha, "readme.txt");
    const f3 = path.join(aBeta, "logs/system/audit.log");
    const f4 = path.join(aBeta, "config/app.json");

    await writeFile(f1, "id,amount\n1001,50000\n1002,75000\n");
    await utimes(f1, new Date(baseTime + 1000), new Date(baseTime + 1000));

    await writeFile(f2, "Dataset Alpha Master Documentation v1.0\n");
    await utimes(f2, new Date(baseTime + 2000), new Date(baseTime + 2000));

    await writeFile(f3, "[2026-11-01T00:00:00Z] INFO Tunnel established\n");
    await utimes(f3, new Date(baseTime + 3000), new Date(baseTime + 3000));

    await writeFile(f4, JSON.stringify({ env: "production", retries: 3 }, null, 2) + "\n");
    await utimes(f4, new Date(baseTime + 4000), new Date(baseTime + 4000));

    // Save initial A-site and B-site TOML configs with ports 3000 and 3001
    await saveConfig(
      {
        site_name: "本社Aサイト",
        role: "A",
        port: 3000,
        dirlist: ["./site_a/dataset_alpha", "./site_a/dataset_beta"],
        recipients: [],
      },
      aConfigPath,
    );

    await saveConfig(
      {
        site_name: "東京支社B",
        role: "B",
        port: 3001,
        dirlist: ["./site_b/dataset_alpha", "./site_b/dataset_beta"],
        recipients: [],
      },
      bConfigPath,
    );

    // Boot isolated HTTP API servers for A-site and B-site
    aServer = serve({
      port: 0,
      routes: createApiRoutes({ configPath: aConfigPath, baseDir: tmpWorkspace }),
    });
    bServer = serve({
      port: 0,
      routes: createApiRoutes({ configPath: bConfigPath, baseDir: tmpWorkspace }),
    });

    aBaseUrl = aServer.url.origin;
    bBaseUrl = bServer.url.origin;
  });

  afterAll(async () => {
    aServer?.stop(true);
    bServer?.stop(true);
    if (tmpWorkspace && existsSync(tmpWorkspace)) {
      await rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  test("0. data/config_a.toml (port=3000) と data/config_b.toml (port=3001) および CLI 引数解決を検証", async () => {
    expect(resolveStartupConfigPath(["a"])).toBe(CONFIG_A_PATH);
    expect(resolveStartupConfigPath(["b"])).toBe(CONFIG_B_PATH);

    const cfgA = await loadConfig(CONFIG_A_PATH);
    expect(cfgA.role).toBe("A");
    expect(cfgA.port).toBe(3000);

    const cfgB = await loadConfig(CONFIG_B_PATH);
    expect(cfgB.role).toBe("B");
    expect(cfgB.port).toBe(3001);
  });

  test("1. Aサイト側で階層ディレクトリのスキャンと .manifest.json 自動生成・冪等性を検証", async () => {
    const res = await fetch(`${aBaseUrl}/api/state`);
    expect(res.status).toBe(200);
    const state = (await res.json()) as PublicAppState;

    expect(state.role).toBe("A");
    expect(state.port).toBe(3000);
    expect(state.config_file).toBe("data/config_a.toml");
    expect(state.trees).toHaveLength(2);
    expect(state.trees[0]!.totalFiles).toBe(2);
    expect(state.trees[1]!.totalFiles).toBe(2);

    // Verify .manifest.json was generated at the top of each directory
    const alphaManifestPath = path.join(tmpWorkspace, "site_a/dataset_alpha", MANIFEST_FILENAME);
    const betaManifestPath = path.join(tmpWorkspace, "site_a/dataset_beta", MANIFEST_FILENAME);
    expect(existsSync(alphaManifestPath)).toBe(true);
    expect(existsSync(betaManifestPath)).toBe(true);

    const alphaManifest = JSON.parse(
      await readFile(alphaManifestPath, "utf8"),
    ) as DirectoryManifest;
    expect(alphaManifest.version).toBe(1);
    expect(Object.keys(alphaManifest.files)).toEqual(["finance/q4/ledger.csv", "readme.txt"]);

    const expectedSha = await computeFileSha256(
      path.join(tmpWorkspace, "site_a/dataset_alpha/finance/q4/ledger.csv"),
    );
    expect(alphaManifest.files["finance/q4/ledger.csv"]!.sha256).toBe(expectedSha);

    // Re-scanning without modifications should NOT rewrite .manifest.json
    const secondTrees = await scanDirlist(
      ["./site_a/dataset_alpha", "./site_a/dataset_beta"],
      { writeManifest: true, baseDir: tmpWorkspace },
    );
    expect(secondTrees[0]!.manifestUpdated).toBe(false);
    expect(secondTrees[1]!.manifestUpdated).toBe(false);
  });

  test("2. BサイトでのRSA鍵ペア生成・TOML保存・公開鍵PEMダウンロードとAサイトへの公開鍵登録を検証", async () => {
    const genRes = await fetch(`${bBaseUrl}/api/b/keys/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modulusLength: 2048 }),
    });
    expect(genRes.status).toBe(200);
    const bState = (await genRes.json()) as PublicAppState;
    expect(bState.role).toBe("B");
    expect(bState.port).toBe(3001);
    expect(bState.config_file).toBe("data/config_b.toml");
    expect(bState.b_site_keys.hasKeys).toBe(true);
    expect(bState.b_site_keys.fingerprint.startsWith("SHA256:")).toBe(true);
    expect(bState.b_site_keys.keyBits).toBe(2048);

    // Verify TOML persistence directly on disk (including port = 3001 preserved)
    const rawBToml = await readFile(bConfigPath, "utf8");
    const parsedB = parseConfigFromToml(rawBToml);
    expect(parsedB.port).toBe(3001);
    expect(parsedB.b_site_keys?.private_key).toContain("-----BEGIN PRIVATE KEY-----");
    expect(parsedB.b_site_keys?.public_key).toContain("-----BEGIN PUBLIC KEY-----");

    // Download PEM from B-site endpoint
    const pemRes = await fetch(`${bBaseUrl}/api/b/keys/public.pem`);
    expect(pemRes.status).toBe(200);
    const downloadedPem = await pemRes.text();
    expect(downloadedPem).toContain("-----BEGIN PUBLIC KEY-----");

    // Register B-site public key onto A-site via API
    const regRes = await fetch(`${aBaseUrl}/api/a/recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "b-site-01",
        name: "東京支社B",
        public_key: downloadedPem,
      }),
    });
    expect(regRes.status).toBe(200);
    const aState = (await regRes.json()) as PublicAppState;
    expect(aState.recipients).toHaveLength(1);
    expect(aState.recipients[0]!.id).toBe("b-site-01");
    expect(aState.recipients[0]!.fingerprint).toBe(bState.b_site_keys.fingerprint);
  });

  test("3. ENC_BUNDLE_V1 フォーマット検証・改ざん検知・初回全量反映・一時ディレクトリ削除を検証", async () => {
    const bundleRes = await fetch(`${aBaseUrl}/api/a/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId: "b-site-01" }),
    });
    expect(bundleRes.status).toBe(200);
    const bundleBytes = new Uint8Array(await bundleRes.arrayBuffer());

    const header = parseEncBundle(bundleBytes);
    expect(header.magic).toBe(ENC_BUNDLE_MAGIC);
    expect(header.encryptedKeyLength).toBe(256);
    expect(header.iv.byteLength).toBe(12);
    expect(header.authTag.byteLength).toBe(16);
    expect(header.encryptedPayload.byteLength).toBeGreaterThan(0);

    // Tamper 1 bit in encrypted payload and verify B-site rejects before creating target files
    const tampered = new Uint8Array(bundleBytes);
    tampered[tampered.length - 1]! ^= 0x01;
    const tamperForm = new FormData();
    tamperForm.append("file", new Blob([tampered]), "tampered.enc");
    const tamperRes = await fetch(`${bBaseUrl}/api/b/import`, {
      method: "POST",
      body: tamperForm,
    });
    expect(tamperRes.status).toBe(400);
    expect(existsSync(path.join(tmpWorkspace, "site_b/dataset_alpha"))).toBe(false);

    // Verify temporary extraction happens inside ./temp/extract_<ts> and is cleaned up
    const bConfig = await loadConfig(bConfigPath);
    let capturedTempDir = "";
    let tempExistedDuringSync = false;

    const firstReport = await importEncryptedBundleOnBSite(bundleBytes, bConfig, {
      baseDir: tmpWorkspace,
      onBeforeTempCleanup: extractDir => {
        capturedTempDir = extractDir;
        tempExistedDuringSync = existsSync(extractDir);
      },
    });

    expect(tempExistedDuringSync).toBe(true);
    expect(capturedTempDir).toContain(path.join("temp", "extract_"));
    expect(existsSync(capturedTempDir)).toBe(false);
    expect(firstReport.tempDirCleaned).toBe(true);

    expect(firstReport.summary).toEqual({
      added: 4,
      updated: 0,
      unchanged: 0,
      total: 4,
    });

    const aLedger = path.join(tmpWorkspace, "site_a/dataset_alpha/finance/q4/ledger.csv");
    const bLedger = path.join(tmpWorkspace, "site_b/dataset_alpha/finance/q4/ledger.csv");
    expect(await readFile(bLedger, "utf8")).toBe(await readFile(aLedger, "utf8"));
    expect(Math.floor((await stat(bLedger)).mtimeMs)).toBe(
      Math.floor((await stat(aLedger)).mtimeMs),
    );
  });

  test("4. 一部ファイル更新時の再パッケージ化 → Bサイトで『更新ファイルのみ上書きされ無変更ファイルは未接触』を厳密検証", async () => {
    const bLedger = path.join(tmpWorkspace, "site_b/dataset_alpha/finance/q4/ledger.csv");
    const bReadme = path.join(tmpWorkspace, "site_b/dataset_alpha/readme.txt");
    const bAudit = path.join(tmpWorkspace, "site_b/dataset_beta/logs/system/audit.log");
    const bAppJson = path.join(tmpWorkspace, "site_b/dataset_beta/config/app.json");

    const beforeReadmeStat = await stat(bReadme);
    const beforeAuditStat = await stat(bAudit);
    const beforeAppJsonStat = await stat(bAppJson);
    const beforeLedgerSha = await computeFileSha256(bLedger);

    await Bun.sleep(30);

    const aLedger = path.join(tmpWorkspace, "site_a/dataset_alpha/finance/q4/ledger.csv");
    const updatedMtime = new Date(1761960000500);
    await writeFile(aLedger, "id,amount\n1001,50000\n1002,75000\n1003,128000\n");
    await utimes(aLedger, updatedMtime, updatedMtime);

    const aNewNote = path.join(tmpWorkspace, "site_a/dataset_beta/logs/release_note.md");
    const newNoteMtime = new Date(1761960005000);
    await writeFile(aNewNote, "# Patch Sync\nAdded incremental verification note.\n");
    await utimes(aNewNote, newNoteMtime, newNoteMtime);

    const aConfig = await loadConfig(aConfigPath);
    const { bundleBytes: secondBundle } = await buildEncryptedBundleForRecipient(
      aConfig,
      "b-site-01",
      tmpWorkspace,
    );

    const alphaManifest = JSON.parse(
      await readFile(
        path.join(tmpWorkspace, "site_a/dataset_alpha", MANIFEST_FILENAME),
        "utf8",
      ),
    ) as DirectoryManifest;
    expect(alphaManifest.files["finance/q4/ledger.csv"]!.sha256).not.toBe(beforeLedgerSha);

    const form = new FormData();
    form.append("file", new Blob([Buffer.from(secondBundle)]), "second_sync.enc");
    const importRes = await fetch(`${bBaseUrl}/api/b/import`, {
      method: "POST",
      body: form,
    });
    expect(importRes.status).toBe(200);

    const { report, state } = (await importRes.json()) as {
      report: SyncImportReport;
      state: PublicAppState;
    };

    expect(report.summary).toEqual({
      added: 1,
      updated: 1,
      unchanged: 3,
      total: 5,
    });

    const updatedItems = report.files.filter(f => f.action === "updated");
    expect(updatedItems).toHaveLength(1);
    expect(updatedItems[0]!.relativePath).toBe("finance/q4/ledger.csv");
    expect(updatedItems[0]!.reason).toBe("mtime_and_sha256");

    const addedItems = report.files.filter(f => f.action === "added");
    expect(addedItems).toHaveLength(1);
    expect(addedItems[0]!.relativePath).toBe("logs/release_note.md");

    expect(await readFile(bLedger, "utf8")).toContain("1003,128000");
    expect(Math.floor((await stat(bLedger)).mtimeMs)).toBe(updatedMtime.getTime());

    const bNewNote = path.join(tmpWorkspace, "site_b/dataset_beta/logs/release_note.md");
    expect(existsSync(bNewNote)).toBe(true);
    expect(Math.floor((await stat(bNewNote)).mtimeMs)).toBe(newNoteMtime.getTime());

    const afterReadmeStat = await stat(bReadme);
    const afterAuditStat = await stat(bAudit);
    const afterAppJsonStat = await stat(bAppJson);

    expect(afterReadmeStat.ino).toBe(beforeReadmeStat.ino);
    expect(afterReadmeStat.ctimeMs).toBe(beforeReadmeStat.ctimeMs);
    expect(afterReadmeStat.mtimeMs).toBe(beforeReadmeStat.mtimeMs);

    expect(afterAuditStat.ino).toBe(beforeAuditStat.ino);
    expect(afterAuditStat.ctimeMs).toBe(beforeAuditStat.ctimeMs);
    expect(afterAuditStat.mtimeMs).toBe(beforeAuditStat.mtimeMs);

    expect(afterAppJsonStat.ino).toBe(beforeAppJsonStat.ino);
    expect(afterAppJsonStat.ctimeMs).toBe(beforeAppJsonStat.ctimeMs);
    expect(afterAppJsonStat.mtimeMs).toBe(beforeAppJsonStat.mtimeMs);

    const totalInTree = state.trees.reduce((s, t) => s + t.totalFiles, 0);
    expect(totalInTree).toBe(5);

    const tempRoot = path.join(tmpWorkspace, "temp");
    if (existsSync(tempRoot)) {
      const remaining = await readdir(tempRoot);
      expect(remaining).toHaveLength(0);
    }
  });

  test("5. RSA-4096bit 鍵長での暗号化・復号ラウンドトリップも正常動作することを検証", async () => {
    const kp4096 = await generateRsaKeyPair(4096);
    const samplePayload = new TextEncoder().encode("RSA-4096 payload verification");
    const enc = encryptBundle(samplePayload, kp4096.publicKeyPem);

    const parsed = parseEncBundle(enc);
    expect(parsed.encryptedKeyLength).toBe(512);

    const dec = decryptBundle(enc, kp4096.privateKeyPem);
    expect(new TextDecoder().decode(dec)).toBe("RSA-4096 payload verification");
  });

  test("6. 共通テキストファイルプレビュー機能（JSON/CSV/Markdown表示・バイナリ判定・パストラバーサル拒否）を検証", async () => {
    // 1) JSON preview on A-site
    const jsonParams = new URLSearchParams({
      dirPath: "./site_a/dataset_beta",
      relativePath: "config/app.json",
    });
    const jsonRes = await fetch(`${aBaseUrl}/api/files/preview?${jsonParams.toString()}`);
    expect(jsonRes.status).toBe(200);
    const jsonPreview = (await jsonRes.json()) as FilePreviewResponse;
    expect(jsonPreview.isText).toBe(true);
    expect(jsonPreview.language).toBe("json");
    expect(jsonPreview.content).toContain('"env": "production"');

    // 2) CSV preview on B-site (synced destination)
    const csvParams = new URLSearchParams({
      dirPath: "./site_b/dataset_alpha",
      relativePath: "finance/q4/ledger.csv",
    });
    const csvRes = await fetch(`${bBaseUrl}/api/files/preview?${csvParams.toString()}`);
    expect(csvRes.status).toBe(200);
    const csvPreview = (await csvRes.json()) as FilePreviewResponse;
    expect(csvPreview.isText).toBe(true);
    expect(csvPreview.language).toBe("csv");
    expect(csvPreview.content).toContain("1003,128000");

    // 3) Binary file detection (NUL-containing payload)
    const binFile = path.join(tmpWorkspace, "site_a/dataset_alpha/raw_blob.dat");
    await writeFile(binFile, new Uint8Array([0x89, 0x50, 0x00, 0x01, 0xff]));
    const binParams = new URLSearchParams({
      dirPath: "./site_a/dataset_alpha",
      relativePath: "raw_blob.dat",
    });
    const binRes = await fetch(`${aBaseUrl}/api/files/preview?${binParams.toString()}`);
    expect(binRes.status).toBe(200);
    const binPreview = (await binRes.json()) as FilePreviewResponse;
    expect(binPreview.isText).toBe(false);
    expect(binPreview.content).toBeNull();

    // 4) Path traversal & unregistered dirPath rejection
    const traversalParams = new URLSearchParams({
      dirPath: "./site_a/dataset_alpha",
      relativePath: "../../data/config_b.toml",
    });
    const travRes = await fetch(
      `${aBaseUrl}/api/files/preview?${traversalParams.toString()}`,
    );
    expect(travRes.status).toBe(400);

    const unregParams = new URLSearchParams({
      dirPath: "/etc",
      relativePath: "hosts",
    });
    const unregRes = await fetch(`${aBaseUrl}/api/files/preview?${unregParams.toString()}`);
    expect(unregRes.status).toBe(400);
  });
});
