import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
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

  test("packs and resolves from a fresh external consumer", async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "oneharness-ui-consumer-"));
    try {
      const packageRoot = resolve(import.meta.dir, "..");
      const packed = Bun.spawnSync(
        ["bun", "pm", "pack", "--quiet", "--destination", temporaryRoot],
        {
          cwd: packageRoot,
        },
      );
      expect(packed.exitCode).toBe(0);
      const filename = packed.stdout.toString().trim();
      if (
        !isAbsolute(filename) ||
        dirname(filename) !== temporaryRoot ||
        basename(filename).length > 255 ||
        !basename(filename).endsWith(".tgz")
      ) {
        throw new Error("bun pm pack returned an invalid package filename");
      }
      const tarball = filename;
      const manifestResult = Bun.spawnSync(["tar", "-xOf", tarball, "package/package.json"]);
      expect(manifestResult.exitCode).toBe(0);
      const manifest: unknown = JSON.parse(manifestResult.stdout.toString());
      expect(JSON.stringify(manifest)).not.toContain("workspace:");
      const consumerRoot = resolve(temporaryRoot, "consumer");
      await mkdir(consumerRoot);
      await writeFile(
        resolve(consumerRoot, "package.json"),
        `${JSON.stringify({
          dependencies: {
            "@oneharness/ui": `file:${tarball}`,
          },
          private: true,
          scripts: {
            verify: "bun verify.ts",
          },
        })}\n`,
      );
      await writeFile(
        resolve(consumerRoot, "verify.ts"),
        `import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ConversationList,
  ConversationView,
  StatusBadge,
  TooltipProvider,
  TurnCard,
} from "@oneharness/ui";

const turn = {
  assistant: "Consumer answer",
  failureKind: null,
  harness: "codex",
  id: "turn-1",
  model: "model",
  reasoning: null,
  status: "completed",
  timestamp: "2026-07-25T00:00:00Z",
  tools: [],
  unknown: {},
  usage: {},
  user: "Consumer question",
};
const summary = {
  harnesses: ["codex"],
  id: "session-1",
  name: "Public session",
  project: "/consumer",
  startedAt: "2026-07-25T00:00:00Z",
  turnCount: 1,
};
const conversation = {
  ...summary,
  canContinue: false,
  name: "Transcript session",
  state: "completed",
  turns: [turn],
};
const html = renderToStaticMarkup(
  createElement(
    TooltipProvider,
    null,
    createElement(
      "div",
      null,
      createElement(StatusBadge, { state: "running" }),
      createElement(ConversationList, {
        conversations: [summary],
        hasMore: false,
        labelError: null,
        labeling: false,
        loadMoreError: null,
        loadingMore: false,
        onLoadMore: async () => undefined,
        onRefresh: () => undefined,
        onSelect: () => undefined,
        onSetLabels: async () => undefined,
        refreshing: false,
        selectedId: null,
        totalCount: 1,
      }),
      createElement(ConversationView, {
        conversation,
        continueError: null,
        hasMoreTurns: false,
        loadMoreTurnsError: null,
        loadingMoreTurns: false,
        onBack: () => undefined,
        onContinue: async () => undefined,
        onLoadMoreTurns: async () => undefined,
        pending: false,
        totalTurnCount: 1,
      }),
      createElement(TurnCard, { turn }),
    ),
  ),
);
for (const text of ["Running", "Public session", "Transcript session", "Consumer question"]) {
  if (!html.includes(text)) process.exit(1);
}
`,
      );
      const install = Bun.spawnSync(["bun", "install", "--offline"], { cwd: consumerRoot });
      expect(install.exitCode).toBe(0);
      const verify = Bun.spawnSync(["bun", "run", "verify"], { cwd: consumerRoot });
      expect(verify.exitCode).toBe(0);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }, 90_000);
});
