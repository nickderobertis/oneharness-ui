import { z } from "zod";

export const e2eProject = "/tmp/oneharness-ui-e2e-project";
export const e2eWebPort = z.coerce
  .number()
  .int()
  .min(1_024)
  .max(65_535)
  .parse(process.env.ONEHARNESS_UI_TEST_WEB_PORT ?? 3_000);
export const e2eWebOrigin = `http://127.0.0.1:${e2eWebPort}`;
