# conversation-ui-visual

Proves the conversation UI renders as its committed screencomp manifest records.
The `visual` target captures the production export twice in the pinned Playwright
container, checks the two are byte-identical and classifies them against
`shots/baseline`. The spec and its Playwright config stay beside the source they
render in `conversation-ui`; this project owns when they run.

- **Depends on:** `conversation-ui`; the host needs Docker and the screencomp
  binary `just bootstrap` installs.
- **Run:** `just visual`.
- The capture is `visual`, never `test` or another gate target: it needs Docker
  and one x86_64 container, so it cannot run in the cross-OS gate. `test` holds
  only the stubbed command-contract tests.
- A file a capture renders or reads goes in the `capture` named input, or
  changing it will not trigger a capture in CI.
