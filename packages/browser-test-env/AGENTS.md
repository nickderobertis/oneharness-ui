# browser-test-env

The DOM preload that every browser-facing unit suite loads with
`bun test --preload @oneharness-ui/browser-test-env/src/preload.ts`. It registers
happy-dom's globals and points the bridge client at the loopback test URL, so
`conversation-ui` and `ui` tests render real components without a browser.

- **Depends on:** no workspace project; only `happy-dom` and its global
  registrator. No host prerequisite.
- **Run:** it has no tests of its own. `bunx nx run-many -t lint typecheck
  format-check -p browser-test-env` checks it, and the `conversation-ui:test` and
  `ui:test` targets exercise it; both list `src/preload.ts` among their inputs, so
  a change here re-runs them.
- Keep it to environment globals every suite needs; a suite-specific double
  belongs in that suite.
