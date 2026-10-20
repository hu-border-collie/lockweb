import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

async function create(page: Page) {
  await page.goto("/");
  await page.getByLabel("设置密码").fill("test-password");
  await page.getByLabel("确认密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "开启手记" }).click();
  await expect(page.getByRole("button", { name: "开始佩戴", exact: true })).toBeVisible();
}

async function nav(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
}

async function addPhotos(page: Page, count = 1) {
  await nav(page, "记录");
  await page.getByLabel("从相册选择照片").setInputFiles(
    Array.from({ length: count }, () => path.resolve("tests/fixture.jpg")),
  );
  await expect(page.getByRole("button", { name: "收进今天", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "收进今天", exact: true }).click();
  await expect(page.locator("article.record")).toHaveCount(1);
}

test("dragging a draft onto the backdrop preserves it; a backdrop click closes", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await create(page);
  await page.getByRole("button", { name: "时段" }).click();
  await page.getByRole("button", { name: "补记时段" }).click();
  const dialog = page.getByRole("dialog", { name: "补记时段", exact: true });
  const note = dialog.locator("textarea");
  await note.fill("尚未保存的备注");
  // Wait for the sheet's entrance animation before taking pointer coordinates.
  await expect.poll(() => dialog.evaluate((e) => e.getAnimations().length)).toBe(0);
  const box = (await note.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(10, 10, { steps: 10 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(note).toHaveValue("尚未保存的备注");

  // The reverse drag must also preserve the draft.
  await page.mouse.move(10, 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 20, { steps: 10 });
  await page.mouse.up();
  await expect(note).toHaveValue("尚未保存的备注");
  await page.mouse.click(10, 10);
  await expect(dialog).toHaveCount(0);
});

test("the comparison handle stays aligned while pressed and dragged", async ({ page }) => {
  await create(page);
  await addPhotos(page, 2);
  await nav(page, "日历");
  await page.getByRole("button", { name: "挑两张照片对比", exact: true }).click();
  await page.locator(".compare-picks input").nth(0).check();
  await page.locator(".compare-picks input").nth(1).check();
  await page.getByRole("button", { name: "开始对比（2/2）", exact: true }).click();
  await page.getByRole("button", { name: "卷帘看", exact: true }).click();
  const divider = page.getByRole("slider", { name: "照片卷帘分界线" });
  await divider.scrollIntoViewIfNeeded();
  const alignmentError = () => divider.evaluate((e) => {
    const handle = e.getBoundingClientRect();
    const stage = e.parentElement!.getBoundingClientRect();
    const split = Number(e.getAttribute("aria-valuenow"));
    return Math.abs(handle.x + handle.width / 2 - (stage.x + stage.width * split / 100));
  });
  await expect.poll(alignmentError).toBeLessThan(1);
  const box = (await divider.boundingBox())!;
  const stage = (await page.locator(".compare-stage").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Sample beyond the active transition: checking only the first frame misses the regression.
  await page.waitForTimeout(150);
  expect(await alignmentError()).toBeLessThan(1);
  await page.mouse.move(stage.x + stage.width * 0.75, box.y + box.height / 2);
  await expect(divider).toHaveAttribute("aria-valuenow", "75");
  await expect.poll(alignmentError).toBeLessThan(1);
  await page.mouse.up();
  await expect.poll(alignmentError).toBeLessThan(1);
});

test("second ticks update only the live timers and keep a paused wear duration fixed", async ({ page }) => {
  // Observe rendered fibers via the DevTools hook; use prop signatures because
  // production builds minify component names. No instrumentation ships in the app.
  await page.addInitScript(() => {
    const state = window as typeof window & {
      __frontendRenders: { shell: number; home: number };
      __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown;
    };
    state.__frontendRenders = { shell: 0, home: 0 };
    state.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      inject: () => 1,
      onCommitFiberUnmount: () => {},
      onCommitFiberRoot: (_id: number, root: { current: unknown }) => {
        type Fiber = { flags: number; memoizedProps: Record<string, unknown> | null; child?: Fiber; sibling?: Fiber };
        const walk = (fiber?: Fiber) => {
          if (!fiber) return;
          const props = fiber.memoizedProps;
          if ((fiber.flags & 1) && props) {
            if ("onToggleWear" in props) state.__frontendRenders.home++;
            if ("vault" in props && "lock" in props && "onTheme" in props && !("refresh" in props))
              state.__frontendRenders.shell++;
          }
          walk(fiber.child);
          walk(fiber.sibling);
        };
        walk(root.current as Fiber);
      },
    };
  });
  await page.clock.install({ time: new Date("2026-10-15T12:00:10+08:00") });
  await create(page);
  await page.waitForTimeout(1000);
  const counts = () => page.evaluate(() => (window as unknown as {
    __frontendRenders: { shell: number; home: number };
  }).__frontendRenders);
  const idleCounts = await counts();
  await page.waitForTimeout(2100);
  expect(await counts()).toEqual(idleCounts);
  await page.getByRole("button", { name: "开始佩戴", exact: true }).click();
  await expect(page.getByRole("button", { name: "清洁小憩", exact: true })).toBeEnabled();
  // Let the four-second toast clear before measuring steady-state renders.
  await expect(page.locator(".toast")).toHaveCount(0);
  const before = await counts();
  expect(before.shell).toBeGreaterThan(0);
  expect(before.home).toBeGreaterThan(0);
  const timer = page.locator(".wear-timer");
  const initial = await timer.textContent();
  await page.waitForTimeout(3100);
  await expect(timer).not.toHaveText(initial!);
  expect(await counts()).toEqual(before);

  await page.getByRole("button", { name: "清洁小憩", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续佩戴", exact: true })).toBeEnabled();
  await page.waitForTimeout(1000);
  const pausedCounts = await counts();
  const pausedWear = await timer.textContent();
  const pause = page.locator(".hero-start").filter({ hasText: "小憩已持续" });
  const initialPause = await pause.textContent();
  await page.waitForTimeout(3100);
  await expect(timer).toHaveText(pausedWear!);
  await expect(pause).not.toHaveText(initialPause!);
  expect(await counts()).toEqual(pausedCounts);

  await page.getByRole("button", { name: "继续佩戴", exact: true }).click();
  await expect(page.getByRole("button", { name: "清洁小憩", exact: true })).toBeEnabled();
  const resumed = await timer.textContent();
  await page.waitForTimeout(3100);
  await expect(timer).not.toHaveText(resumed!);
  await nav(page, "回顾");
  await expect(page.locator(".stat-detail")).toContainText("0 小时 0 分钟");
  await page.clock.fastForward(120000);
  await expect(page.locator(".stat-detail")).toContainText("0 小时 2 分钟");
});

test("midnight refreshes today's records and ritual eligibility without a reload", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-15T23:59:30+08:00") });
  await create(page);
  await addPhotos(page);
  await page.getByRole("button", { name: "命运轮盘" }).click();
  await page.getByRole("button", { name: "转一转", exact: true }).click();
  await expect(page.locator(".fate-result")).toBeVisible();
  await expect(page.locator(".fate-rule")).toHaveText("今天的仪式已经做过了");
  await page.getByRole("dialog", { name: "命运轮盘", exact: true })
    .getByRole("button", { name: "关闭", exact: true }).click();
  await page.clock.pauseAt(new Date("2026-10-15T23:59:50+08:00"));
  await page.clock.runFor(11000);
  await expect(page.locator(".home-metrics > div").first()).toContainText("0 笔");
  await expect(page.locator("article.record")).toHaveCount(0);
  await expect(page.locator(".fate-launch")).toContainText("今天先拍一张，再来转");
  await expect(page.locator(".eyebrow").first()).toContainText("10月16日");
  await page.getByRole("button", { name: "命运轮盘" }).click();
  await expect(page.getByRole("button", { name: "转一转", exact: true })).toBeDisabled();
});
