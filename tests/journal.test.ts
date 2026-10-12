import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createVault, PrivateDB, Vault } from "../src/lib/db";
import {
  defaultSettings,
  type Entry,
  type WearSession,
} from "../src/lib/models";
import {
  dailyWear,
  longestContinuous,
  totalWear,
  validateSession,
} from "../src/lib/time";
import { insights, validateSettings } from "../src/lib/journal";
import {
  exportBackup,
  importBackup,
  validateManifest,
} from "../src/lib/backup";
import { passwordKey, seal } from "../src/lib/crypto";
import { shareSummary } from "../src/lib/shareCard";
let db: PrivateDB, vault: Vault;
const jpeg = new Uint8Array([255, 216, 1, 2, 255, 217]);
const photo = (id = "p") => ({
  id,
  full: new Blob([jpeg]),
  thumb: new Blob([jpeg]),
});
const entry = (extra: Partial<Entry> = {}): Entry => ({
  id: "e",
  timestamp: Date.now() - 10000,
  note: "private note",
  tags: ["private tag"],
  wearing: "on",
  comfort: 4,
  photoIds: ["p"],
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});
const settings = () => ({
  ...defaultSettings(),
  templates: [{ id: "t", name: "Private template", text: "private question" }],
  gears: [
    {
      id: "g",
      name: "Private gear",
      material: "metal",
      size: "size",
      acquired: "",
      started: "",
      note: "private gear note",
      archived: false,
    },
  ],
});
beforeEach(async () => {
  db = new PrivateDB("journal-test-" + crypto.randomUUID());
  const v = await createVault("local-password", db);
  vault = new Vault(v.key, v.config, db);
});
afterEach(async () => {
  await db.delete();
});
describe("journal extensions", () => {
  it("upgrades v3 while preserving encrypted preferences and the revision", async () => {
    const Dexie = (await import("dexie")).default,
      name = "v3-upgrade-" + crypto.randomUUID(),
      old = new Dexie(name);
    old
      .version(3)
      .stores({
        meta: "key",
        entries: "id",
        sessions: "id",
        photos: "id,ownerId",
      });
    const prefs = settings(),
      sealed = await seal(
        vault.key,
        new TextEncoder().encode(JSON.stringify(prefs)),
        "journal-settings",
      );
    await old.table("meta").bulkPut([
      { key: "vault", value: vault.config },
      { key: "revision", value: 7 },
      { key: "journal-settings", value: { id: "journal-settings", sealed } },
    ]);
    old.close();
    const next = new PrivateDB(name);
    try {
      const snap = await new Vault(vault.key, vault.config, next).snapshot();
      expect(snap.revision).toBe(7);
      expect(snap.settings).toEqual(prefs);
      expect(next.verno).toBe(4);
    } finally {
      await next.delete();
    }
  });
  it("upgrades a v2 database without resetting its revision or records", async () => {
    const Dexie = (await import("dexie")).default;
    const name = "v2-upgrade-" + crypto.randomUUID(),
      old = new Dexie(name);
    old.version(2).stores({
      meta: "key",
      entries: "id",
      sessions: "id",
      photos: "id,ownerId",
    });
    await old.table("meta").bulkPut([
      { key: "vault", value: vault.config },
      { key: "revision", value: 42 },
    ]);
    const e = entry();
    const packet = await seal(
      vault.key,
      new TextEncoder().encode(JSON.stringify(e)),
      `entry:${e.id}`,
    );
    await old.table("entries").put({ id: e.id, sealed: packet });
    old.close();
    const upgraded = new PrivateDB(name);
    try {
      const next = new Vault(vault.key, vault.config, upgraded);
      const snap = await next.snapshot();
      expect(snap.revision).toBe(42);
      expect(snap.entries).toEqual([e]);
      expect(snap.settings).toEqual(defaultSettings());
      expect(upgraded.verno).toBe(4);
    } finally {
      await upgraded.delete();
    }
  });
  it("subtracts breaks before union, splits midnight, and preserves only short-break continuity", () => {
    const t = (s: string) => new Date(s).getTime();
    const start = t("2026-10-10T22:00:00+08:00"),
      end = t("2026-10-11T03:00:00+08:00");
    const s: WearSession = {
      id: "s",
      start,
      end,
      note: "",
      breaks: [
        {
          start: t("2026-10-10T23:30:00+08:00"),
          end: t("2026-10-11T00:30:00+08:00"),
        },
      ],
    };
    expect(totalWear([s], end)).toBe(4 * 3600000);
    expect(dailyWear([s], end)).toEqual({
      "2026-10-10": 1.5 * 3600000,
      "2026-10-11": 2.5 * 3600000,
    });
    expect(longestContinuous(s, end, 30)).toBe(2.5 * 3600000);
    expect(longestContinuous(s, end, 60)).toBe(4 * 3600000);
    // Another session can fill a break in the overall union.
    expect(
      totalWear(
        [
          s,
          {
            id: "other",
            start: t("2026-10-10T23:45:00+08:00"),
            end: t("2026-10-11T00:15:00+08:00"),
            note: "",
          },
        ],
        end,
      ),
    ).toBe(4.5 * 3600000);
  });
  it("excludes an ongoing break and rejects overlaps, out-of-range and unfinished breaks in ended sessions", () => {
    const now = Date.now(),
      s: WearSession = {
        id: "s",
        start: now - 3600000,
        end: null,
        note: "",
        breaks: [{ start: now - 600000, end: null }],
      };
    expect(totalWear([s], now)).toBe(3000000);
    expect(() => validateSession({ ...s, end: now })).toThrow("小憩");
    expect(() =>
      validateSession({ ...s, breaks: [{ start: s.start - 1, end: now }] }),
    ).toThrow();
    expect(() =>
      validateSession({
        ...s,
        breaks: [
          { start: now - 900000, end: now - 100000 },
          { start: now - 200000, end: null },
        ],
      }),
    ).toThrow();
  });
  it("encrypts settings, rejects stale edits and keeps settings and references through a full v3 restore", async () => {
    const prefs = settings();
    await vault.saveSettings(prefs, 0);
    const raw = await db.meta.get("journal-settings");
    expect(JSON.stringify(raw)).not.toContain("private question");
    await expect(
      vault.saveSettings({ ...prefs, fastTags: ["stale"] }, 0),
    ).rejects.toThrow("另一窗口");
    const now = Date.now(),
      s: WearSession = {
        id: "s",
        start: now - 3600000,
        end: null,
        note: "",
        gearId: "g",
        breaks: [{ start: now - 600000, end: now - 300000 }],
      };
    await vault.saveSession(s, 1);
    const e = entry({ gearId: "g", sessionId: "s" });
    await vault.saveEntry(e, [photo()], 2);
    const backup = await exportBackup(vault, "backup-password");
    expect(new TextDecoder().decode(await backup.arrayBuffer())).not.toContain(
      "Private gear",
    );
    const restored = await importBackup(backup, "backup-password");
    expect(restored.settings).toEqual(prefs);
    expect(restored.sessions).toEqual([s]);
    await vault.replace(
      restored.entries,
      restored.sessions,
      restored.photos,
      3,
      restored.settings,
    );
    expect((await vault.snapshot()).entries).toEqual([e]);
    expect((await vault.snapshot()).settings).toEqual(prefs);
    await vault.deleteSession("s", 4);
    expect((await vault.snapshot()).entries[0].sessionId).toBeUndefined();
  });
  it("rejects missing gear/session references and rolls back settings with a failed restore", async () => {
    const prefs = settings();
    await vault.saveSettings(prefs, 0);
    await vault.saveEntry(entry({ gearId: "g" }), [photo()], 1);
    await expect(vault.saveSettings(defaultSettings(), 2)).rejects.toThrow(
      "装备",
    );
    await expect(
      vault.saveEntry(entry({ sessionId: "missing" }), [], 2),
    ).rejects.toThrow("时段");
    const failure = vi
      .spyOn(db.meta, "put")
      .mockRejectedValueOnce(
        new DOMException("storage full", "QuotaExceededError"),
      );
    await expect(
      vault.replace([], [], [], 2, defaultSettings()),
    ).rejects.toThrow();
    failure.mockRestore();
    const snap = await vault.snapshot();
    expect(snap.revision).toBe(2);
    expect(snap.entries).toHaveLength(1);
    expect(snap.settings).toEqual(prefs);
    expect(() =>
      validateManifest({
        format: "private-log",
        version: 2,
        entries: [entry({ gearId: "missing" })],
        sessions: [],
        settings: prefs,
      }),
    ).toThrow();
    expect(() =>
      validateSettings({ ...prefs, breakThresholdMinutes: NaN }),
    ).toThrow();
  });
  it("replaces both photo sizes, refuses cross-entry ownership and reports ciphertext storage bytes", async () => {
    await vault.saveEntry(entry(), [photo()], 0);
    await expect(
      vault.saveEntry(entry({ id: "other" }), [photo()], 1),
    ).rejects.toThrow("另一条");
    await vault.saveEntry(
      entry({ photoIds: ["redacted"] }),
      [photo("redacted")],
      1,
    );
    expect(await db.photos.get("p")).toBeUndefined();
    expect(await db.photos.count()).toBe(1);
    const sizes = await vault.storageAnalysis();
    expect(sizes[0].count).toBe(1);
    expect(sizes[0].bytes).toBe(2 * (jpeg.length + 16 + 12));
  });
  it("counts only scored and explicit worn-time samples without treating missing comfort as zero", () => {
    const now = Date.now(),
      s: WearSession = {
        id: "s",
        start: now - 25 * 3600000,
        end: null,
        note: "",
        gearId: "g",
        breaks: [{ start: now - 3600000, end: now - 1800000 }],
      };
    const entries = [
      entry({ sessionId: "s", gearId: "g" }),
      entry({ id: "old", comfort: 1 }),
      entry({ id: "none", comfort: null, sessionId: "s" }),
      entry({
        id: "break",
        timestamp: now - 3000000,
        sessionId: "s",
        comfort: 1,
      }),
    ];
    const result = insights(entries, [s], settings(), now);
    expect(result.comfort.find((b) => b.name === "24–48h")).toMatchObject({
      average: 4,
      count: 1,
    });
    expect(result.comfort[0].average).toBeNull();
    expect(result.gears[0]).toMatchObject({
      average: 4,
      count: 1,
      hours: 24.5,
    });
    const share = shareSummary(entries, [s], now);
    expect(Object.keys(share).sort()).toEqual([
      "current",
      "heat",
      "hours",
      "longest",
    ]);
    expect(JSON.stringify(share)).not.toContain("private");
  });
  it("reads an original v2 backup and supplies default settings", async () => {
    const enc = new TextEncoder(),
      salt = new Uint8Array(16),
      key = await passwordKey("backup-password", salt),
      id = "legacy";
    const uint = (n: number) => {
      const a = new Uint8Array(4);
      new DataView(a.buffer).setUint32(0, n);
      return a;
    };
    const header = enc.encode(
      JSON.stringify({ version: 2, id, iterations: 600000, salt: [...salt] }),
    );
    const parts: BlobPart[] = [
      enc.encode("PRIVATELOG2\n"),
      uint(header.length),
      header,
    ];
    for (const [i, bytes] of [
      enc.encode(
        JSON.stringify({
          format: "private-log",
          version: 1,
          entries: [entry()],
          sessions: [],
        }),
      ),
      jpeg,
      jpeg,
      enc.encode("complete"),
    ].entries()) {
      const packet = await seal(key, bytes, `private-log-backup-v2:${id}:${i}`);
      parts.push(uint(12 + packet.data.length), packet.iv, packet.data);
    }
    const legacy = await importBackup(new Blob(parts), "backup-password");
    expect(legacy.entries).toHaveLength(1);
    expect(legacy.photos).toHaveLength(1);
    expect(legacy.settings).toEqual(defaultSettings());
  });
});
