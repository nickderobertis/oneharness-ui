import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  ConversationTimeline,
  ReplyForm,
  StatusBadge,
  Timeline,
  TooltipProvider,
  TurnCard,
} from "@oneharness/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { runPhase } from "./phase-runner.ts";

/** Per-phase bounds, so host load on one step cannot be reported as an opaque whole-test timeout. */
const PACK_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 120_000;
const VERIFY_TIMEOUT_MS = 60_000;
/** Outer backstop over every phase bound; a phase that overruns reports first, naming itself. */
const PACKAGE_TEST_TIMEOUT_MS = PACK_TIMEOUT_MS + INSTALL_TIMEOUT_MS + VERIFY_TIMEOUT_MS + 30_000;

describe("@oneharness/ui public package", () => {
  test("renders and drives public components through the built package entry", async () => {
    const user = userEvent.setup();
    let submitted = "";
    render(
      <TooltipProvider>
        <StatusBadge state="running" />
        <Timeline
          items={[
            {
              duration: 20,
              id: "public-span",
              kind: "work",
              label: "Public span",
              payload: {},
              start: 0,
            },
          ]}
        />
        <ConversationTimeline onSelectTurn={() => undefined} turns={[]} />
        <TurnCard
          author={{ avatar: "https://example.test/worker.png", label: "Worker" }}
          turn={{
            assistant: "Public answer",
            failureKind: null,
            harness: "codex",
            id: "public-turn",
            model: null,
            reasoning: null,
            status: "completed",
            timestamp: "2026-08-04T00:00:00Z",
            tools: [],
            unknown: {},
            usage: {},
            user: "Public question",
          }}
        />
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
    expect(screen.getByRole("button", { name: "Public span, span" })).toBeTruthy();
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

  test(
    "packs and resolves from a fresh external consumer",
    async () => {
      const temporaryRoot = await mkdtemp(resolve(tmpdir(), "oneharness-ui-consumer-"));
      try {
        const packageRoot = resolve(import.meta.dir, "..");
        const packed = await runPhase({
          command: ["bun", "pm", "pack", "--quiet", "--destination", temporaryRoot],
          cwd: packageRoot,
          name: "pack",
          timeoutMs: PACK_TIMEOUT_MS,
        });
        const tarballPath = packed.stdout.trim();
        if (
          !isAbsolute(tarballPath) ||
          dirname(tarballPath) !== temporaryRoot ||
          basename(tarballPath).length > 255 ||
          !basename(tarballPath).endsWith(".tgz")
        ) {
          throw new Error("bun pm pack returned an invalid package filename");
        }
        const tarball = tarballPath;
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
  ConversationTimeline,
  ConversationView,
  StatusBadge,
  Timeline,
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
  tools: [
    {
      durationMs: 1240,
      finishedAt: "2026-07-25T00:00:01Z",
      index: 0,
      input: { command: "pwd" },
      kind: "tool_call",
      name: "Bash",
      startedAt: "2026-07-25T00:00:00Z",
      status: "completed",
      timingSource: "provider_measured",
      toolCallId: "call-1",
    },
    { index: 1, kind: "tool_result", output: "/consumer", toolCallId: "call-1" },
  ],
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
      createElement(Timeline, {
        items: [{ duration: 20, id: "consumer-span", kind: "work", label: "Consumer span", payload: {}, start: 0 }],
      }),
      createElement(ConversationTimeline, {
        onSelectTurn: () => undefined,
        turns: [turn],
      }),
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
      createElement(TurnCard, {
        author: { avatar: "https://example.test/judge.png", label: "Judge" },
        turn,
      }),
    ),
  ),
);
for (const text of [
  "Running",
  "Consumer span",
  "Public session",
  "Transcript session",
  "Consumer question",
  "Bash tool details",
  "1.2 s",
  "completed",
  "Judge",
  "https://example.test/judge.png",
]) {
  if (!html.includes(text)) {
    console.error(\`the consumer markup is missing \${text}\`);
    process.exit(1);
  }
}
`,
        );
        await runPhase({
          command: ["bun", "install", "--offline"],
          cwd: consumerRoot,
          name: "offline install",
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
        const installedManifest = parseInstalledManifest(
          await readFile(resolve(consumerRoot, "node_modules/@oneharness/ui/package.json"), "utf8"),
        );
        expect(installedManifest.name).toBe("@oneharness/ui");
        expect(installedManifest.version).toMatch(/^\d+\.\d+\.\d+/);
        for (const [dependency, range] of installedManifest.dependencyRanges) {
          expect(`${dependency} is pinned to ${range}`).not.toContain("workspace:");
        }
        await runPhase({
          command: ["bun", "run", "verify"],
          cwd: consumerRoot,
          name: "consumer verification",
          timeoutMs: VERIFY_TIMEOUT_MS,
        });
      } finally {
        await rm(temporaryRoot, { force: true, recursive: true });
      }
    },
    PACKAGE_TEST_TIMEOUT_MS,
  );
});

/** Dependency maps a published manifest may pin a range in. */
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

type InstalledManifest = {
  /** Every `<name, range>` pair the manifest pins, across {@link DEPENDENCY_FIELDS}. */
  readonly dependencyRanges: readonly (readonly [string, string])[];
  readonly name: string;
  readonly version: string;
};

/**
 * Validates the manifest the install wrote into the consumer before the test
 * reads anything out of it. It is a file produced by a subprocess, so its shape
 * is asserted here rather than assumed by the reader.
 */
function parseInstalledManifest(source: string): InstalledManifest {
  const manifest: unknown = JSON.parse(source);
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error("the installed manifest is not a JSON object");
  }
  const fields: Record<string, unknown> = manifest;
  if (typeof fields.name !== "string" || typeof fields.version !== "string") {
    throw new Error("the installed manifest has no string name and version");
  }
  const dependencyRanges: [string, string][] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const pinned: unknown = fields[field];
    if (pinned === undefined) continue;
    if (typeof pinned !== "object" || pinned === null || Array.isArray(pinned)) {
      throw new Error(`the installed manifest's ${field} is not a JSON object`);
    }
    for (const [dependency, range] of Object.entries(pinned)) {
      if (typeof range !== "string") {
        throw new Error(`the installed manifest pins ${dependency} to a non-string range`);
      }
      dependencyRanges.push([dependency, range]);
    }
  }
  return { dependencyRanges, name: fields.name, version: fields.version };
}
