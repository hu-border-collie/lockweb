import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateDB, Vault, createVault } from "../src/lib/db";
import { defaultSettings, type Entry } from "../src/lib/models";
import { FATE_META, defaultFate, fatePreset, fateSectors, pickFate, randomBelow, validateFateConfig, validateFateState } from "../src/lib/fate";
import { exportBackup, importBackup, validateManifest } from "../src/lib/backup";
import { ITERATIONS, passwordKey, seal } from "../src/lib/crypto";
let database: PrivateDB, vault: Vault, now: number;
const jpeg = new Uint8Array([255, 216, 1, 2, 255, 217]);
const photo = () => ({ id: "p", full: new Blob([jpeg]), thumb: new Blob([jpeg]) });
function entry(extra: Partial<Entry> = {}): Entry {
    return { id: "e", timestamp: now - 1000, createdAt: now - 1000, updatedAt: now - 1000, photoIds: ["p"], note: "original", tags: [], wearing: "on", comfort: null, ...extra };
}
beforeEach(async () => {
    now = new Date(2026, 9, 13, 12).getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);
    database = new PrivateDB("fate-test-" + crypto.randomUUID());
    const v = await createVault("local-password", database);
    vault = new Vault(v.key, v.config, database);
});
afterEach(async () => { vi.restoreAllMocks(); await database.delete(); });
describe("durable encrypted fate", () => {
    it("reads existing vaults with stable defaults without changing data or revision", async () => {
        const first = await vault.snapshot(), second = await vault.snapshot();
        expect(first.fate).toEqual(second.fate);
        expect(first.revision).toBe(0);
        expect(first.settings).toEqual(defaultSettings());
        expect(await database.meta.get(FATE_META)).toBeUndefined();
    });
    it("uses rejection sampling rather than biased modulo or Math.random", () => {
        const samples = [0xffffffff, 7];
        const rng = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
            (array as Uint32Array)[0] = samples.shift()!;
            return array;
        });
        const insecure = vi.spyOn(Math, "random");
        expect(randomBelow(10)).toBe(7);
        expect(rng).toHaveBeenCalledTimes(2);
        expect(insecure).not.toHaveBeenCalled();
        for (const limit of [0, -1, 1.5, NaN, 0x100000001])
            expect(() => randomBelow(limit)).toThrow();
    });
    it("selects exact weighted boundary outcomes and sizes visual sectors by weight", () => {
        const config = fatePreset();
        const rng = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
            (array as Uint32Array)[0] = 50;
            return array;
        });
        expect(pickFate(config).id).toBe(config.slices[1].id);
        rng.mockImplementation((array) => { (array as Uint32Array)[0] = 99; return array; });
        expect(pickFate(config).id).toBe(config.slices[3].id);
        const sectors = fateSectors(config.slices);
        expect(sectors[0].end).toBe(180);
        expect(sectors.at(-1)!.end).toBe(360);
    });
    it("requires a new photo check-in today, not yesterday or a retimed old entry", async () => {
        await expect(vault.drawFate(0)).rejects.toThrow("今天先拍一张");
        await vault.saveEntry(entry({ createdAt: now - 86400000 }), [photo()], 0);
        await expect(vault.drawFate(1)).rejects.toThrow("今天先拍一张");
        await vault.saveEntry(entry({ timestamp: now - 86400000 }), [], 1);
        await expect(vault.drawFate(2)).rejects.toThrow("今天先拍一张");
        expect((await vault.snapshot()).fate.draws).toHaveLength(0);
    });
    it("persists a result before returning, encrypts every label/date and survives reopen/deletion", async () => {
        await vault.saveEntry(entry(), [photo()], 0);
        const draw = await vault.drawFate(1);
        expect(draw.mode).toBe("ritual");
        const raw = JSON.stringify(await database.meta.get(FATE_META));
        expect(raw).not.toContain(draw.slice.label);
        expect(raw).not.toContain(draw.day);
        expect(raw).not.toContain("draws");
        database.close();
        await database.open();
        const reopened = new Vault(vault.key, vault.config, database);
        expect((await reopened.snapshot()).fate.draws).toEqual([draw]);
        await reopened.deleteEntry(entry(), 2);
        await expect(reopened.drawFate(3)).rejects.toThrow("今天的仪式已经做过了");
    });
    it("allows only one concurrent commit across two vault clients", async () => {
        await vault.saveEntry(entry(), [photo()], 0);
        const other = new Vault(vault.key, vault.config, database);
        const results = await Promise.allSettled([vault.drawFate(1), other.drawFate(1)]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect((await vault.snapshot()).fate.draws).toHaveLength(1);
        expect((await vault.snapshot()).revision).toBe(2);
    });
    it("does not consume an attempt on quota failure or on a stale revision", async () => {
        await vault.saveEntry(entry(), [photo()], 0);
        await expect(vault.drawFate(0)).rejects.toThrow("另一窗口");
        const failed = vi.spyOn(database.meta, "put").mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
        await expect(vault.drawFate(1)).rejects.toThrow();
        failed.mockRestore();
        expect((await vault.snapshot()).fate.draws).toHaveLength(0);
        expect((await vault.snapshot()).revision).toBe(1);
        await vault.drawFate(1);
    });
    it("keeps ritual cooldown when switching modes/presets and freezes historical results", async () => {
        await vault.saveEntry(entry(), [photo()], 0);
        const original = await vault.drawFate(1);
        await vault.saveFateConfig(fatePreset(true, "free"), 2);
        const sandbox = await vault.drawFate(3);
        expect(sandbox.mode).toBe("free");
        await vault.saveFateConfig(fatePreset(true), 4);
        await expect(vault.drawFate(5)).rejects.toThrow("今天的仪式已经做过了");
        expect((await vault.snapshot()).fate.draws[0]).toEqual(original);
    });
    it("unlocks a fresh local date but still requires that day's new check-in", async () => {
        await vault.saveEntry(entry(), [photo()], 0);
        await vault.drawFate(1);
        now = new Date(2026, 9, 14, 0, 1).getTime();
        vi.mocked(Date.now).mockReturnValue(now);
        await expect(vault.drawFate(2)).rejects.toThrow("今天先拍一张");
        await vault.saveEntry(entry({ id: "next", photoIds: ["next-p"] }), [{ ...photo(), id: "next-p" }], 2);
        await vault.drawFate(3);
        expect((await vault.snapshot()).fate.draws.map((d) => d.day)).toEqual(["2026-10-13", "2026-10-14"]);
    });
    it("links the current session without modifying actual start/end/breaks", async () => {
        const session = { id: "s", start: now - 600000, end: null, note: "" };
        await vault.saveSession(session, 0);
        await vault.saveFateConfig(fatePreset(true, "free"), 1);
        const draw = await vault.drawFate(2);
        expect(draw.sessionId).toBe("s");
        expect((await vault.snapshot()).sessions).toEqual([session]);
    });
    it("atomically appends the result exactly once and preserves photos and existing notes", async () => {
        await vault.saveEntry(entry(), [photo()], 0);
        const draw = await vault.drawFate(1);
        const failed = vi.spyOn(database.meta, "put").mockRejectedValueOnce(new Error("full"));
        await expect(vault.attachFateNote(draw.id, "e", 2)).rejects.toThrow();
        failed.mockRestore();
        expect((await vault.snapshot()).entries[0].note).toBe("original");
        expect((await vault.snapshot()).fate.draws[0].attachedEntryId).toBeUndefined();
        await vault.attachFateNote(draw.id, "e", 2);
        const snap = await vault.snapshot();
        expect(snap.entries[0].note).toContain("original\n[🎲 命运判定]");
        expect(snap.fate.draws[0].attachedEntryId).toBe("e");
        expect(await database.photos.count()).toBe(1);
        await expect(vault.attachFateNote(draw.id, "e", 3)).rejects.toThrow("已写入");
    });
    it("includes configuration, immutable outcomes, attribution and cooldown in v4 encrypted backups", async () => {
        await vault.saveEntry(entry(), [photo()], 0);
        await vault.drawFate(1);
        const expected = (await vault.snapshot()).fate;
        const blob = await exportBackup(vault, "backup-password");
        expect(new TextDecoder().decode(await blob.slice(0, 12).arrayBuffer())).toBe("PRIVATELOG4\n");
        expect(new TextDecoder().decode(await blob.arrayBuffer())).not.toContain(expected.config.name);
        const parsed = await importBackup(blob, "backup-password");
        await vault.clear(2);
        expect((await vault.snapshot()).fate.draws).toHaveLength(0);
        await vault.replace(parsed.entries, parsed.sessions, parsed.photos, 3, parsed.settings, parsed.fate);
        expect((await vault.snapshot()).fate).toEqual(expected);
        await expect(vault.drawFate(4)).rejects.toThrow("今天的仪式已经做过了");
    });
    it("reads historical v3 backups with default fate instead of dropping unknown new data", async () => {
        const enc = new TextEncoder(), salt = crypto.getRandomValues(new Uint8Array(16)), id = crypto.randomUUID();
        const key = await passwordKey("backup-password", salt);
        const header = enc.encode(JSON.stringify({ version: 3, id, iterations: ITERATIONS, salt: [...salt] }));
        const uint = (n: number) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n); return a; };
        const parts: BlobPart[] = [enc.encode("PRIVATELOG3\n"), uint(header.length), header];
        for (const [i, value] of [JSON.stringify({ format: "private-log", version: 2, entries: [], sessions: [], settings: defaultSettings() }), "complete"].entries()) {
            const s = await seal(key, enc.encode(value), `private-log-backup-v3:${id}:${i}`);
            parts.push(uint(s.data.length + 12), s.iv, s.data);
        }
        const parsed = await importBackup(new Blob(parts), "backup-password");
        expect(parsed.fate).toEqual(defaultFate());
        expect(() => validateManifest({ format: "private-log", version: 2, entries: [], sessions: [], settings: defaultSettings(), fate: defaultFate() })).toThrow("未知轮盘");
        expect(() => validateManifest({ format: "private-log", version: 3, entries: [], sessions: [], settings: defaultSettings() })).toThrow("轮盘记录");
    });
    it("rolls back fate and journal together if a restore fails", async () => {
        await vault.saveFateConfig(fatePreset(true, "free"), 0);
        await vault.drawFate(1);
        const before = await vault.snapshot();
        const fail = vi.spyOn(database.meta, "put").mockRejectedValueOnce(new Error("full"));
        await expect(vault.replace([], [], [], 2, defaultSettings(), defaultFate())).rejects.toThrow();
        fail.mockRestore();
        expect(await vault.snapshot()).toEqual(before);
    });
    it("rejects malformed configurations and duplicate/day-mismatched outcomes", async () => {
        const config = fatePreset();
        for (const change of [{ weight: 0 }, { weight: 1.2 }, { color: "url(x)" }, { label: " " }, { kind: "extra", extraMinutes: 0 }])
            expect(() => validateFateConfig({ ...config, slices: [{ ...config.slices[0], ...change }, config.slices[1]] })).toThrow();
        await vault.saveEntry(entry(), [photo()], 0);
        await vault.drawFate(1);
        const fate = (await vault.snapshot()).fate;
        expect(() => validateFateState({ ...fate, draws: [...fate.draws, { ...fate.draws[0], id: "duplicate-day" }] })).toThrow("重复");
        expect(() => validateFateState({ ...fate, draws: [{ ...fate.draws[0], day: "2026-10-12" }] })).toThrow("日期");
    });
});
