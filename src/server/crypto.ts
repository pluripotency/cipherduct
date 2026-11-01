import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPair as generateKeyPairCb,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { promisify } from "node:util";

const generateKeyPairAsync = promisify(generateKeyPairCb);

export const ENC_BUNDLE_MAGIC = "ENC_BUNDLE_V1";
const MAGIC_BYTES = new TextEncoder().encode(ENC_BUNDLE_MAGIC); // 13 bytes
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const AES_KEY_LENGTH = 32; // 256 bits

export interface GeneratedKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  fingerprint: string;
  keyBits: number;
  createdAt: string;
}

export interface PublicKeyMetadata {
  normalizedPem: string;
  fingerprint: string;
  keyBits?: number;
}

export interface ParsedEncBundleHeader {
  magic: string;
  encryptedKeyLength: number;
  encryptedAesKey: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  encryptedPayload: Uint8Array;
}

/**
 * Compute SHA256 fingerprint from SPKI DER bytes (e.g. "SHA256:xxxx...").
 */
export function computePublicKeyFingerprint(publicKeyPem: string): PublicKeyMetadata {
  let keyObj;
  try {
    keyObj = createPublicKey(publicKeyPem.trim());
  } catch (err) {
    throw new Error(
      `公開鍵のPEM形式が不正です: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (keyObj.asymmetricKeyType !== "rsa") {
    throw new Error(
      `RSA公開鍵のみサポートされています（検出された鍵種別: ${keyObj.asymmetricKeyType ?? "unknown"}）`,
    );
  }

  const keyBits = keyObj.asymmetricKeyDetails?.modulusLength;
  if (keyBits && keyBits < 2048) {
    throw new Error(`RSA鍵長が短すぎます（${keyBits}bit）。2048bit以上が必要です。`);
  }

  const spkiDer = keyObj.export({ type: "spki", format: "der" });
  const normalizedPem = keyObj.export({ type: "spki", format: "pem" }).toString().trim();
  const digestBase64 = createHash("sha256")
    .update(spkiDer)
    .digest("base64")
    .replace(/=+$/, "");

  return {
    normalizedPem,
    fingerprint: `SHA256:${digestBase64}`,
    keyBits,
  };
}

/**
 * Generate an RSA-OAEP compatible key pair (2048 or 4096 bits) in SPKI/PKCS#8 PEM format.
 */
export async function generateRsaKeyPair(
  modulusLength: 2048 | 4096 = 2048,
): Promise<GeneratedKeyPair> {
  const { publicKey, privateKey } = await generateKeyPairAsync("rsa", {
    modulusLength,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const meta = computePublicKeyFingerprint(publicKey);

  return {
    privateKeyPem: privateKey.trim(),
    publicKeyPem: meta.normalizedPem,
    fingerprint: meta.fingerprint,
    keyBits: modulusLength,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Parse and validate an ENC_BUNDLE_V1 binary buffer into its header fields and ciphertext payload.
 */
export function parseEncBundle(bundleBytes: Uint8Array): ParsedEncBundleHeader {
  const minHeaderSize = MAGIC_BYTES.byteLength + 2 + 1 + IV_LENGTH + AUTH_TAG_LENGTH;
  if (bundleBytes.byteLength < minHeaderSize) {
    throw new Error("暗号化パッケージのサイズが不正です（ヘッダ長不足）。");
  }

  const magicSlice = bundleBytes.subarray(0, MAGIC_BYTES.byteLength);
  const magic = new TextDecoder().decode(magicSlice);
  if (magic !== ENC_BUNDLE_MAGIC) {
    throw new Error(
      `未対応のパッケージフォーマットです（Magic Bytes不一致: 期待値=${ENC_BUNDLE_MAGIC}）。`,
    );
  }

  const view = new DataView(
    bundleBytes.buffer,
    bundleBytes.byteOffset,
    bundleBytes.byteLength,
  );
  const encryptedKeyLength = view.getUint16(MAGIC_BYTES.byteLength, false); // Big Endian
  if (encryptedKeyLength === 0 || encryptedKeyLength > 2048) {
    throw new Error(`RSA暗号化鍵長フィールドが不正です（${encryptedKeyLength} bytes）。`);
  }

  const keyStart = MAGIC_BYTES.byteLength + 2;
  const ivStart = keyStart + encryptedKeyLength;
  const tagStart = ivStart + IV_LENGTH;
  const payloadStart = tagStart + AUTH_TAG_LENGTH;

  if (bundleBytes.byteLength < payloadStart) {
    throw new Error("暗号化パッケージが破損しています（ヘッダ領域が途中で終了しています）。");
  }

  return {
    magic,
    encryptedKeyLength,
    encryptedAesKey: bundleBytes.subarray(keyStart, ivStart),
    iv: bundleBytes.subarray(ivStart, tagStart),
    authTag: bundleBytes.subarray(tagStart, payloadStart),
    encryptedPayload: bundleBytes.subarray(payloadStart),
  };
}

/**
 * Hybrid-encrypt an archive payload using ephemeral AES-256-GCM + RSA-OAEP (SHA-256).
 *
 * Binary format (ENC_BUNDLE_V1):
 * - Magic Bytes: "ENC_BUNDLE_V1" (13 bytes)
 * - Encrypted AES Key Length: uint16 Big Endian (2 bytes)
 * - Encrypted AES Key Body: RSA-OAEP encrypted 32-byte key (N bytes)
 * - AES-GCM IV / Nonce: 12 bytes
 * - AES-GCM Auth Tag: 16 bytes
 * - Payload: AES-256-GCM ciphertext
 */
export function encryptBundle(
  archivePayload: Uint8Array,
  recipientPublicKeyPem: string,
): Uint8Array {
  const pubKeyObj = createPublicKey(recipientPublicKeyPem.trim());
  if (pubKeyObj.asymmetricKeyType !== "rsa") {
    throw new Error("暗号化にはRSA公開鍵が必要です。");
  }

  const aesKey = randomBytes(AES_KEY_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const ctPart1 = cipher.update(archivePayload);
  const ctPart2 = cipher.final();
  const authTag = cipher.getAuthTag();

  const encryptedAesKey = publicEncrypt(
    {
      key: pubKeyObj,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey,
  );

  // Zero out ephemeral key material after encrypting it
  aesKey.fill(0);

  const totalLength =
    MAGIC_BYTES.byteLength +
    2 +
    encryptedAesKey.byteLength +
    IV_LENGTH +
    AUTH_TAG_LENGTH +
    ctPart1.byteLength +
    ctPart2.byteLength;

  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);

  let offset = 0;
  output.set(MAGIC_BYTES, offset);
  offset += MAGIC_BYTES.byteLength;

  view.setUint16(offset, encryptedAesKey.byteLength, false); // Big Endian
  offset += 2;

  output.set(encryptedAesKey, offset);
  offset += encryptedAesKey.byteLength;

  output.set(iv, offset);
  offset += IV_LENGTH;

  output.set(authTag, offset);
  offset += AUTH_TAG_LENGTH;

  output.set(ctPart1, offset);
  offset += ctPart1.byteLength;

  output.set(ctPart2, offset);

  return output;
}

/**
 * Decrypt and authenticate an ENC_BUNDLE_V1 binary buffer using B-site's RSA private key.
 */
export function decryptBundle(
  bundleBytes: Uint8Array,
  recipientPrivateKeyPem: string,
): Uint8Array {
  const parsed = parseEncBundle(bundleBytes);

  let privKeyObj;
  try {
    privKeyObj = createPrivateKey(recipientPrivateKeyPem.trim());
  } catch (err) {
    throw new Error(
      `Bサイト秘密鍵の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let aesKey: Buffer;
  try {
    aesKey = privateDecrypt(
      {
        key: privKeyObj,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      parsed.encryptedAesKey,
    );
  } catch {
    throw new Error(
      "AES共通鍵のRSA復号に失敗しました。このBサイトの公開鍵宛てに暗号化されたファイルか確認してください。",
    );
  }

  if (aesKey.byteLength !== AES_KEY_LENGTH) {
    aesKey.fill(0);
    throw new Error("復号されたAES鍵長が不正です。");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", aesKey, parsed.iv);
    decipher.setAuthTag(parsed.authTag);
    const ptPart1 = decipher.update(parsed.encryptedPayload);
    const ptPart2 = decipher.final();

    const plaintext = new Uint8Array(ptPart1.byteLength + ptPart2.byteLength);
    plaintext.set(ptPart1, 0);
    plaintext.set(ptPart2, ptPart1.byteLength);
    return plaintext;
  } catch {
    throw new Error(
      "AES-256-GCM認証タグ検証に失敗しました。パッケージが改ざんまたは破損している可能性があります。",
    );
  } finally {
    aesKey.fill(0);
  }
}
