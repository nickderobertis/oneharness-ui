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

The static webview has no filesystem or shell capability. It can call one fixed
Tauri command, which size-limits opaque JSON and launches the bundled
`oneharness-ui-bridge`; Rust owns no oneharness contract. The bridge validates
one newline-delimited request, then invokes processes with argv arrays and
`shell: false`. It returns normalized, sanitized errors and does not log
prompts, answers, reasoning, or environment values.

Desktop production uses that process-local, scoped sidecar transport. Browser
development and web mode use HTTP adapters backed by the same `BridgeService`.
Web mode serves the static export and bridge routes from one origin, binds only
to loopback unless the operator explicitly selects a private LAN address or
wildcard binding, and rejects non-private or cross-origin browser requests. The
adapters establish a server-held capability in a short-lived
`HttpOnly`/`SameSite=Strict` cookie, check that capability again at the service
layer, and bound the bytes read from the request stream. No bridge secret is
present in browser JavaScript.

The bridge first uses an explicit `ONEHARNESS_BIN`, then the SDK's packaged CLI
binary bundled beside it, then the SDK's package-resolved CLI. Config/history
resolution is otherwise delegated to oneharness. Continuation forces parallel run mode
because a native resume ID belongs to one harness and cannot use a fallback
selection; every other discovered setting remains available.

## Monorepo direction

- `packages/ipc-contract`: shared application protocol, no product imports.
- `packages/oneharness-bridge`: local privilege/SDK boundary.
- `apps/conversation-ui`: static UI, imports feature public surfaces only.
- `apps/desktop-shell`: Tauri capability and packaging, no contracts.

Nx owns the project graph and delegates targets to Bun, Biome, Next, and Cargo.
A deterministic boundary checker prevents feature/package dependency reversal.
