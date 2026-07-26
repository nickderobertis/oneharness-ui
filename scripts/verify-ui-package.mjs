import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

function exportTargets(exports_) {
  const targets = [];
  for (const value of Object.values(exports_ ?? {})) {
    if (typeof value === "string") {
      targets.push(value);
      continue;
    }
    if (value && typeof value === "object") {
      targets.push(...Object.values(value).filter((target) => typeof target === "string"));
    }
  }
  return [...new Set(targets)];
}

export function verifyUiPackage(packageRoot, packFiles) {
  const manifestPath = resolve(packageRoot, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const required = exportTargets(manifest.exports).map((target) => target.replace(/^\.\//, ""));
  const missingBuildOutput = required.filter(
    (target) => target.startsWith("dist/") && !existsSync(resolve(packageRoot, target)),
  );
  if (missingBuildOutput.length > 0) {
    throw new Error(
      `UI publish artifact is missing built export output: ${missingBuildOutput.join(", ")}; run \`bun run --cwd packages/ui build\` and retry the release`,
    );
  }

  const packed = new Set(packFiles.map((file) => file.replace(/^\.\//, "")));
  const missingPackedExports = required.filter((target) => !packed.has(target));
  if (missingPackedExports.length > 0) {
    throw new Error(
      `UI publish tarball would omit declared exports: ${missingPackedExports.join(", ")}; correct the package files declaration and retry the release`,
    );
  }

  return required.map((target) => relative(packageRoot, resolve(packageRoot, target)));
}
