import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { labelStoreSchema, labelsFor, setLabels } from "../src/label-store.ts";

describe("conversation label storage", () => {
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
