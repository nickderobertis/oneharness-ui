import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const desktopE2eArtifacts = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../test-results/desktop-e2e",
);
export const desktopE2eStageLog = resolve(desktopE2eArtifacts, "stages.log");

type StageStatus = "fail" | "pass" | "start";

const STAGE_NAME = /^[a-z][a-z0-9 .:-]{0,119}$/;
const STATUS_LABEL: Readonly<Record<StageStatus, string>> = {
  fail: "FAIL",
  pass: "PASS",
  start: "START",
};

export async function recordDesktopStage(
  logPath: string,
  stage: string,
  status: StageStatus,
): Promise<void> {
  if (!isAbsolute(logPath)) {
    throw new Error("native desktop E2E stage log path must be absolute");
  }
  if (!STAGE_NAME.test(stage)) {
    throw new Error("native desktop E2E stage name is invalid");
  }
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${STATUS_LABEL[status]}\t${stage}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function runDesktopStage<T>(
  logPath: string,
  stage: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  await recordDesktopStage(logPath, stage, "start");
  try {
    const result = await operation();
    await recordDesktopStage(logPath, stage, "pass");
    return result;
  } catch (error) {
    await recordDesktopStage(logPath, stage, "fail");
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`native desktop E2E failed at stage "${stage}": ${detail}`, {
      cause: error,
    });
  }
}
