import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
test.use({ actionTimeout: 15000 });
async function setup(page: Page) {
    await page.goto("/");
    await page.getByLabel("设置解锁密码").fill("test-password");
    await page.getByLabel("确认密码", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "创建本地空间" }).click();
    await expect(page.getByRole("button", { name: "命运轮盘" })).toBeVisible();
}
async function nav(page: Page, name: string) {
    await page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
}
async function unlock(page: Page) {
    await page.getByLabel("解锁密码", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "解锁私记", exact: true }).click();
    await expect(page.getByRole("button", { name: "命运轮盘" })).toBeVisible();
}
test("offline ritual requires a photo, persists cooldown and appends one result to today's note", async ({ page, context }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page);
    await nav(page, "设置");
    await expect(page.getByText("应用资源已缓存，可离线使用", { exact: true })).toBeVisible();
    await context.setOffline(true);
    await nav(page, "首页");
    await page.getByRole("button", { name: "命运轮盘" }).click();
    await expect(page.getByRole("button", { name: "转动轮盘", exact: true })).toBeDisabled();
    await page.getByRole("dialog", { name: "命运轮盘", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    await nav(page, "打卡");
    await page.getByLabel("从相册选择照片").setInputFiles(path.resolve("tests/fixture.jpg"));
    await page.getByRole("button", { name: /添加备注与感受/ }).click();
    await page.getByLabel("备注", { exact: true }).fill("原有备注");
    await expect(page.getByRole("button", { name: "保存打卡", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "保存打卡", exact: true }).click();
    await page.getByRole("button", { name: "命运轮盘" }).click();
    await page.getByRole("button", { name: "转动轮盘", exact: true }).click();
    await expect(page.locator(".fate-result")).toBeVisible();
    await expect(page.getByRole("button", { name: "转动轮盘", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "追加到打卡备注", exact: true }).click();
    await expect(page.getByText("已写入打卡备注", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "追加到打卡备注", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("fate-ritual.png"), fullPage: true });
    await page.reload();
    await unlock(page);
    await page.getByRole("button", { name: "命运轮盘" }).click();
    await expect(page.locator(".fate-rule")).toHaveText("今日仪式已完成");
    await expect(page.getByRole("button", { name: "转动轮盘", exact: true })).toBeDisabled();
    await expect(page.getByText("已写入打卡备注", { exact: true })).toBeVisible();
    await page.getByRole("dialog", { name: "命运轮盘", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.locator("article.record").first()).toContainText("原有备注");
    await expect(page.locator("article.record").first()).toContainText("[🎲 命运判定]");
    await nav(page, "统计");
    await expect(page.locator(".fate-history")).toContainText("共 1 次 · 每日仪式 1 次 · 自由沙盒 0 次");
    expect(errors).toEqual([]);
});
test("custom weighted sandbox persists before animation and preserves results when closed/reloaded", async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await setup(page);
    await page.getByRole("button", { name: "开始佩戴", exact: true }).click();
    await page.getByRole("button", { name: "命运轮盘" }).click();
    await page.getByRole("button", { name: "配置轮盘", exact: true }).click();
    const options = page.getByRole("dialog", { name: "配置命运轮盘", exact: true });
    await options.getByLabel("轮盘名称", { exact: true }).fill("自定义私密轮盘");
    await options.getByLabel("抽取模式", { exact: true }).selectOption("free");
    await options.getByRole("button", { name: "删除扇区 4", exact: true }).click();
    await options.getByRole("button", { name: "删除扇区 3", exact: true }).click();
    await options.getByRole("button", { name: "新增扇区", exact: true }).click();
    await options.getByRole("button", { name: "删除扇区 3", exact: true }).click();
    for (const i of [1, 2]) {
        await options.getByLabel(`扇区 ${i} 名称`, { exact: true }).fill(`私密加时结果 ${i}`);
        await options.getByLabel(`扇区 ${i} 类型`, { exact: true }).selectOption("extra");
        await options.getByLabel(`扇区 ${i} 加时分钟`, { exact: true }).fill(String(i * 360));
        await options.getByLabel(`扇区 ${i} 权重`, { exact: true }).fill(i === 1 ? "1" : "9");
    }
    await options.getByLabel("扇区 1 权重", { exact: true }).fill("0");
    await options.getByRole("button", { name: "保存轮盘配置", exact: true }).click();
    await expect(options.getByRole("alert")).toContainText("权重");
    await options.getByLabel("扇区 1 权重", { exact: true }).fill("1");
    await options.getByRole("button", { name: "保存轮盘配置", exact: true }).click();
    await expect(options).toHaveCount(0);
    await expect(page.locator(".fate-legend")).toContainText("10.0%");
    await expect(page.locator(".fate-legend")).toContainText("90.0%");
    await page.screenshot({ path: info.outputPath("fate-custom.png"), fullPage: true });
    await page.getByRole("button", { name: "转动轮盘", exact: true }).click();
    await expect(page.getByText("正在转动 · 判定已保存在本机", { exact: true })).toBeVisible();
    // Interrupt the animation; reopening cannot reroll a persisted outcome.
    await page.getByRole("dialog", { name: "命运轮盘", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.locator(".fate-session-badge")).toContainText("私密加时结果");
    const badge = await page.locator(".fate-session-badge").innerText();
    await page.reload();
    await unlock(page);
    await expect(page.locator(".fate-session-badge")).toHaveText(badge, { useInnerText: true });
    await nav(page, "统计");
    await expect(page.locator(".fate-history")).toContainText("共 1 次 · 每日仪式 0 次 · 自由沙盒 1 次");
    const ciphertext = await page.evaluate(() => new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("private-log-vault");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result, transaction = db.transaction("vaultMeta", "readonly");
            const read = transaction.objectStore("vaultMeta").getAll();
            read.onsuccess = () => { resolve(JSON.stringify(read.result)); db.close(); };
            read.onerror = () => { db.close(); reject(read.error); };
        };
    }));
    expect(ciphertext).not.toContain("私密加时结果");
    expect(ciphertext).not.toContain("自定义私密轮盘");
    await nav(page, "首页");
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.getByRole("button", { name: "命运轮盘" }).click();
    await expect(page.locator(".fate-result")).toContainText("私密加时结果");
    await page.getByRole("button", { name: "转动轮盘", exact: true }).click();
    await expect(page.locator(".fate-result")).toBeVisible();
    await page.screenshot({ path: info.outputPath("fate-dark.png"), fullPage: true });
    await page.getByRole("dialog", { name: "命运轮盘", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    await nav(page, "统计");
    await expect(page.locator(".fate-history")).toContainText("共 2 次");
    expect(errors).toEqual([]);
});
