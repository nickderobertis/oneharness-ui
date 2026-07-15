# Desktop shell rules

- Keep Rust ignorant of oneharness contracts. It grants the main webview only
  the scoped permission to spawn the bundled bridge; add no general shell grant.
- Never add shell command construction. Build and package the sidecar by target
  triple through the root script.
