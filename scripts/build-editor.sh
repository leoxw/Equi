#!/usr/bin/env bash
# 构建 web-editor，并同步到 macOS Bundle 与 Windows Electron 资源目录。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web-editor"
npm install
npm run build

INDEX="$ROOT/Equi/Resources/Editor/index.html"
FLAT="$ROOT/Equi/Resources/EquiEditor.html"
if [[ ! -f "$INDEX" ]]; then
  echo "错误：未生成 $INDEX"
  exit 1
fi
cp -f "$INDEX" "$FLAT"

WIN_RES="$ROOT/equi-win/resources"
mkdir -p "$WIN_RES/Editor"
cp -f "$INDEX" "$WIN_RES/EquiEditor.html"
cp -f "$INDEX" "$WIN_RES/Editor/index.html"
if [[ -d "$ROOT/Equi/Resources/Editor/assets" ]]; then
  rm -rf "$WIN_RES/Editor/assets"
  cp -R "$ROOT/Equi/Resources/Editor/assets" "$WIN_RES/Editor/assets"
fi

echo "Editor → Equi/Resources (+ EquiEditor.html $(wc -c < "$FLAT") bytes)"
echo "Editor → equi-win/resources/EquiEditor.html"
