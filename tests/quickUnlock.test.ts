import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createVault, PrivateDB, Vault } from "../src/lib/db";
import { QUICK_UNLOCK_META } from "../src/lib/models";
import {
  authorizeQuickEnrollment,
  createQuickCredential,
  finishQuickEnrollment,
  unlockWithQuickBinding,
  unlockWithPassword,
  readQuickBinding,
  derSignature,
  validBinding,
} from "../src/lib/quickUnlock";
import { exportBackup, importBackup } from "../src/lib/backup";
import { syntheticAuthenticator } from "./helpers/authenticator";
let database: PrivateDB,
  vault: Vault,
  auth: Awaited<ReturnType<typeof syntheticAuthenticator>>;
beforeEach(async () => {
  vi.stubGlobal("location", {
    origin: "https://journal.example",
    hostname: "journal.example",
  });
  auth = await syntheticAuthenticator();
  vi.stubGlobal("navigator", {
    credentials: { create: auth.create, get: auth.get },
  });
  database = new PrivateDB("quick-test-" + crypto.randomUUID());
  const v = await createVault("local-password", database);
  vault = new Vault(v.key, v.config, database);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await database.delete();
});
async function enroll() {
  const grant = await authorizeQuickEnrollment(vault, "local-password");
  const pending = await createQuickCredential(
    grant,
    24,
    new AbortController().signal,
  );
  return finishQuickEnrollment(vault, pending, new AbortController().signal);
}
describe("PRF quick unlock", () => {
  it("keeps password access on renewal failure and rolls back a failed revocation", async () => {
    const binding = await enroll();
    const failRenew = vi
      .spyOn(database.meta, "put")
      .mockRejectedValueOnce(
        new DOMException("storage full", "QuotaExceededError"),
      );
    const password = await unlockWithPassword(
      vault.config,
      "local-password",
      new AbortController().signal,
      database,
    );
    failRenew.mockRestore();
    await password.guard();
    expect((await readQuickBinding(vault.config, database))!.expiresAt).toBe(
      binding.expiresAt,
    );
    const failDelete = vi
      .spyOn(database.meta, "delete")
      .mockRejectedValueOnce(new Error("write failed"));
    await expect(vault.changePassword("new-password", 1)).rejects.toThrow();
    failDelete.mockRestore();
    expect((await readQuickBinding(vault.config, database))!.id).toBe(
      binding.id,
    );
    await unlockWithPassword(
      vault.config,
      "local-password",
      new AbortController().signal,
      database,
    );
    const empty = new PrivateDB("cancel-create-" + crypto.randomUUID());
    try {
      const c = new AbortController(),
        result = createVault("new-password", empty, c.signal);
      c.abort();
      await expect(result).rejects.toThrow("取消");
      expect(await empty.meta.count()).toBe(0);
    } finally {
      await empty.delete();
    }
  });
  it("requires the password, accepts create-without-PRF-output, and decrypts the real key with a verified assertion", async () => {
    await expect(
      authorizeQuickEnrollment(vault, "wrong-password"),
    ).rejects.toThrow("密码");
    const binding = await enroll();
    expect(await readQuickBinding(vault.config, database)).toEqual(binding);
    const raw = (await database.meta.get(QUICK_UNLOCK_META))!.value;
    const key = new Uint8Array(await crypto.subtle.exportKey("raw", vault.key));
    expect(JSON.stringify(raw)).not.toContain([...key].join(","));
    const unlocked = await unlockWithQuickBinding(
      vault.config,
      binding,
      new AbortController().signal,
      database,
    );
    expect(
      new Uint8Array(await crypto.subtle.exportKey("raw", unlocked.vault.key)),
    ).toEqual(key);
    await unlocked.guard();
  });
  it("never enables a credential without PRF and retains an existing binding when replacement fails", async () => {
    const binding = await enroll();
    auth.controls.getPrf = false;
    const grant = await authorizeQuickEnrollment(vault, "local-password"),
      pending = await createQuickCredential(
        grant,
        12,
        new AbortController().signal,
      );
    await expect(
      finishQuickEnrollment(vault, pending, new AbortController().signal),
    ).rejects.toThrow("无法用于快速解锁");
    expect((await database.meta.get(QUICK_UNLOCK_META))!.value).toEqual(
      binding,
    );
    auth.controls.createPrf = false;
    await expect(
      createQuickCredential(grant, 12, new AbortController().signal),
    ).rejects.toThrow("无法用于快速解锁");
  });
  it("rejects absent user verification, wrong identity/origin/challenge, bad signatures and incorrect PRF secrets", async () => {
    const binding = await enroll();
    for (const flag of [
      "wrongChallenge",
      "wrongOrigin",
      "wrongId",
      "badSignature",
      "wrongPrf",
    ] as const) {
      auth.controls[flag] = true;
      await expect(
        unlockWithQuickBinding(
          vault.config,
          binding,
          new AbortController().signal,
          database,
        ),
      ).rejects.toThrow();
      auth.controls[flag] = false;
    }
    auth.controls.uv = false;
    await expect(
      unlockWithQuickBinding(
        vault.config,
        binding,
        new AbortController().signal,
        database,
      ),
    ).rejects.toThrow("用户验证");
    expect(() => derSignature(new Uint8Array([0x30, 0, 1]).buffer)).toThrow();
  });
  it("enforces an authenticated expiry and renews the window only after entering the password", async () => {
    const binding = await enroll(),
      clock = vi.spyOn(Date, "now");
    expect(
      validBinding({
        ...binding,
        authorizedAt: 9000000000000000,
        expiresAt: 9000000000000000 + 24 * 3600000,
      }),
    ).toBe(false);
    clock.mockReturnValue(binding.expiresAt);
    await expect(
      unlockWithQuickBinding(
        vault.config,
        binding,
        new AbortController().signal,
        database,
      ),
    ).rejects.toThrow("过期");
    const forged = {
      ...binding,
      authorizedAt: binding.authorizedAt + 3600000,
      expiresAt: binding.expiresAt + 3600000,
    };
    await database.meta.put({ key: QUICK_UNLOCK_META, value: forged });
    await expect(
      unlockWithQuickBinding(
        vault.config,
        forged,
        new AbortController().signal,
        database,
      ),
    ).rejects.toThrow("窗口");
    await database.meta.put({ key: QUICK_UNLOCK_META, value: binding });
    await unlockWithPassword(
      vault.config,
      "local-password",
      new AbortController().signal,
      database,
    );
    const renewed = (await readQuickBinding(vault.config, database))!;
    expect(renewed.expiresAt).toBe(binding.expiresAt + 24 * 3600000);
    expect(renewed.id).toBe(binding.id);
    await unlockWithQuickBinding(
      vault.config,
      renewed,
      new AbortController().signal,
      database,
    );
    expect((await readQuickBinding(vault.config, database))!.expiresAt).toBe(
      renewed.expiresAt,
    );
  });
  it("rejects late results after abort, password change, disable and an expired enrollment grant", async () => {
    const binding = await enroll();
    let release!: () => void;
    auth.controls.hold = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const c = new AbortController(),
      result = unlockWithQuickBinding(
        vault.config,
        binding,
        c.signal,
        database,
      );
    c.abort();
    release();
    await expect(result).rejects.toThrow();
    const second = unlockWithQuickBinding(
      vault.config,
      binding,
      new AbortController().signal,
      database,
    );
    await vault.disableQuickUnlock(1);
    release();
    await expect(second).rejects.toThrow("撤销");
    auth.controls.hold = null;
    const grant = await authorizeQuickEnrollment(vault, "local-password");
    await vault.changePassword("new-password", 2);
    await expect(
      createQuickCredential(
        { ...grant, verifiedAt: Date.now() - 6 * 60000 },
        24,
        new AbortController().signal,
      ),
    ).rejects.toThrow("过期");
    await expect(
      unlockWithPassword(
        grant.config,
        "local-password",
        new AbortController().signal,
        database,
      ),
    ).rejects.toThrow("改变");
  });
  it("rejects stale enrollment and revokes binding atomically on password change, clear and restore", async () => {
    const grant = await authorizeQuickEnrollment(vault, "local-password"),
      pending = await createQuickCredential(
        grant,
        24,
        new AbortController().signal,
      );
    await vault.saveSettings((await vault.snapshot()).settings, 0);
    await expect(
      finishQuickEnrollment(vault, pending, new AbortController().signal),
    ).rejects.toThrow("另一窗口");
    let binding = await enroll();
    const backup = await exportBackup(vault, "backup-password");
    const restored = await importBackup(backup, "backup-password");
    expect(JSON.stringify(restored)).not.toContain(binding.id);
    await vault.replace(
      restored.entries,
      restored.sessions,
      restored.photos,
      2,
      restored.settings,
    );
    expect(await database.meta.get(QUICK_UNLOCK_META)).toBeUndefined();
    binding = await enroll();
    await vault.clear(4);
    expect(await database.meta.get(QUICK_UNLOCK_META)).toBeUndefined();
    binding = await enroll();
    await vault.changePassword("new-password", 6);
    expect(await database.meta.get(QUICK_UNLOCK_META)).toBeUndefined();
  });
});
