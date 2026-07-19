import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readEnvironment } from "../src/environment.ts";
import { labelStoreSchema, labelsFor, setLabels } from "../src/label-store.ts";

describe("conversation label storage", () => {
  test("uses only validated fallback state directories", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "oneharness-label-state-"));
    try {
      const environment = readEnvironment({ XDG_STATE_HOME: root });
      await setLabels(environment, "session-1", ["local"]);
      expect(await labelsFor(environment)).toEqual({ "session-1": ["local"] });
      expect(() => readEnvironment({ XDG_STATE_HOME: "relative/state" })).toThrow(
        "must be an absolute path",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("recovers after the storage target stops being a directory", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "oneharness-label-recovery-"));
    const path = resolve(root, ".oneharness-ui-labels.json");
    try {
      await mkdir(path);
      await expect(setLabels({ historyDir: root }, "session-1", ["urgent"])).rejects.toThrow();
      await rm(path, { recursive: true });
      await setLabels({ historyDir: root }, "session-1", ["urgent"]);
      expect(await labelsFor({ historyDir: root })).toEqual({ "session-1": ["urgent"] });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("round-trips the versioned golden and rejects hostile persisted data", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "oneharness-labels-"));
    const path = resolve(root, ".oneharness-ui-labels.json");
    try {
      const golden = await readFile(resolve(import.meta.dir, "fixtures/labels-v1.json"), "utf8");
      expect(labelStoreSchema.parse(JSON.parse(golden))).toEqual({
        labels: { "session-1": ["frontend", "urgent"] },
        schemaVersion: 1,
      });
      await setLabels({ historyDir: root }, "session-1", [" urgent ", "frontend", "urgent"]);
      expect(await labelsFor({ historyDir: root })).toEqual({
        "session-1": ["frontend", "urgent"],
      });
      await writeFile(
        path,
        JSON.stringify({ labels: { "../escape": ["<b>bad</b>"] }, schemaVersion: 2 }),
      );
      await expect(labelsFor({ historyDir: root })).rejects.toThrow("label storage is malformed");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
