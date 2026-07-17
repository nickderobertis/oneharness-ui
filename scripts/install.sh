#!/bin/sh
# Install a checksum-verified oneharness UI release without prompting.
#
# Latest release:
#   curl -fsSL https://raw.githubusercontent.com/nickderobertis/oneharness-ui/main/scripts/install.sh | sh
#
# Pinned release or destination (flags override environment variables):
#   curl -fsSL .../install.sh | sh -s -- --version v0.2.0 --to ~/.local/bin
#
# Environment: ONEHARNESS_UI_VERSION, ONEHARNESS_UI_INSTALL_DIR, GITHUB_TOKEN.

set -eu

REPO="nickderobertis/oneharness-ui"
PROGRAM="oneharness-ui"
RELEASE_BASE_URL="${ONEHARNESS_UI_RELEASE_BASE_URL:-}"

say() { printf '%s\n' "$*" >&2; }
err() { printf 'oneharness UI installer: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat >&2 <<EOF
Install a checksum-verified oneharness UI release.

Usage: install.sh [--version <tag>] [--to <dir>]

  --version <tag>  Release tag, for example v0.2.0 (default: latest).
  --to <dir>       Linux executable or macOS application directory.
  -h, --help       Show this help.

Environment: ONEHARNESS_UI_VERSION, ONEHARNESS_UI_INSTALL_DIR, GITHUB_TOKEN.
EOF
}

detect_platform() {
  os="$(uname -s)" || err "could not detect the operating system with uname"
  arch="$(uname -m)" || err "could not detect the architecture with uname"

  case "$os" in
    Linux) platform_os="linux" ;;
    Darwin) platform_os="macos" ;;
    MINGW* | MSYS* | CYGWIN* | Windows_NT) platform_os="windows" ;;
    *) err "unsupported operating system: $os; use a release asset from https://github.com/$REPO/releases" ;;
  esac

  case "$arch" in
    x86_64 | amd64) platform_arch="x86_64" ;;
    arm64 | aarch64) platform_arch="aarch64" ;;
    *) err "unsupported architecture: $arch; use a release asset from https://github.com/$REPO/releases" ;;
  esac

  case "${platform_os}-${platform_arch}" in
    linux-x86_64 | linux-aarch64 | macos-aarch64 | windows-x86_64) ;;
    *)
      err "no prebuilt installer for ${platform_os}-${platform_arch}; use a supported release asset from https://github.com/$REPO/releases"
      ;;
  esac

  platform="${platform_os}-${platform_arch}"
}

asset_name() {
  case "$platform_os" in
    linux) extension="AppImage" ;;
    macos) extension="dmg" ;;
    windows) extension="msi" ;;
    *) err "internal unsupported platform: $platform_os" ;;
  esac
  printf '%s-%s-%s.%s\n' "$PROGRAM" "$version" "$platform" "$extension"
}

api_get() {
  api_url="$1"
  if [ "$downloader" = "curl" ]; then
    if [ -n "${GITHUB_TOKEN:-}" ]; then
      curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "$api_url"
    else
      curl -fsSL "$api_url"
    fi
  elif [ -n "${GITHUB_TOKEN:-}" ]; then
    wget --header="Authorization: Bearer $GITHUB_TOKEN" -qO- "$api_url"
  else
    wget -qO- "$api_url"
  fi
}

download() {
  download_url="$1"
  download_output="$2"
  if [ "$downloader" = "curl" ]; then
    curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 -o "$download_output" "$download_url"
  else
    wget -qO "$download_output" "$download_url"
  fi
}

latest_tag() {
  release_json="$(api_get "https://api.github.com/repos/$REPO/releases/latest")" \
    || err "could not query the latest release; set GITHUB_TOKEN if GitHub rate-limited the request"
  release_tag="$(printf '%s\n' "$release_json" \
    | sed -nE 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/p' \
    | head -n 1)"
  [ -n "$release_tag" ] \
    || err "could not parse the latest release tag from the GitHub API response"
  printf '%s\n' "$release_tag"
}

validate_version() {
  printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' \
    || err "invalid release version: $version; use a v-prefixed semantic version such as v0.2.0"
}

sha256_of() {
  checksum_target="$1"
  if have sha256sum; then
    sha256sum "$checksum_target" | awk '{print $1}'
  elif have shasum; then
    shasum -a 256 "$checksum_target" | awk '{print $1}'
  elif have openssl; then
    openssl dgst -sha256 "$checksum_target" | awk '{print $NF}'
  else
    err "no SHA-256 tool found; install sha256sum, shasum, or openssl and retry"
  fi
}

install_linux() {
  [ -n "$install_dir" ] || install_dir="${HOME:-}/.local/bin"
  [ -n "$install_dir" ] || err "HOME is unset; pass --to with an install directory"
  mkdir -p "$install_dir" || err "could not create install directory: $install_dir"
  destination="${install_dir}/${PROGRAM}"
  if have install; then
    install -m 0755 "$archive_path" "$destination" \
      || err "could not install the AppImage to $destination"
  else
    if ! cp "$archive_path" "$destination" || ! chmod 0755 "$destination"; then
      err "could not install the AppImage to $destination"
    fi
  fi
  say "installed oneharness UI $version to $destination"
  case ":${PATH}:" in
    *":${install_dir}:"*) ;;
    *) say "NOTE: add ${install_dir} to PATH to launch with '${PROGRAM}'." ;;
  esac
}

