import { readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { harnessPort } from "./configuration.ts";

const repository = resolve(import.meta.dir, "../../..");
const exportDirectory = resolve(repository, "apps/conversation-ui/out");
const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

// The page renders the published `@oneharness/ui` build, styled by the app's compiled export of
// the package stylesheet, so a journey sees exactly the bundle and theme a consumer ships.
const exportIndex = await readFile(resolve(exportDirectory, "index.html"), "utf8").catch(
  (error: unknown) => {
    throw new Error(
      `component harness: the static export is missing (${String(error)}); run 'bunx nx run conversation-ui:build', then rerun the journeys`,
    );
  },
);
const stylesheets = [
  ...exportIndex.matchAll(/<link rel="stylesheet" href="(\/_next\/[^"]+\.css)"/g),
]
  .map((match) => match[1])
  .filter((href): href is string => href !== undefined);
if (stylesheets.length === 0)
  throw new Error(
    "component harness: the static export links no stylesheet; rebuild conversation-ui and rerun the journeys",
  );
const build = await Bun.build({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  entrypoints: [resolve(import.meta.dir, "page.tsx")],
  target: "browser",
});
const script = build.outputs[0];
if (!build.success || !script)
  throw new Error(
    `component harness: bundling page.tsx failed (${build.logs.join("; ")}); build the ui package with 'bunx nx run ui:build', then rerun the journeys`,
  );
const scriptSource = await script.text();
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>oneharness ui component harness</title>
${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n")}
</head>
<body><div id="root"></div><script type="module" src="/harness.js"></script></body>
</html>`;

async function exported(pathname: string): Promise<Response> {
  const path = resolve(exportDirectory, `.${decodeURIComponent(pathname)}`);
  const inside = relative(exportDirectory, path);
  if (inside.startsWith(`..${sep}`) || inside === ".." || !pathname.startsWith("/_next/static/"))
    return new Response("Not found", { status: 404 });
  const body = await readFile(path).catch(() => null);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: { "content-type": contentTypes[extname(path)] ?? "application/octet-stream" },
  });
}

Bun.serve({
  fetch: async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return new Response("ok");
    if (pathname === "/")
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (pathname === "/harness.js")
      return new Response(scriptSource, {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    return await exported(pathname);
  },
  hostname: "127.0.0.1",
  port: harnessPort,
});
