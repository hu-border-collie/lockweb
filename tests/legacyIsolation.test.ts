import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { PrivateDB, Vault, getConfig } from "../src/lib/db";
import { makeVault, sealJSON, seal, openJSON } from "../src/lib/crypto";
import {
  defaultSettings,
  QUICK_UNLOCK_META,
  type WearSession,
} from "../src/lib/models";

const legacySchema = {
  meta: "key",
  entries: "id",
  sessions: "id",
  photos: "id,ownerId",
};
const jpeg = new Uint8Array([255, 216, 1, 2, 255, 217]);

async function legacyVault(version: number) {
  const name = "legacy-isolation-" + crypto.randomUUID();
  const old = new Dexie(name);
  old.version(version).stores(legacySchema);
  old.on("versionchange", () => old.close());
  const { key, config } = await makeVault("local-password");
  const session: WearSession = {
    id: "s",
    start: Date.now() - 3600000,
    end: null,
    note: "private",
    gearId: "g",
    breaks: [{ start: Date.now() - 600000, end: Date.now() - 300000 }],
  };
  const settings = {
    ...defaultSettings(),
    gears: [
      {
        id: "g",
        name: "private gear",
        material: "metal",
        size: "",
        acquired: "",
        started: "",
        note: "",
        archived: false,
      },
    ],
  };
  const entry = {
    id: "e",
    timestamp: Date.now() - 10000,
    note: "private entry",
    tags: [],
    wearing: "on",
    comfort: 4,
    photoIds: ["p"],
    createdAt: 1,
    updatedAt: 1,
    gearId: "g",
    sessionId: "s",
  };
  const meta = [
    { key: "vault", value: config },
    { key: "revision", value: 7 },
    {
      key: "journal-settings",
      value: {
        id: "journal-settings",
        sealed: await sealJSON(key, settings, "journal-settings"),
      },
    },
    // Migration must copy bindings opaquely, without renewing or rewrapping them.
    { key: QUICK_UNLOCK_META, value: { marker: new Uint8Array([1, 2, 3]) } },
  ].sort((a, b) => a.key.localeCompare(b.key));
  const er = { id: "e", sealed: await sealJSON(key, entry, "entry:e") };
  const sr = { id: "s", sealed: await sealJSON(key, session, "session:s") };
  const pr = {
    id: "p",
    ownerId: "e",
    full: await seal(key, jpeg, "photo:p"),
    thumb: await seal(key, jpeg, "thumb:p"),
  };
  await old.transaction("rw", old.tables, async () => {
    await old.table("meta").bulkPut(meta);
    await old.table("entries").add(er);
    await old.table("sessions").add(sr);
    await old.table("photos").add(pr);
  });
  old.close();
  return { name, old, key, config, session, settings, entry, meta, er, sr, pr };
}

describe("legacy client isolation", () => {
  it.each([2, 3, 4])(
    "migrates v%i data atomically and isolates legacy edits, clearing and password changes",
    async (version) => {
      const fixture = await legacyVault(version);
      const next = new PrivateDB(fixture.name);
      try {
        const vault = new Vault(fixture.key, fixture.config, next);
        const expected = await vault.snapshot();
        expect(expected).toEqual({
          entries: [fixture.entry],
          sessions: [fixture.session],
          settings: fixture.settings,
          revision: 7,
        });
        expect(await next.meta.toArray()).toEqual(fixture.meta);
        expect(await next.photos.get("p")).toEqual(fixture.pr);
        expect([...next.backendDB().objectStoreNames]).not.toContain("meta");
        next.close();

        // Dexie can recreate its missing legacy stores. That must never make
        // them aliases of the current stores, even for a client retaining a key.
        await fixture.old.open();
        await fixture.old
          .table("sessions")
          .put({
            id: "s",
            sealed: await sealJSON(
              fixture.key,
              {
                id: "s",
                start: fixture.session.start,
                end: null,
                note: "old edit",
              },
              "session:s",
            ),
          });
        await fixture.old
          .table("entries")
          .put({
            id: "e",
            sealed: await sealJSON(
              fixture.key,
              { ...fixture.entry, sessionId: undefined, gearId: undefined },
              "entry:e",
            ),
          });
        await fixture.old
          .table("photos")
          .put({ ...fixture.pr, ownerId: "old-owner" });
        await fixture.old
          .table("meta")
          .put({
            key: "vault",
            value: (await makeVault("changed-password")).config,
          });
        for (const name of Object.keys(legacySchema))
          await fixture.old.table(name).clear();
        fixture.old.close();

        await next.open();
        expect(await getConfig(next)).toEqual(fixture.config);
        expect(await vault.snapshot()).toEqual(expected);
        expect(await next.meta.toArray()).toEqual(fixture.meta);
        expect(await next.photos.get("p")).toEqual(fixture.pr);
        expect(
          new Uint8Array(await (await vault.photo("p")).arrayBuffer()),
        ).toEqual(jpeg);
        await vault.saveSession(
          { ...fixture.session, note: "current edit" },
          7,
        );
        expect((await vault.snapshot()).sessions[0].breaks).toEqual(
          fixture.session.breaks,
        );
      } finally {
        fixture.old.close();
        await next.delete();
      }
    },
  );

  it("rolls back every store if an encrypted-photo copy fails", async () => {
    const fixture = await legacyVault(4);
    const add = IDBObjectStore.prototype.add;
    const fail = vi
      .spyOn(IDBObjectStore.prototype, "add")
      .mockImplementation(function (this: IDBObjectStore, ...args) {
        if (this.name === "journalPhotos")
          throw new DOMException("storage full", "QuotaExceededError");
        return add.apply(this, args);
      });
    const next = new PrivateDB(fixture.name);
    try {
      await expect(next.open()).rejects.toThrow();
      fail.mockRestore();
      await fixture.old.open();
      expect(fixture.old.backendDB().version).toBe(40);
      expect(await fixture.old.table("meta").toArray()).toEqual(fixture.meta);
      expect(await fixture.old.table("entries").get("e")).toEqual(fixture.er);
      expect(await fixture.old.table("sessions").get("s")).toEqual(fixture.sr);
      expect(await fixture.old.table("photos").get("p")).toEqual(fixture.pr);
      expect(
        await openJSON(fixture.key, fixture.sr.sealed, "session:s"),
      ).toEqual(fixture.session);
      fixture.old.close();
      await next.open();
      expect(
        (await new Vault(fixture.key, fixture.config, next).snapshot())
          .revision,
      ).toBe(7);
    } finally {
      fail.mockRestore();
      fixture.old.close();
      await next.delete();
    }
  });
});
