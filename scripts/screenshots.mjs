/**
 * 界面截图脚本（Lead 验收用，不参与应用运行）。
 *
 * 用法：
 *   node scripts/screenshots.mjs
 * 环境变量：
 *   SHOT_URL       默认 http://127.0.0.1:4173
 *   SHOT_OUT       默认 design/screenshots/after
 *   SHOT_VARIANT   new | old（旧版文案，用于重构前对照）
 *   SHOT_SET       all | mobile | desktop | dark（默认 all）
 *   PLAYWRIGHT_BROWSERS_PATH 需指向 .playwright-browsers
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.SHOT_URL || "http://127.0.0.1:4173";
const OUT = process.env.SHOT_OUT || "design/screenshots/after";
const VARIANT = process.env.SHOT_VARIANT || "new";
const SET = process.env.SHOT_SET || "all";
const old = VARIANT === "old";
const fixture = path.resolve("tests/fixture.jpg");
fs.mkdirSync(OUT, { recursive: true });

const T = old
  ? {
      create: ["创建本地空间"],
      password: "设置解锁密码",
      confirm: "确认密码",
      home: "首页",
      navCalendar: "日历",
      navCheckin: "打卡",
      navStats: "统计",
      navSettings: "设置",
      startWear: "开始佩戴",
      pause: "清洁小憩",
      resume: "恢复佩戴",
      manage: "时段管理",
      addSession: "补录佩戴时段",
      details: "添加备注与感受",
      save: "保存打卡",
      wheel: "命运轮盘",
      compare: "选择照片对比",
      compareSubmit: "对比已选照片（2/2）",
      timeline: "照片时间线",
      share: "生成脱敏战报",
      shareGenerate: "生成战报预览",
      shotName: "old",
    }
  : {
      create: ["开启手记"],
      password: "设置密码",
      confirm: "确认密码",
      home: "今天",
      navCalendar: "日历",
      navCheckin: "记录",
      navStats: "回顾",
      navSettings: "设置",
      startWear: "开始佩戴",
      pause: "清洁小憩",
      resume: "继续佩戴",
      manage: "时段",
      addSession: "补记时段",
      details: "再写两句",
      save: "收进今天",
      wheel: "命运轮盘",
      compare: "挑两张照片对比",
      compareSubmit: "开始对比（2/2）",
      timeline: "时间线",
      share: "做一张匿名小结",
      shareGenerate: "生成小结",
      shotName: "new",
    };

async function clickAny(page, names, role = "button") {
  for (const name of names) {
    for (const opts of [{ name, exact: true }, { name }]) {
      const loc = page.getByRole(role, opts).first();
      try {
        await loc.waitFor({ state: "visible", timeout: 15000 });
        await loc.click({ timeout: 15000 });
        return;
      } catch {
        /* 继续尝试下一个名称 */
      }
    }
  }
  if (process.env.SHOT_DEBUG) {
    await page.screenshot({ path: path.join(OUT, "debug.png") });
    console.log("BODY>>", (await page.locator("body").innerText()).slice(-1200));
  }
  throw new Error(`找不到控件：${names.join(" / ")}`);
}

async function shot(page, name) {
  await page
    .locator(".toast")
    .first()
    .waitFor({ state: "detached", timeout: 6000 })
    .catch(() => {});
  await page.waitForTimeout(280);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log("shot", name);
}

