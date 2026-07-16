import { describe, expect, test } from "bun:test";
import * as service from "./tauri-launcher-service.ts";

describe("native desktop WebDriver service", () => {
  test("exposes the external driver launcher without plugin-dependent worker hooks", () => {
    expect(service.launcher).toBeFunction();
    expect(Object.hasOwn(service, "default")).toBe(false);
  });
});
