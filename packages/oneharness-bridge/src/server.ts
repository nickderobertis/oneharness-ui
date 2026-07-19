import { randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { bridgeResponseSchema, bridgeRoutes } from "@oneharness-ui/ipc-contract";
import { readEnvironment } from "./environment.ts";
import { authorizationSchema, BridgeService } from "./service.ts";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_COOKIE_BYTES = 4096;
const SESSION_COOKIE = "oneharness_ui_capability";
const DEFAULT_UI_ORIGIN = "http://127.0.0.1:3000";
export const WEB_DEFAULT_PORT = 4173;
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

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

function isPermittedWebOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    const octets = originUrl.hostname.split(".").map(Number);
    const privateIpv4 =
      octets.length === 4 &&
      octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
      (octets[0] === 10 ||
        (octets[0] === 127 && octets[1] === 0 && octets[2] === 0 && octets[3] === 1) ||
        (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
        (octets[0] === 192 && octets[1] === 168));
    return originUrl.protocol === "http:" && privateIpv4 && originUrl.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

async function staticResponse(root: string, pathname: string): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    return new Response("Bad request", { status: 400 });
  }
  const requested = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const candidate = resolve(root, `.${requested}`);
  const local = relative(root, candidate);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const [canonical, metadata] = await Promise.all([realpath(candidate), stat(candidate)]);
    const canonicalLocal = relative(root, canonical);
    if (
      !metadata.isFile() ||
      canonicalLocal === ".." ||
      canonicalLocal.startsWith(`..${sep}`) ||
      isAbsolute(canonicalLocal)
    ) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(Bun.file(canonical), {
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type":
          CONTENT_TYPES[extname(canonical).toLowerCase()] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function startWebServer({
  hostname = "127.0.0.1",
  port,
  staticDirectory,
}: {
  hostname?: string;
  port: number;
  staticDirectory: string;
}): Promise<ReturnType<typeof Bun.serve>> {
  const authorization = authorizationSchema.parse(randomBytes(32).toString("base64url"));
  const root = await realpath(staticDirectory);
  if (!(await stat(root)).isDirectory()) throw new Error("web UI path must be a directory");
  const service = new BridgeService(readEnvironment(), authorization);
  return Bun.serve({
    hostname,
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const jsonHeaders = { ...SECURITY_HEADERS, "Content-Type": "application/json" };
      if (request.method === "GET" && url.pathname === bridgeRoutes.health) {
        return Response.json({ status: "ok" }, { headers: jsonHeaders });
      }
      if (url.pathname === bridgeRoutes.invoke) {
        if (request.method !== "POST") {
          return Response.json(
            { error: "Method not allowed" },
            { headers: jsonHeaders, status: 405 },
          );
        }
        if (!isPermittedWebOrigin(request)) {
          return Response.json(
            { error: "Forbidden origin" },
            { headers: jsonHeaders, status: 403 },
          );
        }
        let input: unknown;
        try {
          input = await readBoundedJson(request);
        } catch (error) {
          const status = error instanceof RequestTooLargeError ? 413 : 400;
          const message = status === 413 ? "Request too large" : "Malformed JSON";
          return Response.json({ error: message }, { headers: jsonHeaders, status });
        }
        const response = bridgeResponseSchema.parse(await service.handle(input, authorization));
        return Response.json(response, { headers: jsonHeaders });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { headers: SECURITY_HEADERS, status: 405 });
      }
      const response = await staticResponse(root, url.pathname);
      return request.method === "HEAD"
        ? new Response(null, { headers: response.headers, status: response.status })
        : response;
    },
  });
}
