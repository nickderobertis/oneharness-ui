import { z } from "zod";

/** The loopback port the component harness serves on, beside the bridge's e2e server. */
export const harnessPort = z.coerce
  .number()
  .int()
  .min(1_024)
  .max(65_535)
  .parse(process.env.ONEHARNESS_UI_TEST_HARNESS_PORT ?? 3_001);
export const harnessOrigin = `http://127.0.0.1:${harnessPort}`;
