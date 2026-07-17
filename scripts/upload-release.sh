#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'upload-release: %s\n' "$1" >&2
  exit 1
}

readonly ASSET_ROOT="${RELEASE_ASSET_DIRECTORY:-}"
readonly TAG="${RELEASE_TAG:-}"

[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "RELEASE_TAG must be a v-prefixed semver created by semantic-release; set it to the release tag, then rerun just upload-release"
[ "$ASSET_ROOT" = "target/release-assets" ] \
  || fail "RELEASE_ASSET_DIRECTORY must be target/release-assets; run just prepare-release-assets before just upload-release"
[ -d "$ASSET_ROOT" ] \
  || fail "release asset directory is missing; run just prepare-release-assets before just upload-release"

artifacts=()
while IFS= read -r -d '' artifact; do
  artifacts+=("$artifact")
done < <(
  find "$ASSET_ROOT" -mindepth 1 -maxdepth 1 -type f -print0
)
[ "${#artifacts[@]}" -gt 0 ] \
  || fail "no canonical release assets were found; rerun just prepare-release-assets"

for artifact in "${artifacts[@]}"; do
  name="${artifact#"$ASSET_ROOT"/}"
  base="${name%.sha256}"
  case "$base" in
    "oneharness-ui-${TAG}-linux-x86_64.AppImage" | \
      "oneharness-ui-${TAG}-linux-x86_64.deb" | \
      "oneharness-ui-${TAG}-linux-aarch64.AppImage" | \
      "oneharness-ui-${TAG}-linux-aarch64.deb" | \
      "oneharness-ui-${TAG}-macos-aarch64.dmg" | \
      "oneharness-ui-${TAG}-windows-x86_64.msi" | \
      "oneharness-ui-${TAG}-windows-x86_64-setup.exe") ;;
    *) fail "unexpected release asset name: $name; rerun just prepare-release-assets" ;;
  esac
  if [[ "$name" == *.sha256 ]]; then
    [ -f "$ASSET_ROOT/$base" ] \
      || fail "checksum has no matching release asset: $name; rerun just prepare-release-assets"
  else
    [ -f "$artifact.sha256" ] \
      || fail "release asset has no mandatory checksum: $name; rerun just prepare-release-assets"
  fi
done

gh release upload "$TAG" "${artifacts[@]}" --clobber \
  || fail "GitHub upload failed; verify GH_TOKEN and that semantic-release created $TAG, then rerun just upload-release"