install_macos() {
  [ -n "$install_dir" ] || install_dir="${HOME:-}/Applications"
  [ -n "$install_dir" ] || err "HOME is unset; pass --to with an application directory"
  mount_path="${temporary}/mount"
  mkdir -p "$mount_path" || err "could not prepare the temporary DMG mount"
  hdiutil attach "$archive_path" -nobrowse -readonly -mountpoint "$mount_path" >/dev/null \
    || err "could not mount $asset"
  mounted="1"
  source_app="${mount_path}/oneharness.app"
  [ -d "$source_app" ] || err "oneharness.app was not present in $asset"
  mkdir -p "$install_dir" || err "could not create application directory: $install_dir"
  destination="${install_dir}/oneharness.app"
  ditto "$source_app" "$destination" || err "could not install oneharness.app to $install_dir"
  hdiutil detach "$mount_path" >/dev/null || err "could not detach the temporary DMG mount"
  mounted=""
  say "installed oneharness UI $version to $destination"
}

install_windows() {
  [ -z "$install_dir" ] \
    || err "--to is not supported on Windows; the MSI selects its noninteractive install location"
  have msiexec.exe || err "msiexec.exe is required to install the Windows MSI"
  windows_archive="$archive_path"
  if have cygpath; then
    windows_archive="$(cygpath -w "$archive_path")" \
      || err "could not translate the MSI path for Windows"
  fi
  MSYS2_ARG_CONV_EXCL='*' msiexec.exe /i "$windows_archive" /qn /norestart \
    || err "Windows Installer failed for $asset; rerun from an elevated Git Bash or install the MSI manually"
  say "installed oneharness UI $version with Windows Installer"
}

cleanup() {
  if [ -n "${mounted:-}" ] && [ -n "${mount_path:-}" ]; then
    hdiutil detach "$mount_path" >/dev/null 2>&1 || true
  fi
  if [ -n "${temporary:-}" ]; then
    rm -rf "$temporary"
  fi
}

main() {
  version="${ONEHARNESS_UI_VERSION:-}"
  install_dir="${ONEHARNESS_UI_INSTALL_DIR:-}"
  print_asset=""

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        [ "$#" -ge 2 ] || err "--version needs a value"
        version="$2"
        shift 2
        ;;
      --version=*) version="${1#*=}"; shift ;;
      --to | --bin-dir)
        [ "$#" -ge 2 ] || err "$1 needs a value"
        install_dir="$2"
        shift 2
        ;;
      --to=* | --bin-dir=*) install_dir="${1#*=}"; shift ;;
      --print-asset) print_asset="1"; shift ;;
      -h | --help) usage; exit 0 ;;
      *) err "unknown option: $1; run with --help for usage" ;;
    esac
  done

  detect_platform

  if [ -z "$version" ]; then
    if [ -n "$print_asset" ]; then
      err "--print-asset requires --version"
    fi
    if have curl; then
      downloader="curl"
    elif have wget; then
      downloader="wget"
    else
      err "curl or wget is required to resolve the latest release"
    fi
    say "resolving the latest oneharness UI release..."
    version="$(latest_tag)"
  fi
  validate_version
  asset="$(asset_name)"

  if [ -n "$print_asset" ]; then
    printf '%s\n' "$asset"
    return
  fi

  if have curl; then
    downloader="curl"
  elif have wget; then
    downloader="wget"
  else
    err "curl or wget is required to download the release"
  fi

  [ -n "$RELEASE_BASE_URL" ] \
    || RELEASE_BASE_URL="https://github.com/$REPO/releases/download/${version}"
  temporary="$(mktemp -d 2>/dev/null || mktemp -d -t oneharness-ui)" \
    || err "could not create a temporary directory"
  mounted=""
  trap cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  archive_path="${temporary}/${asset}"
  checksum_path="${archive_path}.sha256"
  say "downloading $asset ($version)..."
  download "${RELEASE_BASE_URL}/${asset}" "$archive_path" \
    || err "download failed: ${RELEASE_BASE_URL}/${asset}"
  download "${RELEASE_BASE_URL}/${asset}.sha256" "$checksum_path" \
    || err "checksum download failed: ${RELEASE_BASE_URL}/${asset}.sha256"

  say "verifying the SHA-256 checksum..."
  expected="$(awk -v name="$asset" '$2 == name { print $1; exit }' "$checksum_path")"
  case "$expected" in
    '' | *[!0-9A-Fa-f]*) err "invalid checksum file for $asset" ;;
  esac
  [ "${#expected}" -eq 64 ] || err "invalid checksum file for $asset"
  actual="$(sha256_of "$archive_path")"
  [ "$expected" = "$actual" ] \
    || err "checksum mismatch for $asset (expected $expected, got $actual); refusing to install"

  case "$platform_os" in
    linux) install_linux ;;
    macos) install_macos ;;
    windows) install_windows ;;
    *) err "internal unsupported platform: $platform_os" ;;
  esac
}

main "$@"
