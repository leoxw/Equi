#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web-editor"
npm install
npm run build
echo "Editor bundle → Equi/Resources/Editor"
