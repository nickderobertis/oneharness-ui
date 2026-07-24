import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ReplyForm, StatusBadge, TooltipProvider } from "@oneharness/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("@oneharness/ui public package", () => {
  test("renders and drives public components through the built package entry", async () => {
    const user = userEvent.setup();
    let submitted = "";
    render(
      <TooltipProvider>
        <StatusBadge state="running" />
        <ReplyForm
          error={null}
          onSubmit={async (message) => {
            submitted = message;
          }}
          pending={false}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Running")).toBeTruthy();
    await user.type(screen.getByLabelText("Continue this session"), "Continue from here");
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    expect(submitted).toBe("Continue from here");
  });

  test("ships the Tailwind theme and transcript content styles", async () => {
    const css = await readFile(resolve(import.meta.dir, "../dist/styles.css"), "utf8");
    expect(css).toContain("@theme inline");
    expect(css).toContain(".message-markdown");
    expect(css).toContain(".message-json");
    expect(css).toContain(".hljs-keyword");
  });
});
