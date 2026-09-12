#!/usr/bin/env bash
# 打包 MarkDuo Windows 安装包 / 便携版。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT/scripts/build-editor.sh"

ICON_SRC="$ROOT/Equi/Supporting/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
if [[ ! -f "$ICON_SRC" ]]; then
  ICON_SRC="$ROOT/Equi/Supporting/AppIcon-1024.png"
fi
mkdir -p "$ROOT/equi-win/build"
ICON_ICO="$ROOT/equi-win/build/icon.ico"
ICON_PNG="$ROOT/equi-win/build/icon.png"

if [[ -f "$ICON_SRC" ]]; then
  cp -f "$ICON_SRC" "$ICON_PNG"
  if [[ -f "$ICON_ICO" ]]; then
    echo "已有 icon.ico，跳过重新生成"
  elif python3 -c "from PIL import Image" 2>/dev/null; then
    python3 - <<PY
from pathlib import Path
from PIL import Image
src = Path(r"""$ICON_SRC""")
out = Path(r"""$ICON_ICO""")
im = Image.open(src).convert("RGBA")
im.save(out, format="ICO", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print("wrote", out)
PY
  else
    echo "警告：未安装 Pillow，无法生成 .ico。可执行: pip3 install pillow"
    echo "将继续打包（若仓库已有 equi-win/build/icon.ico 则仍会使用它）。"
  fi
fi

cd "$ROOT/equi-win"
npm install
if [[ "${1:-}" == "--dir" ]]; then
  npx electron-builder --dir
else
  npx electron-builder --win
fi
echo "产物目录: $ROOT/equi-win/dist"
