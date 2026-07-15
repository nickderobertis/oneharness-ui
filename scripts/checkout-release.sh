#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'release checkout: %s\n' "$1" >&2
  exit 1
}

readonly TAG="${RELEASE_TAG:-}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "RELEASE_TAG must be a v-prefixed semantic version"
[ -n "${GH_TOKEN:-}" ] \
  || fail "GH_TOKEN must be the current workflow's built-in token"

git fetch --no-tags origin main \
  || fail "could not fetch protected main for provenance validation"
git fetch --force origin "refs/tags/$TAG:refs/tags/$TAG" \
  || fail "could not fetch the requested $TAG tag"
git merge-base --is-ancestor "$TAG^{commit}" origin/main \
  || fail "$TAG does not identify a commit reachable from protected main"
[ "$(gh release view "$TAG" --json isDraft --jq '.isDraft')" = "false" ] \
  || fail "$TAG must have a published, non-draft GitHub Release"
git checkout --detach "$TAG^{commit}" \
  || fail "could not check out the verified $TAG commit"
