import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

const optionalPath = z.string().trim().min(1).max(4096).optional();

const environmentSchema = z.object({
  ONEHARNESS_BIN: optionalPath,
  ONEHARNESS_UI_HISTORY_DIR: optionalPath,
  ONEHARNESS_UI_PROVIDER_BIN: optionalPath,
  ONEHARNESS_UI_PROVIDER_HARNESS: z.string().trim().min(1).max(100).optional(),
});

export type BridgeEnvironment = {
  executable?: string;
  historyDir?: string;
  providerBin?: string;
  providerHarness?: string;
};

function bundledExecutable(): string | undefined {
  const directory = dirname(process.execPath);
  const ownName = basename(process.execPath);
  const extension = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    join(directory, `oneharness${extension}`),
    join(directory, ownName.replace("oneharness-ui-bridge", "oneharness")),
  ];
  return candidates.find((candidate) => candidate !== process.execPath && existsSync(candidate));
}

export function readEnvironment(
  input: Readonly<Record<string, string | undefined>> = process.env,
): BridgeEnvironment {
  const parsed = environmentSchema.parse(input);
  const executable = parsed.ONEHARNESS_BIN ?? bundledExecutable();
  return {
    ...(executable ? { executable } : {}),
    ...(parsed.ONEHARNESS_UI_HISTORY_DIR ? { historyDir: parsed.ONEHARNESS_UI_HISTORY_DIR } : {}),
    ...(parsed.ONEHARNESS_UI_PROVIDER_BIN
      ? { providerBin: parsed.ONEHARNESS_UI_PROVIDER_BIN }
      : {}),
    ...(parsed.ONEHARNESS_UI_PROVIDER_HARNESS
      ? { providerHarness: parsed.ONEHARNESS_UI_PROVIDER_HARNESS }
      : {}),
  };
}
