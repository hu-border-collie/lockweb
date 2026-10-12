import type { Sealed, VaultConfig } from "./models";
export const ITERATIONS = 600_000;
const enc = new TextEncoder();
export async function passwordKey(
  password: string,
  salt: Uint8Array,
  iterations = ITERATIONS,
) {
  if (iterations < 100_000 || iterations > 2_000_000 || salt.length !== 16)
    throw new Error("不支持的加密参数");
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(
  key: CryptoKey,
  bytes: Uint8Array,
  context: string,
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(context) },
      key,
      bytes,
    ),
  );
  return { iv, data };
}
export async function open(key: CryptoKey, sealed: Sealed, context: string) {
  if (sealed.iv.length !== 12) throw new Error("加密数据格式损坏");
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv, additionalData: enc.encode(context) },
      key,
      sealed.data,
    ),
  );
}
export const sealJSON = (key: CryptoKey, value: unknown, context: string) =>
  seal(key, enc.encode(JSON.stringify(value)), context);
export async function openJSON<T>(
  key: CryptoKey,
  value: Sealed,
  context: string,
): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await open(key, value, context)));
}
export async function makeVault(
  password: string,
  key?: CryptoKey,
  vaultId: string = crypto.randomUUID(),
): Promise<{ config: VaultConfig; key: CryptoKey }> {
  if (password.length < 8) throw new Error("密码至少需要 8 个字符");
  key ??= await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pwKey = await passwordKey(password, salt);
  const wrapped = await seal(
    pwKey,
    new Uint8Array(await crypto.subtle.exportKey("raw", key)),
    `vault:${vaultId}`,
  );
  return {
    config: { version: 1, id: vaultId, salt, iterations: ITERATIONS, wrapped },
    key,
  };
}
export async function unlockVault(
  config: VaultConfig,
  password: string,
): Promise<CryptoKey> {
  try {
    const bytes = await open(
      await passwordKey(password, config.salt, config.iterations),
      config.wrapped,
      `vault:${config.id}`,
    );
    return await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
  } catch {
    throw new Error("密码不正确，或本地密钥已损坏");
  }
}
