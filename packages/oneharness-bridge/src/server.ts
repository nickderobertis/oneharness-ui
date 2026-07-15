import { bridgeResponseSchema } from "@oneharness-ui/ipc-contract";
import { readEnvironment } from "./environment.ts";
import { BridgeService } from "./service.ts";

const MAX_REQUEST_BYTES = 64 * 1024;

export function startServer(port = 4317): ReturnType<typeof Bun.serve> {
  const service = new BridgeService(readEnvironment());
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const origin = request.headers.get("origin");
      const headers = {
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Origin": origin?.startsWith("http://127.0.0.1:") ? origin : "null",
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
      const length = Number(request.headers.get("content-length") ?? 0);
      if (!Number.isSafeInteger(length) || length > MAX_REQUEST_BYTES) {
        return Response.json({ error: "Request too large" }, { headers, status: 413 });
      }
      let input: unknown;
      try {
        input = await request.json();
      } catch {
        return Response.json({ error: "Malformed JSON" }, { headers, status: 400 });
      }
      const response = bridgeResponseSchema.parse(await service.handle(input));
      return Response.json(response, { headers });
    },
  });
}
