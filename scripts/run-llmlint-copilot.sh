#!/usr/bin/env bash
set -euo pipefail

if [ -z "${COPILOT_GITHUB_TOKEN:-}" ]; then
  echo "llmlint: GitHub did not provide the short-lived token required by Copilot CLI" >&2
  exit 1
fi

probe_log="$(mktemp "${TMPDIR:-/tmp}/oneharness-ui-copilot.XXXXXX")"
readonly probe_log
trap 'rm -f "$probe_log"' EXIT

probe_copilot() {
  : >"$probe_log"
  copilot --silent \
    --prompt 'Return exactly {"ok":true} and nothing else.' \
    --allow-all-tools \
    --allow-all-paths \
    --no-ask-user >"$probe_log" 2>&1
}

is_quota_failure() {
  grep -Fq "reached your additional usage limit for your plan" "$probe_log"
}

ignore_quota_failure() {
  echo "::warning::llmlint judge skipped because GitHub reports that the repository Copilot quota is exhausted." >&2
}

if ! probe_copilot; then
  if is_quota_failure; then
    ignore_quota_failure
    exit 0
  fi
  echo "llmlint: Copilot judge preflight failed" >&2
  sed -n '1,20p' "$probe_log" >&2
  exit 1
fi

if just lint-llm-diff; then
  exit 0
fi

# oneharness intentionally hides invalid model output. Probe once more so the
# only hidden backend failure we waive is GitHub's explicit quota response.
if ! probe_copilot && is_quota_failure; then
  ignore_quota_failure
  exit 0
fi

echo "llmlint: semantic diff lint failed for a reason other than Copilot quota" >&2
exit 1
