import {
  type BridgeRequest,
  type BridgeResponse,
  bridgeRequestSchema,
  bridgeResponseSchema,
} from "@oneharness-ui/ipc-contract";
import { z } from "zod";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const httpConfigurationSchema = z.object({
  authorization: z.string().min(32).max(256),
  url: z
    .string()
    .url()
    .transform((value, context) => {
      const url = new URL(value);
      if (
        url.protocol !== "http:" ||
        (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
        url.username ||
        url.password
      ) {
        context.addIssue({
          code: "custom",
          message: "Bridge URL must be an unauthenticated loopback URL",
        });
        return z.NEVER;
      }
      return url.origin;
    }),
});

function httpConfiguration(): z.infer<typeof httpConfigurationSchema> {
  return httpConfigurationSchema.parse({
    authorization: process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_TOKEN,
    url: process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL,
  });
}

async function invokeTauri(request: BridgeRequest): Promise<unknown> {
  const { Command } = await import("@tauri-apps/plugin-shell");
  const command = Command.sidecar("binaries/oneharness-ui-bridge");
  let stdout = "";
  let stderr = "";
  command.stdout.on("data", (line) => {
    stdout += `${line}\n`;
  });
  command.stderr.on("data", (line) => {
    stderr += `${line}\n`;
  });
  const closed = new Promise<void>((resolve, reject) => {
    command.on("close", ({ code }) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Local bridge exited with status ${code}`));
    });
    command.on("error", reject);
  });
  const child = await command.spawn();
  await child.write(`${JSON.stringify(request)}\n`);
  await closed;
  return JSON.parse(stdout);
}

async function invokeHttp(request: BridgeRequest): Promise<unknown> {
  const configuration = httpConfiguration();
  const response = await fetch(`${configuration.url}/invoke`, {
    body: JSON.stringify(request),
    headers: {
      Authorization: `Bearer ${configuration.authorization}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Local bridge returned HTTP ${response.status}`);
  return await response.json();
}

export async function invokeBridge(input: unknown): Promise<BridgeResponse> {
  const request = bridgeRequestSchema.parse(input);
  const value =
    typeof window !== "undefined" && window.__TAURI_INTERNALS__
      ? await invokeTauri(request)
      : await invokeHttp(request);
  return bridgeResponseSchema.parse(value);
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export function dataOrThrow(
  response: BridgeResponse,
): Extract<BridgeResponse, { ok: true }>["data"] {
  if (!response.ok)
    throw new BridgeError(response.error.message, response.error.code, response.error.detail);
  return response.data;
}
