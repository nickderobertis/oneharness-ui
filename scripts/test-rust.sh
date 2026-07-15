#!/usr/bin/env bash
set -euo pipefail

if [ "${OS:-}" = "Windows_NT" ]; then
  cargo test --locked --workspace --all-features \
    || {
      printf 'test-rust: Windows Rust tests failed; fix the emitted test diagnostic and rerun just test\n' >&2
      exit 1
    }
  exit 0
fi

cargo llvm-cov --locked --workspace --all-features \
  --ignore-filename-regex 'apps/desktop-shell/src/main.rs' --fail-under-lines 95 \
  || {
    printf 'test-rust: Rust tests or coverage failed; add tests or fix the emitted diagnostic, then rerun just test\n' >&2
    exit 1
  }
