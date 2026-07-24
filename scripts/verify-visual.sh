#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT
versions_file="$ROOT/scripts/visual-docs-versions.env"
readonly versions_file
VISUAL_PLAYWRIGHT_IMAGE="$(sed -n 's/^VISUAL_PLAYWRIGHT_IMAGE=//p' "$versions_file")"
[[ "$VISUAL_PLAYWRIGHT_IMAGE" =~ ^mcr\.microsoft\.com/playwright:v[0-9]+\.[0-9]+\.[0-9]+-noble$ ]] \
  || { echo "visual docs: invalid container pin; correct scripts/visual-docs-versions.env" >&2; exit 2; }
readonly VISUAL_PLAYWRIGHT_IMAGE
readonly PLATFORM="linux/amd64"

docker_command="${ONEHARNESS_VISUAL_DOCKER_COMMAND:-docker}"
screencomp_command="${ONEHARNESS_VISUAL_SCREENCOMP_COMMAND:-screencomp}"
[[ "$docker_command" =~ ^[A-Za-z0-9._-]+$ && "$screencomp_command" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "visual docs: command overrides must be executable names without paths" >&2
  exit 2
}
readonly docker_command screencomp_command

run_quiet() {
  local operation="$1"
  local remedy="$2"
  shift 2
  ONEHARNESS_QUIET=1 "$ROOT/scripts/run-quiet.sh" "visual docs: $operation" "$remedy" -- "$@"
}

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
  run_quiet "$output capture" "inspect the browser output and retry" \
    "$docker_command" run --rm --platform="$PLATFORM" --ipc=host --shm-size=2g \
    -e "SHOTS_OUT=$output/x86_64" \
    -v "$ROOT:/work" -v /work/node_modules -w /work \
    "$VISUAL_PLAYWRIGHT_IMAGE" bash capture.sh
}

capture shots/current
capture shots/verify
run_quiet "capture index validation" "fix capture.sh and retry" \
  "$screencomp_command" doctor --input shots/current --baseline-manifest shots/baseline/x86_64.json \
  --arch x86_64 --exit-code
run_quiet "capture reproducibility" "captures are not reproducible; remove nondeterministic UI state and retry" \
  "$screencomp_command" verify --first shots/current --second shots/verify --arch x86_64
run_quiet "capture classification" "review it and update the manifest if intentional" \
  "$screencomp_command" classify --baseline-manifest shots/baseline/x86_64.json \
  --current shots/current --arch x86_64 --exit-code
