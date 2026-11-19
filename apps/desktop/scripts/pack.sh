#!/usr/bin/env bash
# Monta o "LAP Reuniões.app" e o .dmg em apps/desktop/dist/ para instalar neste Mac.
# Assinatura ad-hoc (sem conta de desenvolvedor Apple): no primeiro uso, abrir com botão direito > Abrir.
# Uso (de apps/desktop): bash scripts/pack.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NOME="LAP Reuniões"
# Sempre arm64 (o nome que o app procura no release). `uname -m` mente num terminal sob Rosetta
# (x86_64); `hw.optional.arm64` diz o hardware. Mac Intel não monta este pacote.
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" != "1" ]]; then
  echo "pack.sh: precisa de um Mac com Apple Silicon (o pacote é só arm64)" >&2
  exit 1
fi
ARCH=arm64
VERSAO=$(node -p "require('./package.json').version")
ELECTRON=$(node -p "require('electron/package.json').version")
ZOD=$(node -p "require('zod/package.json').version")
PACKAGER="../../prova/node_modules/.bin/electron-packager"
# Contrato 49: o lap-mic-watch é compilado aqui. O /usr/bin/swiftc sempre existe (é um atalho do xcrun); quem diz se
# há ferramentas de linha de comando do Xcode por trás dele é o `xcode-select -p`, como no dev.
xcode-select -p >/dev/null 2>&1 || { echo "pack.sh: sem as ferramentas de linha de comando do Xcode, o swiftc não compila o lap-mic-watch (instale com: xcode-select --install)" >&2; exit 1; }

pnpm build

# Pasta só com o que o app usa em produção: o build, os ícones e o zod (único require externo do main).
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R out "$STAGE/out"
rm -rf "$STAGE/out/smoke"
mkdir -p "$STAGE/resources" "$STAGE/node_modules"
cp -R resources/brand "$STAGE/resources/brand"
# Contrato 25: o guia do app que o Assistente lê.
cp -R resources/assistente "$STAGE/resources/assistente"
# Contrato 24: os arquivos do serviço local do WhatsApp (o app copia para o userData ao ligar). O cliente falso
# do smoke e os testes ficam de fora; o neonize nunca vai no pacote (é instalado com o clique da pessoa).
mkdir -p "$STAGE/resources/whatsapp-bridge"
for f in server.py bridge_store.py backend_neonize.py requirements.txt README.md; do
  cp "../../services/whatsapp-bridge/$f" "$STAGE/resources/whatsapp-bridge/$f"
done
# Contrato 31: a extensão do Chrome "Quem fala no Meet" (a aba Plugins copia para a pasta que a pessoa escolher).
mkdir -p "$STAGE/resources/meet-extension"
for f in manifest.json content.js background.js README.md; do
  cp "../../extensions/meet/$f" "$STAGE/resources/meet-extension/$f"
done
# Contrato 46: a extensão do Chrome "Controle do navegador" (idem, pela aba Plugins).
mkdir -p "$STAGE/resources/navegador-extension"
for f in manifest.json background.js README.md; do
  cp "../../extensions/navegador/$f" "$STAGE/resources/navegador-extension/$f"
