#!/usr/bin/env bash
# Materialize the unpublished SDK from one immutable upstream source archive.
set -euo pipefail

readonly SDK_COMMIT="964a5e030b2e0caa4cd0827ac871a0f94ca1d8a5"
readonly ARCHIVE_SHA256="beb8b4fe66d56dc212ab1105efa15c8d2e0479b070b3e470d1f68a6fe5138224"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT
readonly CACHE="$ROOT/.cache/oneharness-$SDK_COMMIT"
readonly ARCHIVE="$ROOT/.cache/oneharness-$SDK_COMMIT.tar.gz"
readonly SDK_PACKAGE="$CACHE/npm/dist/sdk"

fail() {
  printf 'fetch-sdk: %s\n' "$1" >&2
  exit 1
}

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "no SHA-256 utility found; install sha256sum or shasum, then rerun just bootstrap"
  fi
}

mkdir -p "$ROOT/.cache"
if [ ! -f "$ARCHIVE" ]; then
  curl --fail --location --silent --show-error \
    "https://github.com/nickderobertis/oneharness/archive/$SDK_COMMIT.tar.gz" \
    --output "$ARCHIVE" \
    || fail "could not download pinned oneharness source; verify GitHub access, remove $ARCHIVE, and rerun just bootstrap"
fi
[ "$(checksum "$ARCHIVE")" = "$ARCHIVE_SHA256" ] \
  || fail "pinned source checksum mismatch; remove $ARCHIVE and rerun just bootstrap"

if [ ! -d "$CACHE" ]; then
  tmp="$ROOT/.cache/oneharness-extract-$$"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp"
  tar -xzf "$ARCHIVE" -C "$tmp"
  mv "$tmp/oneharness-$SDK_COMMIT" "$CACHE"
fi

if [ ! -f "$SDK_PACKAGE/dist/index.js" ]; then
  (
    cd "$CACHE/npm/oneharness-sdk"
    bun install --frozen-lockfile >/dev/null
    bun run build >/dev/null
  ) || fail "could not build @oneharness/sdk from pinned source; remove $CACHE/npm/oneharness-sdk/node_modules and rerun just bootstrap"
  node "$CACHE/scripts/sdk-pack.mjs" >/dev/null \
    || fail "could not assemble the pinned SDK package; remove $SDK_PACKAGE and rerun just bootstrap"
fi

cli="$ROOT/.cache/upstream-target/debug/oneharness"
mock="$ROOT/.cache/upstream-target/debug/oneharness-mock-harness"
if [ "${OS:-}" = "Windows_NT" ]; then
  cli="$cli.exe"
  mock="$mock.exe"
fi
if [ ! -x "$cli" ] || [ ! -x "$mock" ]; then
  cargo build --quiet --locked --manifest-path "$CACHE/Cargo.toml" \
    --target-dir "$ROOT/.cache/upstream-target" --features mock-harness \
    --bin oneharness --bin oneharness-mock-harness \
    || fail "could not build oneharness's deterministic provider fixture; install the pinned Rust toolchain and rerun just bootstrap"
fi
