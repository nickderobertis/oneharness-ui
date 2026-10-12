#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'macOS artifact verification: %s; inspect the native bundle and rerun just verify-macos-artifact\n' "$1" >&2
  exit 1
}
[[ "$(uname -s)" = Darwin ]] || fail 'a native macOS host is required'
shopt -s nullglob
images=(target/release/bundle/dmg/*.dmg)
(( ${#images[@]} == 1 )) || fail 'expected exactly one DMG'
image="${images[0]}"
mount="$(hdiutil attach "$image" -nobrowse | tail -1 | sed 's#^.*\(/Volumes/.*\)#\1#')" || fail 'DMG attachment failed'
case "$mount" in
  /Volumes/*) ;;
  *) fail 'DMG mount did not resolve under /Volumes' ;;
esac
cleanup() {
  status=$?
  if ! hdiutil detach "$mount" >/dev/null; then
    printf 'macOS artifact cleanup failed; run hdiutil detach on the reported mount before retrying the verifier\n' >&2
    exit 1
  fi
  exit "$status"
}
trap cleanup EXIT
sudo ditto "$mount/oneharness.app" /Applications/oneharness.app || fail 'application installation failed'
hdiutil detach "$mount" >/dev/null || fail 'DMG detach failed'
trap - EXIT
test -x /Applications/oneharness.app/Contents/MacOS/oneharness || fail 'installed application is not executable'
bridge=/Applications/oneharness.app/Contents/MacOS/oneharness-ui-bridge
test -x "$bridge" || fail 'installed bridge is not executable'
response="$(printf '{"kind":"unknown"}\n' | "$bridge")" || fail 'installed bridge execution failed'
node -e 'let value;try{value=JSON.parse(process.argv[1])}catch(error){const cause=error instanceof SyntaxError?(error.message.startsWith("Unexpected end")?"incomplete JSON":error.message.startsWith("Unterminated string")?"unterminated string":"invalid JSON syntax"):"parser failure";const location=error instanceof SyntaxError?error.message.match(/position (\d+)(?: \(line (\d+) column (\d+)\))?/):null;const suffix=location?" at position "+location[1]+(location[2]?" (line "+location[2]+" column "+location[3]+")":""):"";console.error("bridge JSON parsing failed: "+cause+suffix);process.exit(1)};if(value?.ok!==false){console.error("bridge JSON validation failed: ok must be false");process.exit(1)};if(value?.error?.code!=="INVALID_REQUEST"){console.error("bridge JSON validation failed: error.code must be INVALID_REQUEST");process.exit(1)}' "$response" || fail 'bridge response is not INVALID_REQUEST JSON'
