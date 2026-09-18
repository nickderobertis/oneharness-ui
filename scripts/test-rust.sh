#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT

if [ "${OS:-}" = "Windows_NT" ]; then
  "$ROOT/scripts/run-quiet.sh" \
    "Windows Rust test compilation" \
    "Fix the emitted test compilation diagnostic and rerun just test." \
    -- cargo test --locked --workspace --all-features --no-run
  exit 0
fi

# The runtime tests drive the real packaged bridge, which inherits this
# environment and would otherwise read the host's own oneharness history: a
# large store turns one "session not found" lookup into seconds of scanning
# and the watch test's frame budget into a load-dependent flake.
HISTORY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/oneharness-ui-rust-history.XXXXXX")"
readonly HISTORY_DIR
trap 'rm -rf "$HISTORY_DIR"' EXIT
export ONEHARNESS_UI_HISTORY_DIR="$HISTORY_DIR"

"$ROOT/scripts/run-quiet.sh" \
  "Rust tests and coverage" \
  "Add tests or fix the emitted diagnostic, then rerun just test." \
  -- cargo llvm-cov --locked --workspace --all-features \
  --ignore-filename-regex 'apps/desktop-shell/src/main.rs' --show-missing-lines \
  --fail-under-lines 95
