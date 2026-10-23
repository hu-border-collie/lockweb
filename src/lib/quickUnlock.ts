import Dexie from "dexie";
import { db, getConfig, Vault, type PrivateDB } from "./db";
import {
  QUICK_UNLOCK_META,
  type QuickUnlockBinding,
  type QuickUnlockWindowHours,
  type VaultConfig,
} from "./models";
import { open, openJSON, seal, sealJSON, unlockVault } from "./crypto";
import { beginSystemDialog, endSystemDialog } from "./privacy";

const enc = new TextEncoder();
const WINDOWS = [0, 1, 12, 24, 168, 720];
const expiry = (authorizedAt: number, hours: QuickUnlockWindowHours) =>
  hours === 0 ? null : authorizedAt + hours * 3600000;
export const LOCK_EVENT = "private-log-lock";
export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const configText = (c: VaultConfig) =>
  JSON.stringify([
    c.version,
    c.id,
    c.iterations,
    base64url(c.salt),
    base64url(c.wrapped.iv),
    base64url(c.wrapped.data),
  ]);
export async function configFingerprint(c: VaultConfig) {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", enc.encode(configText(c))),
    ),
  );
}
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("操作已取消", "AbortError");
};
const bytes = (v: unknown, min: number, max = min): v is Uint8Array =>
  v instanceof Uint8Array && v.length >= min && v.length <= max;
const packet = (v: unknown) => {
  const p = v as { iv?: unknown; data?: unknown };
  return p && bytes(p.iv, 12) && bytes(p.data, 16, 4096);
};
export function validBinding(value: unknown): value is QuickUnlockBinding {
  const b = value as QuickUnlockBinding;
  return (
    !!b &&
    b.version === 1 &&
    typeof b.id === "string" &&
    b.id.length <= 80 &&
    typeof b.vaultId === "string" &&
    b.vaultId.length <= 80 &&
    typeof b.configFingerprint === "string" &&
    b.configFingerprint.length === 43 &&
    typeof b.origin === "string" &&
    b.origin.length <= 2048 &&
    typeof b.rpId === "string" &&
    b.rpId.length <= 253 &&
    bytes(b.credentialId, 1, 1024) &&
    bytes(b.publicKey, 1, 1024) &&
    bytes(b.prfInput, 32) &&
    bytes(b.hkdfSalt, 32) &&
    WINDOWS.includes(b.windowHours) &&
    Number.isSafeInteger(b.authorizedAt) &&
    b.authorizedAt >= 0 &&
    b.authorizedAt <= 8640000000000000 &&
    (b.windowHours === 0
      ? b.expiresAt === null
      : typeof b.expiresAt === "number" &&
        b.expiresAt === expiry(b.authorizedAt, b.windowHours) &&
        b.expiresAt <= 8640000000000000) &&
    packet(b.wrapped) &&
    b.wrapped.data.length === 48 &&
    packet(b.authorization)
  );
}
const context = (
  b: Pick<
    QuickUnlockBinding,
    | "id"
    | "vaultId"
    | "configFingerprint"
    | "origin"
    | "rpId"
    | "credentialId"
    | "publicKey"
    | "prfInput"
    | "hkdfSalt"
    | "windowHours"
  >,
) =>
  JSON.stringify([
    "private-log-quick-unlock-v1",
    b.id,
    b.vaultId,
    b.configFingerprint,
    b.origin,
    b.rpId,
    base64url(b.credentialId),
    base64url(b.publicKey),
    base64url(b.prfInput),
    base64url(b.hkdfSalt),
    b.windowHours,
  ]);
