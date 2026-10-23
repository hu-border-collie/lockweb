import { test, expect } from "@playwright/test";
import path from "node:path";

test("opens a populated v4 vault after an atomic store migration", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByLabel("设置密码").fill("migration-password");
  await page.getByLabel("确认密码", { exact: true }).fill("migration-password");
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByRole("button", { name: "开始佩戴", exact: true }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByText("已暂停", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "继续佩戴", exact: true }).click();
  await expect(page.getByText("正在佩戴", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "记录", exact: true })
    .click();
  await page
    .getByLabel("从相册选择照片")
    .setInputFiles(path.resolve("tests/fixture.jpg"));
  await expect(
    page.getByRole("button", { name: "保存记录", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /备注、标签和状态/ }).click();
  await page
    .getByRole("textbox", { name: "备注", exact: true })
    .fill("migration control");
  await page.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "结束佩戴", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("migration control", { exact: true }),
  ).toBeVisible();
  // Close the application connection before rebuilding an actual v4 fixture.
  await page.goto("about:blank");
  const helper = await context.newPage();
  await helper.goto("/icons/icon-192.png");
  const copiedCounts = await helper.evaluate(async () => {
    const open = (version?: number, upgrade?: (db: IDBDatabase) => void) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const r =
          version === undefined
            ? indexedDB.open("private-log-vault")
            : indexedDB.open("private-log-vault", version);
        r.onupgradeneeded = () => upgrade?.(r.result);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const mapping = [
      ["vaultMeta", "meta"],
      ["journalEntries", "entries"],
      ["wearSessions", "sessions"],
      ["journalPhotos", "photos"],
    ];
    const current = await open();
    const tx = current.transaction(
      mapping.map(([name]) => name),
      "readonly",
    );
    const rows = await Promise.all(
      mapping.map(
        ([name]) =>
          new Promise<unknown[]>((resolve, reject) => {
            const r = tx.objectStore(name).getAll();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          }),
      ),
    );
    current.close();
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("private-log-vault");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    const legacy = await open(40, (db) => {
      for (const [, name] of mapping) {
        const table = db.createObjectStore(name, {
          keyPath: name === "meta" ? "key" : "id",
        });
        if (name === "photos") table.createIndex("ownerId", "ownerId");
      }
    });
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction(
        mapping.map(([, name]) => name),
        "readwrite",
      );
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      mapping.forEach(([, name], i) =>
        rows[i].forEach((row) => tx.objectStore(name).add(row)),
      );
    });
    legacy.close();
    return rows.map((records) => records.length);
  });
  expect(copiedCounts.slice(1)).toEqual([1, 1, 1]);
  await helper.close();
  await page.goto("/");
  await page.getByLabel("密码", { exact: true }).fill("migration-password");
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(
    page.getByText("migration control", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await page.locator(".recent-grid .photo-thumb").click();
  await expect(
    page.getByRole("dialog", { name: "照片全屏浏览" }).locator("img"),
  ).toBeVisible();
  const stores = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const r = indexedDB.open("private-log-vault");
        r.onsuccess = () => {
          resolve([...r.result.objectStoreNames]);
          r.result.close();
        };
        r.onerror = () => reject(r.error);
      }),
  );
  expect(stores).toEqual([
    "journalEntries",
    "journalPhotos",
    "vaultMeta",
    "wearSessions",
  ]);
});
