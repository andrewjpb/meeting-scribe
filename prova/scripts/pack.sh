#!/usr/bin/env bash
# Empacota a prova em dist/ e assina ad-hoc com os entitlements (sem sandbox).
# Uso: npm run pack  (rodar de dentro de prova/)
set -euo pipefail
cd "$(dirname "$0")/.."

NOME=MeetingScribeProva
ARCH=$(uname -m)   # arm64 no M5

npx electron-packager . "$NOME" \
  --platform=darwin \
  --arch="$ARCH" \
  --out=dist \
  --overwrite \
  --app-bundle-id=com.lap.meetingscribe.prova \
  --extend-info=extendInfo.plist \
  --ignore='^/(out|dist|scripts)($|/)'

APP="dist/$NOME-darwin-$ARCH/$NOME.app"
codesign --force --deep --sign - --entitlements entitlements.plist "$APP"

# Conferência: assinatura válida, entitlements e chaves de privacidade no Info.plist.
codesign --verify --deep --strict "$APP" && echo "assinatura ok"
codesign -d --entitlements - "$APP" 2>/dev/null
plutil -p "$APP/Contents/Info.plist" | grep -E 'CFBundleIdentifier|NSMicrophoneUsageDescription|NSAudioCaptureUsageDescription'
echo "pronto: open \"$PWD/$APP\""
