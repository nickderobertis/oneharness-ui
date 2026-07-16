#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT

fail() {
  printf 'bootstrap: %s\n' "$1" >&2
  exit 1
}

for tool in bun cargo node rustup curl uv; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'bootstrap: %s is required; install the pinned toolchain from .tool-versions\n' "$tool" >&2
    exit 1
  }
done

"$ROOT/scripts/fetch-sdk.sh" \
  || fail "SDK materialization failed; follow the fetch-sdk remedy above, then rerun just bootstrap"
cd "$ROOT"
if [ -f bun.lock ]; then
  bun install --frozen-lockfile >/dev/null \
    || fail "workspace install failed; resolve the Bun lockfile diagnostic, then rerun just bootstrap"
else
  bun install >/dev/null \
    || fail "workspace install failed; restore bun.lock or resolve the Bun diagnostic, then rerun just bootstrap"
fi
bun "$ROOT/scripts/build-sidecar.mjs" \
  || fail "sidecar assembly failed; follow the build-sidecar remedy above, then rerun just bootstrap"
bunx playwright install chromium >/dev/null \
  || fail "Chromium provisioning failed; verify Playwright download access, then rerun just bootstrap"
uvx --from actionlint-py==1.7.12.24 actionlint --version >/dev/null \
  || fail "actionlint provisioning failed; verify uv package-index access, then rerun just bootstrap"
uvx --from shellcheck-py==0.11.0.1 shellcheck --version >/dev/null \
  || fail "shellcheck provisioning failed; verify uv package-index access, then rerun just bootstrap"
cargo fetch --locked --quiet \
  || fail "Rust dependency fetch failed; verify registry access and Cargo.lock, then rerun just bootstrap"

install_cargo_tool() {
  local command="$1"
  local crate="$2"
  local version="$3"
  if ! cargo "$command" --version >/dev/null 2>&1; then
    cargo install --locked --quiet "$crate" --version "$version" \
      || fail "could not install $crate $version; verify crates.io access, then rerun just bootstrap"
  fi
}

install_cargo_tool deny cargo-deny 0.20.2
install_cargo_tool machete cargo-machete 0.9.2
install_cargo_tool llvm-cov cargo-llvm-cov 0.8.7

case "$(uname -s)" in
  Linux | MINGW* | MSYS* | CYGWIN*)
    if ! cargo install --list | grep -Fxq "tauri-driver v2.0.6:"; then
      cargo install --locked --quiet tauri-driver --version 2.0.6 \
        || fail "could not install tauri-driver 2.0.6; verify crates.io access, then rerun just bootstrap"
    fi
    ;;
esac

if [ "${CI:-}" != "true" ]; then
  "$ROOT/scripts/setup-llmlint.sh" >/dev/null 2>&1 || true
fi
