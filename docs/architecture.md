# Architecture decisions

## Contract ownership

oneharness owns its run and history contracts. The local bridge imports
`HistoryRecord`, `RunOptions`, and runtime validation through
`@oneharness/sdk`; this repository does not generate or hand-maintain those
types. A small Zod protocol represents only UI needs and is independently
validated at HTTP/Tauri IPC ingress and egress.

SDK validation intentionally happens after the real CLI reads JSONL. Unknown
properties allowed by the upstream schema are retained as structured data;
known optional reasoning/thinking is shown only when present. Status strings
have a forward-compatible default, structured detail is serialized as text,
and usage properties preserve three distinct states: absent, `null`
(unreported), and measured zero.

## Privilege boundary

The static webview has no filesystem or arbitrary shell capability. Tauri's
capability grants one operation: spawn `binaries/oneharness-ui-bridge`. The
bridge size-limits and validates one newline-delimited request, then invokes
processes with argv arrays and `shell: false`. It returns normalized, sanitized
errors and does not log prompts, answers, reasoning, or environment values.

Production uses that process-local, scoped sidecar transport. The loopback HTTP
adapter exists only for browser development and end-to-end testing: it accepts
only an explicit loopback UI origin, establishes its server-held capability in
a short-lived `HttpOnly`/`SameSite=Strict` cookie, checks that capability again
at the service layer, and bounds the bytes read from the request stream. No
bridge secret is present in browser JavaScript. Release builds do not configure
this adapter.

The bridge first uses an explicit `ONEHARNESS_BIN`, then a compatible CLI
bundled beside it, then the SDK's packaged CLI. Config/history resolution is
otherwise delegated to oneharness. Continuation forces parallel run mode
because a native resume ID belongs to one harness and cannot use a fallback
selection; every other discovered setting remains available.

## Monorepo direction

- `packages/ipc-contract`: shared application protocol, no product imports.
- `packages/oneharness-bridge`: local privilege/SDK boundary.
- `apps/conversation-ui`: static UI, imports feature public surfaces only.
- `apps/desktop-shell`: Tauri capability and packaging, no contracts.

Nx owns the project graph and delegates targets to Bun, Biome, Next, and Cargo.
A deterministic boundary checker prevents feature/package dependency reversal.
