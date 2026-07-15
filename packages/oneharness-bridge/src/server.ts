import { bridgeResponseSchema } from "@oneharness-ui/ipc-contract";
import { readEnvironment } from "./environment.ts";
import { authorizationSchema, BridgeService } from "./service.ts";

const MAX_REQUEST_BYTES = 64 * 1024;

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

function bearerAuthorization(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

function allowedOrigin(value: string | null): string {
  if (!value) return "null";
  try {
    const origin = new URL(value);
    return origin.protocol === "http:" &&
      (origin.hostname === "127.0.0.1" || origin.hostname === "localhost")
      ? origin.origin
      : "null";
  } catch {
    return "null";
  }
}

export function startServer(
  port = 4317,
  expectedAuthorization: string,
): ReturnType<typeof Bun.serve> {
  const authorization = authorizationSchema.parse(expectedAuthorization);
  const service = new BridgeService(readEnvironment(), authorization);
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const origin = request.headers.get("origin");
      const headers = {
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Origin": allowedOrigin(origin),
        "Content-Type": "application/json",
        Vary: "Origin",
      };
      if (request.method === "OPTIONS") return new Response(null, { headers, status: 204 });
      if (request.method === "GET" && new URL(request.url).pathname === "/health") {
        return Response.json({ status: "ok" }, { headers });
      }
      if (request.method !== "POST" || new URL(request.url).pathname !== "/invoke") {
        return Response.json({ error: "Not found" }, { headers, status: 404 });
      }
      const presentedAuthorization = bearerAuthorization(request);
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
