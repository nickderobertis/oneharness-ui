import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const repository = resolve(projectRoot, "../..");
export const contrastTelemetryPath = resolve(projectRoot, "telemetry/contrast.json");

/** What the readings depend on: the package's components and styles, and the journeys. */
const sourceRoots = [
  "apps/conversation-ui/src",
  "packages/ui/src",
  "apps/conversation-ui-e2e/harness",
  "apps/conversation-ui-e2e/tests",
  "apps/conversation-ui-e2e/playwright.config.ts",
];

function files(path: string): string[] {
  const entries = readdirSync(path, { withFileTypes: true }).filter(
    (entry) => entry.name !== "node_modules",
  );
  return entries.flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? files(child) : [child];
  });
}

/** A digest of every reading's source, so a budget refuses telemetry an older tree recorded. */
export function contrastSourceDigest(): string {
  const hash = createHash("sha256");
  const paths = sourceRoots.flatMap((root) => {
    const path = resolve(repository, root);
    return root.endsWith(".ts") ? [path] : files(path);
  });
  for (const path of paths.sort()) {
    hash.update(relative(repository, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const rgba = z.object({
  alpha: z.number().min(0).max(1),
  blue: z.number().min(0).max(255),
  green: z.number().min(0).max(255),
  red: z.number().min(0).max(255),
});
export const contrastReadingSchema = z.object({
  background: rgba,
  browser: z.string().min(1),
  foreground: rgba,
  kind: z.enum(["message", "reasoning", "tool"]).optional(),
  part: z.enum(["crosshair-line", "crosshair-readout", "focus-highlight"]),
  ratio: z.number().min(1).max(21),
  theme: z.enum(["dark", "light"]),
});
export type ContrastReading = z.infer<typeof contrastReadingSchema>;
export const contrastTelemetrySchema = z.object({
  browsers: z.array(z.string().min(1)).min(1),
  readings: z.array(contrastReadingSchema),
  schemaVersion: z.literal(1),
  sourceDigest: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ContrastTelemetry = z.infer<typeof contrastTelemetrySchema>;
