#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'release dispatch: %s\n' "$1" >&2
  exit 1
}

TAG="${RELEASE_TAG:-}"
if [ -z "$TAG" ]; then
  TAG="$(git tag --list 'v*' --sort=-version:refname | head -1)" \
    || fail "could not inspect release tags; repair the checkout, then rerun just dispatch-release"
fi
readonly TAG
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "RELEASE_TAG must be a v-prefixed semantic version; correct it, then rerun just dispatch-release"
command -v gh >/dev/null 2>&1 \
  || fail "gh is missing; install GitHub CLI, then rerun just dispatch-release"
[ -n "${GH_TOKEN:-}" ] \
  || fail "GH_TOKEN is missing; expose the workflow's built-in token, then rerun just dispatch-release"

active_run="$(
  gh run list --workflow release.yml --limit 100 --json displayTitle,status,conclusion \
    --jq ".[] | select(.displayTitle == \"release $TAG\") | select(.status != \"completed\" or .conclusion == \"success\") | .status"
)" || fail "could not inspect artifact runs; verify actions:read, then rerun just dispatch-release"
[ -z "$active_run" ] || exit 0

gh workflow run release.yml --ref main --field "release_tag=$TAG" >/dev/null \
  || fail "GitHub rejected the artifact workflow dispatch for $TAG; run 'gh workflow view release.yml' and grant actions:write, then rerun just dispatch-release"
