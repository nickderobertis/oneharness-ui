import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { report } from "@onebudgetspec/sdk";
import { z } from "zod";
import { contrastSourceDigest, contrastTelemetrySchema } from "./contrast-telemetry.ts";

/** Each metric's readings, and the configurations a complete run records one reading for. */
const metrics = {
  "crosshair-line": { kinds: [undefined], part: "crosshair-line" },
  "crosshair-readout": { kinds: [undefined], part: "crosshair-readout" },
  "focus-highlight": { kinds: ["message", "reasoning", "tool"], part: "focus-highlight" },
};
const themes = ["light", "dark"];

try {
  const { values } = parseArgs({
    options: { metric: { type: "string" }, telemetry: { type: "string" } },
    strict: true,
  });
  const option = z
    .object({ metric: z.enum(Object.keys(metrics)), telemetry: z.string().min(1) })
    .parse(values);
  const metric = metrics[option.metric];
  let text;
  try {
    text = readFileSync(resolve(option.telemetry), "utf8");
  } catch {
    throw new Error(
      `no telemetry at ${option.telemetry}; run 'bunx nx run conversation-ui-e2e:test'`,
    );
  }
  const telemetry = contrastTelemetrySchema.parse(JSON.parse(text));
  if (telemetry.sourceDigest !== contrastSourceDigest())
    throw new Error(
      "the contrast telemetry was recorded from an older tree; rerun 'bunx nx run conversation-ui-e2e:test'",
    );
  const readings = telemetry.readings.filter((reading) => reading.part === metric.part);
  const missing = telemetry.browsers.flatMap((browser) =>
    themes.flatMap((theme) =>
      metric.kinds
        .filter(
          (kind) =>
            !readings.some(
              (reading) =>
                reading.browser === browser && reading.theme === theme && reading.kind === kind,
            ),
        )
        .map((kind) => [browser, theme, kind].filter(Boolean).join("/")),
    ),
  );
  if (missing.length > 0)
    throw new Error(
      `the telemetry has no ${metric.part} reading for ${missing.join(", ")}; rerun the whole 'bunx nx run conversation-ui-e2e:test'`,
    );
  const lowest = Math.min(...readings.map((reading) => reading.ratio));
  report(lowest, JSON.stringify(readings));
} catch (error) {
  const message =
    error instanceof z.ZodError
      ? z.prettifyError(error)
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`contrast budget: ${message}`);
  process.exitCode = 1;
}
