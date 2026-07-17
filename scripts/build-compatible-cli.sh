#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT
readonly UPSTREAM_REPOSITORY="https://github.com/nickderobertis/oneharness.git"
readonly UPSTREAM_REVISION="ff8ea9adfee84f17968a6ca37cc57b1b004b957c"
readonly UPSTREAM_VERSION="0.3.23"
readonly OUTPUT_ROOT="$ROOT/target/oneharness-ui-upstream"

fail() {
  printf 'compatible oneharness CLI: %s\n' "$1" >&2
  exit 1
}

temporary="$(mktemp -d "${TMPDIR:-/tmp}/oneharness-ui-cli.XXXXXX")" \
  || fail "could not create a temporary build directory; set TMPDIR to a writable location and rerun just bundle"
cleanup() {
  if [ -n "${candidate:-}" ]; then
    rm -f "$candidate"
  fi
  rm -rf "$temporary"
}
trap cleanup EXIT

install_root="$temporary/install"
CARGO_TARGET_DIR="$ROOT/target/oneharness-ui-upstream-build" \
  cargo install \
  --git "$UPSTREAM_REPOSITORY" \
  --rev "$UPSTREAM_REVISION" \
  --locked \
  --root "$install_root" \
  --no-track \
  oneharness \
  || fail "could not build pinned oneharness $UPSTREAM_VERSION from revision $UPSTREAM_REVISION; inspect the Cargo diagnostic and rerun just bundle"

source_binary="$install_root/bin/oneharness"
[ -x "$source_binary" ] \
  || fail "the pinned source build produced no executable; inspect the Cargo diagnostic and rerun just bundle"
[ "$($source_binary --version)" = "oneharness $UPSTREAM_VERSION" ] \
  || fail "the pinned source build reported an unexpected version; clear target/oneharness-ui-upstream-build and rerun just bundle"

mkdir -p "$OUTPUT_ROOT/bin" \
  || fail "could not create the compatible CLI output directory; check target permissions and rerun just bundle"
candidate="$(mktemp "$OUTPUT_ROOT/bin/.oneharness.XXXXXX")" \
  || fail "could not stage the compatible CLI; check target permissions and rerun just bundle"
install -m 0755 "$source_binary" "$candidate" \
  || fail "could not stage the compatible CLI; check target permissions and rerun just bundle"
mv "$candidate" "$OUTPUT_ROOT/bin/oneharness" \
  || fail "could not publish the compatible CLI to the bundle input; check target permissions and rerun just bundle"
candidate=""
