import { expect, test } from "@playwright/test";

test("the install manifest stays within the dashboard mount", async ({ page }) => {
  await page.goto("/#/connections");
  const mount = new URL("./", page.url());
  const cdp = await page.context().newCDPSession(page);
  const { url, errors, manifest } = await cdp.send("Page.getAppManifest");

  expect(errors).toEqual([]);
  expect(url).toBe(new URL("manifest.json", mount).href);
  expect(manifest).toMatchObject({
    name: "SingDeck",
    id: mount.href,
    startUrl: mount.href,
    scope: mount.href,
    display: "kStandalone",
    icons: [
      { url: new URL("icon-192.png", mount).href, sizes: "192x192" },
      { url: new URL("icon-512.png", mount).href, sizes: "512x512" },
    ],
  });

  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => ({
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
    caches: await caches.keys(),
  }))).toEqual({ serviceWorkers: 0, caches: [] });
});
