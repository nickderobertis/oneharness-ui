#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'release dispatch: %s\n' "$1" >&2
  exit 1
}

readonly TAG="${RELEASE_TAG:-}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "RELEASE_TAG must be a v-prefixed semantic version; correct it, then rerun just dispatch-release"
command -v gh >/dev/null 2>&1 \
  || fail "gh is missing; install GitHub CLI, then rerun just dispatch-release"
[ -n "${GH_TOKEN:-}" ] \
  || fail "GH_TOKEN is missing; expose the workflow's built-in token, then rerun just dispatch-release"

gh workflow run release.yml --ref main --field "release_tag=$TAG" >/dev/null \
  || fail "GitHub rejected the artifact workflow dispatch for $TAG; verify actions:write and release.yml on main, then rerun just dispatch-release"
