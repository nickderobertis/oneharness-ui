# conversation-ui-e2e

Proves the exported conversation UI works for a user: Playwright journeys in
Chromium and WebKit (Chromium alone on Windows) against the built static export
and the bridge's real e2e server.

- **Depends on:** `conversation-ui` (built first), `oneharness-bridge` (the e2e
  server and its history fixtures) and `ipc-contract`; the host needs the
  Playwright browsers `just bootstrap` installs.
- **Run:** `just test-e2e`.
- A bridge fixture a journey starts reading goes in this project's `test`
  `inputs`, or changing it will not re-run the journeys.
