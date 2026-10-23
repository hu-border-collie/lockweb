import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function dimensions(page: Page) {
  await nav(page, "日历");
  await page.getByRole("button", { name: "时间线", exact: true }).click();
  const photos = page.getByRole("button", { name: "查看照片", exact: true });
  const sizes: number[] = [];
  for (let i = 0; i < (await photos.count()); i++) {
    await photos.nth(i).click();
    const image = page
      .getByRole("dialog", { name: "照片全屏浏览" })
      .locator("img");
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((e: HTMLImageElement) => e.naturalWidth))
      .toBeGreaterThan(0);
    sizes.push(await image.evaluate((e: HTMLImageElement) => e.naturalWidth));
    await page.getByRole("button", { name: "关闭照片" }).click();
  }
  return sizes.sort((a, b) => a - b);
}
for (const mode of ["compressed", "thumbnail"] as const) {
  test(`storage ${mode}: saved-backup gate, real JPEG archive, unchanged recent photo and original restore`, async ({
    page,
    context,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Capture the real exported File at the native share boundary. System file
    // saving itself requires device validation; ordinary downloads have separate coverage.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          if ((window as unknown as { cancelShare: boolean }).cancelShare)
            throw new DOMException("Cancelled", "AbortError");
          (window as unknown as { sharedBackup: File }).sharedBackup =
            data.files![0];
        },
      });
    });
    await page.goto("/");
    await page.getByLabel("设置密码").fill("test-password");
    await page.getByLabel("确认密码", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "创建并进入" }).click();
    await nav(page, "设置");
    await expect(
      page.getByText("已缓存，可离线使用", { exact: true }),
    ).toBeVisible();
    await context.setOffline(true);
    const buffer = await sharp({
      create: { width: 2400, height: 1800, channels: 3, background: "#a83a28" },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    for (const old of [true, false]) {
      await nav(page, "记录");
      await page
        .getByLabel("从相册选择照片")
        .setInputFiles(
          Array.from({ length: old ? 2 : 1 }, () => ({
            name: "photo.jpg",
            mimeType: "image/jpeg",
            buffer,
          })),
        );
      await expect(
        page.getByRole("button", { name: "保存记录", exact: true }),
      ).toBeEnabled();
      if (old) await page.getByLabel("记录时间").fill("2020-01-15T12:00");
      await page.getByRole("button", { name: /填写备注、标签与评分/ }).click();
      await page
        .getByLabel("备注", { exact: true })
        .fill(old ? "保留旧记录" : "保留新记录");
      await page.getByRole("button", { name: "保存记录", exact: true }).click();
      await expect(
        page
          .getByRole("navigation")
          .getByRole("button", { name: "首页", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
    await nav(page, "设置");
    await page.getByRole("button", { name: "分析照片占用" }).click();
    await expect(page.getByText("2020-01 · 2 张")).toBeVisible();
    await expect(
      page.getByRole("meter", { name: "2020-01 照片占用" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "查看归档范围" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "先导出完整备份" }).click();
    await page.getByLabel("备份密码", { exact: true }).fill("backup-password");
    await page.getByLabel("再次输入备份密码").fill("backup-password");
    await page.getByRole("button", { name: "生成备份" }).click();
    const link = page.getByRole("link", { name: /直接下载/ });
    await expect(link).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { cancelShare: boolean }).cancelShare = true;
    });
    await page
      .getByRole("button", { name: "保存备份文件", exact: true })
      .click();
    // Merely generating the blob must not unlock archival.
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "查看归档范围" }),
    ).toBeDisabled();
    // Reopen export and explicitly save through the controlled system share boundary.
    await page.getByRole("button", { name: "先导出完整备份" }).click();
    await page.getByLabel("备份密码", { exact: true }).fill("backup-password");
    await page.getByLabel("再次输入备份密码").fill("backup-password");
    await page.getByRole("button", { name: "生成备份" }).click();
    await expect(link).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { cancelShare: boolean }).cancelShare = false;
    });
    await page
      .getByRole("button", { name: "保存备份文件", exact: true })
      .click();
    const bytes = await page.evaluate(async () =>
      Array.from(
        new Uint8Array(
          await (
            window as unknown as { sharedBackup: File }
          ).sharedBackup.arrayBuffer(),
        ),
      ),
    );
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByLabel("归档方式").selectOption(mode);
    await page.getByRole("button", { name: "查看归档范围" }).click();
    await expect(
      page.getByRole("button", { name: "确认归档 2 张", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: info.outputPath("archive-confirmation.png"),
      fullPage: true,
    });
    // Cancelling the preview must leave full-size images readable.
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "查看归档范围" }).click();
    await page.getByRole("checkbox", { name: /我已把当前完整备份/ }).check();
    await page
      .getByRole("button", { name: "确认归档 2 张", exact: true })
      .click();
    await expect(
      page.getByText(/归档完成：处理 2 张，缩小 2 张/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "查看归档范围" }),
    ).toBeDisabled();
    // A second archive must not re-encode an already archived image.
    await page.getByRole("button", { name: "先导出完整备份" }).click();
    await page.getByLabel("备份密码", { exact: true }).fill("backup-password");
    await page.getByLabel("再次输入备份密码").fill("backup-password");
    await page.getByRole("button", { name: "生成备份" }).click();
    await expect(
      page.getByRole("button", { name: "保存备份文件", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "保存备份文件", exact: true })
      .click();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "查看归档范围" }).click();
    await page.getByRole("checkbox", { name: /我已把当前完整备份/ }).check();
    await page
      .getByRole("button", { name: "确认归档 2 张", exact: true })
      .click();
    await expect(
      page.getByText(/归档完成：处理 2 张，缩小 0 张/),
    ).toBeVisible();
    expect(await dimensions(page)).toEqual([
      mode === "compressed" ? 1600 : 360,
      mode === "compressed" ? 1600 : 360,
      2400,
    ]);
    await nav(page, "设置");
    await page.getByRole("button", { name: "从备份恢复" }).click();
    await page.getByLabel("选择备份文件").setInputFiles({
      name: "original.plog",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(bytes),
    });
    await page.getByLabel("备份密码", { exact: true }).fill("backup-password");
    await page.getByRole("button", { name: "校验备份" }).click();
    await expect(page.getByText("校验通过", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "覆盖并恢复" }).click();
    await expect(
      page.getByText("已恢复全部记录和照片。", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    expect(await dimensions(page)).toEqual([2400, 2400, 2400]);
    expect(errors).toEqual([]);
  });
}
