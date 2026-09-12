#!/usr/bin/env bash
# 构建 web-editor，并同步到 macOS Bundle 与（若存在）Windows Electron 资源目录。
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
# 扁平副本：作为 Bundle 根级普通文件资源，沙盒下比 folder reference 更稳
cp -f "$INDEX" "$FLAT"
echo "Editor bundle → Equi/Resources/Editor (+ EquiEditor.html $(wc -c < "$FLAT") bytes)"

WIN_RES="$ROOT/equi-win/resources"
if [[ -d "$ROOT/equi-win" ]]; then
  mkdir -p "$WIN_RES/Editor"
  cp -f "$INDEX" "$WIN_RES/EquiEditor.html"
  cp -f "$INDEX" "$WIN_RES/Editor/index.html"
  if [[ -d "$ROOT/Equi/Resources/Editor/assets" ]]; then
    rm -rf "$WIN_RES/Editor/assets"
    cp -R "$ROOT/Equi/Resources/Editor/assets" "$WIN_RES/Editor/assets"
  fi
  echo "Editor → equi-win/resources/EquiEditor.html"
fi
