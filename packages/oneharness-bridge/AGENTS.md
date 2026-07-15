# Sidecar rules

- Import upstream contracts and validation only from the pinned
  `@oneharness/sdk`; never recreate its history/run types.
- Keep the bridge local, line-delimited, size-limited, and shell-free. Return
  actionable sanitized errors; never log session contents.
- Boundary tests must use the SDK's packaged CLI and oneharness's own
  deterministic provider fixture, not a fake SDK or subprocess.
