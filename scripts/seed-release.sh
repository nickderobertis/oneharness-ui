#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'initial release seed: %s\n' "$1" >&2
  exit 1
}

existing_tag="$(git tag --list 'v*' --sort=-version:refname | head -1)"
if [ -n "$existing_tag" ]; then
  [[ "$existing_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
    || fail "the existing release tag is invalid; repair or remove it, then rerun just seed-release"
  exit 0
fi

readonly SHA="${GITHUB_SHA:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] \
  || fail "GITHUB_SHA must identify protected main; run from its push workflow, then rerun just seed-release"
VERSION="$(bun -e 'const value = await Bun.file("package.json").json(); console.log(value.version)')"
readonly VERSION
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "package.json has no semantic version; correct it, then rerun just seed-release"
readonly TAG="v$VERSION"
[ -n "${GH_TOKEN:-}" ] \
  || fail "GH_TOKEN is missing; expose the workflow's built-in token, then rerun just seed-release"

git tag "$TAG" "$SHA" \
  || fail "could not create $TAG at $SHA; remove a conflicting local tag or correct GITHUB_SHA, then rerun just seed-release"
git push --quiet origin "refs/tags/$TAG" \
  || fail "could not push $TAG; verify contents:write and that the remote tag is absent, then rerun just seed-release"
gh release create "$TAG" --verify-tag --target "$SHA" --title "$TAG" --generate-notes >/dev/null \
  || fail "could not create the $TAG GitHub Release; verify contents:write and the remote tag, then rerun just seed-release"
RELEASE_TAG="$TAG" "$(dirname "$0")/dispatch-release.sh"
