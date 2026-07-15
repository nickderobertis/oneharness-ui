#!/usr/bin/env bash
set -uo pipefail

readonly LLMLINT_MIN="0.3.17"
readonly BIN_DIR="$HOME/.local/bin"
log() { printf 'setup-llmlint: %s\n' "$*" >&2; }

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

export PATH="${BIN_DIR}:${PATH}"
if ! command -v uv >/dev/null 2>&1; then
  log "uv not found; install the version pinned in .tool-versions, then rerun just setup-llmlint"
  exit 1
fi
provision_log="$(mktemp "${TMPDIR:-/tmp}/oneharness-ui-llmlint.XXXXXX")"
if ! uv tool install --upgrade "llmlint-cli>=$LLMLINT_MIN" >"$provision_log" 2>&1; then
  cat "$provision_log" >&2
  rm -f "$provision_log"
  log "llmlint installation failed; verify package-index access, then rerun just setup-llmlint"
  exit 1
fi
rm -f "$provision_log"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  safe_environment_file "$CLAUDE_ENV_FILE" \
    || { log "refusing CLAUDE_ENV_FILE outside the local temporary directory"; exit 1; }
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) printf 'export PATH=%q\n' "${BIN_DIR}:${PATH}" >>"$CLAUDE_ENV_FILE" ;;
  esac
fi
if command -v llmlint >/dev/null 2>&1; then
  llmlint doctor >/dev/null 2>&1 \
    || log "llmlint doctor failed; authenticate the configured harness, then run llmlint doctor"
else
  log "llmlint is unavailable after installation; add $BIN_DIR to PATH, then rerun just setup-llmlint"
  exit 1
fi
exit 0
