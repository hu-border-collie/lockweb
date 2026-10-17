import { test, expect } from "@playwright/test";
import path from "node:path";
test("offline journal tools: encrypted preferences, breaks, redaction, stealth, comparison and share", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("设置密码").fill("test-password");
  await page.getByLabel("确认密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "开启手记" }).click();
  const nav = async (name: string) =>
    page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  await nav("设置");
  await expect(
    page.getByText("应用已缓存，可以离线使用", { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "模板、快捷标签与装备" }).click();
  await page.getByRole("button", { name: "新增模板" }).click();
  await page.getByLabel("模板名称").fill("日常检查");
  await page.getByLabel("模板内容").fill("私密测试问题：正常");
  await page.getByRole("button", { name: "保留模板到草稿" }).click();
  await page.getByRole("button", { name: "新增装备" }).click();
  await page.getByLabel("装备名称").fill("测试装备");
  await page.getByLabel("材质", { exact: true }).fill("金属");
  await page.getByRole("button", { name: "保留装备到草稿" }).click();
  await page.getByRole("button", { name: "保存这些设置" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav("今天");
  await page.getByLabel("这次的装备").selectOption({ label: "测试装备" });
  await page.getByRole("button", { name: "开始佩戴", exact: true }).click();
  await page.getByRole("button", { name: "清洁小憩", exact: true }).click();
  await expect(page.getByText("小憩中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "继续佩戴", exact: true }).click();
  await expect(page.getByText("正在佩戴", { exact: true })).toBeVisible();
  await nav("记录");
  await page
    .getByLabel("从相册选择照片")
    .setInputFiles([
      path.resolve("tests/fixture.jpg"),
      path.resolve("tests/fixture.jpg"),
    ]);
  await expect(
    page.getByRole("button", { name: "收进今天", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("套用模板").selectOption({ label: "日常检查" });
  await expect(
    page.getByRole("textbox", { name: "备注", exact: true }),
  ).toHaveValue("私密测试问题：正常");
  await page.getByRole("button", { name: "运动", exact: true }).click();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await page.getByRole("button", { name: "遮一下", exact: true }).first().click();
  const canvas = page.getByLabel("照片打码画布");
  await expect(canvas).toHaveAttribute("width", "800");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2);
  await page.mouse.up();
  expect(
    await canvas.evaluate((c: HTMLCanvasElement) =>
      [
        ...c.getContext("2d")!.getImageData(c.width / 2, c.height / 2, 1, 1)
          .data,
      ].slice(0, 3),
    ),
  ).toEqual([0, 0, 0]);
  // A later mosaic must not weaken an existing opaque black redaction.
  await page.getByRole("button", { name: "马赛克", exact: true }).click();
  const drawMosaic = async () => {
    await canvas.scrollIntoViewIfNeeded();
    const overlap = (await canvas.boundingBox())!;
    await page.mouse.move(
      overlap.x + overlap.width / 2,
      overlap.y + overlap.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      overlap.x + overlap.width / 2 + 10,
      overlap.y + overlap.height / 2,
    );
    await page.mouse.up();
  };
  await drawMosaic();
  expect(
    await canvas.evaluate((c: HTMLCanvasElement) =>
      [
        ...c.getContext("2d")!.getImageData(c.width / 2, c.height / 2, 1, 1)
          .data,
      ].slice(0, 3),
    ),
  ).toEqual([0, 0, 0]);
  await page.getByRole("button", { name: "撤回一笔", exact: true }).click();
  expect(
    await canvas.evaluate((c: HTMLCanvasElement) =>
      [
        ...c.getContext("2d")!.getImageData(c.width / 2, c.height / 2, 1, 1)
          .data,
      ].slice(0, 3),
    ),
  ).toEqual([0, 0, 0]);
  await drawMosaic();
  await page.getByRole("button", { name: "就遮这样", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "收进今天", exact: true }).click();
  await expect(
    page.getByText("私密测试问题：正常", { exact: true }),
  ).toBeVisible();
  const thumbnail = page.locator(".recent-grid .photo-thumb").first();
  await thumbnail.scrollIntoViewIfNeeded();
  await expect(thumbnail).toHaveClass(/concealed/);
  const rect = (await thumbnail.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await expect(thumbnail).not.toHaveClass(/concealed/);
  await page.mouse.up();
  await expect(thumbnail).toHaveClass(/concealed/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await thumbnail.click();
  const full = page
    .getByRole("dialog", { name: "照片全屏浏览" })
    .locator("img");
  await expect(full).toBeVisible();
  expect(
    await full.evaluate((img: HTMLImageElement) => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      return [
        ...c.getContext("2d")!.getImageData(c.width / 2, c.height / 2, 1, 1)
          .data,
      ]
        .slice(0, 3)
        .every((v) => v < 30);
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "关闭照片" }).click();
  await nav("日历");
  await page.getByRole("button", { name: "挑两张照片对比" }).click();
  const checks = page.locator(".compare-picks input");
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByRole("button", { name: "开始对比（2/2）" }).click();
  await expect(
    page.getByRole("dialog", { name: "照片对比" }).locator("img"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "卷帘看", exact: true }).click();
  await page.getByLabel("对比线").focus();
  await page.getByLabel("对比线").press("Home");
  await page.getByLabel("对比线").press("ArrowRight");
  const divider = page.getByRole("slider", { name: "照片卷帘分界线" });
  await divider.scrollIntoViewIfNeeded();
  const dividerBox = (await divider.boundingBox())!,
    stageBox = (await page.locator(".compare-stage").boundingBox())!;
  await page.mouse.move(
    dividerBox.x + dividerBox.width / 2,
    dividerBox.y + dividerBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    stageBox.x + stageBox.width * 0.75,
    dividerBox.y + dividerBox.height / 2,
  );
  await page.mouse.up();
  await expect(divider).toHaveAttribute("aria-valuenow", "75");
  await page.screenshot({
    path: info.outputPath("compare.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await nav("回顾");
  await expect(page.getByText("测试装备", { exact: true })).toBeVisible();
  await expect(page.getByText("4.00", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "做一张匿名小结", exact: true }).click();
  await page.getByRole("button", { name: "生成小结", exact: true }).click();
  await expect(page.getByAltText("匿名小结预览")).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: "保存图片" }).click();
  await (await dl).saveAs(info.outputPath("share.png"));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await nav("设置");
  await page.getByRole("button", { name: "分析照片占用" }).click();
  await expect(page.getByText(/2 张/)).toBeVisible();
  await page.getByRole("button", { name: "导出一份加密备份" }).click();
  await page.getByLabel("备份密码", { exact: true }).fill("backup-password");
  await page.getByLabel("再次输入备份密码").fill("backup-password");
  await page.getByRole("button", { name: "开始打包" }).click();
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: /直接下载/ }).click();
  const backup = info.outputPath("journal.plog");
  await (await backupDownload).saveAs(backup);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "清空这本手记" }).click();
  await page.getByLabel("输入「清空」确认").fill("清空");
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByText("这本手记已经清空。")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "用备份恢复" }).click();
  await page.getByLabel("选择备份文件").setInputFiles(backup);
  await page.getByLabel("备份密码", { exact: true }).fill("backup-password");
  await page.getByRole("button", { name: "检查备份" }).click();
  await page.getByRole("button", { name: "覆盖并恢复" }).click();
  await expect(page.getByText("记录和照片已经完整恢复。")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await page.getByLabel("密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "打开手记", exact: true }).click();
  await expect(page.getByRole("button", { name: "防窥模式" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByText("私密测试问题：正常", { exact: true }),
  ).toBeVisible();
  await nav("设置");
  await page.getByRole("button", { name: "模板、快捷标签与装备" }).click();
  await expect(
    page.getByRole("button", { name: "日常检查", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "测试装备", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await nav("日历");
  const restoredThumb = page.locator("article.record .photo-thumb").first();
  await restoredThumb.focus();
  await page.keyboard.down("Space");
  await expect(restoredThumb).not.toHaveClass(/concealed/);
  await page.keyboard.up("Space");
  await expect(restoredThumb).toHaveClass(/concealed/);
  await restoredThumb.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "照片全屏浏览" }).locator("img"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps a comparison selection when choosing a photo in another month", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("设置密码").fill("test-password");
  await page.getByLabel("确认密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "开启手记" }).click();
  const dates = await page.evaluate(() => {
    const today = new Date(),
      previous = new Date();
    previous.setDate(1);
    previous.setMonth(previous.getMonth() - 1);
    previous.setDate(15);
    previous.setHours(12, 0, 0, 0);
    const local = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      today: local(today),
      previous: local(previous),
      input: local(previous) + "T12:00",
    };
  });
  const nav = async (name: string) =>
    page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  for (const time of [null, dates.input]) {
    await nav("记录");
    await page
      .getByLabel("从相册选择照片")
      .setInputFiles(path.resolve("tests/fixture.jpg"));
    await expect(
      page.getByRole("button", { name: "收进今天", exact: true }),
    ).toBeEnabled();
    if (time) await page.getByLabel("记录时间", { exact: true }).fill(time);
    await page.getByRole("button", { name: "收进今天", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "开始佩戴", exact: true }),
    ).toBeVisible();
  }
  await nav("日历");
  await page.getByRole("button", { name: "挑两张照片对比", exact: true }).click();
  await page.locator(".compare-picks input").check();
  await expect(
    page.getByRole("button", { name: "开始对比（1/2）", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "上个月", exact: true }).click();
  await page
    .getByRole("button", { name: `${dates.previous}，1 笔记录`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "取消对比", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始对比（1/2）", exact: true }),
  ).toBeVisible();
  await page.locator(".compare-picks input").check();
  await page
    .getByRole("button", { name: "开始对比（2/2）", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "照片对比" }).locator("img"),
  ).toHaveCount(2);
});
