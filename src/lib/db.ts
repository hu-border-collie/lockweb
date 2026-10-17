import Dexie, { type Table } from "dexie";
import type {
  Entry,
  WearSession,
  Row,
  PhotoRow,
  VaultConfig,
  PhotoInput,
  JournalSettings,
  QuickUnlockBinding,
} from "./models";
import { defaultSettings, QUICK_UNLOCK_META } from "./models";
import { validateLinks, validateSettings } from "./journal";
import { dayKey } from "./time";
import { validateManifest } from "./backup";
import { makeVault, sealJSON, openJSON, seal, open } from "./crypto";
import { validateSession } from "./time";
import { FATE_META, MAX_FATE_DRAWS, RITUAL_READY, defaultFate, validateFateConfig, validateFateState, pickFate, ritualStatus, fateNote, type FateState, type FateConfig, type FateDraw } from "./fate";
export class PrivateDB extends Dexie {
  meta!: Table<{ key: string; value: unknown }, string>;
  entries!: Table<Row, string>;
  sessions!: Table<Row, string>;
  photos!: Table<PhotoRow, string>;
  constructor(name = "private-log-vault") {
    super(name);
    this.version(1).stores({
      meta: "key",
      entries: "id",
      sessions: "id",
      photos: "id,ownerId",
    });
    this.version(2)
      .stores({
        meta: "key",
        entries: "id",
        sessions: "id",
        photos: "id,ownerId",
      })
      .upgrade((tx) => tx.table("meta").put({ key: "revision", value: 0 }));
    // Retain historical schemas so existing encrypted data can be migrated.
    this.version(3).stores({
      meta: "key",
      entries: "id",
      sessions: "id",
      photos: "id,ownerId",
    });
    this.version(4).stores({
      meta: "key",
      entries: "id",
      sessions: "id",
      photos: "id,ownerId",
    });
    // Dexie retries VersionError without a version, so version numbers alone
    // cannot isolate old clients. Move every store, including keys and photos.
    this.version(5)
      .stores({
        meta: null,
        entries: null,
        sessions: null,
        photos: null,
        vaultMeta: "key",
        journalEntries: "id",
        wearSessions: "id",
        journalPhotos: "id,ownerId",
      })
      .upgrade(async (tx) => {
        for (const [source, target] of [
          ["meta", "vaultMeta"],
          ["entries", "journalEntries"],
          ["sessions", "wearSessions"],
          ["photos", "journalPhotos"],
        ]) {
          // Copy one opaque row at a time within the upgrade transaction.
          // In particular, never load all encrypted photos into memory at once.
          await new Promise<void>((resolve, reject) => {
            const cursor = tx.idbtrans.objectStore(source).openCursor();
            cursor.onerror = () => reject(cursor.error);
            cursor.onsuccess = () => {
              const row = cursor.result;
              if (!row) return resolve();
              try {
                const write = tx.idbtrans.objectStore(target).add(row.value);
                write.onerror = () => reject(write.error);
                write.onsuccess = () => row.continue();
              } catch (e) {
                reject(e);
              }
            };
          });
        }
      });
    // Keep the Vault API stable while legacy clients address separate stores.
    this.meta = this.table("vaultMeta");
    this.entries = this.table("journalEntries");
    this.sessions = this.table("wearSessions");
    this.photos = this.table("journalPhotos");
    this.on("versionchange", () => this.close());
  }
}
export const db = new PrivateDB();
export const getConfig = async (database = db) =>
  (await database.meta.get("vault"))?.value as VaultConfig | undefined;
