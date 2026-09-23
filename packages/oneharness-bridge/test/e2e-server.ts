import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { startWebServer } from "../src/server.ts";
import { e2eProject, e2eWebPort } from "./e2e-configuration.ts";
import { e2eHistoryDir, e2eProviderBin, seedE2eHistory } from "./e2e-history.ts";

const repository = resolve(import.meta.dir, "../../..");
const webAccessToken = z
  .string()
  .min(32)
  .max(256)
  .parse(process.env.ONEHARNESS_UI_TEST_WEB_ACCESS_TOKEN);
const cliOverride = process.env.ONEHARNESS_UI_TEST_CLI_BIN;
if (
  cliOverride !== undefined &&
  (cliOverride.length === 0 ||
    cliOverride.length > 4096 ||
    !isAbsolute(cliOverride) ||
    !existsSync(cliOverride))
) {
  throw new Error("ONEHARNESS_UI_TEST_CLI_BIN must be an existing absolute executable path");
}
const visualProject = "/tmp/oneharness-ui-visual-project";
const visualMode =
  z.enum(["true"]).optional().parse(process.env.ONEHARNESS_UI_TEST_VISUAL) === "true";
const provider = visualMode
  ? resolve(repository, "packages/oneharness-bridge/test/fixtures/visual-provider.sh")
  : e2eProviderBin;

if (cliOverride) process.env.ONEHARNESS_BIN = cliOverride;
delete process.env.ONEHARNESS_HISTORY_LABELS;
await seedE2eHistory({
  cwd: visualMode ? visualProject : e2eProject,
  provider,
  ...(visualMode ? { settleMs: 1_100 } : {}),
});

process.env.ONEHARNESS_UI_HISTORY_DIR = e2eHistoryDir;
process.env.ONEHARNESS_UI_PROVIDER_BIN = provider;
process.env.ONEHARNESS_UI_PROVIDER_HARNESS = "claude-code";
process.env.MOCK_EXIT = "0";
process.env.MOCK_STDERR = "";
process.env.MOCK_STDOUT =
  '{"result":"Continued from the exact desktop session","session_id":"e2e-native-continued"}';
await startWebServer({
  accessToken: webAccessToken,
  port: e2eWebPort,
  staticDirectory: resolve(repository, "apps/conversation-ui/out"),
});
