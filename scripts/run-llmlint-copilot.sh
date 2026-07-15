#!/usr/bin/env bash
set -euo pipefail

if [ -z "${COPILOT_GITHUB_TOKEN:-}" ]; then
  echo "llmlint: COPILOT_GITHUB_TOKEN is missing; expose github.token to the judge step, then rerun the llmlint workflow" >&2
  exit 1
fi

probe_log="$(mktemp "${TMPDIR:-/tmp}/oneharness-ui-copilot.XXXXXX")"
readonly probe_log
trap 'rm -f "$probe_log"' EXIT

probe_copilot() {
  : >"$probe_log"
  copilot --silent \
    --prompt 'Return exactly {"ok":true} and nothing else.' \
    --available-tools= \
    --no-ask-user \
    --no-auto-update \
    --no-custom-instructions \
    --disable-builtin-mcps >"$probe_log" 2>&1
}

is_quota_failure() {
  grep -Fq "reached your additional usage limit for your plan" "$probe_log"
}

if ! probe_copilot; then
  if is_quota_failure; then
    exit 0
  fi
  echo "llmlint: Copilot judge preflight failed; verify built-in-token Copilot access, then rerun the llmlint workflow" >&2
  sed -n '1,20p' "$probe_log" >&2
  exit 1
fi

# llmlint: ignore[work_goes_through_command_surface] This wrapper delegates semantic diff work to the documented just recipe.
if just lint-llm-diff; then
  exit 0
fi

# oneharness intentionally hides invalid model output. Probe once more so the
# only hidden backend failure we waive is GitHub's explicit quota response.
if ! probe_copilot && is_quota_failure; then
  exit 0
fi

echo "llmlint: semantic diff lint failed for a reason other than Copilot quota; inspect 'llmlint history latest', fix every finding, then rerun just lint-llm-diff" >&2
exit 1
