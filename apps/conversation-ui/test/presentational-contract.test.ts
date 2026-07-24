import { describe, expect, test } from "bun:test";
import {
  conversationLabelMaxLength,
  conversationLabelsMaxCount,
  conversationLabelsSchema,
} from "@oneharness-ui/ipc-contract";
import { conversationLabelLimits } from "@/features/conversations";

describe("presentational contract drift gates", () => {
  test("keeps label editor limits aligned with the validated bridge contract", () => {
    expect(conversationLabelLimits).toEqual({
      maxCount: conversationLabelsMaxCount,
      maxLength: conversationLabelMaxLength,
    });
    expect(
      conversationLabelsSchema.safeParse(
        Array.from({ length: conversationLabelLimits.maxCount }, (_, index) =>
          String(index).padEnd(conversationLabelLimits.maxLength, "x"),
        ),
      ).success,
    ).toBe(true);
  });
});
