import { seal, open, passwordKey, ITERATIONS } from "./crypto";
import type { Entry, WearSession, PhotoInput } from "./models";
import type { Vault } from "./db";
import { validateSession } from "./time";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const MAGIC = encoder.encode("PRIVATELOG2\n");
const MAX_FRAME = 64 * 1024 * 1024;
export interface BackupData {
  entries: Entry[];
  sessions: WearSession[];
  photos: PhotoInput[];
}
const uint = (n: number) => {
  const v = new Uint8Array(4);
  new DataView(v.buffer).setUint32(0, n);
  return v;
};
export async function exportBackup(
  vault: Vault,
  password: string,
): Promise<Blob> {
  if (password.length < 8) throw new Error("备份密码至少需要 8 个字符");
  const snapshot = await vault.snapshot();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const backupId = crypto.randomUUID();
  const key = await passwordKey(password, salt);
  const header = encoder.encode(
    JSON.stringify({
      version: 2,
      id: backupId,
      iterations: ITERATIONS,
      salt: Array.from(salt),
    }),
  );
  const parts: BlobPart[] = [MAGIC, uint(header.length), header];
  let index = 0;
  async function frame(data: Uint8Array) {
    if (data.length > MAX_FRAME - 28) throw new Error("单个备份条目过大");
    const sealed = await seal(
      key,
      data,
      `private-log-backup-v2:${backupId}:${index++}`,
    );
    parts.push(
      new Blob([uint(12 + sealed.data.length), sealed.iv, sealed.data]),
    );
  }
  await frame(
    encoder.encode(
      JSON.stringify({
        format: "private-log",
        version: 1,
        exportedAt: Date.now(),
        entries: snapshot.entries,
        sessions: snapshot.sessions,
      }),
    ),
  );
  for (const entry of snapshot.entries)
    for (const id of entry.photoIds)
      for (const thumbnail of [false, true])
        await frame(
          new Uint8Array(
            await (await vault.photo(id, thumbnail)).arrayBuffer(),
          ),
        );
  await frame(encoder.encode("complete"));
  if ((await vault.snapshot()).revision !== snapshot.revision)
    throw new Error("导出过程中数据有变更，请重新导出");
  return new Blob(parts, { type: "application/octet-stream" });
}
function validId(v: unknown): v is string {
  return typeof v === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(v);
}
function finite(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
export function validateManifest(value: unknown): {
  entries: Entry[];
  sessions: WearSession[];
} {
  const m = value as {
    format: string;
    version: number;
    entries: Entry[];
    sessions: WearSession[];
  };
  if (
    m?.format !== "private-log" ||
    m.version !== 1 ||
    !Array.isArray(m.entries) ||
    !Array.isArray(m.sessions) ||
    m.entries.length > 100000 ||
    m.sessions.length > 100000
  )
    throw new Error("不支持或损坏的备份格式");
  const ids = new Set<string>();
  const photoIds = new Set<string>();
  for (const e of m.entries) {
    if (
      !validId(e.id) ||
      ids.has(e.id) ||
      !finite(e.timestamp) ||
      e.timestamp > Date.now() ||
      !finite(e.createdAt) ||
      !finite(e.updatedAt) ||
      typeof e.note !== "string" ||
      e.note.length > 10000 ||
      !Array.isArray(e.tags) ||
      e.tags.length > 50 ||
      e.tags.some((t) => typeof t !== "string" || t.length > 100) ||
      !["on", "off", "unspecified"].includes(e.wearing) ||
      !(
        e.comfort === null ||
        (Number.isInteger(e.comfort) && e.comfort >= 1 && e.comfort <= 5)
      ) ||
      !Array.isArray(e.photoIds) ||
      !e.photoIds.length
    )
      throw new Error("备份中的打卡记录无效");
    ids.add(e.id);
    for (const id of e.photoIds) {
      if (!validId(id) || photoIds.has(id))
        throw new Error("备份中的照片引用重复或无效");
      photoIds.add(id);
    }
  }
  ids.clear();
  let active = 0;
  for (const s of m.sessions) {
    if (
      !validId(s.id) ||
      ids.has(s.id) ||
      typeof s.note !== "string" ||
      s.note.length > 10000
    )
      throw new Error("备份中的佩戴时段无效");
    validateSession(s);
    if (s.end === null) active++;
    ids.add(s.id);
  }
  if (active > 1) throw new Error("备份中存在多个进行中的佩戴时段");
  return { entries: m.entries, sessions: m.sessions };
}
export async function importBackup(
  blob: Blob,
  password: string,
): Promise<BackupData> {
  let position = 0,
    index = 0;
  async function read(count: number) {
    if (count < 0 || position + count > blob.size)
      throw new Error("备份文件被截断，现有记录未改变");
    const bytes = new Uint8Array(
      await blob.slice(position, position + count).arrayBuffer(),
    );
    position += count;
    return bytes;
  }
  if (decoder.decode(await read(MAGIC.length)) !== decoder.decode(MAGIC))
    throw new Error("这不是受支持的私记加密备份（版本 2）");
  const lengthBytes = await read(4);
  const headerLength = new DataView(lengthBytes.buffer).getUint32(0);
  if (headerLength < 1 || headerLength > 2048)
    throw new Error("备份文件头损坏");
  const header = JSON.parse(decoder.decode(await read(headerLength)));
  if (
    header.version !== 2 ||
    !validId(header.id) ||
    !Number.isInteger(header.iterations) ||
    !Array.isArray(header.salt) ||
    header.salt.length !== 16 ||
    header.salt.some(
      (v: unknown) => !Number.isInteger(v) || Number(v) < 0 || Number(v) > 255,
    )
  )
    throw new Error("备份加密参数无效");
  const key = await passwordKey(
    password,
    new Uint8Array(header.salt),
    header.iterations,
  );
  async function frame() {
    const lenBytes = await read(4);
    const length = new DataView(lenBytes.buffer).getUint32(0);
    if (length < 28 || length > MAX_FRAME) throw new Error("备份条目长度无效");
    const iv = await read(12),
      data = await read(length - 12);
    try {
      return await open(
        key,
        { iv, data },
        `private-log-backup-v2:${header.id}:${index++}`,
      );
    } catch {
      throw new Error("备份密码不正确，或文件已损坏。现有记录未改变。");
    }
  }
  const manifestBytes = await frame();
  if (manifestBytes.length > 20 * 1024 * 1024) throw new Error("备份清单过大");
  const manifest = validateManifest(JSON.parse(decoder.decode(manifestBytes)));
  const photos: PhotoInput[] = [];
  for (const entry of manifest.entries)
    for (const id of entry.photoIds) {
      const blobs: Blob[] = [];
      for (let i = 0; i < 2; i++) {
        const data = await frame();
        if (
          data.length < 4 ||
          data[0] !== 0xff ||
          data[1] !== 0xd8 ||
          data.at(-2) !== 0xff ||
          data.at(-1) !== 0xd9
        )
          throw new Error("备份缺少照片或照片格式损坏");
        blobs.push(new Blob([data], { type: "image/jpeg" }));
      }
      photos.push({ id, full: blobs[0], thumb: blobs[1] });
    }
  if (decoder.decode(await frame()) !== "complete" || position !== blob.size)
    throw new Error("备份不完整或包含未知条目");
  return { ...manifest, photos };
}
