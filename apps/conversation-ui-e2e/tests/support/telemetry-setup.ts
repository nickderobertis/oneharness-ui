import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FullConfig } from "@playwright/test";
import {
  type ContrastTelemetry,
  contrastSourceDigest,
  contrastTelemetryPath,
} from "../../contrast-telemetry.ts";

/**
 * Starts each run's contrast telemetry empty, naming the browsers it must cover, so readings a
 * previous or partial run left behind are never reported as this tree's.
 */
export default async function resetContrastTelemetry(config: FullConfig): Promise<void> {
  const telemetry: ContrastTelemetry = {
    browsers: config.projects.map((project) => project.name),
    readings: [],
    schemaVersion: 1,
    sourceDigest: contrastSourceDigest(),
  };
  await mkdir(dirname(contrastTelemetryPath), { recursive: true });
  await writeFile(contrastTelemetryPath, `${JSON.stringify(telemetry, null, 2)}\n`);
}
