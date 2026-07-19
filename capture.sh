#!/usr/bin/env bash
set -euo pipefail

npm install --global bun@1.3.14 >/dev/null
bun install --frozen-lockfile >/dev/null
bun scripts/build-test-provider.mjs
bun scripts/build-sidecar.mjs
bun run --cwd apps/conversation-ui build
SHOTS_OUT="$(pwd)/${SHOTS_OUT:-shots/current/x86_64}" \
  bun run --cwd apps/conversation-ui playwright test --config visual.playwright.config.ts
