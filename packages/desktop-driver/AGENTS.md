# desktop-driver

Owns the local WebDriver launcher and native-driver preparation used by the
packaged desktop journey. Its `test` target drives the real launcher through
held subprocess readiness and deadline failure, without product dependencies.

- **Depends on:** no workspace project; do not import application or SDK code.
- **Consumers:** `desktop-shell-e2e` depends on this project for affected selection
  and includes its source files in the native journey's inputs.
- **Checks:** use `just check-affected` with the dispatch base and committed head.
  Windows registry, publisher verification and downloads run on the native lane.
