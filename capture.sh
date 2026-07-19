#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd -P)"
readonly ROOT
requested_output="${SHOTS_OUT:-shots/current/x86_64}"
if [[ "$requested_output" != /* ]]; then requested_output="$ROOT/$requested_output"; fi
case "$requested_output" in
  "$ROOT"/shots/current/x86_64 | "$ROOT"/shots/verify/x86_64) ;;
  *) echo "visual capture: SHOTS_OUT must select the current or verify x86_64 shot directory" >&2; exit 2 ;;
esac
readonly requested_output

run_quiet() {
  local operation="$1"
  local remedy="$2"
  shift 2
  "$@" >/dev/null \
    || { echo "visual capture: $operation failed; $remedy" >&2; exit 1; }
}

run_quiet "Bun provisioning" "verify npm access and retry" npm install --global bun@1.3.14
run_quiet "workspace install" "restore the lockfile or dependency access and retry" \
  bun install --frozen-lockfile --ignore-scripts
run_quiet "sidecar build" "fix the sidecar build diagnostic and retry" \
  bun scripts/build-sidecar.mjs
run_quiet "web UI build" "fix the static export diagnostic and retry" \
  bun run --cwd apps/conversation-ui build
if ! access_token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"; then
  echo "visual capture: access-token generation failed; restore the pinned Node installation and retry" >&2
  exit 1
fi
readonly access_token
run_quiet "Playwright capture" "inspect the failed journey, make it deterministic, and retry" \
  env ONEHARNESS_UI_TEST_WEB_ACCESS_TOKEN="$access_token" SHOTS_OUT="$requested_output" \
  bun run --cwd apps/conversation-ui playwright test --config visual.playwright.config.ts
