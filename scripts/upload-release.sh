#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'upload-release: %s\n' "$1" >&2
  exit 1
}

readonly BUNDLE_ROOT="${BUNDLE_DIRECTORY:-}"
readonly CHECKSUM_FILE="${CHECKSUM_OUTPUT:-}"
readonly TAG="${RELEASE_TAG:-}"

[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "RELEASE_TAG must be a v-prefixed semver created by semantic-release; set it to the release tag, then rerun just upload-release"
[ "$BUNDLE_ROOT" = "target/release/bundle" ] \
  || fail "BUNDLE_DIRECTORY must be target/release/bundle; set the validated bundle directory, then rerun just upload-release"
[[ "$CHECKSUM_FILE" =~ ^checksums-[A-Za-z0-9_.-]+\.txt$ ]] \
  || fail "CHECKSUM_OUTPUT must be a local checksums-<platform>.txt filename; set it to the generated checksum file, then rerun just upload-release"
[ -f "$CHECKSUM_FILE" ] \
  || fail "checksum file is missing; run just checksums before just upload-release"

artifacts=()
while IFS= read -r -d '' artifact; do
  artifacts+=("$artifact")
done < <(
  find "$BUNDLE_ROOT" -type f \
    \( -name '*.deb' -o -name '*.AppImage' -o -name '*.dmg' -o -name '*.msi' -o -name '*-setup.exe' \) \
    -print0
)
[ "${#artifacts[@]}" -gt 0 ] \
  || fail "no native release artifacts were found; rerun just bundle for this platform"

gh release upload "$TAG" "${artifacts[@]}" "$CHECKSUM_FILE" --clobber \
  || fail "GitHub upload failed; verify GH_TOKEN and that semantic-release created $TAG, then rerun just upload-release"
