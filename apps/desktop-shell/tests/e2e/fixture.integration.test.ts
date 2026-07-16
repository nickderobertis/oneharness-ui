import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDesktopFixture } from "./fixture.ts";

const repository = resolve(import.meta.dir, "../../../..");
const cli = resolve(
  repository,
  `.cache/upstream-target/debug/oneharness${process.platform === "win32" ? ".exe" : ""}`,
);

async function invoke(args: string[]): Promise<unknown> {
  const child = Bun.spawn([cli, ...args], {
    cwd: repository,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) throw new Error(`fixture inspection exited ${exitCode}: ${stderr.trim()}`);
  return JSON.parse(stdout) as unknown;
}

describe("native desktop fixture", () => {
  test("creates SDK-valid stopped, optional-thinking, and recoverable records", async () => {
    const fixture = await createDesktopFixture();
    try {
      expect(Object.hasOwn(fixture.environment, "ONEHARNESS_BIN")).toBe(false);
      const historyDir = fixture.environment.ONEHARNESS_UI_HISTORY_DIR;
      const listed = (await invoke([
        "history",
        "list",
        "--compact",
        "--all-projects",
        "--history-dir",
        historyDir,
      ])) as Array<{ id: string; name: string }>;
      expect(listed.map(({ name }) => name).sort()).toEqual([
        "plain-session",
        "recoverable-failure",
        "stopped-tool-session",
      ]);

      const stoppedId = listed.find(({ name }) => name === "stopped-tool-session")?.id;
      if (!stoppedId) throw new Error("stopped fixture was not listed");
      const stopped = (await invoke([
        "history",
        "show",
        stoppedId,
        "--compact",
        "--all-projects",
        "--history-dir",
        historyDir,
      ])) as Array<Record<string, unknown>>;
      expect(stopped).toHaveLength(1);
      expect(stopped[0]).toMatchObject({
        session_id: "native-stopped-session",
        status: "timeout",
        thinking: "I checked the native command boundary before answering.",
      });

      const failedId = listed.find(({ name }) => name === "recoverable-failure")?.id;
      if (!failedId) throw new Error("recoverable fixture was not listed");
      const failed = (await invoke([
        "history",
        "show",
        failedId,
        "--compact",
        "--all-projects",
        "--history-dir",
        historyDir,
      ])) as Array<Record<string, unknown>>;
      expect(failed[0]).toMatchObject({
        failure_kind: "rate_limit",
        session_id: "native-failed-session",
        status: "nonzero",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  test("removes temporary history when the real provider process cannot run", async () => {
    const prefix = "oneharness-ui-desktop-e2e-";
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix)).sort();
    await expect(createDesktopFixture(cli)).rejects.toThrow("fixture CLI exited");
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix)).sort();
    expect(after).toEqual(before);
  });
});
