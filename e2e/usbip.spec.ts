import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test.use({ trace: "off" });

test("reads USB/IP server status through the native detail stream", async ({ page, baseURL }) => {
  const binary = process.env.SING_BOX_BINARY;
  test.skip(!binary, "Requires official sing-box v1.14.0 with USB/IP support.");

  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  await new Promise<void>((closed) => probe.close(() => closed()));

  const directory = await mkdtemp(`${tmpdir()}/singdeck-usbip-browser-`);
  const secret = randomBytes(24).toString("hex");
  const path = `${directory}/config.json`;
  await writeFile(path, JSON.stringify({
    services: [
      {
        type: "api",
        tag: "usbip-api",
        listen: "127.0.0.1",
        listen_port: 0,
        secret,
        access_control_allow_origin: [new URL(baseURL!).origin],
      },
      {
        type: "usbip-server",
        tag: "fixture-dynamic-usb",
        provider: "dynamic",
        listen: "127.0.0.1",
        listen_port: address.port,
      },
    ],
  }), { mode: 0o600 });
  const core = spawn(resolve(binary!), ["run", "-c", path], { stdio: ["ignore", "ignore", "pipe"], cwd: directory });
  core.on("error", () => {});
  let output = "";
  core.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
    output = (output + chunk).slice(-2048);
  });

  try {
    const endpoint = () => /service\/api\[usbip-api\]: tcp server started at (127\.0\.0\.1:\d+)/.exec(output)?.[1];
    await expect.poll(() => Boolean(endpoint()), { timeout: 5000 }).toBe(true);

    const statusRPC = (request: { url(): string }) => request.url().endsWith("/SubscribeUSBIPServerStatus");
    let calls = 0;
    page.on("request", (request) => {
      if (statusRPC(request)) calls++;
    });
    await page.goto("/#/settings");
    await page.getByRole("textbox", { name: "API endpoint", exact: true }).fill(`http://${endpoint()}`);
    await page.getByLabel("Bearer token", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    const entry = page.getByRole("link", { name: "USB/IP server status" });
    await expect(entry).toBeVisible();
    expect(calls).toBe(0);
    await entry.press("Enter");
    await expect(page.getByRole("heading", { name: "USB/IP server status", level: 1 })).toBeFocused();
    const server = page.getByRole("listitem").filter({ hasText: "fixture-dynamic-usb" });
    await expect(server.getByRole("heading", { name: "fixture-dynamic-usb" })).toBeVisible();
    await expect(server.getByText("0", { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const aborted = page.waitForEvent("requestfailed", statusRPC);
    await page.getByRole("link", { name: "Back to Settings" }).click();
    await aborted;
    await expect(entry).toBeVisible();
  } finally {
    if (core.pid && core.exitCode === null && core.signalCode === null) {
      const exited = once(core, "exit");
      core.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
