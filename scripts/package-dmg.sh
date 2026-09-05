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
PROJECT_FILE="Equi.xcodeproj"
SPEC_FILE="project.yml"
CONFIGURATION="${CONFIGURATION:-Release}"
DIST_DIR="${DIST_DIR:-${ROOT}/dist}"
DERIVED="${DERIVED:-${ROOT}/build/DerivedData}"
SKIP_EDITOR=0

for arg in "$@"; do
  case "${arg}" in
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

if [[ "${SKIP_EDITOR}" -eq 0 ]]; then
  if command -v npm >/dev/null; then
    echo "==> 构建 Web 编辑器 Bundle"
    "${ROOT}/scripts/build-editor.sh"
  else
    echo "警告：未找到 npm，使用已有 Equi/Resources/Editor"
  fi
fi

ensure_xcodeproj() {
  if [[ ! -f "${SPEC_FILE}" ]]; then
    echo "错误：找不到 ${SPEC_FILE}，无法生成 Xcode 工程。"
    exit 1
  fi

  if ! command -v xcodegen >/dev/null; then
    if [[ -d "${PROJECT_FILE}" ]]; then
      echo "警告：未安装 xcodegen，使用已有 ${PROJECT_FILE}"
      return 0
    fi
    cat <<EOF
错误：未找到 ${PROJECT_FILE}，且本机没有 xcodegen。

请先安装并生成工程：
  brew install xcodegen
  xcodegen generate --spec ${SPEC_FILE}

然后再运行：
  ./scripts/package-dmg.sh
EOF
    exit 1
  fi

  echo "==> 生成 / 刷新 Xcode 工程 (${SPEC_FILE} → ${PROJECT_FILE})"
  xcodegen generate --spec "${SPEC_FILE}"

  if [[ ! -d "${PROJECT_FILE}" ]]; then
    echo "错误：xcodegen 已执行，但仍未生成 ${PROJECT_FILE}"
    exit 1
  fi
}

ensure_xcodeproj

mkdir -p "${DIST_DIR}" "${DERIVED}"
STAGE="${DIST_DIR}/dmg-stage"
rm -rf "${STAGE}"
mkdir -p "${STAGE}"

ENTITLEMENTS="${ROOT}/Equi/Supporting/Equi.entitlements"
# 本地打包默认：构建阶段关闭签名（避免沙盒 + Hardened Runtime 与 "-" 冲突），
# 构建完成后再用 ad-hoc（codesign -s -）签名。
# 若已配置 Apple 开发者 Team，可：DEVELOPMENT_TEAM=XXXXXXXX ./scripts/package-dmg.sh
SIGN_ARGS=(
  ENABLE_HARDENED_RUNTIME=NO
  OTHER_CODE_SIGN_FLAGS=--timestamp=none
)
if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  echo "==> 使用 Development Team: ${DEVELOPMENT_TEAM}"
  SIGN_ARGS+=(
    CODE_SIGN_STYLE=Automatic
    DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM}"
    CODE_SIGN_IDENTITY="Apple Development"
    CODE_SIGNING_ALLOWED=YES
    CODE_SIGNING_REQUIRED=YES
  )
else
  echo "==> 本地 ad-hoc 签名模式（无 DEVELOPMENT_TEAM）"
  SIGN_ARGS+=(
    CODE_SIGN_STYLE=Manual
    CODE_SIGN_IDENTITY=-
    CODE_SIGNING_ALLOWED=NO
    CODE_SIGNING_REQUIRED=NO
    EXPANDED_CODE_SIGN_IDENTITY=-
    EXPANDED_CODE_SIGN_IDENTITY_NAME=-
  )
fi

echo "==> xcodebuild (${CONFIGURATION})"
set +e
xcodebuild \
  -project "${PROJECT_FILE}" \
  -scheme "${SCHEME}" \
  -configuration "${CONFIGURATION}" \
  -derivedDataPath "${DERIVED}" \
  -destination "platform=macOS" \
  "${SIGN_ARGS[@]}" \
  build 2>&1 | tee "${DIST_DIR}/xcodebuild.log"
XCODE_STATUS=${PIPESTATUS[0]}
set -e

if [[ "${XCODE_STATUS}" -ne 0 ]]; then
  echo ""
  echo "xcodebuild 失败。末尾日志："
  tail -n 40 "${DIST_DIR}/xcodebuild.log" || true
  echo ""
  echo "若仍是 CodeSign 错误，可尝试："
  echo "  1) 打开 Xcode → Settings → Accounts 登录 Apple ID"
  echo "  2) DEVELOPMENT_TEAM=你的TeamID ./scripts/package-dmg.sh"
  echo "  3) 查看完整日志：${DIST_DIR}/xcodebuild.log"
  exit "${XCODE_STATUS}"
