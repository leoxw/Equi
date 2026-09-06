#!/usr/bin/env bash
# 打包 Equi Windows 安装包 / 便携版。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT/scripts/build-editor.sh"

ICON_SRC="$ROOT/Equi/Supporting/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
if [[ ! -f "$ICON_SRC" ]]; then
  ICON_SRC="$ROOT/Equi/Supporting/AppIcon-1024.png"
fi
mkdir -p "$ROOT/equi-win/build"
if [[ -f "$ICON_SRC" ]]; then
  python3 - <<PY
from pathlib import Path
from PIL import Image
src = Path(r"""$ICON_SRC""")
out = Path(r"""$ROOT/equi-win/build/icon.ico""")
im = Image.open(src).convert("RGBA")
im.save(out, format="ICO", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
Path(r"""$ROOT/equi-win/build/icon.png""").write_bytes(src.read_bytes())
print("wrote", out)
PY
fi

cd "$ROOT/equi-win"
npm install
if [[ "${1:-}" == "--dir" ]]; then
  npx electron-builder --dir
else
  npx electron-builder --win
fi
echo "产物目录: $ROOT/equi-win/dist"
