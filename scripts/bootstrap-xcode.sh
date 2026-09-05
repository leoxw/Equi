#!/usr/bin/env bash
# 重新生成 Xcode 工程 + 共享 Scheme，并打开项目
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v xcodegen >/dev/null; then
  echo "正在安装 xcodegen…"
  brew install xcodegen
fi

echo "==> 构建 Web Editor Bundle"
"$ROOT/scripts/build-editor.sh"

echo "==> xcodegen generate（含 Shared Scheme: Equi）"
rm -rf Equi.xcodeproj
xcodegen generate --spec project.yml

SCHEME_FILE="Equi.xcodeproj/xcshareddata/xcschemes/Equi.xcscheme"
if [[ ! -f "$SCHEME_FILE" ]]; then
  echo "错误：未生成共享 Scheme：$SCHEME_FILE"
  exit 1
fi

echo "==> 已生成 Scheme："
ls -la Equi.xcodeproj/xcshareddata/xcschemes/

echo "==> 打开 Xcode"
open Equi.xcodeproj

cat <<'EOF'

下一步：
1. Xcode 左上角 Scheme 选择器选中「Equi」
2. Product → Clean Build Folder（⇧⌘K）
3. Product → Run（⌘R）

若 Scheme 仍为空：Manage Schemes… → 勾选 Equi 的 Shared。
EOF
