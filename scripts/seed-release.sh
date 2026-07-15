#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'initial release seed: %s\n' "$1" >&2
  exit 1
}

[ -n "${GH_TOKEN:-}" ] \
  || fail "GH_TOKEN is missing; expose the workflow's built-in token, then rerun just seed-release"

existing_tag="$(git tag --list 'v*' --sort=-version:refname | head -1)"
if [ -n "$existing_tag" ]; then
  [[ "$existing_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
    || fail "the existing release tag is invalid; repair or remove it, then rerun just seed-release"
  git merge-base --is-ancestor "$existing_tag^{commit}" HEAD \
    || fail "$existing_tag is not reachable from protected main; repair the tag, then rerun just seed-release"
  release_state="$(gh release view "$existing_tag" --json isDraft --jq '.isDraft' 2>/dev/null || true)"
  [ "$release_state" != "true" ] \
    || fail "$existing_tag is still a draft; publish it, then rerun just seed-release"
  if [ "$release_state" != "false" ]; then
    git rev-parse --verify "$existing_tag^{commit}" >/dev/null \
      || fail "$existing_tag has no commit; repair the tag, then rerun just seed-release"
    gh release create "$existing_tag" --verify-tag --title "$existing_tag" --generate-notes >/dev/null \
      || fail "could not recover the $existing_tag GitHub Release; verify contents:write, then rerun just seed-release"
  fi
  exit 0
fi

readonly SHA="${GITHUB_SHA:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] \
  || fail "GITHUB_SHA must identify protected main; run from its push workflow, then rerun just seed-release"
[ "$(git rev-parse HEAD)" = "$SHA" ] \
  || fail "GITHUB_SHA does not match the checkout; rerun just seed-release from the protected-main push workflow"
VERSION="$(bun -e 'const value = await Bun.file("package.json").json(); console.log(value.version)')"
readonly VERSION
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fail "package.json has no semantic version; correct it, then rerun just seed-release"
readonly TAG="v$VERSION"

git tag "$TAG" "$SHA" \
  || fail "could not create $TAG at $SHA; remove a conflicting local tag or correct GITHUB_SHA, then rerun just seed-release"
git push --quiet origin "refs/tags/$TAG" \
  || fail "could not push $TAG; verify contents:write and that the remote tag is absent, then rerun just seed-release"
gh release create "$TAG" --verify-tag --target "$SHA" --title "$TAG" --generate-notes >/dev/null \
  || fail "could not create the $TAG GitHub Release; verify contents:write and the remote tag, then rerun just seed-release"
