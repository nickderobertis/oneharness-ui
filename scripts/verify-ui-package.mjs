import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function exportTargets(exports_) {
  if (
    !exports_ ||
    typeof exports_ !== "object" ||
    Array.isArray(exports_) ||
    Object.getPrototypeOf(exports_) !== Object.prototype
  ) {
    throw new Error("UI package manifest must declare an exports object");
  }
  const targets = [];
  for (const value of Object.values(exports_)) {
    if (typeof value === "string") {
      targets.push(value);
      continue;
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      throw new Error("UI package exports must resolve to strings or condition objects");
    }
    for (const target of Object.values(value)) {
      if (typeof target !== "string") {
        throw new Error("UI package export conditions must resolve to strings");
      }
      targets.push(target);
    }
  }
  if (
    targets.length === 0 ||
    targets.some(
      (target) =>
        !target.startsWith("./") ||
        target.includes("\\") ||
        target.split("/").some((segment) => segment === ".."),
    )
  ) {
    throw new Error("UI package exports must be non-empty package-relative paths");
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

  return required;
}
