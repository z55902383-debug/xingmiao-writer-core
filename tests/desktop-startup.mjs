import { _electron as electron, expect } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("test-results/startup-integration");
await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(output, "run-"));
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".startup-splash")).toBeVisible();
  await expect(page.locator("[inert]")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      Number(document.querySelector("#boot-plate")?.getAttribute("opacity")) >
      0.9,
  );
  await page.mouse.move(1100, 320);
  await page.screenshot({ path: resolve(output, "startup-dark.png") });
  await expect(page.locator(".startup-splash")).toHaveCount(0, {
    timeout: 6000,
  });
  await expect(
    page.getByRole("heading", { name: "我的书架", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[inert]")).toHaveCount(0);
  await page.getByRole("button", { name: /人工码字板/ }).click();
  await page.getByRole("button", { name: "返回书架", exact: true }).click();
  await expect(page.locator(".startup-splash")).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("xm-theme", "light"));
  await page.reload();
  await expect(page.locator(".startup-splash")).toBeVisible();
  await page.waitForFunction(
    () =>
      Number(document.querySelector("#boot-plate")?.getAttribute("opacity")) >
      0.9,
  );
  await page.screenshot({ path: resolve(output, "startup-light.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".startup-splash")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".startup-splash")).toHaveCount(0, {
    timeout: 3000,
  });
  await expect(
    page.getByRole("heading", { name: "我的书架", exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "Startup integration passed: actual shelf transition, input isolation, one play per load, dark/light, Escape, reduced motion; no renderer errors.",
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
