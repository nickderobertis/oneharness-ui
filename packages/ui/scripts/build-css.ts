import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const source = await readFile(
  resolve(workspaceRoot, "apps/conversation-ui/src/app/styles.css"),
  "utf8",
);
const libraryCss = source
  .replace('@import "@fontsource-variable/inter";\n', "")
  .replace('@import "@fontsource-variable/jetbrains-mono";\n', "")
  .replace(
    '@import "tailwindcss";',
    '@import "tailwindcss" source("../../apps/conversation-ui/src") source("../src");',
  );
await mkdir(resolve(packageRoot, "dist"), { recursive: true });
await writeFile(resolve(packageRoot, "dist/styles.css"), libraryCss);
