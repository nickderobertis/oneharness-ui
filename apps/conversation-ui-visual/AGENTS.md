# conversation-ui-visual

The capture spec and its Playwright config stay beside the source they render
in `conversation-ui` (see `docs/visual-testing.md`); this project owns when they
run.

- **Depends on:** `conversation-ui`; the host needs Docker and the screencomp
  binary `just bootstrap` installs.
- **Run:** `just visual`.
- The capture is `visual`, never `test` or another gate target: it needs Docker
  and one x86_64 container, so it cannot run in the cross-OS gate.
- A file a capture renders or reads goes in the `capture` named input, or
  changing it will not trigger a capture in CI.
