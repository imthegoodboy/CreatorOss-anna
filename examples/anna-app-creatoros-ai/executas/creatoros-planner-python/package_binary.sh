#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

EXECUTA_JSON="executa.json"
ENTRY_FILE="creatoros_planner_plugin.py"
OUT_DIR="dist-anna"

if [ ! -f "$EXECUTA_JSON" ]; then
  echo "ERROR: $EXECUTA_JSON not found" >&2
  exit 1
fi

if [ ! -f "$ENTRY_FILE" ]; then
  echo "ERROR: $ENTRY_FILE not found" >&2
  exit 1
fi

UV_BIN="${UV_BIN:-uv}"
if ! command -v "$UV_BIN" >/dev/null 2>&1; then
  if command -v uv.exe >/dev/null 2>&1; then
    UV_BIN="uv.exe"
  elif command -v uv.cmd >/dev/null 2>&1; then
    UV_BIN="uv.cmd"
  fi
fi

if ! command -v "$UV_BIN" >/dev/null 2>&1; then
  echo "ERROR: uv is required." >&2
  exit 1
fi

TOOL_ID="${TOOL_ID_OVERRIDE:-}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

if [ -z "$TOOL_ID" ]; then
  TOOL_ID="$("$PYTHON_BIN" - <<'PY'
import json
with open("executa.json", "r", encoding="utf-8") as f:
    print(json.load(f)["tool_id"])
PY
)"
fi

VERSION="$("$PYTHON_BIN" - <<'PY'
import json
with open("executa.json", "r", encoding="utf-8") as f:
    print(json.load(f).get("version") or "0.0.0")
PY
)"

DISPLAY_NAME="$("$PYTHON_BIN" - <<'PY'
import json
with open("executa.json", "r", encoding="utf-8") as f:
    data = json.load(f)
print(data.get("name") or data["tool_id"])
PY
)"

DESCRIPTION="$("$PYTHON_BIN" - <<'PY'
import json
with open("executa.json", "r", encoding="utf-8") as f:
    print(json.load(f).get("description") or "")
PY
)"

if [ -n "${PLATFORM:-}" ]; then
  TARGET_PLATFORM="$PLATFORM"
else
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$OS" in
    mingw*|msys*|cygwin*) OS="windows" ;;
  esac
  if [ "$OS" = "linux" ] && command -v cmd.exe >/dev/null 2>&1; then
    case "$(command -v "$UV_BIN" 2>/dev/null || true)" in
      *.exe|*.EXE) OS="windows" ;;
    esac
  fi
  case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    arm64|aarch64) ARCH="arm64" ;;
  esac
  TARGET_PLATFORM="$OS-$ARCH"
fi

case "$TARGET_PLATFORM" in
  darwin-arm64|darwin-x86_64|linux-x86_64|windows-x86_64|windows-arm64) ;;
  *)
    echo "ERROR: unsupported platform: $TARGET_PLATFORM" >&2
    echo "Supported: darwin-arm64, darwin-x86_64, linux-x86_64, windows-x86_64, windows-arm64" >&2
    exit 1
    ;;
esac

BINARY_EXT=""
case "$TARGET_PLATFORM" in
  windows-*) BINARY_EXT=".exe" ;;
esac

echo "Tool ID:  $TOOL_ID"
echo "Version:  $VERSION"
echo "Platform: $TARGET_PLATFORM"
echo

rm -rf build dist "$OUT_DIR/staging-$TARGET_PLATFORM"
mkdir -p "$OUT_DIR/staging-$TARGET_PLATFORM/bin"

"$UV_BIN" run --with pyinstaller "$PYTHON_BIN" -m PyInstaller \
  --onefile \
  --clean \
  --noupx \
  --name "$TOOL_ID" \
  "$ENTRY_FILE"

BINARY="dist/$TOOL_ID$BINARY_EXT"
if [ ! -f "$BINARY" ]; then
  echo "ERROR: PyInstaller did not produce $BINARY" >&2
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ]; then
  codesign --force --sign - "$BINARY" 2>/dev/null || true
fi

STAGE="$OUT_DIR/staging-$TARGET_PLATFORM"
ENTRYPOINT="bin/$TOOL_ID$BINARY_EXT"
cp "$BINARY" "$STAGE/$ENTRYPOINT"
chmod 0755 "$STAGE/$ENTRYPOINT"

"$PYTHON_BIN" - "$STAGE/manifest.json" "$TOOL_ID" "$VERSION" "$DISPLAY_NAME" "$DESCRIPTION" "$ENTRYPOINT" <<'PY'
import json
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
tool_id = sys.argv[2]
version = sys.argv[3]
display_name = sys.argv[4]
description = sys.argv[5]
entrypoint = sys.argv[6]

manifest = {
    "name": tool_id,
    "display_name": display_name,
    "version": version,
    "description": description,
    "runtime": {
        "binary": {
            "entrypoint": {"default": entrypoint},
            "permissions": {entrypoint: "0o755"},
        }
    },
}

manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY

ARCHIVE="$OUT_DIR/$TOOL_ID-$TARGET_PLATFORM.tar.gz"
(
  cd "$STAGE"
  tar czf "../$TOOL_ID-$TARGET_PLATFORM.tar.gz" .
)

if command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
else
  SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
fi

SIZE="$(wc -c < "$ARCHIVE" | tr -d ' ')"

echo
echo "Built archive:"
echo "  $ARCHIVE"
echo
echo "SHA-256:"
echo "  $SHA256"
echo
echo "Size:"
echo "  $SIZE bytes"
echo
echo "Archive layout:"
tar tzf "$ARCHIVE"
echo
echo "Binary distribution snippet:"
cat <<JSON
"$TARGET_PLATFORM": {
  "url": "https://github.com/<owner>/<repo>/releases/download/creatoros-planner-v$VERSION/$TOOL_ID-$TARGET_PLATFORM.tar.gz",
  "sha256": "$SHA256",
  "size": $SIZE,
  "entrypoint": "$ENTRYPOINT",
  "format": "tar.gz"
}
JSON
