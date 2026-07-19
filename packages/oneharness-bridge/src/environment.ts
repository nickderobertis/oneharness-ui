import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";

const optionalPath = z.string().trim().min(1).max(4096).optional();
const optionalAuthorization = z.string().min(32).max(256).optional();

const environmentSchema = z.object({
  ONEHARNESS_BIN: optionalPath,
  ONEHARNESS_UI_HISTORY_DIR: optionalPath,
  ONEHARNESS_UI_HTTP_TOKEN: optionalAuthorization,
  ONEHARNESS_UI_PROVIDER_BIN: optionalPath,
  ONEHARNESS_UI_PROVIDER_HARNESS: z.string().trim().min(1).max(100).optional(),
  HOME: optionalPath,
  XDG_STATE_HOME: optionalPath,
});

function validatedFile(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    accessSync(path, constants.R_OK | constants.X_OK);
    return realpathSync(path);
  } catch {
    throw new Error(`${label} must be an existing executable file, not a symlink`);
  }
}

function validatedDirectory(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("not a directory");
    accessSync(path, constants.R_OK | constants.W_OK);
    return realpathSync(path);
  } catch {
    throw new Error(`${label} must be an existing writable directory, not a symlink`);
  }
}

export type BridgeEnvironment = {
  executable?: string;
  historyDir?: string;
  httpAuthorization?: string;
  labelDir?: string;
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
  for (const candidate of candidates) {
    if (candidate === process.execPath) continue;
    try {
      return validatedFile(candidate, "bundled oneharness executable");
    } catch {
      // A development bridge commonly has no adjacent bundled CLI.
    }
  }
  return undefined;
}

export function readEnvironment(
  input: Readonly<Record<string, string | undefined>> = process.env,
): BridgeEnvironment {
  const parsed = environmentSchema.parse(input);
  const executable = parsed.ONEHARNESS_BIN
    ? validatedFile(parsed.ONEHARNESS_BIN, "ONEHARNESS_BIN")
    : bundledExecutable();
  const historyDir = parsed.ONEHARNESS_UI_HISTORY_DIR
    ? validatedDirectory(parsed.ONEHARNESS_UI_HISTORY_DIR, "ONEHARNESS_UI_HISTORY_DIR")
    : undefined;
  const stateRoot =
    parsed.XDG_STATE_HOME ?? (parsed.HOME ? join(parsed.HOME, ".local", "state") : undefined);
  if (!historyDir && stateRoot && !isAbsolute(stateRoot)) {
    throw new Error("label storage root must be an absolute path");
  }
  const providerBin = parsed.ONEHARNESS_UI_PROVIDER_BIN
    ? validatedFile(parsed.ONEHARNESS_UI_PROVIDER_BIN, "ONEHARNESS_UI_PROVIDER_BIN")
    : undefined;
  return {
    ...(executable ? { executable } : {}),
    ...(historyDir ? { historyDir } : {}),
    ...(!historyDir && stateRoot ? { labelDir: join(stateRoot, "oneharness-ui") } : {}),
    ...(parsed.ONEHARNESS_UI_HTTP_TOKEN
      ? { httpAuthorization: parsed.ONEHARNESS_UI_HTTP_TOKEN }
      : {}),
    ...(providerBin ? { providerBin } : {}),
    ...(parsed.ONEHARNESS_UI_PROVIDER_HARNESS
      ? { providerHarness: parsed.ONEHARNESS_UI_PROVIDER_HARNESS }
      : {}),
  };
}
