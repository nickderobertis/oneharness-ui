#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 4 ] || [ "$3" != "--" ]; then
  printf 'run-quiet: usage: run-quiet.sh <label> <remedy> -- <command> [args...]\n' >&2
  exit 2
fi

readonly LABEL="$1"
readonly REMEDY="$2"
shift 3

LOG="$(mktemp "${TMPDIR:-/tmp}/oneharness-ui-command.XXXXXX")"
readonly LOG
trap 'rm -f "$LOG"' EXIT

set +e
"$@" >"$LOG" 2>&1
status=$?
set -e

if [ "$status" -ne 0 ]; then
  cat "$LOG" >&2
  printf '%s: failed. %s\n' "$LABEL" "$REMEDY" >&2
  exit "$status"
fi

printf '%s: ok\n' "$LABEL"
