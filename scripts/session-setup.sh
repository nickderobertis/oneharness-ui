#!/usr/bin/env bash
set -uo pipefail

readonly BIN_DIR="$HOME/.local/bin"
log() { printf 'session-setup: %s\n' "$*" >&2; }
status=0

safe_environment_file() {
  local candidate="$1"
  local parent
  local temporary_root
  [ "${#candidate}" -le 4096 ] && [[ "$candidate" = /* ]] && [ ! -L "$candidate" ] \
    || return 1
  parent="$(cd "$(dirname "$candidate")" 2>/dev/null && pwd -P)" || return 1
  temporary_root="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)" || return 1
  [[ "$parent" = "$temporary_root" || "$parent" = "$temporary_root/"* ]]
}

if [ -n "${CI:-}" ]; then
  exit 0
fi

export PATH="${BIN_DIR}:${PATH}"
if ! command -v just >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    provision_log="$(mktemp "${TMPDIR:-/tmp}/oneharness-ui-session.XXXXXX")"
    if ! uv tool install --upgrade "rust-just>=1.42.4" >"$provision_log" 2>&1; then
      cat "$provision_log" >&2
      log "could not install just; verify uv can reach its package index, then run just session-setup"
      status=1
    fi
    rm -f "$provision_log"
  else
    log "uv is required to provision just; install the pinned uv version from .tool-versions, then rerun this hook"
    status=1
  fi
fi

for tool in bun cargo uv; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    log "$tool is missing; install its pinned version from .tool-versions, then run just session-setup"
    status=1
  fi
done

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  safe_environment_file "$CLAUDE_ENV_FILE" \
    || { log "refusing CLAUDE_ENV_FILE outside the local temporary directory"; exit 1; }
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) printf 'export PATH=%q\n' "${BIN_DIR}:${PATH}" >>"$CLAUDE_ENV_FILE" ;;
  esac
fi

if [ -x "$(dirname "$0")/setup-llmlint.sh" ]; then
  if ! "$(dirname "$0")/setup-llmlint.sh"; then
    log "llmlint setup reported an issue; run just setup-llmlint and follow its remediation"
    status=1
  fi
fi
exit "$status"
