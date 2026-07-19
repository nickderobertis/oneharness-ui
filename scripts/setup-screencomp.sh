#!/usr/bin/env bash
set -euo pipefail

readonly VERSION="v0.4.2"
readonly INSTALL_DIR="$HOME/.local/bin"
installer="$(mktemp "${TMPDIR:-/tmp}/screencomp-install.XXXXXX")"
readonly installer
trap 'rm -f "$installer"' EXIT

curl -fsSL https://raw.githubusercontent.com/nickderobertis/screencomp/v0.4.2/scripts/install.sh \
  -o "$installer"
sh "$installer" --version "$VERSION" --to "$INSTALL_DIR"
