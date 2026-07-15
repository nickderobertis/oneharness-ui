#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'release checkout: %s\n' "$1" >&2
  exit 1
}

readonly TAG="${RELEASE_TAG:-}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "RELEASE_TAG must be a v-prefixed semantic version; correct the dispatch input, then rerun the release workflow"
[ -n "${GH_TOKEN:-}" ] \
  || fail "GH_TOKEN is missing; expose the workflow's built-in token, then rerun the release workflow"

git fetch --quiet --no-tags origin main \
  || fail "could not fetch protected main; verify origin and workflow token access, then rerun the release workflow for $TAG"
git fetch --quiet --force origin "refs/tags/$TAG:refs/tags/$TAG" \
  || fail "could not fetch $TAG; verify the tag exists remotely, then rerun its release workflow"
git merge-base --is-ancestor "$TAG^{commit}" origin/main \
  || fail "$TAG is not reachable from protected main; publish from a protected-main commit, then dispatch the corrected tag"
[ "$(gh release view "$TAG" --json isDraft --jq '.isDraft')" = "false" ] \
  || fail "$TAG has no published GitHub Release; publish it, then rerun the release workflow"
git checkout --quiet --detach "$TAG^{commit}" \
  || fail "could not check out $TAG; remove the damaged workflow checkout, then rerun the release workflow"
