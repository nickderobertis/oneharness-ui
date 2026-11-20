# conversation-ui-e2e

Proves the exported conversation UI works for a user: Playwright journeys, in
the browser projects `playwright.config.ts` declares, against the built static
export and the bridge's real e2e server.

- **Depends on:** `conversation-ui` (built first), `oneharness-bridge` (the e2e
  server and its history fixtures) and `ipc-contract`; the host needs the
  Playwright browsers `just bootstrap` installs.
- **Run:** `just test-e2e`.
- Journeys that need a component state the app cannot reach (timeline markers, focus
  on any item) render the built `@oneharness/ui` through `harness/`, styled by the
  app's compiled stylesheet. They record WCAG contrast readings in `telemetry/`, which
  the `budgets` target checks against `budgets.yaml`.
- A bridge fixture a journey starts reading goes in this project's `test`
  `inputs`, or changing it will not re-run the journeys.
