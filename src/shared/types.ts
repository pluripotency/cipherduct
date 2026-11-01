export type SiteRole = "A" | "B";

export interface RecipientConfig {
  id: string;
  name: string;
  public_key: string;
}

export interface RecipientPublicView {
  id: string;
  name: string;
  public_key: string;
  fingerprint: string;
  keyBits?: number;
}

export interface BSiteKeysConfig {
  private_key: string;
  public_key: string;
  fingerprint: string;
  created_at: string;
}

export interface BSiteKeysPublicView {
  hasKeys: boolean;
  public_key: string;
  fingerprint: string;
  created_at: string;
  keyBits?: number;
}

export interface AppConfig {
  site_name: string;
  role: SiteRole;
  port?: number;
  dirlist: string[];
  recipients: RecipientConfig[];
  b_site_keys?: BSiteKeysConfig;
}

export interface ManifestFileEntry {
  sha256: string;
  mtimeMs: number;
  mtime: string;
  size: number;
}

export interface DirectoryManifest {
  version: 1;
  directory: string;
  generated_at: string;
  files: Record<string, ManifestFileEntry>;
}

export interface FileTreeNode {
  type: "file";
  name: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  mtime: string;
  sha256: string;
}

export interface FolderTreeNode {
  type: "folder";
  name: string;
  relativePath: string;
  children: TreeNode[];
  fileCount: number;
  latestMtimeMs: number;
}

export type TreeNode = FileTreeNode | FolderTreeNode;

export interface DirectoryRootTree {
  dirPath: string;
  resolvedPath: string;
  name: string;
  exists: boolean;
  totalFiles: number;
  totalBytes: number;
  manifestUpdated: boolean;
  children: TreeNode[];
}

export interface PublicAppState {
  site_name: string;
  role: SiteRole;
  port: number;
  config_file: string;
  dirlist: string[];
  recipients: RecipientPublicView[];
  b_site_keys: BSiteKeysPublicView;
  trees: DirectoryRootTree[];
  scannedAt: string;
}

export interface SyncFileDiffItem {
  dataset: string;
  targetDir: string;
  relativePath: string;
  action: "added" | "updated" | "unchanged";
  reason?: "new_file" | "mtime_and_sha256" | "sha256_changed" | "mtime_changed";
}

export interface SyncImportReport {
  importedAt: string;
  sourceSite?: string;
  summary: {
    added: number;
    updated: number;
    unchanged: number;
    total: number;
  };
  files: SyncFileDiffItem[];
  tempDirPath: string;
  tempDirCleaned: boolean;
}