export async function createVault(
  password: string,
  database = db,
  signal?: AbortSignal,
) {
  const check = () => {
    if (signal?.aborted) throw new DOMException("操作已取消", "AbortError");
  };
  check();
  const vault = await makeVault(password);
  check();
  await database.transaction("rw", database.meta, async () => {
    check();
    if (await database.meta.get("vault"))
      throw new Error("保险库已存在，请解锁");
    await database.meta.bulkPut([
      { key: "vault", value: vault.config },
      { key: "revision", value: 0 },
    ]);
    check();
  });
  return vault;
}
export class Vault {
  constructor(
    public key: CryptoKey,
    public config: VaultConfig,
    public database = db,
  ) {}
  async snapshot() {
    const rows = await this.database.transaction(
      "r",
      this.database.meta,
      this.database.entries,
      this.database.sessions,
      async () => ({
        entries: await this.database.entries.toArray(),
        sessions: await this.database.sessions.toArray(),
        settings: (await this.database.meta.get("journal-settings"))?.value as
          | Row
          | undefined,
        fate: (await this.database.meta.get(FATE_META))?.value as Row | undefined,
        revision:
          ((await this.database.meta.get("revision"))?.value as number) ?? 0,
      }),
    );
    return {
      entries: await Promise.all(
        rows.entries.map((r) =>
          openJSON<Entry>(this.key, r.sealed, `entry:${r.id}`),
        ),
      ),
      sessions: await Promise.all(
        rows.sessions.map((r) =>
          openJSON<WearSession>(this.key, r.sealed, `session:${r.id}`),
        ),
      ),
      revision: rows.revision,
      fate: rows.fate
        ? validateFateState(await openJSON<FateState>(this.key, rows.fate.sealed, FATE_META))
        : defaultFate(),
      settings: rows.settings
        ? validateSettings(
            await openJSON<JournalSettings>(
              this.key,
              rows.settings.sealed,
              "journal-settings",
            ),
          )
        : defaultSettings(),
    };
  }
  private async mutate(revision: number, action: () => Promise<void>) {
    await this.database.transaction(
      "rw",
      this.database.meta,
      this.database.entries,
      this.database.sessions,
      this.database.photos,
      async () => {
        const config = await getConfig(this.database);
        if (config?.id !== this.config.id)
          throw new Error("保险库已改变，请重新打开应用");
        const current = (await this.database.meta.get("revision"))?.value ?? 0;
        if (current !== revision)
          throw new Error("记录已在另一窗口改变，请刷新后重试");
        await action();
        await this.database.meta.put({ key: "revision", value: revision + 1 });
      },
    );
  }
  async saveEntry(entry: Entry, photos: PhotoInput[], revision: number) {
    const snap = await this.snapshot();
    validateLinks([entry], snap.sessions, snap.settings);
    if (
      !(
        entry.comfort === null ||
        (Number.isInteger(entry.comfort) &&
          entry.comfort >= 1 &&
          entry.comfort <= 5)
      )
    )
      throw new Error("舒适度必须为 1 到 5，或未填写");
    if (
      !Number.isFinite(entry.timestamp) ||
      entry.timestamp > Date.now() ||
      entry.timestamp < 0
    )
      throw new Error("打卡时间无效或在未来");
    if (!entry.photoIds.length) throw new Error("请至少保留一张照片");
    if (
      entry.note.length > 10000 ||
      entry.tags.length > 50 ||
      entry.tags.some((t) => t.length > 100)
    )
      throw new Error("备注过长，或标签超过 50 个/每个超过 100 字符");
    if (new Set(entry.photoIds).size !== entry.photoIds.length)
      throw new Error("不能重复引用同一张照片");
    if (
      new Set(photos.map((p) => p.id)).size !== photos.length ||
      photos.some((p) => !entry.photoIds.includes(p.id))
    )
      throw new Error("新增照片引用无效");
    const row: Row = {
      id: entry.id,
      sealed: await sealJSON(this.key, entry, `entry:${entry.id}`),
    };
    const rows: PhotoRow[] = [];
    for (const p of photos)
      rows.push({
        id: p.id,
        ownerId: entry.id,
        full: await seal(
          this.key,
          new Uint8Array(await p.full.arrayBuffer()),
          `photo:${p.id}`,
        ),
        thumb: await seal(
          this.key,
          new Uint8Array(await p.thumb.arrayBuffer()),
          `thumb:${p.id}`,
        ),
      });
    await this.mutate(revision, async () => {
      for (const p of rows) {
        const existing = await this.database.photos.get(p.id);
        if (existing && existing.ownerId !== entry.id)
          throw new Error("照片已属于另一条记录");
      }
      const old = await this.database.photos
        .where("ownerId")
        .equals(entry.id)
        .toArray();
      await this.database.photos.bulkDelete(
        old.filter((p) => !entry.photoIds.includes(p.id)).map((p) => p.id),
      );
      await this.database.photos.bulkPut(rows);
      const present = await this.database.photos.bulkGet(entry.photoIds);
      if (present.some((p) => !p || p.ownerId !== entry.id))
        throw new Error("照片不完整，记录未保存");
      await this.database.entries.put(row);
    });
  }
  async deleteEntry(entry: Entry, revision: number) {
    await this.mutate(revision, async () => {
      await this.database.photos.where("ownerId").equals(entry.id).delete();
      await this.database.entries.delete(entry.id);
    });
  }
  async saveSession(session: WearSession, revision: number) {
    validateSession(session);
    validateLinks([], [session], (await this.snapshot()).settings);
    const sealed = await sealJSON(this.key, session, `session:${session.id}`);
    await this.mutate(revision, async () => {
      if (session.end === null) {
        const rows = await this.database.sessions.toArray();
        for (const r of rows) {
          if (r.id !== session.id) {
            const s = await Dexie.waitFor(
              openJSON<WearSession>(this.key, r.sealed, `session:${r.id}`),
            );
            if (s.end === null)
              throw new Error("已有进行中的佩戴时段，请先结束它");
          }
        }
      }
      await this.database.sessions.put({ id: session.id, sealed });
    });
  }
  async deleteSession(id: string, revision: number) {
    const snapshot = await this.snapshot();
    const linked = await Promise.all(
      snapshot.entries
        .filter((e) => e.sessionId === id)
        .map(async (e) => {
          const { sessionId: _removed, ...entry } = e;
          return {
            id: entry.id,
            sealed: await sealJSON(this.key, entry, `entry:${entry.id}`),
          };
        }),
    );
    await this.mutate(revision, async () => {
      await this.database.entries.bulkPut(linked);
      await this.database.sessions.delete(id);
    });
  }
  async photo(id: string, thumb = false) {
    const row = await this.database.photos.get(id);
    if (!row) throw new Error("照片未找到");
    return new Blob(
      [
        await open(
          this.key,
          thumb ? row.thumb : row.full,
          `${thumb ? "thumb" : "photo"}:${id}`,
        ),
      ],
      { type: "image/jpeg" },
    );
  }
  async changePassword(password: string, revision: number) {
    const { config } = await makeVault(password, this.key, this.config.id);
    await this.mutate(revision, async () => {
      await this.database.meta.put({ key: "vault", value: config });
      await this.database.meta.delete(QUICK_UNLOCK_META);
    });
    this.config = config;
  }
  async clear(revision: number) {
    await this.mutate(revision, async () => {
      await this.database.entries.clear();
      await this.database.sessions.clear();
      await this.database.photos.clear();
      await this.database.meta.delete(QUICK_UNLOCK_META);
      await this.database.meta.delete(FATE_META);
    });
  }
  async replace(
    entries: Entry[],
    sessions: WearSession[],
    photos: PhotoInput[],
    revision: number,
    settings: JournalSettings = defaultSettings(),
    fate: FateState = defaultFate(),
  ) {
    validateManifest({
      format: "private-log",
      version: 3,
      entries,
      sessions,
      settings,
      fate,
    });
    const expected = new Set(entries.flatMap((e) => e.photoIds));
    if (
      photos.length !== expected.size ||
      new Set(photos.map((p) => p.id)).size !== photos.length ||
      photos.some((p) => !expected.has(p.id))
    )
      throw new Error("恢复照片引用不完整或重复");
    const settingRow = {
      id: "journal-settings",
      sealed: await sealJSON(this.key, settings, "journal-settings"),
    };
    const fateRow = { id: FATE_META, sealed: await sealJSON(this.key, fate, FATE_META) };
    const er = await Promise.all(
      entries.map(async (e) => ({
        id: e.id,
        sealed: await sealJSON(this.key, e, `entry:${e.id}`),
      })),
    );
    const sr = await Promise.all(
      sessions.map(async (s) => ({
        id: s.id,
        sealed: await sealJSON(this.key, s, `session:${s.id}`),
      })),
    );
    const owner = new Map(
      entries.flatMap((e) =>
        e.photoIds.map((p) => [p, e.id] as [string, string]),
      ),
    );
    const pr: PhotoRow[] = [];
    for (const p of photos)
      pr.push({
        id: p.id,
        ownerId: owner.get(p.id)!,
        full: await seal(
          this.key,
          new Uint8Array(await p.full.arrayBuffer()),
          `photo:${p.id}`,
        ),
        thumb: await seal(
          this.key,
          new Uint8Array(await p.thumb.arrayBuffer()),
          `thumb:${p.id}`,
        ),
      });
    await this.mutate(revision, async () => {
      await this.database.entries.clear();
      await this.database.sessions.clear();
      await this.database.photos.clear();
      await this.database.entries.bulkPut(er);
      await this.database.sessions.bulkPut(sr);
      await this.database.photos.bulkPut(pr);
      await this.database.meta.put({
        key: "journal-settings",
        value: settingRow,
      });
      await this.database.meta.delete(QUICK_UNLOCK_META);
      await this.database.meta.put({ key: FATE_META, value: fateRow });
    });
  }
  async saveFateConfig(config: FateConfig, revision: number) {
    validateFateConfig(config);
    const snap = await this.snapshot();
    const fate = validateFateState({ ...snap.fate, config });
    const row = { id: FATE_META, sealed: await sealJSON(this.key, fate, FATE_META) };
    await this.mutate(revision, async () => {
      await this.database.meta.put({ key: FATE_META, value: row });
    });
  }
  async drawFate(revision: number): Promise<FateDraw> {
    const snap = await this.snapshot(), now = Date.now();
    if (snap.fate.draws.length >= MAX_FATE_DRAWS) throw new Error("轮盘记录已达 20000 次，请先备份并整理数据");
    if (snap.fate.config.mode === "ritual") {
      const status = ritualStatus(snap.fate, snap.entries, now);
      if (status !== RITUAL_READY) throw new Error(status);
    }
    const active = snap.sessions.find((s) => s.end === null);
    const draw: FateDraw = {
      id: crypto.randomUUID(), timestamp: now, day: dayKey(now),
      timezoneOffset: new Date(now).getTimezoneOffset(), mode: snap.fate.config.mode,
      wheelName: snap.fate.config.name, slice: pickFate(snap.fate.config),
      totalWeight: snap.fate.config.slices.reduce((n, s) => n + s.weight, 0),
      ...(active ? { sessionId: active.id } : {}),
    };
    const fate = validateFateState({ ...snap.fate, draws: [...snap.fate.draws, draw] });
    const row = { id: FATE_META, sealed: await sealJSON(this.key, fate, FATE_META) };
    // Revision validation and the sealed result are committed in one transaction.
    // The caller starts animation only after this promise succeeds.
    await this.mutate(revision, async () => {
      await this.database.meta.put({ key: FATE_META, value: row });
    });
    return draw;
  }
  async attachFateNote(drawId: string, entryId: string, revision: number) {
    const snap = await this.snapshot(), today = dayKey(Date.now());
    const draw = snap.fate.draws.find((d) => d.id === drawId);
    const entry = snap.entries.find((e) => e.id === entryId);
    if (!draw || !entry || draw.day !== today || dayKey(entry.timestamp) !== today)
      throw new Error("请选择今日判定和今日打卡");
    if (draw.attachedEntryId) throw new Error("这次判定已写入打卡");
    const note = [entry.note, fateNote(draw)].filter(Boolean).join("\n");
    if (note.length > 10000) throw new Error("打卡备注过长，请先缩短备注");
    const entryRow = { id: entry.id, sealed: await sealJSON(this.key, { ...entry, note, updatedAt: Date.now() }, `entry:${entry.id}`) };
    const fate = { ...snap.fate, draws: snap.fate.draws.map((d) => d.id === drawId ? { ...d, attachedEntryId: entry.id } : d) };
    const fateRow = { id: FATE_META, sealed: await sealJSON(this.key, fate, FATE_META) };
    await this.mutate(revision, async () => {
      await this.database.entries.put(entryRow);
      await this.database.meta.put({ key: FATE_META, value: fateRow });
    });
  }
  async saveSettings(settings: JournalSettings, revision: number) {
    validateSettings(settings);
    const snap = await this.snapshot();
    validateLinks(snap.entries, snap.sessions, settings);
    const row = {
      id: "journal-settings",
      sealed: await sealJSON(this.key, settings, "journal-settings"),
    };
    await this.mutate(revision, async () => {
      await this.database.meta.put({ key: "journal-settings", value: row });
    });
  }
  async saveQuickUnlock(
    binding: QuickUnlockBinding,
    revision: number,
    check: () => void = () => {},
  ) {
    if (binding.vaultId !== this.config.id)
      throw new Error("保险库已改变，请重新解锁");
    await this.mutate(revision, async () => {
      check();
      await this.database.meta.put({ key: QUICK_UNLOCK_META, value: binding });
      check();
    });
  }
  async disableQuickUnlock(revision: number) {
    await this.mutate(revision, async () => {
      await this.database.meta.delete(QUICK_UNLOCK_META);
    });
  }
  async storageAnalysis() {
    const data = await this.database.transaction(
      "r",
      this.database.entries,
      this.database.photos,
      async () => {
        const entries = await this.database.entries.toArray();
        const sizes: { ownerId: string; bytes: number }[] = [];
        await this.database.photos.each((p) => {
          sizes.push({
            ownerId: p.ownerId,
            bytes:
              p.full.data.byteLength +
              p.full.iv.byteLength +
              p.thumb.data.byteLength +
              p.thumb.iv.byteLength,
          });
        });
        return { entries, sizes };
      },
    );
    const months = new Map<
      string,
      { month: string; count: number; bytes: number }
    >();
    const owners = new Map<string, string>();
    for (const r of data.entries) {
      const e = await openJSON<Entry>(this.key, r.sealed, `entry:${r.id}`);
      owners.set(e.id, dayKey(e.timestamp).slice(0, 7));
    }
    for (const p of data.sizes) {
      const month = owners.get(p.ownerId) ?? "未关联";
      const group = months.get(month) ?? { month, count: 0, bytes: 0 };
      group.count++;
      group.bytes += p.bytes;
      months.set(month, group);
    }
    return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  }
}
export function userError(error: unknown) {
  const e = error as Error;
  return /quota/i.test(e?.name + " " + e?.message)
    ? "设备存储空间不足，操作未保存。请先备份，再释放空间。"
    : e?.message || "操作失败，请重试";
}
