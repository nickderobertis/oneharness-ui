import { extname, join, normalize } from "node:path";

const root = join(import.meta.dir, "../../out");
const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

Bun.serve({
  hostname: "127.0.0.1",
  port: 3000,
  async fetch(request) {
    const url = new URL(request.url);
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
    let path = join(root, relative);
    if (url.pathname.endsWith("/")) path = join(path, "index.html");
    let file = Bun.file(path);
    if (!(await file.exists())) file = Bun.file(join(root, "404.html"));
    return new Response(file, {
      headers: { "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream" },
      status: (await file.exists()) ? 200 : 404,
    });
  },
});
