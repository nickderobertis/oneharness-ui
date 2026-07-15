#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'release dispatch: %s\n' "$1" >&2
  exit 1
}

readonly TAG="${RELEASE_TAG:-}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "RELEASE_TAG must be a v-prefixed semantic version"
command -v gh >/dev/null 2>&1 \
  || fail "gh is required to dispatch the native artifact workflow"
[ -n "${GH_TOKEN:-}" ] \
  || fail "GH_TOKEN must be the current workflow's built-in token"

gh workflow run release.yml --ref main --field "release_tag=$TAG" \
  || fail "GitHub rejected the artifact workflow dispatch for $TAG"
