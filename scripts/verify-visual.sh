#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT
readonly IMAGE="mcr.microsoft.com/playwright:v1.61.1-noble"
readonly PLATFORM="linux/amd64"

command -v docker >/dev/null 2>&1 || {
  echo "visual docs: Docker is required to render in the pinned Linux container" >&2
  exit 1
}
command -v screencomp >/dev/null 2>&1 || {
  echo "visual docs: screencomp is missing; run just bootstrap" >&2
  exit 1
}

capture() {
  local output="$1"
  docker run --rm --platform="$PLATFORM" --ipc=host --shm-size=2g \
    -e "SHOTS_OUT=$output/x86_64" \
    -v "$ROOT:/work" -v /work/node_modules -w /work \
    "$IMAGE" bash capture.sh
}

capture shots/current
capture shots/verify
screencomp doctor --input shots/current --baseline-manifest shots/baseline/x86_64.json \
  --arch x86_64 --exit-code
screencomp verify --first shots/current --second shots/verify --arch x86_64
screencomp classify --baseline-manifest shots/baseline/x86_64.json \
  --current shots/current --arch x86_64 --exit-code