export function bindingCurrent(
  b: QuickUnlockBinding,
  config: VaultConfig,
  origin: string,
  rpId: string,
  now = Date.now(),
) {
  return (
    validBinding(b) &&
    b.vaultId === config.id &&
    b.origin === origin &&
    b.rpId === rpId &&
    (b.expiresAt === null || (now >= b.authorizedAt && now < b.expiresAt))
  );
}
export async function readQuickBinding(
  config: VaultConfig,
  database: PrivateDB = db,
  origin = location.origin,
  rpId = location.hostname,
) {
  const row = (await database.meta.get(QUICK_UNLOCK_META))?.value;
  if (
    !validBinding(row) ||
    row.vaultId !== config.id ||
    row.origin !== origin ||
    row.rpId !== rpId ||
    row.configFingerprint !== (await configFingerprint(config))
  )
    return null;
  return row;
}
export async function quickCapability(): Promise<boolean> {
  try {
    return (
      window.isSecureContext &&
      window.top === window &&
      typeof PublicKeyCredential !== "undefined" &&
      !!navigator.credentials &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}
function credential(value: Credential | null): PublicKeyCredential {
  if (
    !value ||
    value.type !== "public-key" ||
    !("rawId" in value) ||
    !("getClientExtensionResults" in value)
  )
    throw new Error("系统没有返回通行密钥，请使用密码");
  return value as PublicKeyCredential;
}
async function verifyClient(
  raw: ArrayBuffer,
  type: string,
  challenge: Uint8Array,
  origin: string,
) {
  if (raw.byteLength > 8192) throw new Error("系统认证数据无效");
  const client = JSON.parse(new TextDecoder().decode(raw));
  if (
    client.type !== type ||
    client.challenge !== base64url(challenge) ||
    client.origin !== origin ||
    (client.crossOrigin !== undefined && client.crossOrigin !== false)
  )
    throw new Error("系统认证的来源或挑战不匹配");
}
async function verifyAuthenticator(raw: ArrayBuffer, rpId: string) {
  const data = new Uint8Array(raw);
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", enc.encode(rpId)),
  );
  if (
    data.length < 37 ||
    !equal(data.slice(0, 32), hash) ||
    (data[32] & 5) !== 5
  )
    throw new Error("系统未完成用户验证，或站点不匹配");
}
// WebAuthn ES256 signatures use ASN.1 DER; Web Crypto verifies the fixed-width form.
export function derSignature(raw: ArrayBuffer): Uint8Array {
  const a = new Uint8Array(raw),
    out = new Uint8Array(64);
  let pos = 2;
  if (a.length < 8 || a.length > 72 || a[0] !== 0x30 || a[1] !== a.length - 2)
    throw new Error("系统签名格式无效");
  for (let i = 0; i < 2; i++) {
    if (a[pos++] !== 2) throw new Error("系统签名格式无效");
    let len = a[pos++];
    if (len < 1 || len > 33 || pos + len > a.length || a[pos] & 128)
      throw new Error("系统签名格式无效");
    if (len > 1 && a[pos] === 0) {
      if (!(a[pos + 1] & 128)) throw new Error("系统签名格式无效");
      pos++;
      len--;
    }
    if (len > 32) throw new Error("系统签名格式无效");
    out.set(a.slice(pos, pos + len), (i + 1) * 32 - len);
    pos += len;
  }
  if (pos !== a.length) throw new Error("系统签名格式无效");
  return out;
}
export interface PasswordGrant {
  config: VaultConfig;
  fingerprint: string;
  key: CryptoKey;
  revision: number;
  verifiedAt: number;
}
export interface PendingQuickUnlock {
  grant: PasswordGrant;
  id: string;
  credentialId: Uint8Array;
  publicKey: Uint8Array;
  prfInput: Uint8Array;
  hkdfSalt: Uint8Array;
  windowHours: QuickUnlockWindowHours;
  origin: string;
  rpId: string;
}
export async function authorizeQuickEnrollment(
  vault: Vault,
  password: string,
  signal?: AbortSignal,
): Promise<PasswordGrant> {
  const snapshot = await vault.database.transaction(
    "r",
    vault.database.meta,
    async () => ({
      config: await getConfig(vault.database),
      revision:
        ((await vault.database.meta.get("revision"))?.value as number) ?? 0,
    }),
  );
  if (
    !snapshot.config ||
    configText(snapshot.config) !== configText(vault.config)
  )
    throw new Error("密码或本机数据已在另一窗口改变，请重新解锁");
  const key = await unlockVault(snapshot.config, password);
  abort(signal);
  await ensureConfig(snapshot.config, vault.database, signal);
  return {
    config: snapshot.config,
    fingerprint: await configFingerprint(snapshot.config),
    key,
    revision: snapshot.revision,
    verifiedAt: Date.now(),
  };
}
function checkGrant(grant: PasswordGrant, signal?: AbortSignal) {
  abort(signal);
  if (
    Date.now() < grant.verifiedAt ||
    Date.now() - grant.verifiedAt > 5 * 60000
  )
    throw new Error("密码确认已过期，请重新确认");
}
export function reuseQuickCredential(
  grant: PasswordGrant,
  binding: QuickUnlockBinding,
  windowHours: QuickUnlockWindowHours,
): PendingQuickUnlock {
  checkGrant(grant);
  if (
    binding.configFingerprint !== grant.fingerprint ||
    binding.vaultId !== grant.config.id
  )
    throw new Error("绑定已改变，请重新确认密码");
  return {
    grant,
    id: crypto.randomUUID(),
    credentialId: binding.credentialId,
    publicKey: binding.publicKey,
    prfInput: binding.prfInput,
    hkdfSalt: crypto.getRandomValues(new Uint8Array(32)),
    windowHours,
    origin: binding.origin,
    rpId: binding.rpId,
  };
}
export async function createQuickCredential(
  grant: PasswordGrant,
  windowHours: QuickUnlockWindowHours,
  signal: AbortSignal,
): Promise<PendingQuickUnlock> {
  checkGrant(grant, signal);
  if (!WINDOWS.includes(windowHours)) throw new Error("快速解锁有效期无效");
  const origin = location.origin,
    rpId = location.hostname,
    challenge = crypto.getRandomValues(new Uint8Array(32)),
    prfInput = crypto.getRandomValues(new Uint8Array(32));
  beginSystemDialog();
  try {
    // Start the system call before any awaited I/O, preserving Safari's user activation.
    const c = credential(
      await navigator.credentials.create({
        signal,
        publicKey: {
          challenge,
          rp: { id: rpId, name: "私记 · 本地解锁" },
          user: {
            id: crypto.getRandomValues(new Uint8Array(32)),
            name: `private-log-${grant.config.id.slice(0, 8)}`,
            displayName: "私记",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "required",
            userVerification: "required",
          },
          attestation: "none",
          timeout: 60000,
          extensions: { prf: { eval: { first: prfInput } } },
        },
      }),
    );
    abort(signal);
    const response = c.response as AuthenticatorAttestationResponse;
    if (
      typeof response.getPublicKey !== "function" ||
      typeof response.getAuthenticatorData !== "function" ||
      response.getPublicKeyAlgorithm() !== -7
    )
      throw new Error("此环境无法验证通行密钥，请使用密码");
    await verifyClient(
      response.clientDataJSON,
      "webauthn.create",
      challenge,
      origin,
    );
    await verifyAuthenticator(response.getAuthenticatorData(), rpId);
    const publicKey = response.getPublicKey();
    if (!publicKey || c.getClientExtensionResults().prf?.enabled !== true)
      throw new Error(
        "此通行密钥无法用于快速解锁，请继续使用密码。可在系统密码设置中删除刚创建的通行密钥。",
      );
    await crypto.subtle.importKey(
      "spki",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    checkGrant(grant, signal);
    return {
      grant,
      id: crypto.randomUUID(),
      credentialId: new Uint8Array(c.rawId),
      publicKey: new Uint8Array(publicKey),
      prfInput,
      hkdfSalt: crypto.getRandomValues(new Uint8Array(32)),
      windowHours,
      origin,
      rpId,
    };
  } finally {
    endSystemDialog();
  }
}
async function assertion(
  target: Pick<
    PendingQuickUnlock,
    "credentialId" | "publicKey" | "prfInput" | "origin" | "rpId"
  >,
  signal: AbortSignal,
) {
  abort(signal);
  if (location.origin !== target.origin || location.hostname !== target.rpId)
    throw new Error("站点已改变，请使用密码");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  beginSystemDialog();
  try {
    const c = credential(
      await navigator.credentials.get({
        signal,
        publicKey: {
          challenge,
          rpId: target.rpId,
          allowCredentials: [
            {
              type: "public-key",
              id: target.credentialId,
              transports: ["internal"],
            },
          ],
          userVerification: "required",
          timeout: 60000,
          extensions: { prf: { eval: { first: target.prfInput } } },
        },
      }),
    );
    abort(signal);
    const response = c.response as AuthenticatorAssertionResponse;
    if (!equal(new Uint8Array(c.rawId), target.credentialId))
      throw new Error("系统返回的通行密钥不匹配");
    await verifyClient(
      response.clientDataJSON,
      "webauthn.get",
      challenge,
      target.origin,
    );
    await verifyAuthenticator(response.authenticatorData, target.rpId);
    const hash = new Uint8Array(
        await crypto.subtle.digest("SHA-256", response.clientDataJSON),
      ),
      data = new Uint8Array(response.authenticatorData.byteLength + 32);
    data.set(new Uint8Array(response.authenticatorData));
    data.set(hash, response.authenticatorData.byteLength);
    const publicKey = await crypto.subtle.importKey(
      "spki",
      target.publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        derSignature(response.signature),
        data,
      ))
    )
      throw new Error("通行密钥签名验证失败");
    const result = c.getClientExtensionResults().prf?.results?.first;
    if (!result) throw new Error("此通行密钥无法用于快速解锁，请使用密码");
    const secret = new Uint8Array(
      result instanceof ArrayBuffer
        ? result
        : result.buffer.slice(
            result.byteOffset,
            result.byteOffset + result.byteLength,
          ),
    );
    if (secret.length !== 32) throw new Error("PRF 密钥格式无效");
    abort(signal);
    return secret;
  } finally {
    endSystemDialog();
  }
}
async function wrappingKey(
  secret: Uint8Array,
  b: Parameters<typeof context>[0],
) {
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      secret,
      "HKDF",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: b.hkdfSalt,
        info: enc.encode(context(b)),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    secret.fill(0);
  }
}
export async function finishQuickEnrollment(
  vault: Vault,
  pending: PendingQuickUnlock,
  signal: AbortSignal,
) {
  checkGrant(pending.grant, signal);
  const secret = await assertion(pending, signal);
  checkGrant(pending.grant, signal);
  const base = {
    version: 1 as const,
    id: pending.id,
    vaultId: pending.grant.config.id,
    configFingerprint: pending.grant.fingerprint,
    origin: pending.origin,
    rpId: pending.rpId,
    credentialId: pending.credentialId,
    publicKey: pending.publicKey,
    prfInput: pending.prfInput,
    hkdfSalt: pending.hkdfSalt,
    windowHours: pending.windowHours,
  };
  const key = await wrappingKey(secret, base),
    raw = new Uint8Array(
      await crypto.subtle.exportKey("raw", pending.grant.key),
    );
  try {
    const wrapped = await seal(key, raw, context(base));
    const authorizedAt = pending.grant.verifiedAt,
      expiresAt = expiry(authorizedAt, base.windowHours);
    const authorization = await sealJSON(
      pending.grant.key,
      { authorizedAt, expiresAt },
      `window:${context(base)}`,
    );
    const binding: QuickUnlockBinding = {
      ...base,
      authorizedAt,
      expiresAt,
      wrapped,
      authorization,
    };
    if (!validBinding(binding)) throw new Error("快速解锁绑定格式无效");
    checkGrant(pending.grant, signal);
    await ensureConfig(pending.grant.config, vault.database, signal);
    abort(signal);
    await vault.saveQuickUnlock(binding, pending.grant.revision, () =>
      checkGrant(pending.grant, signal),
    );
    return binding;
  } finally {
    raw.fill(0);
  }
}
export async function ensureConfig(
  config: VaultConfig,
  database: PrivateDB = db,
  signal?: AbortSignal,
) {
  abort(signal);
  const current = await getConfig(database);
  abort(signal);
  if (!current || configText(current) !== configText(config))
    throw new Error("密码或本机数据已改变，请重新输入密码");
}
async function authenticatedWindow(
  key: CryptoKey,
  b: QuickUnlockBinding,
  allowExpired = false,
) {
  const stamp = await openJSON<{
    authorizedAt: number;
    expiresAt: number | null;
  }>(key, b.authorization, `window:${context(b)}`);
  if (
    stamp.authorizedAt !== b.authorizedAt ||
    stamp.expiresAt !== b.expiresAt ||
    (!allowExpired &&
      stamp.expiresAt !== null &&
      (Date.now() < stamp.authorizedAt || Date.now() >= stamp.expiresAt))
  )
    throw new Error("快速解锁有效期已过期或无效，请输入密码");
}
async function quickGuard(
  config: VaultConfig,
  binding: QuickUnlockBinding,
  key: CryptoKey,
  database: PrivateDB,
  signal: AbortSignal,
) {
  abort(signal);
  await database.transaction("r", database.meta, async () => {
    const current = await getConfig(database),
      raw = (await database.meta.get(QUICK_UNLOCK_META))?.value;
    if (
      !current ||
      configText(current) !== configText(config) ||
      !validBinding(raw) ||
      context(raw) !== context(binding) ||
      !equal(raw.wrapped.iv, binding.wrapped.iv) ||
      !equal(raw.wrapped.data, binding.wrapped.data)
    )
      throw new Error("快速解锁绑定已撤销或改变，请输入密码");
    await Dexie.waitFor(authenticatedWindow(key, raw));
    abort(signal);
  });
}
export async function unlockWithQuickBinding(
  config: VaultConfig,
  binding: QuickUnlockBinding,
  signal: AbortSignal,
  database: PrivateDB = db,
) {
  if (!bindingCurrent(binding, config, location.origin, location.hostname))
    throw new Error("快速解锁有效期已过期，请输入密码");
  const secret = await assertion(binding, signal),
    wrapper = await wrappingKey(secret, binding);
  abort(signal);
  const raw = await open(wrapper, binding.wrapped, context(binding));
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
    const guard = () => quickGuard(config, binding, key, database, signal);
    await guard();
    return { vault: new Vault(key, config, database), guard };
  } finally {
    raw.fill(0);
  }
}
export async function unlockWithPassword(
  config: VaultConfig,
  password: string,
  signal: AbortSignal,
  database: PrivateDB = db,
) {
  const key = await unlockVault(config, password);
  await ensureConfig(config, database, signal);
  // Password entry can renew the authenticated window; a failed renewal never blocks password access.
  try {
    const fingerprint = await configFingerprint(config);
    await database.transaction("rw", database.meta, async () => {
      const current = await getConfig(database),
        b = (await database.meta.get(QUICK_UNLOCK_META))?.value;
      abort(signal);
      if (!current || configText(current) !== configText(config))
        throw new Error("本机数据已改变");
      if (
        !validBinding(b) ||
        b.configFingerprint !== fingerprint ||
        b.vaultId !== config.id ||
        b.origin !== location.origin ||
        b.rpId !== location.hostname
      )
        return;
      await Dexie.waitFor(authenticatedWindow(key, b, true));
      const authorizedAt = Date.now(),
        expiresAt = expiry(authorizedAt, b.windowHours);
      const authorization = await Dexie.waitFor(
        sealJSON(key, { authorizedAt, expiresAt }, `window:${context(b)}`),
      );
      abort(signal);
      await database.meta.put({
        key: QUICK_UNLOCK_META,
        value: { ...b, authorizedAt, expiresAt, authorization },
      });
      const revision =
        ((await database.meta.get("revision"))?.value as number) ?? 0;
      await database.meta.put({ key: "revision", value: revision + 1 });
      abort(signal);
    });
  } catch {
    /* The normal password path remains available if a binding is damaged or storage is full. */
  }
  const guard = () => ensureConfig(config, database, signal);
  await guard();
  return { vault: new Vault(key, config, database), guard };
}
export function quickError(error: unknown) {
  const e = error as Error;
  if (e.name === "NotAllowedError" || e.name === "AbortError")
    return "系统验证已取消或未完成，可继续使用密码。";
  if (e.name === "NotSupportedError" || e.name === "SecurityError")
    return "当前环境不支持此快速解锁方式，请使用密码。";
  if (e.name === "OperationError")
    return "快速解锁密钥无法解密，请输入密码后重新绑定。";
  return e.message || "快速解锁失败，请使用密码。";
}
