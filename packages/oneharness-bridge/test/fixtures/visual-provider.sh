#!/usr/bin/env bash
set -euo pipefail

if [[ -v MOCK_STDOUT ]]; then
  stdout="$MOCK_STDOUT"
else
  stdout='{"result":"mock ok"}'
fi
stderr="${MOCK_STDERR:-}"
exit_code="${MOCK_EXIT:-0}"
[[ "$exit_code" =~ ^([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$ ]] \
  || { echo "visual provider: MOCK_EXIT must be an integer from 0 through 255" >&2; exit 2; }
[ "${#stdout}" -le 8388608 ] && [ "${#stderr}" -le 8388608 ] \
  || { echo "visual provider: fixture output exceeds 8 MiB" >&2; exit 2; }

printf '%s' "$stderr" >&2
printf '%s' "$stdout"
exit "$exit_code"
