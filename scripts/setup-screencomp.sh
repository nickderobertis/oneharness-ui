#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT
versions_file="$ROOT/scripts/visual-docs-versions.env"
readonly versions_file
SCREENCOMP_VERSION="$(sed -n 's/^SCREENCOMP_VERSION=//p' "$versions_file")"
[[ "$SCREENCOMP_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "screencomp setup: invalid pinned version; correct scripts/visual-docs-versions.env" >&2; exit 2; }
readonly SCREENCOMP_VERSION
[[ -n "${HOME:-}" && "$HOME" = /* && "${#HOME}" -le 4096 ]] \
  || { echo "screencomp setup: HOME must be an absolute path of reasonable length" >&2; exit 2; }
readonly INSTALL_DIR="$HOME/.local/bin"
readonly INSTALLER_SHA256="dd4e02daf93c3f056b84b0555c03c60b8e8bfb29ecb462e7dfa4b84fd84202b4"
temporary_root="${TMPDIR:-/tmp}"
[[ "$temporary_root" = /* && "${#temporary_root}" -le 4096 && -d "$temporary_root" && ! -L "$temporary_root" ]] \
  || { echo "screencomp setup: TMPDIR must be an absolute, existing non-symlink directory" >&2; exit 2; }
readonly temporary_root
installer="$(mktemp "$temporary_root/screencomp-install.XXXXXX")"
readonly installer
trap 'rm -f "$installer"' EXIT

curl -fsSL "https://raw.githubusercontent.com/nickderobertis/screencomp/${SCREENCOMP_VERSION}/scripts/install.sh" \
  -o "$installer" \
  || { echo "screencomp setup: installer download failed; verify GitHub access and retry" >&2; exit 1; }
if ! actual_sha256="$(bun -e 'const file = Bun.file(process.argv[1]); console.log(new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex"))' "$installer")"; then
  echo "screencomp setup: checksum calculation failed; restore the pinned Bun installation and retry" >&2
  exit 1
fi
[ "$actual_sha256" = "$INSTALLER_SHA256" ] \
  || { echo "screencomp setup: installer checksum mismatch; do not execute the download" >&2; exit 1; }
sh "$installer" --version "$SCREENCOMP_VERSION" --to "$INSTALL_DIR" >/dev/null \
  || { echo "screencomp setup: verified installer failed; inspect the release assets and retry" >&2; exit 1; }
