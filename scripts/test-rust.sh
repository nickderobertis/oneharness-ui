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
# and the watch test's frame budget into a load-dependent flake. The empty
# store lives in the repository's own target directory, beside the mock
# harness, so no outside path is read or shared with another run.
readonly HISTORY_PARENT="$ROOT/target/oneharness-ui-test"
if ! mkdir -p "$HISTORY_PARENT" || ! HISTORY_DIR="$(mktemp -d "$HISTORY_PARENT/rust-history.XXXXXX")"; then
  echo "Rust tests: could not create an empty history store under $HISTORY_PARENT. Make the target directory writable, then rerun just test." >&2
  exit 1
fi
readonly HISTORY_DIR
# A store left behind is a failure of this run: report it and fail a run
# that would otherwise have passed, without masking the tests' own status.
remove_history_store() {
  local status=$?
  if ! rm -rf "$HISTORY_DIR"; then
    echo "Rust tests: could not remove the empty history store $HISTORY_DIR. Delete it by hand, then rerun just test." >&2
    if [ "$status" -eq 0 ]; then status=1; fi
  fi
  exit "$status"
}
trap remove_history_store EXIT
export ONEHARNESS_UI_HISTORY_DIR="$HISTORY_DIR"

"$ROOT/scripts/run-quiet.sh" \
  "Rust tests and coverage" \
  "Add tests or fix the emitted diagnostic, then rerun just test." \
  -- cargo llvm-cov --locked --workspace --all-features \
  --ignore-filename-regex 'apps/desktop-shell/src/main.rs' --show-missing-lines \
  --fail-under-lines 95
