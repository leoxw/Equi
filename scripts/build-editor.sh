#!/usr/bin/env bash
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