done
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
# Contrato 49: o observador do microfone dos outros apps, fora do app.asar (um binário não roda de dentro dele), em
# Contents/Resources/bin. Assinado antes do app, com a mesma identidade e os mesmos entitlements.
MIC_WATCH="$APP/Contents/Resources/bin/lap-mic-watch"
mkdir -p "$(dirname "$MIC_WATCH")"
swiftc -O -target arm64-apple-macos14.4 native/mic-watch/main.swift -o "$MIC_WATCH"
codesign --force --sign - --entitlements build/entitlements.plist "$MIC_WATCH"
codesign --force --deep --sign - --entitlements build/entitlements.plist "$APP"
codesign --verify --deep --strict "$APP" && echo "assinatura ok"
npx -y @electron/asar list "$APP/Contents/Resources/app.asar" | grep -q "^/node_modules/zod/package.json" && echo "zod ok"
ASAR_LIST=$(npx -y @electron/asar list "$APP/Contents/Resources/app.asar")
grep -q "^/resources/whatsapp-bridge/server.py$" <<<"$ASAR_LIST" || { echo "pack.sh: o pacote não leva o serviço do WhatsApp" >&2; exit 1; }
echo "serviço do WhatsApp ok"
grep -q "^/resources/assistente/guia-do-app.md$" <<<"$ASAR_LIST" || { echo "pack.sh: o pacote não leva o guia do Assistente" >&2; exit 1; }
echo "guia do Assistente ok"
grep -q "^/resources/meet-extension/manifest.json$" <<<"$ASAR_LIST" || { echo "pack.sh: o pacote não leva a extensão do Meet" >&2; exit 1; }
echo "extensão do Meet ok"
# Contrato 59: o ical.js vai embutido no main (electron.vite.config.ts), como as bibliotecas de email; o pacote não
# leva node_modules/ical.js. Nenhum .js do main pode pedir o módulo de fora, e, quando o main usa os convites
# (shared/invite), o código dele tem de estar lá: o literal "component began but did not end" só existe no
# node_modules/ical.js/dist/ical.js (conferido com grep -r em src/). Antes disso o bundler nem inclui o ical.js.
ASAR_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE" "$ASAR_DIR"' EXIT
npx -y @electron/asar extract "$APP/Contents/Resources/app.asar" "$ASAR_DIR/app"
if grep -rqF --include='*.js' -e 'require("ical.js")' -e "require('ical.js')" -e 'from "ical.js"' -e "from 'ical.js'" "$ASAR_DIR/app/out/main"; then
  echo "pack.sh: o main ainda pede o ical.js de fora do pacote" >&2
  exit 1
fi
if grep -rqE "shared/invite['\"]" src/main; then
  grep -rqF --include='*.js' 'component began but did not end' "$ASAR_DIR/app/out/main" || { echo "pack.sh: o pacote não leva o ical.js" >&2; exit 1; }
fi
echo "ical.js ok"
codesign --verify --strict "$MIC_WATCH" || { echo "pack.sh: o lap-mic-watch não está assinado" >&2; exit 1; }
"$MIC_WATCH" --version </dev/null | grep -q "^lap-mic-watch " || { echo "pack.sh: o lap-mic-watch não roda" >&2; exit 1; }
echo "lap-mic-watch ok"
if grep -qiE "backend_fake|neonize-|\.dylib$" <<<"$ASAR_LIST"; then
  echo "pack.sh: o pacote leva o cliente falso do WhatsApp ou o neonize" >&2
  exit 1
fi
plutil -p "$APP/Contents/Info.plist" | grep -E 'CFBundleIdentifier|CFBundleName|NSMicrophoneUsageDescription|NSAudioCaptureUsageDescription'

# Nome que o app procura no release do GitHub (contrato 14): LAP-Reunioes-<versão>-<arch>.dmg, com o
# .sha256 ao lado (formato do shasum, conferido pelo app antes de abrir) e o latest.json de referência.
DMG_NOME="LAP-Reunioes-$VERSAO-$ARCH.dmg"
DMG="dist/$DMG_NOME"
DMGSRC=$(mktemp -d)
cp -R "$APP" "$DMGSRC/"
ln -s /Applications "$DMGSRC/Applications"
hdiutil create -volname "$NOME" -srcfolder "$DMGSRC" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$DMGSRC"
# Contrato 17 (decisão do Andrew): o Claude Agent SDK é proprietário e não vai no .dmg; o agente é baixado
# pelo app, com o clique da pessoa. Confere o .dmg montado e o app.asar.
MOUNT=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG" >/dev/null
FOUND=$( (find "$MOUNT" -iname '*claude-agent*'; npx -y @electron/asar list "$MOUNT/$NOME.app/Contents/Resources/app.asar" | grep -i 'claude-agent' || true) | head -5)
hdiutil detach "$MOUNT" >/dev/null
rmdir "$MOUNT"
if [[ -n "$FOUND" ]]; then
  echo "pack.sh: o .dmg leva o agente, que não pode ir no pacote:" >&2
  echo "$FOUND" >&2
  exit 1
fi
echo "dmg sem claude-agent-sdk nem claude-agent-acp"
(cd dist && shasum -a 256 "$DMG_NOME" > "$DMG_NOME.sha256")
SHA=$(cut -d' ' -f1 "$DMG.sha256")
cat > dist/latest.json <<JSON
{ "version": "$VERSAO", "arch": "$ARCH", "file": "$DMG_NOME", "sha256": "$SHA" }
JSON
echo "pronto: $PWD/$DMG"
echo "sha256: $SHA ($PWD/$DMG.sha256)"
