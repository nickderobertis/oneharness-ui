#!/usr/bin/env bash
set -uo pipefail

readonly BIN_DIR="$HOME/.local/bin"
log() { printf 'session-setup: %s\n' "$*" >&2; }

if [ -n "${CI:-}" ]; then
  exit 0
fi

export PATH="${BIN_DIR}:${PATH}"
if ! command -v just >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install --upgrade "rust-just>=1.42.4" >/dev/null 2>&1 \
      || log "could not install just; run scripts/session-setup.sh again"
  else
    log "uv is required to provision just"
  fi
fi

for tool in bun cargo uv; do
  command -v "$tool" >/dev/null 2>&1 || log "$tool is missing; see README setup"
done

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) printf 'export PATH=%q\n' "${BIN_DIR}:${PATH}" >>"$CLAUDE_ENV_FILE" ;;
  esac
fi

if [ -x "$(dirname "$0")/setup-llmlint.sh" ]; then
  "$(dirname "$0")/setup-llmlint.sh" || log "llmlint setup reported an issue"
fi
exit 0
