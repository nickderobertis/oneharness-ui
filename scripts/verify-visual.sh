#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT
# The version file is resolved from the validated repository root, not the caller's directory.
# shellcheck disable=SC1091
source "$ROOT/scripts/visual-docs-versions.sh"
[[ "$VISUAL_PLAYWRIGHT_IMAGE" =~ ^mcr\.microsoft\.com/playwright:v[0-9]+\.[0-9]+\.[0-9]+-noble$ ]] \
  || { echo "visual docs: invalid container pin; correct scripts/visual-docs-versions.sh" >&2; exit 2; }
readonly PLATFORM="linux/amd64"

docker_command="${ONEHARNESS_VISUAL_DOCKER_COMMAND:-docker}"
screencomp_command="${ONEHARNESS_VISUAL_SCREENCOMP_COMMAND:-screencomp}"
[[ "$docker_command" =~ ^[A-Za-z0-9._-]+$ && "$screencomp_command" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "visual docs: command overrides must be executable names without paths" >&2
  exit 2
}
readonly docker_command screencomp_command

command -v "$docker_command" >/dev/null 2>&1 || {
  echo "visual docs: Docker is required; install and start Docker, then rerun just visual" >&2
  exit 1
}
command -v "$screencomp_command" >/dev/null 2>&1 || {
  echo "visual docs: screencomp is missing; run just bootstrap" >&2
  exit 1
}

capture() {
  local output="$1"
  "$docker_command" run --rm --platform="$PLATFORM" --ipc=host --shm-size=2g \
    -e "SHOTS_OUT=$output/x86_64" \
    -v "$ROOT:/work" -v /work/node_modules -w /work \
    "$VISUAL_PLAYWRIGHT_IMAGE" bash capture.sh >/dev/null \
    || { echo "visual docs: $output capture failed; inspect the browser output and retry" >&2; exit 1; }
}

capture shots/current
capture shots/verify
"$screencomp_command" doctor --input shots/current --baseline-manifest shots/baseline/x86_64.json \
  --arch x86_64 --exit-code >/dev/null \
  || { echo "visual docs: capture index is invalid; fix capture.sh and retry" >&2; exit 1; }
"$screencomp_command" verify --first shots/current --second shots/verify --arch x86_64 >/dev/null \
  || { echo "visual docs: captures are not reproducible; remove nondeterministic UI state and retry" >&2; exit 1; }
"$screencomp_command" classify --baseline-manifest shots/baseline/x86_64.json \
  --current shots/current --arch x86_64 --exit-code >/dev/null \
  || { echo "visual docs: capture drifted; review it and update the manifest if intentional" >&2; exit 1; }
