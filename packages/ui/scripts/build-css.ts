import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const sourcePath = resolve(workspaceRoot, "apps/conversation-ui/src/app/styles.css");
const requiredImports = [
  '@import "tailwindcss";',
  '@import "@fontsource-variable/inter";',
  '@import "@fontsource-variable/jetbrains-mono";',
] as const;

try {
  const source = await readFile(sourcePath, "utf8");
  const missing = requiredImports.filter((value) => !source.includes(value));
  if (missing.length > 0) {
    throw new Error(
      `source stylesheet is missing required imports: ${missing.join(", ")}; restore the app theme imports, then rerun the UI build`,
    );
  }
  const libraryCss = source
    .replace(`${requiredImports[1]}\n`, "")
    .replace(`${requiredImports[2]}\n`, "")
    .replace(
      requiredImports[0],
      '@import "tailwindcss" source("../../apps/conversation-ui/src") source("../src");',
    );
  await mkdir(resolve(packageRoot, "dist"), { recursive: true });
  await writeFile(resolve(packageRoot, "dist/styles.css"), libraryCss);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(
    `UI stylesheet build failed: ${detail}. Verify ${sourcePath} is readable and the package dist directory is writable, then rerun \`bun run --cwd packages/ui build\`.`,
    { cause: error },
  );
}
