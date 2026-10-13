import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import type { TauriCapabilities } from "@wdio/tauri-service";
import { z } from "zod";
import {
  findDriverExecutable,
  prepareNativeDriver,
  validateDriverExecutable,
} from "./native-driver.ts";

export const DRIVER_START_TIMEOUT = 120_000;

const safeString = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\0"));
const absolutePath = safeString.refine((value) => isAbsolute(value), "requires an absolute path");
const launcherOptions = z.object({
  logDir: absolutePath,
  driverProvider: z.literal("external").optional(),
  tauriDriverPath: absolutePath.optional(),
  startTimeout: z.number().finite().positive().max(600_000).optional(),
  driverArguments: z.array(safeString).max(64).optional(),
  nativeDriverPath: absolutePath.optional(),
});
type LauncherOptions = z.infer<typeof launcherOptions>;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot allocate WebDriver port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

// The release app has no WDIO plugin worker hooks.
export class launcher {
  private process: ChildProcess | undefined;
  private output = "";
  private readonly options: LauncherOptions;
  constructor(options: LauncherOptions) {
    this.options = launcherOptions.parse(options);
  }

  async onPrepare(_config: unknown, capabilities: TauriCapabilities[]) {
    for (const capability of capabilities) {
      if (
        capability.browserName !== undefined &&
        capability.browserName !== "tauri" &&
        capability.browserName !== "wry"
      ) {
        throw new Error(
          `tauri-driver supports browserName tauri or wry, got: ${capability.browserName}`,
        );
      }
      // WDIO needs browserName to select the service; tauri-driver forwards it to
      // WebKitWebDriver/msedgedriver, which reject the session on that name.
      delete capability.browserName;
    }
    const nativeDriver = this.options.nativeDriverPath
      ? validateDriverExecutable(this.options.nativeDriverPath, "native WebDriver")
      : await prepareNativeDriver();
    const port = await freePort();
    let nativePort = await freePort();
    while (nativePort === port) nativePort = await freePort();
    const driver = this.options.tauriDriverPath
      ? validateDriverExecutable(this.options.tauriDriverPath, "tauri-driver")
      : findDriverExecutable(process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver");
    const timeout = this.options.startTimeout ?? DRIVER_START_TIMEOUT;
    const args = [
      ...(this.options.driverArguments ?? []),
      "--port",
      String(port),
      "--native-port",
      String(nativePort),
      "--native-driver",
      nativeDriver,
    ];
    await mkdir(this.options.logDir, { recursive: true });
    const log = resolve(this.options.logDir, "driver-startup.log");
    this.output = `tauri-driver: ${driver}; native WebDriver: ${nativeDriver}\n`;
    await writeFile(log, this.output);
    const started = performance.now();
    const child = spawn(driver, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    this.process = child;
    let processError: string | undefined;
    child.on("error", (error) => {
      processError = error.message;
    });
    // Keep bounded driver-only diagnostics; never capture app/session payloads.
    const capture = (chunk: Buffer) => {
      this.output = (this.output + chunk.toString()).slice(-8192);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    let observation = "no status response";
    let lastHttpResponse = "no HTTP status response";
    let ready = false;
    try {
      while (performance.now() - started < timeout) {
        if (processError || child.exitCode !== null || child.signalCode !== null) {
          throw new Error(processError ?? `process exited (${child.exitCode ?? child.signalCode})`);
        }
        try {
          const response = await fetch(`http://127.0.0.1:${port}/status`, {
            signal: AbortSignal.timeout(
              Math.max(1, Math.min(2000, Math.ceil(timeout - (performance.now() - started)))),
            ),
          });
          lastHttpResponse = `HTTP ${response.status}`;
          const status: unknown = await response.json();
          if (response.ok && typeof status === "object" && status !== null && "value" in status) {
            const value = status.value;
            if (
              typeof value === "object" &&
              value !== null &&
              "ready" in value &&
              value.ready === true
            ) {
              for (const capability of capabilities) {
                capability.hostname = "127.0.0.1";
                capability.port = port;
              }
              ready = true;
              return;
            }
          }
          lastHttpResponse = `HTTP ${response.status}; ready was not true`;
          observation = lastHttpResponse;
        } catch (error) {
          observation = error instanceof Error ? error.message : String(error);
        }
        await pause(Math.min(100, Math.max(0, timeout - (performance.now() - started))));
      }
      throw new Error(`last status observation: ${observation}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `tauri-driver (${driver}), native WebDriver (${nativeDriver}) failed readiness after ${Math.round(performance.now() - started)}ms (limit ${timeout}ms): ${detail}; last HTTP response: ${lastHttpResponse}; driver output: ${this.output}; inspect ${log}`,
      );
    } finally {
      try {
        await writeFile(log, this.output);
      } finally {
        // A rejected onPrepare must clean up even when WDIO never calls onComplete.
        if (!ready) await this.onComplete();
      }
    }
  }

  async onComplete() {
    const child = this.process;
    this.process = undefined;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}
