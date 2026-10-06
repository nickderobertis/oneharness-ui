# conversation-ui-visual

The screencomp visual-docs capture of the conversation UI. The capture itself lives
where it renders (`apps/conversation-ui/tests/visual`, its Playwright config, the
root `capture.sh`); this project's `visual` target lists those and the capture
tooling as inputs, so Nx marks it affected exactly when a capture could change.

- **Depends on:** `conversation-ui` (and through it `oneharness-bridge`'s e2e
  server and `ipc-contract`). Host prerequisites: Docker and the screencomp binary
  `just bootstrap` installs.
- **Run:** `just visual` (`bunx nx run conversation-ui-visual:visual`). CI's
  `Visual docs` workflow captures only when this project is affected.
- No gate target (`lint`, `format-check`, `typecheck`, `test`) may run a capture.
  Add any new file a capture renders or reads to the `visual` target's `inputs`.
