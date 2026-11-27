import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import { build, preview, type Plugin } from "vite";

const port = 15960;
const origin = `http://127.0.0.1:${port}`;
const viewport = { width: 1280, height: 720 };
const pageSize = 60;
const repetitions = 3;
const script = "scripts/measure-outbound-capacity.ts";
type FixtureWindow = { outboundCapacity: { count: number; tasks: PerformanceEntry[] } };

function fixturePlugin(): Plugin {
  const file = resolve("src/mocks/client.ts");
  const before = "          yield clone(OutboundListSchema, create(OutboundListSchema, {";
  return {
    name: "benchmark-synthetic-outbounds",
    enforce: "pre",
    transform(source, id) {
      if (id !== file) return;
      assert.equal(source.split(before).length, 2, "Outbound fixture source changed");
      return source.replace(before, `          for (let i = unique.size; i < globalThis.outboundCapacity.count; i++) {
            const tag = 'Capacity node ' + String(i).padStart(5, '0');
            unique.set(tag, create(GroupItemSchema, { tag, type: i % 2 ? 'direct' : 'vless' }));
          }
${before}`);
    },
  };
}

async function sample(browser: Browser, count: number) {
  const context = await browser.newContext({ viewport, locale: "en-US" });
  try {
    const blocked: string[] = [];
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url()).origin;
      if (target === origin) return route.continue();
      blocked.push(target);
      return route.abort();
    });
    await context.addInitScript((count) => {
      const tasks: PerformanceEntry[] = [];
      Object.assign(globalThis, { outboundCapacity: { count, tasks } });
      new PerformanceObserver((list) => tasks.push(...list.getEntries())).observe({ type: "longtask" });
    }, count);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    async function measuredFrame(action: () => Promise<void>) {
      const start = performance.now();
      await action();
      await page.evaluate(() => new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ));
      return Math.round(performance.now() - start);
    }

    await page.goto(origin);
    await page.getByRole("button", { name: "Explore demo", exact: true }).click();
    await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Outbounds", exact: true }).first().click();
    const startedAt = await page.evaluate(() => performance.now());
    const list = page.getByRole("list", { name: "All outbounds", exact: true });
    const inventoryMs = await measuredFrame(async () => {
      await page.getByRole("radio", { name: "All outbounds", exact: true }).click();
      await expect(list.getByRole("listitem")).toHaveCount(pageSize);
      await expect(page.getByText(`Page 1 / ${Math.ceil(count / pageSize)}`, { exact: true })).toBeVisible();
    });
    const cdp = await context.newCDPSession(page);
    const { usedSize } = await cdp.send("Runtime.getHeapUsage");
    const tag = "Capacity node " + String(count - 1).padStart(5, "0");
    const searchMs = await measuredFrame(async () => {
      await page.getByRole("textbox", { name: "Search outbounds", exact: true }).fill(tag);
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await expect(list.getByText(tag, { exact: true })).toBeVisible();
    });
    const longestTaskMs = await page.evaluate((start) => {
      const { tasks } = (globalThis as unknown as FixtureWindow).outboundCapacity;
      return Math.max(0, ...tasks.filter((entry) => entry.startTime >= start).map((entry) => entry.duration));
    }, startedAt);
    assert.deepEqual(blocked, [], "The fixture attempted to contact another origin");
    assert.deepEqual(errors, [], "The dashboard reported a browser error");
    const heapMiB = Math.round(usedSize / (1024 * 1024) * 10) / 10;
    return { count, rendered: pageSize, inventoryMs, searchMs, longestTaskMs, heapMiB };
  } finally {
    await context.close();
  }
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();
const source = git("rev-parse", "HEAD");
const status = git("status", "--porcelain=v1", "--untracked-files=all").split("\n").filter(Boolean);
const allowed = [script, "docs/verification.md"];
assert.deepEqual(status.filter((line) => !allowed.includes(line.slice(3))), [], "Benchmark requires clean application source and configuration");
const scriptSha256 = createHash("sha256").update(await readFile(script)).digest("hex");
const directory = await mkdtemp(join(tmpdir(), "singdeck-outbound-capacity-"));
const outDir = join(directory, "dist");
try {
  await build({ envFile: false, plugins: [fixturePlugin()], build: { outDir }, logLevel: "error" });
  const server = await preview({ build: { outDir }, preview: { host: "127.0.0.1", port, strictPort: true }, logLevel: "error" });
  try {
    const browser = await chromium.launch();
    try {
      await sample(browser, 1_000);
      const samples = [];
      for (let run = 0; run < repetitions; run++) {
        for (const count of [1_000, 10_000, 20_000]) samples.push(await sample(browser, count));
      }
      const report = {
        source, status, scriptSha256, bun: process.versions.bun,
        platform: process.platform, architecture: process.arch, logicalCpus: availableParallelism(),
        browser: browser.version(), viewport, repetitions, samples,
      };
      const reportFile = join(directory, "measurements.json");
      await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
      console.log(reportFile);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
} finally {
  await rm(outDir, { recursive: true, force: true });
}