async function seed(page, authName = "01-auth") {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  // 解锁页 / 首次创建页
  await shot(page, authName);
  await page.getByLabel(T.password, { exact: true }).fill("test-password-123");
  await page.getByLabel(T.confirm, { exact: true }).fill("test-password-123");
  await clickAny(page, T.create);
  await page.getByRole("button", { name: T.startWear, exact: true }).waitFor();
  await page.waitForTimeout(500);

  // 开始佩戴并暂停一次，让首页呈现"佩戴中"信息
  await clickAny(page, [T.startWear]);
  await page.waitForTimeout(400);
  await clickAny(page, [T.pause, "清洁小憩"]);
  await page.waitForTimeout(300);
  await clickAny(page, [T.resume, "恢复佩戴", "继续佩戴"]);

  // 三条记录：第一条带备注、标签、舒适度
  const nav = async (name) =>
    page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await nav(T.navCheckin);
    await page
      .getByLabel("从相册选择照片")
      .setInputFiles([fixture, fixture].slice(0, i === 0 ? 2 : 1));
    if (i === 0) {
      await clickAny(page, [T.details]);
      await page.getByLabel("备注", { exact: true }).fill("今天戴得还好，下午换了新的护理盒。");
      await page.getByLabel("标签", { exact: true }).fill("日常，清洁");
      await page.getByRole("button", { name: "4", exact: true }).click();
    }
    await clickAny(page, [T.save]);
    await page.locator("article.record").nth(i).waitFor();
    await page.waitForTimeout(300);
  }
  await nav(T.home);
  await page.waitForTimeout(400);
  // 关闭防窥遮罩，让截图呈现真实照片；防窥本身的行为由 e2e 测试覆盖。
  const eye = page.getByRole("button", { name: "防窥模式" });
  if ((await eye.count()) && (await eye.getAttribute("aria-pressed")) === "true")
    await eye.click();
  await page.mouse.move(195, 1400);
  await page.waitForTimeout(200);
}

async function mobileShots(browser, scheme) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  const suffix = scheme === "dark" ? "-dark" : "";
  // 每个 context 独立存储：深色截图需要重新建库，避免与浅色库冲突。
  await seed(page, `01-auth${suffix}`);
  await shot(page, `02-home${suffix}`);

  await clickAny(page, [T.manage, "时段管理", "时段"]);
  await shot(page, `03-sessions${suffix}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await clickAny(page, [T.wheel, "命运轮盘"]);
  await shot(page, `04-wheel${suffix}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.getByRole("navigation").getByRole("button", { name: T.navCheckin, exact: true }).click();
  await shot(page, `05-record${suffix}`);

  await page.getByRole("navigation").getByRole("button", { name: T.navCalendar, exact: true }).click();
  await shot(page, `06-calendar${suffix}`);
  await clickAny(page, [T.timeline, "照片时间线"]);
  await shot(page, `07-timeline${suffix}`);

  // 对比两张照片
  await clickAny(page, [T.compare, "选择照片对比"]);
  const picks = page.locator(".compare-picks input");
  await picks.nth(0).check();
  await picks.nth(1).check();
  await clickAny(page, [T.compareSubmit, "对比已选照片（2/2）"]);
  await shot(page, `08-compare${suffix}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.getByRole("navigation").getByRole("button", { name: T.navStats, exact: true }).click();
  await shot(page, `09-stats${suffix}`);
  await page.evaluate(() => window.scrollTo(0, 900));
  await shot(page, `10-stats-lower${suffix}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await clickAny(page, [T.share, "生成脱敏战报"]);
  await clickAny(page, [T.shareGenerate, "生成战报预览"]);
  await page.locator(".share-preview").waitFor();
  await shot(page, `11-share${suffix}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.getByRole("navigation").getByRole("button", { name: T.navSettings, exact: true }).click();
  await shot(page, `12-settings${suffix}`);
  await page.evaluate(() => window.scrollTo(0, 1200));
  await shot(page, `13-settings-lower${suffix}`);

  // 编辑打卡弹层
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("navigation").getByRole("button", { name: T.home, exact: true }).click();
  const edit = page.getByRole("button", { name: /改一改|编辑/ }).first();
  if (await edit.count()) {
    await edit.click();
    await shot(page, `14-edit-entry${suffix}`);
  }
  await ctx.close();
}

async function desktopShots(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await seed(page, "01-auth-desktop");
  await shot(page, "15-home-desktop");
  await page.getByRole("navigation").getByRole("button", { name: T.navCalendar, exact: true }).click();
  await shot(page, "16-calendar-desktop");
  await page.getByRole("navigation").getByRole("button", { name: T.navStats, exact: true }).click();
  await shot(page, "17-stats-desktop");
  await page.getByRole("navigation").getByRole("button", { name: T.navSettings, exact: true }).click();
  await shot(page, "18-settings-desktop");
  await ctx.close();
}

const browser = await chromium.launch();
try {
  if (SET === "all" || SET === "mobile") await mobileShots(browser, "light");
  if (SET === "all" || SET === "dark") await mobileShots(browser, "dark");
  if (SET === "all" || SET === "desktop") await desktopShots(browser);
} finally {
  await browser.close();
}
console.log("done ->", OUT);
