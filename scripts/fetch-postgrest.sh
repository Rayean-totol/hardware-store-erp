#!/usr/bin/env bash
# Download a pinned PostgREST release into .tools/ for the API test suite (pnpm test:api).
# PostgREST does not publish checksum files; the SHA-256 below was recorded when this script
# was written (trust on first use). If you update the version, record the new digest after
# verifying the download through an independent channel.
set -euo pipefail
VERSION="v12.2.3"
ASSET="postgrest-${VERSION}-linux-static-x64.tar.xz"
SHA256="9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.tools"

if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
  echo "This script only fetches the linux x86_64 build. Install PostgREST ${VERSION} manually and set POSTGREST_BIN." >&2
  exit 1
fi

mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/$ASSET" "https://github.com/PostgREST/postgrest/releases/download/${VERSION}/${ASSET}"
echo "${SHA256}  $TMP/$ASSET" | sha256sum -c -
tar -xJf "$TMP/$ASSET" -C "$DEST"
chmod +x "$DEST/postgrest"
"$DEST/postgrest" --version
