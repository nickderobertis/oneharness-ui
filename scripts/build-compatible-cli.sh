#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT
readonly UPSTREAM_REPOSITORY="https://github.com/nickderobertis/oneharness.git"
# llmlint: ignore-block[contracts_have_one_source_or_a_drift_gate] scripts/check-version-drift.mjs fails unless this version matches the bridge's @oneharness/sdk pin. This script checks the built revision reports that version.
readonly UPSTREAM_REVISION="b610356dc4089dcb0bf342b154a3539e115295a3"
readonly UPSTREAM_VERSION="0.14.0"
# llmlint: ignore-end[contracts_have_one_source_or_a_drift_gate]
readonly OUTPUT_ROOT="$ROOT/target/oneharness-ui-upstream"

fail() {
  printf 'compatible oneharness CLI: %s\n' "$1" >&2
  exit 1
}

temporary="$(mktemp -d "${TMPDIR:-/tmp}/oneharness-ui-cli.XXXXXX")" \
  || fail "could not create a temporary build directory; set TMPDIR to a writable location and rerun just bundle"
cleanup() {
  local status=$?
  trap - EXIT
  if [ -n "${candidate:-}" ]; then
    rm -f "$candidate" \
      || {
        printf 'compatible oneharness CLI: could not remove staged file %s; remove it manually before rerunning just bundle\n' "$candidate" >&2
        status=1
      }
  fi
  rm -rf "$temporary" \
    || {
      printf 'compatible oneharness CLI: could not remove temporary directory %s; remove it manually before rerunning just bundle\n' "$temporary" >&2
      status=1
    }
  exit "$status"
}
trap cleanup EXIT

install_root="$temporary/install"
# The upstream crate compiles under its own lint settings: this repository's
# RUSTFLAGS="-D warnings" would otherwise fail its pinned revision on any lint
# a newer compiler adds, which is not this repository's to fix. The build lands
# in the clone's one target directory rather than the temporary one cargo
# install would otherwise use and discard.
# llmlint: ignore[contracts_have_one_source_or_a_drift_gate] cargo install reloads its configuration rooted at CARGO_HOME for a non-path crate, so the clone's .cargo/config.toml build.target-dir is never read by it; this environment variable is the one channel that reaches it, carrying the value the config names.
CARGO_TARGET_DIR="$ROOT/target" \
  env -u RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS \
  cargo install \
  --git "$UPSTREAM_REPOSITORY" \
  --rev "$UPSTREAM_REVISION" \
  --locked \
  --quiet \
  --root "$install_root" \
  --no-track \
  oneharness \
  || fail "could not build pinned oneharness $UPSTREAM_VERSION from revision $UPSTREAM_REVISION; inspect the Cargo diagnostic and rerun just bundle"

source_binary="$install_root/bin/oneharness"
[ -x "$source_binary" ] \
  || fail "the pinned source build produced no executable; inspect the Cargo diagnostic and rerun just bundle"
observed_version="$("$source_binary" --version 2>&1)" \
  || fail "the pinned source build could not report its version: $observed_version; inspect the Cargo diagnostic and rerun just bundle"
[ "$observed_version" = "oneharness $UPSTREAM_VERSION" ] \
  || fail "the pinned source build reported '$observed_version' rather than 'oneharness $UPSTREAM_VERSION'; run cargo clean --release and rerun just bundle"

mkdir -p "$OUTPUT_ROOT/bin" \
  || fail "could not create the compatible CLI output directory; check target permissions and rerun just bundle"
candidate="$(mktemp "$OUTPUT_ROOT/bin/.oneharness.XXXXXX")" \
  || fail "could not stage the compatible CLI; check target permissions and rerun just bundle"
install -m 0755 "$source_binary" "$candidate" \
  || fail "could not stage the compatible CLI; check target permissions and rerun just bundle"
mv "$candidate" "$OUTPUT_ROOT/bin/oneharness" \
  || fail "could not publish the compatible CLI to the bundle input; check target permissions and rerun just bundle"
candidate=""
