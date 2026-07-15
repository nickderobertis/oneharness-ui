#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT

for tool in bun cargo rustup curl npm uv; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'bootstrap: %s is required; install the pinned toolchain from .tool-versions\n' "$tool" >&2
    exit 1
  }
done

"$ROOT/scripts/fetch-sdk.sh"
cd "$ROOT"
if [ -f bun.lock ]; then
  bun install --frozen-lockfile >/dev/null
else
  bun install >/dev/null
fi
bunx playwright install chromium >/dev/null
uvx --from actionlint-py==1.7.12.24 actionlint --version >/dev/null
uvx --from shellcheck-py==0.11.0.1 shellcheck --version >/dev/null
cargo fetch --locked --quiet

install_cargo_tool() {
  local command="$1"
  local crate="$2"
  local version="$3"
  if ! cargo "$command" --version >/dev/null 2>&1; then
    cargo install --locked --quiet "$crate" --version "$version"
  fi
}

install_cargo_tool deny cargo-deny 0.20.2
install_cargo_tool machete cargo-machete 0.9.2
install_cargo_tool llvm-cov cargo-llvm-cov 0.8.7

if [ "${CI:-}" != "true" ]; then
  "$ROOT/scripts/setup-llmlint.sh" >/dev/null 2>&1 || true
fi
