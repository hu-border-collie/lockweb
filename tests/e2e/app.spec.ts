import { test, expect } from "@playwright/test";
import path from "node:path";
const photo = path.resolve("tests/fixture.jpg");
async function unlock(page: import("@playwright/test").Page) {
  await page.getByLabel("密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(
    page.getByRole("navigation").getByRole("button", { name: "首页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
}
async function create(page: import("@playwright/test").Page) {
  await page.getByLabel("设置密码").fill("test-password");
  await page.getByLabel("确认密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "创建" }).click();
}
async function add(page: import("@playwright/test").Page, count = 1) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "记录", exact: true })
    .click();
  await page
    .getByLabel("从相册选择照片")
    .setInputFiles(Array.from({ length: count }, () => photo));
  await expect(
    page.getByRole("button", { name: "保存记录", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(
    page.getByRole("navigation").getByRole("button", { name: "首页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
}
test("complete offline acceptance: multiple checkins, reopen, views, wear time, encrypted backup and restore", async ({
  page,
  context,
}, testInfo) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173") &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await create(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await expect(
    page.getByText("已缓存，可离线使用", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await unlock(page);
  await context.setOffline(true);
  await add(page, 2);
  await add(page);
  await page.getByRole("button", { name: "开始佩戴", exact: true }).click();
  await expect(page.getByText("正在佩戴", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "佩戴时段" }).click();
  await page.getByRole("button", { name: "补录时段" }).click();
  await page.getByLabel("仍在佩戴").uncheck();
  const current = new Date();
  const start = new Date(current);
  start.setDate(start.getDate() - 1);
  start.setHours(22, 0, 0, 0);
  const end = new Date(current);
  end.setHours(1, 0, 0, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (end > current) end.setDate(end.getDate() - 1);
  if (start >= end) start.setDate(start.getDate() - 1);
  await page.getByLabel("开始时间", { exact: true }).fill(fmt(start));
  await page.getByLabel("结束时间", { exact: true }).fill(fmt(end));
  await page.getByRole("button", { name: "保存时段" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await unlock(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  await expect(page.locator("article.record")).toHaveCount(2);
  await page
    .locator("article.record")
    .first()
    .getByRole("button", { name: "查看照片" })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "照片全屏浏览" }).locator("img"),
  ).toBeVisible();
  await page.getByRole("button", { name: "放大照片" }).click();
  await page.getByRole("button", { name: "关闭照片" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "统计", exact: true })
    .click();
  await expect(page.getByText("3 张", { exact: false })).toBeVisible();
  await expect(page.getByText("最长的一次佩戴")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("stats.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByRole("button", { name: "导出加密备份" }).click();
  await page.getByLabel("备份密码", { exact: true }).fill("backup-password");
  await page.getByLabel("再次输入备份密码").fill("backup-password");
  await page.getByRole("button", { name: "生成备份" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /直接下载/ }).click();
  const download = await downloadPromise;
  const file = testInfo.outputPath("backup.plog");
  await download.saveAs(file);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "清空所有记录" }).click();
  await page.getByLabel("输入「清空」确认").fill("清空");
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByText("已清空所有记录。")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "从备份恢复" }).click();
  await page.getByLabel("选择备份文件").setInputFiles(file);
  await page.getByLabel("备份密码", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "校验备份" }).click();
  await expect(page.getByRole("alert")).toContainText("备份密码不正确");
  await page.getByLabel("备份密码", { exact: true }).fill("backup-password");
  await page.getByRole("button", { name: "校验备份" }).click();
  await expect(
    page.getByText("2 条记录 · 3 张照片 · 2 个时段"),
  ).toBeVisible();
  await page.getByRole("button", { name: "覆盖并恢复" }).click();
  await expect(page.getByText("已恢复全部记录和照片。")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await unlock(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  await expect(page.locator("article.record")).toHaveCount(2);
  const restoredPhotos = page.locator("article.record .photo-thumb");
  await expect(restoredPhotos).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await restoredPhotos.nth(i).scrollIntoViewIfNeeded();
    await expect(restoredPhotos.nth(i).locator("img")).toBeVisible();
    await restoredPhotos.nth(i).click();
    const full = page
      .getByRole("dialog", { name: "照片全屏浏览" })
      .locator("img");
    await expect(full).toBeVisible();
    expect(await full.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(
      800,
    );
    await page.getByRole("button", { name: "关闭照片" }).click();
  }
  await page.screenshot({
    path: testInfo.outputPath("calendar.png"),
    fullPage: true,
  });
  expect(external).toEqual([]);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const req of await (await caches.open(key)).keys())
        urls.push(req.url);
    return urls;
  });
  expect(cached.every((u) => !u.startsWith("blob:"))).toBe(true);
});
test("edit and delete photos, password lock, responsive dark appearance", async ({
  page,
}) => {
  await page.goto("/");
  await create(page);
  await add(page, 2);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  await page
    .locator("article.record")
    .getByRole("button", { name: /编辑/ })
    .click();
  await page.getByRole("button", { name: "移除照片" }).first().click();
  await page.getByLabel("备注", { exact: true }).fill("edited");
  // Hold input focus across two real one-second UI ticks.
  await page.waitForTimeout(2100);
  await expect(
    page.getByRole("textbox", { name: "备注", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByText("edited", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByLabel("外观").selectOption("dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "立即锁定" }).click();
  await unlock(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  await page
    .locator("article.record")
    .getByRole("button", { name: /编辑/ })
    .click();
  await page.getByRole("button", { name: "删除记录" }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  await expect(page.locator("article.record")).toHaveCount(0);
});
