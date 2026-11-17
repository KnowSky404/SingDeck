import { expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const binary = process.env.SING_BOX_BINARY;
it.skipIf(!binary)(
  "official core downloads a root-layout dashboard ZIP and serves its assets locally",
  async () => {
    const directory = await mkdtemp(`${tmpdir()}/singdeck-download-`);
    let child: ChildProcess | undefined;
    const server = createServer();
    try {
      const archive = `${directory}/singdeck.zip`;
      const packed = spawnSync(
        "python3",
        [
          "-c",
          "from pathlib import Path; from zipfile import ZipFile, ZIP_DEFLATED; import sys; z = ZipFile(sys.argv[1], 'w', ZIP_DEFLATED); [z.write(p, p.as_posix()) for p in Path('.').rglob('*') if p.is_file()]; z.close()",
          archive,
        ],
        { cwd: "dist" },
      );
      expect(packed.status, packed.stderr?.toString()).toBe(0);
      const zip = await readFile(archive);
      server.on("request", (_req, response) => {
        response.writeHead(200, {
          "content-type": "application/zip",
          etag: '"singdeck-fixture"',
        });
        response.end(zip);
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing download fixture address");
      const config = JSON.parse(
        await readFile("examples/sing-box-dashboard-download.json", "utf8"),
      );
      config.services[0].secret = randomBytes(24).toString("hex");
      config.services[0].listen_port = 19290;
      config.inbounds[0].listen_port = 19280;
      config.services[0].dashboard.path = `${directory}/dashboard`;
      config.services[0].dashboard.download_url = `http://127.0.0.1:${address.port}/singdeck.zip`;
      const path = `${directory}/config.json`;
      await writeFile(path, JSON.stringify(config), { mode: 0o600 });
      expect(spawnSync(binary!, ["check", "-c", path]).status).toBe(0);
      child = spawn(binary!, ["run", "-c", path], { stdio: "ignore" });
      const endpoint = "http://127.0.0.1:19290/dashboard/";
      await expect
        .poll(
          async () => {
            try {
              return (await fetch(endpoint)).ok;
            } catch {
              return false;
            }
          },
          { timeout: 10000 },
        )
        .toBe(true);
      const html = await (await fetch(endpoint)).text();
      expect(html).toContain("SingDeck");
      const asset = /src="(\.\/assets\/[^"]+)"/.exec(html)?.[1];
      expect(asset).toBeTruthy();
      expect((await fetch(new URL(asset!, endpoint))).ok).toBe(true);
      expect(await readFile(`${directory}/dashboard/.etag`, "utf8")).toBe(
        '"singdeck-fixture"',
      );
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise<void>((resolve) =>
          child!.once("exit", () => resolve()),
        );
        child.kill();
        await exited;
      }
      if (server.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
