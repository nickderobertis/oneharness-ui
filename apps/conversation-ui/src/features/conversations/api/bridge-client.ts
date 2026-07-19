import {
  type BridgeRequest,
  type BridgeResponse,
  bridgeRequestSchema,
  bridgeResponseSchema,
  bridgeRoutes,
} from "@oneharness-ui/ipc-contract";
import { z } from "zod";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const httpConfigurationSchema = z.object({
  url: z
    .string()
    .optional()
    .transform((value, context) => {
      if (value === undefined || value === "") return "";
      if (!URL.canParse(value)) {
        context.addIssue({ code: "custom", message: "Bridge URL must be a URL" });
        return z.NEVER;
      }
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
    url: process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL,
  });
}

async function invokeTauri(request: BridgeRequest): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke("invoke_bridge", { request });
}

async function invokeHttp(request: BridgeRequest): Promise<unknown> {
  const configuration = httpConfiguration();
  const session = await fetch(`${configuration.url}${bridgeRoutes.session}`, {
    credentials: "include",
  });
  if (!session.ok) throw new Error(`Local bridge session returned HTTP ${session.status}`);
  const response = await fetch(`${configuration.url}${bridgeRoutes.invoke}`, {
    body: JSON.stringify(request),
    credentials: "include",
    headers: {
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
