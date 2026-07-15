#!/usr/bin/env bash
set -uo pipefail

readonly LLMLINT_MIN="0.3.17"
readonly BIN_DIR="$HOME/.local/bin"
log() { printf 'setup-llmlint: %s\n' "$*" >&2; }

export PATH="${BIN_DIR}:${PATH}"
if ! command -v uv >/dev/null 2>&1; then
  log "uv not found; install it from https://docs.astral.sh/uv/"
  exit 0
fi
uv tool install --upgrade "llmlint-cli>=$LLMLINT_MIN" >/dev/null 2>&1 \
  || log "llmlint installation failed; retry with just setup-llmlint"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) printf 'export PATH=%q\n' "${BIN_DIR}:${PATH}" >>"$CLAUDE_ENV_FILE" ;;
  esac
fi
if command -v llmlint >/dev/null 2>&1; then
  llmlint doctor >/dev/null 2>&1 || log "llmlint doctor failed; authenticate a configured harness"
else
  log "llmlint is unavailable after installation"
fi
exit 0
