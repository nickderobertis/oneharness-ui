import { describe, expect, test } from "bun:test";
import { readEnvironment } from "../src/environment.ts";

describe("readEnvironment", () => {
  test("accepts explicit local paths and ignores unrelated variables", () => {
    expect(
      readEnvironment({
        ONEHARNESS_BIN: "/opt/oneharness",
        ONEHARNESS_UI_HISTORY_DIR: "/tmp/history",
        UNRELATED: "secret",
      }),
    ).toEqual({ executable: "/opt/oneharness", historyDir: "/tmp/history" });
  });

  test("rejects empty configured paths", () => {
    expect(() => readEnvironment({ ONEHARNESS_BIN: "" })).toThrow();
  });

  test("falls through cleanly when no bundled executable is adjacent", () => {
    expect(readEnvironment({})).toEqual({});
  });
});
