# affected-selection

Proves the selector CI uses to gate an expensive suite (`just select-affected
<project>`) prints `run=true` exactly when the change between `NX_BASE` and
`NX_HEAD` reaches that Nx project.

- **Depends on:** no project; its `test` target reads the graph definition
  (`nx.json`, the root `package.json` and every `project.json`), so it re-runs
  when the graph changes and not for unrelated code. The host needs git and the
  installed workspace (`just install-workspace`).
- **Run:** `bunx nx run affected-selection:test`.
