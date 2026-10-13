import { describe, expect, test } from "bun:test";
import { launcher } from "@oneharness-ui/desktop-driver";
import * as service from "./tauri-launcher-service.ts";

describe("native desktop WebDriver service", () => {
  test("uses the isolated driver launcher without plugin-dependent worker hooks", () => {
    expect(service.launcher).toBe(launcher);
    expect(Object.hasOwn(service, "default")).toBe(false);
  });
});
