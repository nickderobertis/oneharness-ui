import { describe, expect, test } from "bun:test";
import { parseSessionSelector, serializeSessionSelector } from "./use-session-url";

describe("session URL state", () => {
  test("uses a valid deep-link selector", () => {
    expect(parseSessionSelector("?session=fix-login-20260715T100000Z-4")).toBe(
      "fix-login-20260715T100000Z-4",
    );
  });

  test("falls back safely for absent or invalid selectors", () => {
    expect(parseSessionSelector("")).toBeNull();
    expect(parseSessionSelector("?session=../private")).toBeNull();
  });

  test("round-trips a selector without preserving unrelated state", () => {
    const value = "session_1.2";
    expect(parseSessionSelector(serializeSessionSelector(value))).toBe(value);
    expect(serializeSessionSelector(null)).toBe("");
  });
});
