import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setImmediate } from "node:timers";
import type { TauriCapabilities } from "@wdio/tauri-service";
import * as service from "../src/tauri-launcher-service.ts";

async function fixture(startTimeout = service.DRIVER_START_TIMEOUT) {
  const root = await mkdtemp(resolve(tmpdir(), "desktop-driver-test-"));
  let release: () => void = () => {};
  let requested: () => void = () => {};
  const observed = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const control = createServer(async (_request, response) => {
    requested();
    await held;
    response.end("release");
  });
  await new Promise<void>((resolve) => control.listen(0, "127.0.0.1", resolve));
  const address = control.address();
  if (!address || typeof address === "string") throw new Error("control port missing");
  const executable = resolve(root, "driver.mjs");
  await writeFile(
    executable,
    // llmlint: ignore[e2e_not_mocked] The acceptance criteria require a held readiness seam. This subprocess controls only driver readiness; the real launcher setup/lifecycle is the layer under test. Native Windows verification runs on the merge path.
    `#!${process.execPath}
import { createServer } from 'node:http';
const index = process.argv.indexOf('--port');
const argument = process.argv[index + 1];
if (index < 0 || !argument || !/^\\d+$/.test(argument)) throw new Error('missing or invalid --port');
const port = Number(argument);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port out of range');
let ready = false;
let notified = false;
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/session') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      // Like WebKitWebDriver/msedgedriver behind tauri-driver: a browserName fails matching.
      let always;
      try {
        always = JSON.parse(body).capabilities.alwaysMatch;
      } catch {
        always = undefined;
      }
      if (typeof always !== 'object' || always === null || Array.isArray(always)) {
        response.writeHead(400).end(JSON.stringify({value: {error: 'invalid argument', message: 'alwaysMatch must be an object'}}));
        return;
      }
      if ('browserName' in always) {
        response.writeHead(500).end(JSON.stringify({value: {error: 'session not created', message: 'Failed to match capabilities'}}));
        return;
      }
      response.end(JSON.stringify({value: {sessionId: 'held-driver-session', capabilities: always}}));
    });
    return;
  }
  if (request.url !== '/status') { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({value: {ready}}));
  if (!notified) {
    notified = true;
    fetch('http://127.0.0.1:${address.port}/held-native-startup').then(async (response) => {
      if (!response.ok || await response.text() !== 'release') throw new Error('invalid readiness release');
      ready = true;
    });
  }
});
server.listen(port, '127.0.0.1', () => {
  // A listening intermediary is not proof that its native driver is ready.
  console.log('intermediary listening; native startup held');
});
`,
    { mode: 0o700 },
  );
  const launcher = new service.launcher({
    logDir: root,
    driverProvider: "external",
    tauriDriverPath: process.platform === "win32" ? process.execPath : executable,
    driverArguments: process.platform === "win32" ? [executable] : [],
    startTimeout,
    nativeDriverPath: process.execPath,
  });
  return {
    launcher,
    observed,
    release,
    root,
    cleanup: async () => {
      release();
      await launcher.onComplete();
      await new Promise<void>((resolve, reject) =>
        control.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe("native desktop WebDriver service", () => {
  test("exposes only the external driver launcher", () => {
    expect(service.launcher).toBeFunction();
    expect(Object.hasOwn(service, "default")).toBe(false);
    expect(service.DRIVER_START_TIMEOUT).toBe(120_000);
  });

  test("holds session setup until the native driver reports ready", async () => {
    const driver = await fixture();
    const capabilities: TauriCapabilities[] = [
      { browserName: "tauri", "tauri:options": { application: process.execPath } },
    ];
    let prepared = false;
    const preparation = driver.launcher.onPrepare({ maxInstances: 1 }, capabilities).then(() => {
      prepared = true;
    });
    try {
      await driver.observed;
      await new Promise<void>((resolve) => setImmediate(resolve));
      // The control request follows a real status response with ready:false.
      // Hold the native-startup step until an HTTP request proves the launcher is polling.
      expect(prepared).toBe(false);
      const log = await readFile(resolve(driver.root, "driver-startup.log"), "utf8");
      expect(log).toContain("native WebDriver");
      driver.release();
      await preparation;
      expect(prepared).toBe(true);
      const response = await fetch(
        `http://${capabilities[0]?.hostname}:${capabilities[0]?.port}/status`,
      );
      expect(await response.json()).toEqual({ value: { ready: true } });
      const { hostname, port, ...requested } = capabilities[0] ?? {};
      const session = await fetch(`http://${hostname}:${port}/session`, {
        method: "POST",
        body: JSON.stringify({ capabilities: { alwaysMatch: requested } }),
      });
      expect(session.status).toBe(200);
      expect(requested).toEqual({ "tauri:options": { application: process.execPath } });
    } finally {
      await driver.cleanup();
    }
  });

  test("withheld readiness fails with driver names, elapsed bound and observed status, and stops the child", async () => {
    const driver = await fixture(10_000);
    const capabilities: TauriCapabilities[] = [
      { "tauri:options": { application: process.execPath } },
    ];
    try {
      const preparation = driver.launcher.onPrepare({ maxInstances: 1 }, capabilities);
      await driver.observed;
      await new Promise<void>((resolve) => setImmediate(resolve));
      await expect(preparation).rejects.toThrow(
        /tauri-driver.*native WebDriver.*limit 10000ms.*HTTP 200; ready was not true/,
      );
      expect(capabilities[0]?.port).toBeUndefined();
      expect(await readFile(resolve(driver.root, "driver-startup.log"), "utf8")).toContain(
        "intermediary listening; native startup held",
      );
    } finally {
      await driver.cleanup();
    }
  }, 20_000);
  test("a non-Tauri browserName is rejected before driver launch", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "desktop-browser-name-"));
    try {
      const launcher = new service.launcher({ logDir: root, nativeDriverPath: process.execPath });
      await expect(
        launcher.onPrepare(
          { maxInstances: 1 },
          // The capability type forbids "chrome"; untyped WDIO config can still carry it,
          // so the test supplies it as parsed data to reach the runtime rejection.
          JSON.parse('[{"browserName":"chrome"}]') as TauriCapabilities[],
        ),
      ).rejects.toThrow("browserName is tauri, wry or unset");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("invalid launcher configuration is rejected before setup", () => {
    expect(() => new service.launcher({ logDir: "relative" })).toThrow("requires an absolute path");
    expect(() => new service.launcher({ logDir: tmpdir(), startTimeout: 0 })).toThrow();
    expect(
      () => new service.launcher({ logDir: tmpdir(), startTimeout: Number.POSITIVE_INFINITY }),
    ).toThrow();
    expect(
      () => new service.launcher({ logDir: tmpdir(), driverArguments: ["bad\0argument"] }),
    ).toThrow();
  });

  test("an absent native executable stops setup before driver launch", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "desktop-missing-driver-"));
    try {
      const launcher = new service.launcher({
        logDir: root,
        nativeDriverPath: resolve(root, "missing-msedgedriver.exe"),
      });
      await expect(launcher.onPrepare({ maxInstances: 1 }, [])).rejects.toThrow(
        /native WebDriver executable is absent or not executable: .*missing-msedgedriver.exe.*before starting tauri-driver/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an early driver exit names both executables and does not hang cleanup", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "desktop-failed-driver-"));
    try {
      const executable = resolve(root, "exiting-driver.mjs");
      await writeFile(
        executable,
        "process.stderr.write('native initialization failed'); process.exit(23);",
      );
      const launcher = new service.launcher({
        logDir: root,
        tauriDriverPath: process.execPath,
        driverArguments: [executable],
        nativeDriverPath: process.execPath,
      });
      await expect(launcher.onPrepare({ maxInstances: 1 }, [])).rejects.toThrow(
        /tauri-driver.*native WebDriver.*process exited \(23\).*native initialization failed/s,
      );
      await launcher.onComplete();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
