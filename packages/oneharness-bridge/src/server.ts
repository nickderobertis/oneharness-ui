import { bridgeResponseSchema } from "@oneharness-ui/ipc-contract";
import { readEnvironment } from "./environment.ts";
import { authorizationSchema, BridgeService } from "./service.ts";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_COOKIE_BYTES = 4096;
const SESSION_COOKIE = "oneharness_ui_capability";
const DEFAULT_UI_ORIGIN = "http://127.0.0.1:3000";

class RequestTooLargeError extends Error {}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new SyntaxError("Invalid length");
    if (length > MAX_REQUEST_BYTES) throw new RequestTooLargeError();
  }
  if (!request.body) throw new SyntaxError("Missing body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestTooLargeError();
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body);
}

function cookieAuthorization(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header || Buffer.byteLength(header) > MAX_COOKIE_BYTES) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function localOrigin(value: string): string {
  try {
    const origin = new URL(value);
    if (
      origin.protocol !== "http:" ||
      (origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost") ||
      origin.username ||
      origin.password ||
      origin.origin !== value
    ) {
      throw new Error("not a plain loopback origin");
    }
    return origin.origin;
  } catch {
    throw new Error("The development UI origin must be a plain HTTP loopback origin");
  }
}

export function startServer(
  port = 4317,
  expectedAuthorization: string,
  expectedOrigin = DEFAULT_UI_ORIGIN,
): ReturnType<typeof Bun.serve> {
  const authorization = authorizationSchema.parse(expectedAuthorization);
  const uiOrigin = localOrigin(expectedOrigin);
  const service = new BridgeService(readEnvironment(), authorization);
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const origin = request.headers.get("origin");
      const accessControlOrigin = origin === uiOrigin ? uiOrigin : "null";
      const headers = {
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Origin": accessControlOrigin,
        "Content-Type": "application/json",
        Vary: "Origin",
      };
      const path = new URL(request.url).pathname;
      if (request.method === "OPTIONS") {
        return new Response(null, { headers, status: accessControlOrigin === "null" ? 403 : 204 });
      }
      if (request.method === "GET" && path === "/health") {
        return Response.json({ status: "ok" }, { headers });
      }
      if (request.method === "GET" && path === "/session") {
        if (accessControlOrigin === "null") {
          return Response.json({ error: "Forbidden origin" }, { headers, status: 403 });
        }
        return new Response(null, {
          headers: {
            ...headers,
            "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(authorization)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=300`,
          },
          status: 204,
        });
      }
      if (request.method !== "POST" || path !== "/invoke") {
        return Response.json({ error: "Not found" }, { headers, status: 404 });
      }
      if (accessControlOrigin === "null") {
        return Response.json({ error: "Forbidden origin" }, { headers, status: 403 });
      }
      const presentedAuthorization = cookieAuthorization(request);
      if (!service.isAuthorized(presentedAuthorization)) {
        return Response.json({ error: "Unauthorized" }, { headers, status: 401 });
      }
      let input: unknown;
      try {
        input = await readBoundedJson(request);
      } catch (error) {
        if (error instanceof RequestTooLargeError) {
          return Response.json({ error: "Request too large" }, { headers, status: 413 });
        }
        return Response.json({ error: "Malformed JSON" }, { headers, status: 400 });
      }
      const response = bridgeResponseSchema.parse(
        await service.handle(input, presentedAuthorization),
      );
      return Response.json(response, { headers });
    },
  });
}
