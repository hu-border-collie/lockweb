import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVault, PrivateDB, Vault } from "../src/lib/db";
import { archiveCutoff, archivePhotos, planArchive } from "../src/lib/storage";
import { exportBackup, importBackup } from "../src/lib/backup";
import type { Entry } from "../src/lib/models";

let db: PrivateDB, vault: Vault;
const jpeg = (size: number, byte: number) =>
  new Blob([
    new Uint8Array([255, 216]),
    new Uint8Array(size - 4).fill(byte),
    new Uint8Array([255, 217]),
  ]);
const full = jpeg(4000, 7);
const thumb = jpeg(100, 3);
const cutoff = new Date(2025, 10, 1).getTime();
beforeEach(async () => {
  db = new PrivateDB(`storage-${crypto.randomUUID()}`);
  const v = await createVault("local-password", db);
  vault = new Vault(v.key, v.config, db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});
async function add(id: string, timestamp = cutoff - 1) {
  const e: Entry = {
    id,
    timestamp,
    note: "private note",
    tags: ["tag"],
    wearing: "on",
    comfort: 3,
    photoIds: [`p-${id}`],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const rev = (await vault.snapshot()).revision;
  await vault.saveEntry(e, [{ id: `p-${id}`, full, thumb }], rev);
  return e;
}
async function execute(
  mode: "compressed" | "thumbnail" = "thumbnail",
  compress = vi.fn(async () => thumb),
) {
  const plan = await planArchive(vault, cutoff, mode);
  const backup = { vaultId: vault.config.id, revision: plan.revision };
  return archivePhotos(
    vault,
    plan,
    backup,
    new AbortController().signal,
    () => {},
    compress,
  );
}
describe("historical photo archive", () => {
  it("clamps month ends, preserves leap days, and uses local midnight", () => {
    expect(new Date(archiveCutoff(6, new Date(2026, 7, 31, 17)))).toEqual(
      new Date(2026, 1, 28),
    );
    expect(new Date(archiveCutoff(12, new Date(2024, 1, 29, 10)))).toEqual(
      new Date(2023, 1, 28),
    );
  });
  it("selects strictly older record dates and leaves cutoff and newer photos intact", async () => {
    const old = await add("old");
    await add("boundary", cutoff);
    await add("new", cutoff + 1);
    const before = await vault.snapshot();
    const plan = await planArchive(vault, cutoff, "thumbnail");
    expect(plan.photos).toEqual([{ id: "p-old", ownerId: "old" }]);
    const result = await execute();
    expect(result).toEqual({ processed: 1, changed: 1, saved: 3900 });
    expect(
      (await vault.snapshot()).entries.find((e) => e.id === old.id),
    ).toEqual(old);
    expect((await vault.snapshot()).revision).toBe(before.revision + 1);
    expect(await (await vault.photo("p-old")).arrayBuffer()).toEqual(
      await thumb.arrayBuffer(),
    );
    expect(await (await vault.photo("p-old", true)).arrayBuffer()).toEqual(
      await thumb.arrayBuffer(),
    );
    expect((await vault.photo("p-boundary")).size).toBe(4000);
    expect((await vault.photo("p-new")).size).toBe(4000);
    expect((await db.photos.get("p-old"))!.full.data).not.toEqual(
      new Uint8Array(await thumb.arrayBuffer()),
    );
  });
  it("rejects a stale/mismatched backup and a stale plan without changing any ciphertext", async () => {
    await add("old");
    const plan = await planArchive(vault, cutoff, "thumbnail");
    const original = await db.photos.get("p-old");
    for (const backup of [
      { vaultId: "other", revision: plan.revision },
      { vaultId: vault.config.id, revision: 0 },
    ]) {
      await expect(
        archivePhotos(
          vault,
          plan,
          backup,
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow("备份");
    }
    await add("new", cutoff + 1);
    await expect(
      archivePhotos(
        vault,
        plan,
        { vaultId: vault.config.id, revision: plan.revision },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("已改变");
    expect(await db.photos.get("p-old")).toEqual(original);
  });
  it("keeps equal or larger encodings and thumbnails unchanged without advancing revision", async () => {
    await add("old");
    const original = await db.photos.get("p-old");
    expect(
      await execute(
        "compressed",
        vi.fn(async () => full),
      ),
    ).toEqual({ processed: 1, changed: 0, saved: 0 });
    expect(
      await execute(
        "compressed",
        vi.fn(async () => new Blob([new Uint8Array(5000)])),
      ),
    ).toEqual({ processed: 1, changed: 0, saved: 0 });
    expect(await db.photos.get("p-old")).toEqual(original);
    expect((await vault.snapshot()).revision).toBe(1);
  });
  it("commits one photo and revision at a time; stopping preserves remaining full photos", async () => {
    await add("first");
    await add("second");
    const plan = await planArchive(vault, cutoff, "thumbnail"),
      abort = new AbortController();
    const progress = vi.fn(() => abort.abort());
    await expect(
      archivePhotos(
        vault,
        plan,
        { vaultId: vault.config.id, revision: plan.revision },
        abort.signal,
        progress,
      ),
    ).rejects.toThrow();
    expect(progress).toHaveBeenCalledOnce();
    expect((await vault.photo("p-first")).size).toBe(100);
    expect((await vault.photo("p-second")).size).toBe(4000);
    expect((await vault.snapshot()).revision).toBe(3);
  });
  it("rejects a write racing image encoding and stops without overwriting the concurrent change", async () => {
    await add("old");
    await expect(
      execute(
        "compressed",
        vi.fn(async () => {
          await add("new", cutoff + 1);
          return thumb;
        }),
      ),
    ).rejects.toThrow("另一窗口");
    expect((await vault.photo("p-old")).size).toBe(4000);
    expect((await vault.snapshot()).revision).toBe(2);
  });
  it("rolls back a photo write when the revision update fails", async () => {
    await add("old");
    const original = await db.photos.get("p-old");
    vi.spyOn(db.meta, "put").mockRejectedValueOnce(
      new DOMException("storage full", "QuotaExceededError"),
    );
    await expect(execute()).rejects.toThrow("storage full");
    expect(await db.photos.get("p-old")).toEqual(original);
    expect((await vault.snapshot()).revision).toBe(1);
  });
  it("rolls back the current photo when cancellation arrives during its transaction", async () => {
    await add("old");
    const original = await db.photos.get("p-old"),
      plan = await planArchive(vault, cutoff, "thumbnail");
    const abort = new AbortController(),
      put = db.photos.put.bind(db.photos);
    vi.spyOn(db.photos, "put").mockImplementationOnce(async (...args) => {
      const result = await put(...args);
      abort.abort();
      return result;
    });
    await expect(
      archivePhotos(
        vault,
        plan,
        { vaultId: vault.config.id, revision: plan.revision },
        abort.signal,
        () => {},
      ),
    ).rejects.toThrow();
    expect(await db.photos.get("p-old")).toEqual(original);
    expect((await vault.snapshot()).revision).toBe(1);
  });
  it("stops after a decode failure, preserving committed progress and remaining photos", async () => {
    await add("a");
    await add("b");
    await add("c");
    const compress = vi
      .fn()
      .mockResolvedValueOnce(thumb)
      .mockRejectedValueOnce(new Error("decode failed"));
    await expect(execute("compressed", compress)).rejects.toThrow(
      "decode failed",
    );
    expect((await vault.photo("p-a")).size).toBe(100);
    expect((await vault.photo("p-b")).size).toBe(4000);
    expect((await vault.photo("p-c")).size).toBe(4000);
    expect((await vault.snapshot()).revision).toBe(4);
  });
  it("round-trips archived photos and restores full detail from the pre-archive backup", async () => {
    const e = await add("old");
    const before = await exportBackup(vault, "backup-password");
    await execute();
    const archived = await importBackup(
      await exportBackup(vault, "backup-password"),
      "backup-password",
    );
    expect(archived.entries).toEqual([e]);
    expect(archived.photos[0].full.size).toBe(100);
    expect(archived.photos[0].thumb.size).toBe(100);
    const original = await importBackup(before, "backup-password");
    await vault.replace(
      original.entries,
      original.sessions,
      original.photos,
      2,
      original.settings,
      original.fate,
    );
    expect((await vault.photo("p-old")).size).toBe(4000);
    expect((await vault.snapshot()).entries).toEqual([e]);
  });
});
