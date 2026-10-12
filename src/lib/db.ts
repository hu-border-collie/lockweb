import Dexie, { type Table } from "dexie";
import type {
  Entry,
  WearSession,
  Row,
  PhotoRow,
  VaultConfig,
  PhotoInput,
} from "./models";
import { makeVault, sealJSON, openJSON, seal, open } from "./crypto";
import { validateSession } from "./time";
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
    this.on("versionchange", () => this.close());
  }
}
export const db = new PrivateDB();
export const getConfig = async (database = db) =>
  (await database.meta.get("vault"))?.value as VaultConfig | undefined;
export async function createVault(password: string, database = db) {
  const vault = await makeVault(password);
  await database.transaction("rw", database.meta, async () => {
    if (await database.meta.get("vault"))
      throw new Error("保险库已存在，请解锁");
    await database.meta.bulkPut([
      { key: "vault", value: vault.config },
      { key: "revision", value: 0 },
    ]);
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
    await this.mutate(revision, async () => {
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
    });
    this.config = config;
  }
  async clear(revision: number) {
    await this.mutate(revision, async () => {
      await this.database.entries.clear();
      await this.database.sessions.clear();
      await this.database.photos.clear();
    });
  }
  async replace(
    entries: Entry[],
    sessions: WearSession[],
    photos: PhotoInput[],
    revision: number,
  ) {
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
    });
  }
}
export function userError(error: unknown) {
  const e = error as Error;
  return /quota/i.test(e?.name + " " + e?.message)
    ? "设备存储空间不足，操作未保存。请先备份，再释放空间。"
    : e?.message || "操作失败，请重试";
}
