#!/usr/bin/env bash
# 在 macOS 本机一键：构建 Equi.app → 打包 Equi-<version>.dmg
# 用法：
#   ./scripts/package-dmg.sh
#   ./scripts/package-dmg.sh --skip-editor
#   CONFIGURATION=Debug ./scripts/package-dmg.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="Equi"
SCHEME="Equi"
PROJECT="Equi.xcodeproj"
CONFIGURATION="${CONFIGURATION:-Release}"
DIST_DIR="${DIST_DIR:-$ROOT/dist}"
DERIVED="${DERIVED:-$ROOT/build/DerivedData}"
SKIP_EDITOR=0

for arg in "$@"; do
  case "$arg" in
    --skip-editor) SKIP_EDITOR=1 ;;
    -h|--help)
      sed -n '2,7p' "$0"
      exit 0
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  cat <<EOF
错误：DMG 打包必须在 macOS 上运行（需要 xcodebuild / hdiutil）。
当前系统：$(uname -s)

请在本机 Mac 执行：
  brew install xcodegen
  ./scripts/package-dmg.sh

或在 GitHub → Actions →「Package Equi DMG」手动运行。
EOF
  exit 1
fi

command -v xcodebuild >/dev/null || { echo "需要 Xcode / Command Line Tools"; exit 1; }
command -v hdiutil >/dev/null || { echo "需要 hdiutil"; exit 1; }

if [[ "$SKIP_EDITOR" -eq 0 ]]; then
  if command -v npm >/dev/null; then
    echo "==> 构建 Web 编辑器 Bundle"
    "$ROOT/scripts/build-editor.sh"
  else
    echo "警告：未找到 npm，使用已有 Equi/Resources/Editor"
  fi
fi

if [[ ! -d "$PROJECT" ]]; then
  if command -v xcodegen >/dev/null; then
    echo "==> xcodegen generate"
    xcodegen generate
  else
    echo "错误：缺少 $PROJECT。请安装：brew install xcodegen && xcodegen generate"
    exit 1
  fi
fi

mkdir -p "$DIST_DIR" "$DERIVED"
STAGE="$DIST_DIR/dmg-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "==> xcodebuild (${CONFIGURATION})"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -derivedDataPath "$DERIVED" \
  -destination "platform=macOS" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_ALLOWED=YES \
  CODE_SIGNING_REQUIRED=NO \
  build

VERSION="$(xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration "$CONFIGURATION" -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/MARKETING_VERSION/{print $2; exit}')"
VERSION="${VERSION:-1.0.0}"
BUILD_NUMBER="$(xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration "$CONFIGURATION" -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/CURRENT_PROJECT_VERSION/{print $2; exit}')"
BUILD_NUMBER="${BUILD_NUMBER:-1}"

APP_SRC="$(find "$DERIVED/Build/Products/${CONFIGURATION}" -maxdepth 1 -name "${APP_NAME}.app" -type d | head -n1)"
if [[ -z "$APP_SRC" || ! -d "$APP_SRC" ]]; then
  echo "错误：未找到 ${APP_NAME}.app（DerivedData: $DERIVED）"
  exit 1
fi

echo "==> 版本 ${VERSION} (${BUILD_NUMBER})"
echo "==> App: $APP_SRC"

cp -R "$APP_SRC" "$STAGE/${APP_NAME}.app"
ln -sf /Applications "$STAGE/Applications"

DMG_NAME="${APP_NAME}-${VERSION}.dmg"
OUT_DMG="$DIST_DIR/$DMG_NAME"
TMP_DMG="$DIST_DIR/.${APP_NAME}-tmp.dmg"
rm -f "$OUT_DMG" "$TMP_DMG"

VOL_NAME="Equi ${VERSION}"
SIZE_MB="$(du -sm "$STAGE" | awk '{print int($1)+20}')"

echo "==> 创建可读写 DMG（${SIZE_MB}MB）"
hdiutil create \
  -volname "$VOL_NAME" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDRW \
  -size "${SIZE_MB}m" \
  "$TMP_DMG"

ATTACH_OUT="$(hdiutil attach -readwrite -noverify -noautoopen "$TMP_DMG")"
DEVICE="$(echo "$ATTACH_OUT" | awk 'NR==1{print $1}')"
MOUNT_POINT="$(echo "$ATTACH_OUT" | awk '/\/Volumes\//{print $3; exit}')"

if [[ -n "${MOUNT_POINT:-}" && -d "$MOUNT_POINT" ]] && command -v osascript >/dev/null; then
  echo "==> 配置 Finder 图标布局：$MOUNT_POINT"
  osascript <<APPLESCRIPT || true
tell application "Finder"
  tell disk "$VOL_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, 760, 480}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set position of item "${APP_NAME}.app" of container window to {140, 180}
    set position of item "Applications" of container window to {420, 180}
    update without registering applications
    delay 1
    close
  end tell
end tell
APPLESCRIPT
  sync
fi

if [[ -n "${DEVICE:-}" ]]; then
  hdiutil detach "$DEVICE" -quiet || true
fi
if [[ -n "${MOUNT_POINT:-}" ]]; then
  hdiutil detach "$MOUNT_POINT" -force -quiet || true
fi

echo "==> 压缩 → $OUT_DMG"
hdiutil convert "$TMP_DMG" -format UDZO -imagekey zlib-level=9 -o "$OUT_DMG"
rm -f "$TMP_DMG"
rm -rf "$STAGE"

rm -rf "$DIST_DIR/${APP_NAME}.app"
cp -R "$APP_SRC" "$DIST_DIR/${APP_NAME}.app"

file "$OUT_DMG"
ls -lh "$OUT_DMG" "$DIST_DIR/${APP_NAME}.app"

cat <<EOF

✓ Equi 打包完成
  DMG : $OUT_DMG
  App : $DIST_DIR/${APP_NAME}.app
  版本: $VERSION ($BUILD_NUMBER)

安装：打开 DMG，将 Equi.app 拖到 Applications。
EOF
