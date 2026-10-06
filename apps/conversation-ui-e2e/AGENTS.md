# conversation-ui-e2e

Browser journeys that prove the exported conversation UI works for a user end to
end: Playwright drives the built static export served by the bridge's real e2e web
server, which reads history through the pinned SDK and CLI with the deterministic
provider fixture. Every journey runs in Chromium and WebKit (Chromium alone on
Windows).

- **Depends on:** `conversation-ui` (its `build` runs first), `oneharness-bridge`
  (the e2e server and history fixtures under its `test/`), and `ipc-contract`.
  Host prerequisite: the Playwright browsers `just bootstrap` installs; on Linux
  WebKit also needs the system libraries `playwright install --with-deps` adds.
- **Run:** `just test-e2e` (`bunx nx run conversation-ui-e2e:test`). The project's
  `lint`, `typecheck` and `format-check` run in the gate like any other.
- A new journey file goes under `tests/` as `*.e2e.ts`; a new bridge fixture it
  reads goes in this project's `test` target `inputs`, or a change to it will not
  re-run the journeys.
