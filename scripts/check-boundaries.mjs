#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoots = ["apps/conversation-ui/src", "packages/oneharness-bridge/src"];
const extensions = new Set([".ts", ".tsx"]);
const violations = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extensions.has(extname(path))) await inspect(path);
  }
}

async function inspect(path) {
  const content = await readFile(path, "utf8");
  const file = relative(root, path).replaceAll("\\", "/");
  const ownFeature = file.match(/src\/features\/([^/]+)/)?.[1];
  for (const match of content.matchAll(
    /(?:from\s+|import\s*)["']@\/features\/([^/'"]+)\/([^'"]+)["']/g,
  )) {
    const [, target, subpath] = match;
    if (ownFeature !== target || (ownFeature === undefined && subpath !== "index")) {
      violations.push(`${file}: import features through their public index; found ${match[0]}`);
    }
  }
  if (file.includes("/packages/") && /from\s+["'](?:@\/|apps\/)/.test(content)) {
    violations.push(`${file}: packages must not import application code`);
  }
}

for (const directory of sourceRoots) await walk(join(root, directory));
if (violations.length > 0) {
  process.stderr.write(
    `import boundary violations:\n${violations.join("\n")}\nRestore imports to the documented package direction, then rerun just lint.\n`,
  );
  process.exit(1);
}
