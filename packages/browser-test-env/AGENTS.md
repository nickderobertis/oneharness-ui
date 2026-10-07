# browser-test-env

Proves nothing itself: it is the happy-dom preload that lets the `conversation-ui`
and `ui` unit suites render real components without a browser.

- **Depends on:** no workspace project and no host prerequisite.
- **Run:** it has no tests; `just test` exercises it through those suites.
- Keep it to globals every DOM suite needs; a suite-specific double belongs in
  that suite.
