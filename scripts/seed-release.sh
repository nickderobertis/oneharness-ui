#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'initial release seed: %s\n' "$1" >&2
  exit 1
}

existing_tag="$(git tag --list 'v*' --sort=-version:refname | head -1)"
if [ -n "$existing_tag" ]; then
  [[ "$existing_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
    || fail "the existing release tag is not a v-prefixed semantic version"
  exit 0
fi

readonly SHA="${GITHUB_SHA:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] \
  || fail "GITHUB_SHA must identify the protected-main commit to seed"
VERSION="$(bun -e 'const value = await Bun.file("package.json").json(); console.log(value.version)')"
readonly VERSION
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "package.json must contain the initial semantic version"
readonly TAG="v$VERSION"
[ -n "${GH_TOKEN:-}" ] \
  || fail "GH_TOKEN must be the current workflow's built-in token"

git tag "$TAG" "$SHA" \
  || fail "could not create the initial $TAG tag at $SHA"
git push origin "refs/tags/$TAG" \
  || fail "could not push the initial $TAG tag"
gh release create "$TAG" --verify-tag --target "$SHA" --title "$TAG" --generate-notes \
  || fail "could not create the initial $TAG GitHub Release"
RELEASE_TAG="$TAG" "$(dirname "$0")/dispatch-release.sh"
