#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT

if [ "${OS:-}" = "Windows_NT" ]; then
  "$ROOT/scripts/run-quiet.sh" \
    "Windows Rust tests" \
    "Fix the emitted test diagnostic and rerun just test." \
    -- cargo test --locked --workspace --all-features
  exit 0
fi

"$ROOT/scripts/run-quiet.sh" \
  "Rust tests and coverage" \
  "Add tests or fix the emitted diagnostic, then rerun just test." \
  -- cargo llvm-cov --locked --workspace --all-features \
  --ignore-filename-regex 'apps/desktop-shell/src/main.rs' --fail-under-lines 95
