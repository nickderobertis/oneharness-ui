# desktop-shell-e2e

Proves the packaged desktop application works: the `desktop-e2e` target builds the
release binary and its platform installer, launches the real Tauri app, and drives
its WebView with WebdriverIO through official `tauri-driver` against isolated SDK
history and the deterministic provider fixture. The `test` target holds fast unit
tests for the journey's helpers and its own project-graph wiring.

- **Depends on:** `desktop-shell` (its `build` runs first; it pulls in
  `conversation-ui` and `oneharness-bridge`) and `ipc-contract`. Host
  prerequisites: Linux or Windows only, because official `tauri-driver` has no
  macOS driver; Linux also needs `webkit2gtk-driver` and a display (`xvfb-run` when
  headless). Bootstrap installs the pinned `tauri-driver`.
- **Run:** `just test-desktop-e2e` (Linux headless: `xvfb-run -a just
  test-desktop-e2e`) for the journey; `bunx nx run desktop-shell-e2e:test` for the
  unit tests, which the gate runs.
- CI runs the journey only when the change reaches this project in the Nx graph,
  skipping per step so both `desktop-e2e (<os>)` contexts always report. Keep any
  new journey input in the `desktop-e2e` target's `inputs`, or a change to it will
  not select the journey. See `docs/native-desktop-e2e.md`.
