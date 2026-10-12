import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrivateDB, createVault, Vault, getConfig } from "../src/lib/db";
import { unlockVault, seal, open, makeVault } from "../src/lib/crypto";
import {
  exportBackup,
  importBackup,
  validateManifest,
} from "../src/lib/backup";
import type { Entry, PhotoInput } from "../src/lib/models";
let database: PrivateDB, vault: Vault;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const input = (id = "p1"): PhotoInput => ({
  id,
  full: new Blob([jpeg], { type: "image/jpeg" }),
  thumb: new Blob([jpeg], { type: "image/jpeg" }),
});
const entry = (id = "e1", photoIds = ["p1"]): Entry => ({
  id,
  timestamp: Date.now() - 10000,
  note: "私密备注",
  tags: ["日常"],
  wearing: "on",
  comfort: 4,
  photoIds,
  createdAt: Date.now() - 10000,
  updatedAt: Date.now() - 10000,
});
beforeEach(async () => {
  database = new PrivateDB("test-" + crypto.randomUUID());
  const v = await createVault("local-password", database);
  vault = new Vault(v.key, v.config, database);
});
afterEach(async () => {
  await database.delete();
});
describe("encrypted storage and backup integrity", () => {
  it("encrypts notes and photos, decrypts after reopening, and does not create wear sessions", async () => {
    const e = entry();
    await vault.saveEntry(e, [input()], 0);
    const raw = await database.entries.get(e.id);
    expect(new TextDecoder().decode(raw!.sealed.data)).not.toContain(e.note);
    expect((await database.photos.get("p1"))!.full.data).not.toEqual(jpeg);
    expect(await database.sessions.count()).toBe(0);
    database.close();
    await database.open();
    const c = (await getConfig(database))!;
    const reopened = new Vault(
      await unlockVault(c, "local-password"),
      c,
      database,
    );
    expect((await reopened.snapshot()).entries).toEqual([e]);
    expect(
      new Uint8Array(await (await reopened.photo("p1")).arrayBuffer()),
    ).toEqual(jpeg);
  });
  it("rejects wrong password and authenticated-data tampering", async () => {
    await expect(unlockVault(vault.config, "wrong-password")).rejects.toThrow(
      "密码",
    );
    const packet = await seal(vault.key, jpeg, "a");
    await expect(open(vault.key, packet, "b")).rejects.toThrow();
    packet.data[0] ^= 1;
    await expect(open(vault.key, packet, "a")).rejects.toThrow();
  });
  it("roundtrips all records, full photos and thumbnails through a distinct backup password", async () => {
    const e = entry("e1", ["p1", "p2"]);
    await vault.saveEntry(e, [input("p1"), input("p2")], 0);
    const s = {
      id: "s1",
      start: Date.now() - 3600000,
      end: null,
      note: "跨天测试",
    };
    await vault.saveSession(s, 1);
    const backup = await exportBackup(vault, "backup-password");
    expect(new TextDecoder().decode(await backup.arrayBuffer())).not.toContain(
      "私密备注",
    );
    const restored = await importBackup(backup, "backup-password");
    expect(restored.entries).toEqual([e]);
    expect(restored.sessions).toEqual([s]);
    expect(restored.photos).toHaveLength(2);
    await vault.clear(2);
    expect((await vault.snapshot()).entries).toHaveLength(0);
    await vault.replace(
      restored.entries,
      restored.sessions,
      restored.photos,
      3,
    );
    expect((await vault.snapshot()).entries).toEqual([e]);
    expect(
      new Uint8Array(await (await vault.photo("p2", true)).arrayBuffer()),
    ).toEqual(jpeg);
  });
  it("detects incorrect password, corruption, truncation and trailing content without modifying the database", async () => {
    await vault.saveEntry(entry(), [input()], 0);
    const backup = await exportBackup(vault, "backup-password");
    await expect(importBackup(backup, "wrong-password")).rejects.toThrow(
      "密码",
    );
    const data = new Uint8Array(await backup.arrayBuffer());
    data[data.length - 1] ^= 1;
    await expect(
      importBackup(new Blob([data]), "backup-password"),
    ).rejects.toThrow();
    await expect(
      importBackup(backup.slice(0, backup.size - 10), "backup-password"),
    ).rejects.toThrow();
    await expect(
      importBackup(new Blob([backup, new Uint8Array([0])]), "backup-password"),
    ).rejects.toThrow("未知");
    expect((await vault.snapshot()).entries).toHaveLength(1);
  });
  it("restores to a new vault with a different local password", async () => {
    await vault.saveEntry(entry(), [input()], 0);
    const backup = await exportBackup(vault, "backup-password");
    const restored = await importBackup(backup, "backup-password");
    const second = new PrivateDB("test-" + crypto.randomUUID());
    try {
      const v = await createVault("different-password", second);
      const fresh = new Vault(v.key, v.config, second);
      await fresh.replace(
        restored.entries,
        restored.sessions,
        restored.photos,
        0,
      );
      expect((await fresh.snapshot()).entries[0].note).toBe("私密备注");
      expect(
        new Uint8Array(await (await fresh.photo("p1")).arrayBuffer()),
      ).toEqual(jpeg);
    } finally {
      await second.delete();
    }
  });
  it("deletes removed photos, then deletes the entire record atomically", async () => {
    const e = entry("e1", ["p1", "p2"]);
    await vault.saveEntry(e, [input("p1"), input("p2")], 0);
    await vault.saveEntry({ ...e, photoIds: ["p2"] }, [], 1);
    expect(await database.photos.count()).toBe(1);
    expect(await database.photos.get("p1")).toBeUndefined();
    await vault.deleteEntry(e, 2);
    expect(await database.photos.count()).toBe(0);
    expect(await database.entries.count()).toBe(0);
  });
  it("rolls back a failed entry save instead of leaving orphaned photos", async () => {
    await expect(
      vault.saveEntry(entry("e1", ["p1", "missing"]), [input()], 0),
    ).rejects.toThrow("照片不完整");
    expect(await database.photos.count()).toBe(0);
    expect(await database.entries.count()).toBe(0);
    expect((await vault.snapshot()).revision).toBe(0);
  });
  it("rejects stale-tab writes and duplicate ongoing sessions", async () => {
    await vault.saveSession(
      { id: "s1", start: Date.now() - 10000, end: null, note: "" },
      0,
    );
    await expect(vault.saveEntry(entry(), [input()], 0)).rejects.toThrow(
      "另一窗口",
    );
    await expect(
      vault.saveSession(
        { id: "s2", start: Date.now() - 5000, end: null, note: "" },
        1,
      ),
    ).rejects.toThrow("已有");
    expect((await vault.snapshot()).sessions).toHaveLength(1);
  });
  it("changes the password by rewrapping the existing data key", async () => {
    await vault.saveEntry(entry(), [input()], 0);
    await vault.changePassword("new-password", 1);
    const c = (await getConfig(database))!;
    await expect(unlockVault(c, "local-password")).rejects.toThrow();
    const reopened = new Vault(
      await unlockVault(c, "new-password"),
      c,
      database,
    );
    expect((await reopened.snapshot()).entries).toHaveLength(1);
    expect(
      new Uint8Array(await (await reopened.photo("p1")).arrayBuffer()),
    ).toEqual(jpeg);
  });
  it("rejects malformed manifests and duplicate references before writing", () => {
    const base = {
      format: "private-log",
      version: 1,
      entries: [entry()],
      sessions: [],
    };
    expect(() =>
      validateManifest({ ...base, entries: [entry(), entry()] }),
    ).toThrow();
    expect(() =>
      validateManifest({ ...base, entries: [entry("e1", ["p1", "p1"])] }),
    ).toThrow();
    expect(() => validateManifest({ ...base, version: 9 })).toThrow();
    expect(() =>
      validateManifest({ ...base, entries: [{ ...entry(), comfort: 8 }] }),
    ).toThrow();
  });
  it("migrates database schema v1 to v2 without dropping encrypted records", async () => {
    const name = "migration-" + crypto.randomUUID();
    const Dexie = (await import("dexie")).default;
    const old = new Dexie(name);
    old.version(1).stores({
      meta: "key",
      entries: "id",
      sessions: "id",
      photos: "id,ownerId",
    });
    const { config, key } = await makeVault("migration-password");
    await old.table("meta").put({ key: "vault", value: config });
    const packet = await seal(
      key,
      new TextEncoder().encode(JSON.stringify(entry())),
      "entry:e1",
    );
    await old.table("entries").put({ id: "e1", sealed: packet });
    old.close();
    const next = new PrivateDB(name);
    try {
      const migrated = new Vault(key, config, next);
      expect((await migrated.snapshot()).entries).toHaveLength(1);
      expect((await next.meta.get("revision"))!.value).toBe(0);
    } finally {
      await next.delete();
    }
  });
  it("rolls back a restore that hits a storage quota error", async () => {
    const existing = entry();
    await vault.saveEntry(existing, [input()], 0);
    const replacement = entry("e2", ["p2"]);
    const failure = vi
      .spyOn(database.photos, "bulkPut")
      .mockRejectedValueOnce(
        new DOMException("storage full", "QuotaExceededError"),
      );
    await expect(
      vault.replace([replacement], [], [input("p2")], 1),
    ).rejects.toThrow();
    failure.mockRestore();
    expect((await vault.snapshot()).entries).toEqual([existing]);
    expect((await vault.snapshot()).revision).toBe(1);
    expect(await database.photos.count()).toBe(1);
  });
});
