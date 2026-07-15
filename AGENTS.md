# oneharness-ui agent guide

## What this repo is

oneharness-ui is a local Tauri v2 desktop reader and continuation client for
oneharness sessions. Its statically exported Next.js UI reaches the installed
`@oneharness/sdk` only through a narrow local sidecar; the SDK remains the sole
owner of oneharness contracts and runtime validation.

## Standing goals

- Make user-visible behavior observable through realistic tests at the real
  UI → Tauri → sidecar → SDK → CLI/session boundary.
- Keep a clean-clone `just bootstrap` and the strict local/CI gate repeatable.

## Stack and composition

- **Product shape:** nextjs desktop application (Tauri v2 static webview).
- **Language(s):** rust, typescript.
- **References composed:** base.md, shapes/web-app.md, shapes/react.md,
  shapes/nextjs.md, languages/rust.md, languages/typescript.md, ci.md,
  llmlint.md, releasing.md, monorepo.md.
- **Excluded, and why:** asdf and direnv add redundant environment layers over
  pinned Bun/Rust files and the bootstrap script; a network server layout does
  not fit a local-only desktop app.

## Workflow

Use the `just` surface; do not hand-roll equivalent routines. `just check` is
the complete pre-push gate and must pass before commits. Keep llmlint separate:
`just lint-llm`, `just lint-llm-diff`, and `just lint-llm-validate`; install it
with `just setup-llmlint`.

## Architecture and security

- Dependency direction is shared → features → app; features do not import one
  another. Nx project tags and the TypeScript linter enforce the graph.
- Never copy, generate, or maintain oneharness contract types here. Import SDK
  types and validators from the reproducibly pinned `@oneharness/sdk` source.
- Treat URL state, IPC, sidecar IO, executable/config discovery, CLI output,
  and persisted history as hostile. Validate at each boundary and preserve
  unknown upstream values without rendering HTML.
- Pass subprocess arguments as arrays without a shell. Never log prompts,
  reasoning, environment secrets, or raw session payloads.
- Add user-driven tests for every behavior and failure/recovery path. The only
  permitted replacement is paid model execution through oneharness's real
  deterministic provider seam; do not mock the layer under test.
- Keep the command allowlist current and least-privilege. Store release and
  harness credentials only in GitHub secrets.

## Commits, releases, and merging

- Commit logical green changes with Conventional Commits. The pre-1.0 policy is
  `feat`/breaking → minor; `fix`/`perf`/`refactor`/`build` → patch; other types
  do not release.
- Squash-only PRs land on protected `main`; auto-merge, conversation resolution,
  linear history, and every `check`, `supply-chain`, `commitlint`, and `llmlint`
  context are required. Admin bypass is break-glass; merged heads auto-delete.
- release-please opens the release PR. Merging it alone updates manifests and
  changelog and creates `vX.Y.Z`; the tag independently builds signed/checksummed
  Tauri artifacts. The release token is a PAT/App secret so tag workflows fire.

## Output and handoff

Scripts stay quiet on success and identify the failed operation plus a concrete
remedy on failure. Keep subtree-specific rules in nested `AGENTS.md`, durable
explanations under `docs/`, and leave no generated or temporary files behind.
