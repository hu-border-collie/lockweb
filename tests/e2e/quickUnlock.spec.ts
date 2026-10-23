import { test, expect, type Page } from "@playwright/test";
const homeTab = (page: Page) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name: "首页", exact: true });

async function create(page: Page) {
  await page.getByLabel("设置密码").fill("test-password");
  await page.getByLabel("确认密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    homeTab(page),
  ).toHaveAttribute("aria-current", "page");
}
const settings = async (page: Page) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
async function confirmEnrollment(page: Page, hours = 0) {
  await settings(page);
  await page.getByRole("button", { name: "启用快速解锁", exact: true }).click();
  await expect(page.getByLabel("快速解锁有效期")).toHaveValue("0");
  await expect(page.getByLabel("快速解锁有效期").locator("option")).toHaveText([
    "永久有效",
    "1 天",
    "7 天",
    "30 天",
  ]);
  await page.getByLabel("快速解锁有效期").selectOption(String(hours));
  await page.getByLabel("确认当前密码").fill("test-password");
  await page.getByRole("button", { name: "确认密码继续", exact: true }).click();
  await expect(page.getByText("密码已确认，5 分钟内有效")).toBeVisible();
}
for (const hours of [0, 24]) {
  test(`native WebAuthn PRF (${hours === 0 ? "permanent" : "24 hours"}): enroll, cold reopen offline, cancel, password renewal and revocation`, async ({
    page,
    context,
    browserName,
  }, info) => {
    test.skip(
      browserName !== "chromium",
      "Chromium CDP virtual authenticator; this does not verify iPhone biometrics.",
    );
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          ctap2Version: "ctap2_1",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          hasPrf: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      },
    );
    // WebAuthn RP IDs are domain names. localhost is a secure test origin.
    await page.goto("http://localhost:4173/");
    await create(page);
    await confirmEnrollment(page, hours);
    await page
      .getByRole("button", { name: "创建快速解锁通行密钥", exact: true })
      .click();
    await page
      .getByRole("button", { name: "验证并启用快速解锁", exact: true })
      .click();
    await expect(
      page.getByText("快速解锁已启用，下次锁定后可用系统验证解锁。"),
    ).toBeVisible();
    if (hours === 0) {
      await expect(
        page.getByText("已绑定 · 永久有效", { exact: true }),
      ).toBeVisible();
      await page.addInitScript(() => {
        const now = Date.now;
        Date.now = () => now() + 10 * 366 * 86400000;
      });
    }
    await page.screenshot({
      path: info.outputPath("quick-settings.png"),
      fullPage: true,
    });
    await expect(
      page.getByText("已缓存，可离线使用", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "用面容 / 指纹解锁", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "用面容 / 指纹解锁", exact: true })
      .click();
    await expect(
      homeTab(page),
  ).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "锁定应用", exact: true }).click();
    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
      authenticatorId,
      enabled: false,
    });
    await page
      .getByRole("button", { name: "用面容 / 指纹解锁", exact: true })
      .click();
    await page.getByRole("button", { name: "取消解锁", exact: true }).click();
    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
      authenticatorId,
      enabled: true,
    });
    await expect(
      homeTab(page),
  ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "解锁", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("密码", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "解锁", exact: true }).click();
    await settings(page);
    await expect(
      page.getByRole("button", { name: "停用快速解锁", exact: true }),
    ).toBeVisible();
    if (hours === 24) {
      await page
        .getByRole("button", { name: "重新验证或调整有效期", exact: true })
        .click();
      await expect(page.getByLabel("快速解锁有效期")).toHaveValue("24");
      await page.getByLabel("快速解锁有效期").selectOption("0");
      await page.getByLabel("确认当前密码").fill("test-password");
      await page
        .getByRole("button", { name: "确认密码继续", exact: true })
        .click();
      await page
        .getByRole("button", { name: "验证并启用快速解锁", exact: true })
        .click();
      await expect(
        page.getByText("已绑定 · 永久有效", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "锁定应用", exact: true }).click();
      await page.reload();
      await page
        .getByRole("button", { name: "用面容 / 指纹解锁", exact: true })
        .click();
      await expect(
        homeTab(page),
  ).toHaveAttribute("aria-current", "page");
      await settings(page);
    }
    await page.getByRole("button", { name: "更换密码" }).click();
    await page.getByLabel("当前密码", { exact: true }).fill("test-password");
    await page.getByLabel("新密码", { exact: true }).fill("new-password");
    await page.getByLabel("再次输入新密码").fill("new-password");
    await page.getByRole("button", { name: "保存新密码", exact: true }).click();
    await expect(
      page.getByText("密码已更换。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "停用快速解锁", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "锁定应用", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "用面容 / 指纹解锁", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("密码", { exact: true }).fill("new-password");
    await page.getByRole("button", { name: "解锁", exact: true }).click();
    await expect(
      homeTab(page),
  ).toHaveAttribute("aria-current", "page");
    expect(errors).toEqual([]);
  });
}
test("simulated unsupported PRF keeps password access and never writes a quick binding", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", {
      value: class {
        static async isUserVerifyingPlatformAuthenticatorAvailable() {
          return true;
        }
      },
      configurable: true,
    });
    Object.defineProperty(navigator, "credentials", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(navigator.credentials, "create", {
      value: async (options: CredentialCreationOptions) => {
        const p = options.publicKey!,
          enc = new TextEncoder(),
          id = new Uint8Array([1, 2, 3]),
          auth = new Uint8Array(37);
        auth.set(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", enc.encode(p.rp.id!)),
          ),
        );
        auth[32] = 5;
        const challenge = btoa(
          String.fromCharCode(...new Uint8Array(p.challenge as ArrayBuffer)),
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, "");
        const client = enc.encode(
          JSON.stringify({
            type: "webauthn.create",
            challenge,
            origin: location.origin,
            crossOrigin: false,
          }),
        );
        const keys = await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign", "verify"],
        );
        const publicKey = await crypto.subtle.exportKey("spki", keys.publicKey);
        return {
          type: "public-key",
          rawId: id.buffer,
          response: {
            clientDataJSON: client.buffer,
            getAuthenticatorData: () => auth.buffer,
            getPublicKey: () => publicKey,
            getPublicKeyAlgorithm: () => -7,
          },
          getClientExtensionResults: () => ({ prf: { enabled: false } }),
        };
      },
    });
  });
  await page.goto("/");
  await create(page);
  await confirmEnrollment(page);
  await page
    .getByRole("button", { name: "创建快速解锁通行密钥", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("无法用于快速解锁");
  await page.getByRole("button", { name: "取消设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停用快速解锁", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "锁定应用", exact: true }).click();
  await page.getByLabel("密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(
    homeTab(page),
  ).toHaveAttribute("aria-current", "page");
});
test("missing WebAuthn API disables setup and leaves normal password unlock available", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    Object.defineProperty(window, "PublicKeyCredential", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await create(page);
  await settings(page);
  await expect(
    page.getByRole("button", { name: "启用快速解锁", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("此环境不支持快速解锁，可继续使用密码。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "锁定应用", exact: true }).click();
  await page.getByLabel("密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(
    homeTab(page),
  ).toHaveAttribute("aria-current", "page");
  expect(errors).toEqual([]);
});
