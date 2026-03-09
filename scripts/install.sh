#!/usr/bin/env bash

set -euo pipefail

OTTO_REPO="${OTTO_REPO:-foglerek/otto}"
OTTO_INSTALL_DIR="${OTTO_INSTALL_DIR:-$HOME/.local/bin}"

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is not installed."
}

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    darwin)
      case "$arch" in
        arm64) echo "otto-darwin-arm64" ;;
        x86_64) echo "otto-darwin-x64" ;;
        *) fail "Unsupported macOS architecture: $arch" ;;
      esac
      ;;
    linux)
      case "$arch" in
        x86_64) echo "otto-linux-x64" ;;
        *) fail "Unsupported Linux architecture: $arch" ;;
      esac
      ;;
    *)
      fail "Unsupported operating system: $os"
      ;;
  esac
}

resolve_tag() {
  if [ -n "${OTTO_VERSION:-}" ]; then
    case "$OTTO_VERSION" in
      v*) printf '%s\n' "$OTTO_VERSION" ;;
      *) printf 'v%s\n' "$OTTO_VERSION" ;;
    esac
    return
  fi

  local latest_json tag
  latest_json="$(curl -fsSL "https://api.github.com/repos/${OTTO_REPO}/releases/latest")"
  tag="$(printf '%s\n' "$latest_json" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$tag" ] || fail "Failed to resolve latest release tag for ${OTTO_REPO}."
  printf '%s\n' "$tag"
}

main() {
  require_command curl
  require_command uname
  require_command chmod

  local asset tag url tmp target
  asset="$(detect_platform)"
  tag="$(resolve_tag)"
  url="https://github.com/${OTTO_REPO}/releases/download/${tag}/${asset}"

  mkdir -p "$OTTO_INSTALL_DIR"
  tmp="$(mktemp)"
  target="${OTTO_INSTALL_DIR}/otto"

  trap 'rm -f "$tmp"' EXIT

  log "Downloading ${asset} from ${url}"
  curl -fsSL "$url" -o "$tmp"
  chmod +x "$tmp"
  mv "$tmp" "$target"

  log "Installed otto to ${target}"
  case ":$PATH:" in
    *":${OTTO_INSTALL_DIR}:"*) ;;
    *) log "Note: ${OTTO_INSTALL_DIR} is not on PATH." ;;
  esac
  log "Run 'otto --version' to verify the installation."
}

main "$@"
