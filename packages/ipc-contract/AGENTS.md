# IPC contract rules

- These schemas describe only the app's IPC/view protocol. Never reproduce
  oneharness wire types here; the sidecar imports those from `@oneharness/sdk`.
- Keep request limits and response validation symmetric at every transport.
