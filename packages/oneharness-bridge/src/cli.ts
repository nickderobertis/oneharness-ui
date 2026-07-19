#!/usr/bin/env bun
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { bridgeResponseSchema } from "@oneharness-ui/ipc-contract";
import { z } from "zod";
import { readEnvironment } from "./environment.ts";
import { startServer, startWebServer, WEB_DEFAULT_PORT } from "./server.ts";
import { BridgeService } from "./service.ts";

const MAX_REQUEST_BYTES = 64 * 1024;

async function readRequestLine(): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let value = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return value;
      value += decoder.decode(next.value, { stream: true });
      if (Buffer.byteLength(value) > MAX_REQUEST_BYTES) {
        throw new Error("IPC request is too large");
      }
      const newline = value.indexOf("\n");
      if (newline >= 0) return value.slice(0, newline);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "web") {
    const port = Number(process.env.ONEHARNESS_UI_PORT ?? String(WEB_DEFAULT_PORT));
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
      throw new Error("ONEHARNESS_UI_PORT must be an unprivileged TCP port");
    }
    const hostname = z
      .union([
        z.literal("127.0.0.1"),
        z
          .ipv4()
          .refine(
            (value) =>
              value.startsWith("10.") ||
              value.startsWith("192.168.") ||
              /^172\.(1[6-9]|2\d|3[01])\./.test(value),
            "ONEHARNESS_UI_HOST must be loopback or a private LAN IPv4 address",
          ),
      ])
      .parse(process.env.ONEHARNESS_UI_HOST ?? "127.0.0.1");
    await startWebServer({
      authorization: randomBytes(32).toString("base64url"),
      hostname,
      port,
      staticDirectory: resolve(process.cwd(), "apps/conversation-ui/out"),
    });
    process.stdout.write(`oneharness UI listening on http://${hostname}:${port}\n`);
    return;
  }
  if (process.argv[2] === "serve") {
    const environment = readEnvironment();
    const port = Number(process.env.ONEHARNESS_UI_BRIDGE_PORT ?? "4317");
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
      throw new Error("ONEHARNESS_UI_BRIDGE_PORT must be an unprivileged TCP port");
    }
    if (!environment.httpAuthorization) {
      throw new Error("ONEHARNESS_UI_HTTP_TOKEN must contain at least 32 characters");
    }
    startServer(port, environment.httpAuthorization);
    return;
  }

  const input = await readRequestLine();
  const authorization = randomUUID();
  const service = new BridgeService(readEnvironment(), authorization);
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    value = undefined;
  }
  process.stdout.write(
    `${JSON.stringify(bridgeResponseSchema.parse(await service.handle(value, authorization)))}\n`,
  );
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`oneharness-ui-bridge: ${message}\n`);
  process.exitCode = 1;
});
