#!/usr/bin/env bash
# Monta o "LAP Reuniões.app" e o .dmg em apps/desktop/dist/ para instalar neste Mac.
# Assinatura ad-hoc (sem conta de desenvolvedor Apple): no primeiro uso, abrir com botão direito > Abrir.
# Uso (de apps/desktop): bash scripts/pack.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NOME="LAP Reuniões"
ARCH=$(uname -m)
VERSAO=$(node -p "require('./package.json').version")
ELECTRON=$(node -p "require('electron/package.json').version")
ZOD=$(node -p "require('zod/package.json').version")
PACKAGER="../../prova/node_modules/.bin/electron-packager"

pnpm build

# Pasta só com o que o app usa em produção: o build, os ícones e o zod (único require externo do main).
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R out "$STAGE/out"
rm -rf "$STAGE/out/smoke"
mkdir -p "$STAGE/resources" "$STAGE/node_modules"
cp -R resources/brand "$STAGE/resources/brand"
cp -RL node_modules/zod "$STAGE/node_modules/zod"
cat > "$STAGE/package.json" <<JSON
{ "name": "lap-reunioes", "productName": "$NOME", "version": "$VERSAO", "main": "out/main/index.js", "private": true, "dependencies": { "zod": "$ZOD" } }
JSON

rm -rf dist
"$PACKAGER" "$STAGE" "$NOME" \
  --platform=darwin --arch="$ARCH" --electron-version="$ELECTRON" \
  --out=dist --overwrite \
  --app-bundle-id=com.lap.reunioes \
  --app-version="$VERSAO" \
  --icon=resources/brand/icon.icns \
  --extend-info=build/extendInfo.plist \
  --asar \
  --no-prune

APP="dist/$NOME-darwin-$ARCH/$NOME.app"
codesign --force --deep --sign - --entitlements build/entitlements.plist "$APP"
codesign --verify --deep --strict "$APP" && echo "assinatura ok"
npx -y @electron/asar list "$APP/Contents/Resources/app.asar" | grep -q "^/node_modules/zod/package.json" && echo "zod ok"
plutil -p "$APP/Contents/Info.plist" | grep -E 'CFBundleIdentifier|CFBundleName|NSMicrophoneUsageDescription|NSAudioCaptureUsageDescription'

DMG="dist/$NOME $VERSAO.dmg"
DMGSRC=$(mktemp -d)
cp -R "$APP" "$DMGSRC/"
ln -s /Applications "$DMGSRC/Applications"
hdiutil create -volname "$NOME" -srcfolder "$DMGSRC" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$DMGSRC"
echo "pronto: $PWD/$DMG"
