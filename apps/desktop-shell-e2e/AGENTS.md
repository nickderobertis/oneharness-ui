# desktop-shell-e2e

Proves the packaged desktop application works: its `desktop-e2e` target drives the
real installed Tauri binary through official `tauri-driver`; its `test` target
covers the journey's product-specific helpers. Driver lifecycle regressions live
in the independent `desktop-driver` project.

- **Depends on:** `desktop-shell` (built first), `ipc-contract`, and `desktop-driver`; host
  prerequisites are in `docs/native-desktop-e2e.md`.
- **Run:** `just test-desktop-e2e`.
- CI selects the journey from this project's place in the Nx graph, so a file the
  journey starts reading goes in the `desktop-e2e` target's `inputs`, or changing
  it will not run the journey.