fi

VERSION="$(xcodebuild -project "${PROJECT_FILE}" -scheme "${SCHEME}" -configuration "${CONFIGURATION}" -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/MARKETING_VERSION/ { print $2; exit }')"
VERSION="${VERSION:-1.0.0}"
BUILD_NUMBER="$(xcodebuild -project "${PROJECT_FILE}" -scheme "${SCHEME}" -configuration "${CONFIGURATION}" -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/CURRENT_PROJECT_VERSION/ { print $2; exit }')"
BUILD_NUMBER="${BUILD_NUMBER:-1}"

APP_SRC="$(find "${DERIVED}/Build/Products/${CONFIGURATION}" -maxdepth 1 -name "${APP_NAME}.app" -type d | head -n1 || true)"
if [[ -z "${APP_SRC}" || ! -d "${APP_SRC}" ]]; then
  echo "错误：未找到 ${APP_NAME}.app（DerivedData: ${DERIVED}）"
  exit 1
fi

echo "==> 版本 ${VERSION} (${BUILD_NUMBER})"
echo "==> App: ${APP_SRC}"

# 清理扩展属性后做 ad-hoc 签名（无 Team 时必须；有 Team 时加固一次也无妨）
echo "==> codesign (ad-hoc)"
xattr -cr "${APP_SRC}" || true
if [[ -f "${ENTITLEMENTS}" ]]; then
  codesign --force --deep --sign - --entitlements "${ENTITLEMENTS}" "${APP_SRC}"
else
  codesign --force --deep --sign - "${APP_SRC}"
fi
codesign --verify --verbose=2 "${APP_SRC}" || true

cp -R "${APP_SRC}" "${STAGE}/${APP_NAME}.app"
ln -sf /Applications "${STAGE}/Applications"

DMG_NAME="${APP_NAME}-${VERSION}.dmg"
OUT_DMG="${DIST_DIR}/${DMG_NAME}"
TMP_DMG="${DIST_DIR}/.${APP_NAME}-tmp.dmg"
rm -f "${OUT_DMG}" "${TMP_DMG}"

VOL_NAME="Equi ${VERSION}"
SIZE_MB="$(du -sm "${STAGE}" | awk '{ print int($1) + 20 }')"

echo "==> 创建可读写 DMG（${SIZE_MB}MB）"
hdiutil create \
  -volname "${VOL_NAME}" \
  -srcfolder "${STAGE}" \
  -ov \
  -format UDRW \
  -size "${SIZE_MB}m" \
  "${TMP_DMG}"

ATTACH_OUT="$(hdiutil attach -readwrite -noverify -noautoopen "${TMP_DMG}")"
DEVICE="$(echo "${ATTACH_OUT}" | awk 'NR==1 { print $1 }')"
MOUNT_POINT="$(echo "${ATTACH_OUT}" | awk '/\/Volumes\// { print $3; exit }')"

if [[ -n "${MOUNT_POINT:-}" && -d "${MOUNT_POINT}" ]] && command -v osascript >/dev/null; then
  echo "==> 配置 Finder 图标布局：${MOUNT_POINT}"
  osascript <<APPLESCRIPT || true
tell application "Finder"
  tell disk "${VOL_NAME}"
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
  hdiutil detach "${DEVICE}" -quiet || true
fi
if [[ -n "${MOUNT_POINT:-}" ]]; then
  hdiutil detach "${MOUNT_POINT}" -force -quiet || true
fi

echo "==> 压缩 → ${OUT_DMG}"
hdiutil convert "${TMP_DMG}" -format UDZO -imagekey zlib-level=9 -o "${OUT_DMG}"
rm -f "${TMP_DMG}"
rm -rf "${STAGE}"

rm -rf "${DIST_DIR}/${APP_NAME}.app"
cp -R "${APP_SRC}" "${DIST_DIR}/${APP_NAME}.app"

file "${OUT_DMG}"
ls -lh "${OUT_DMG}" "${DIST_DIR}/${APP_NAME}.app"

cat <<EOF

✓ Equi 打包完成
  DMG : ${OUT_DMG}
  App : ${DIST_DIR}/${APP_NAME}.app
  版本: ${VERSION} (${BUILD_NUMBER})

安装：打开 DMG，将 Equi.app 拖到 Applications。
EOF
