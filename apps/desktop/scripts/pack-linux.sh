#!/usr/bin/env bash
# Monta o LAP Reuniões para Linux (x64 e arm64) em apps/desktop/dist/: um .tar.gz por arquitetura, com o
# .sha256 ao lado. Roda neste Mac: o electron-packager baixa o Electron de Linux e monta a pasta.
# Para usar no Linux: tar xzf LAP-Reunioes-<versão>-linux-x64.tar.gz && "./LAP Reuniões-linux-x64/lap-reunioes"
# O que é só do Mac (áudio do sistema, Touch ID, Dock) fica desligado no Linux.
# Uso (de apps/desktop): bash scripts/pack-linux.sh [x64|arm64 ...]
set -euo pipefail
cd "$(dirname "$0")/.."

NOME="LAP Reuniões"
ARCHS=("$@")
[[ ${#ARCHS[@]} -eq 0 ]] && ARCHS=(x64 arm64)
VERSAO=$(node -p "require('./package.json').version")
ELECTRON=$(node -p "require('electron/package.json').version")
ZOD=$(node -p "require('zod/package.json').version")
PACKAGER="../../prova/node_modules/.bin/electron-packager"

pnpm build

# A mesma pasta de produção do pack.sh: o build, os ícones, o guia do Assistente, o serviço do WhatsApp, a extensão
# do Meet e o zod.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R out "$STAGE/out"
rm -rf "$STAGE/out/smoke"
mkdir -p "$STAGE/resources" "$STAGE/node_modules"
cp -R resources/brand "$STAGE/resources/brand"
cp -R resources/assistente "$STAGE/resources/assistente"
mkdir -p "$STAGE/resources/whatsapp-bridge"
for f in server.py bridge_store.py backend_neonize.py requirements.txt README.md; do
  cp "../../services/whatsapp-bridge/$f" "$STAGE/resources/whatsapp-bridge/$f"
done
mkdir -p "$STAGE/resources/meet-extension"
for f in manifest.json content.js background.js README.md; do
  cp "../../extensions/meet/$f" "$STAGE/resources/meet-extension/$f"
done
cp -RL node_modules/zod "$STAGE/node_modules/zod"
cat > "$STAGE/package.json" <<JSON
{ "name": "lap-reunioes", "productName": "$NOME", "version": "$VERSAO", "main": "out/main/index.js", "private": true, "dependencies": { "zod": "$ZOD" } }
JSON

OUT=$(mktemp -d)
mkdir -p dist
for ARCH in "${ARCHS[@]}"; do
  "$PACKAGER" "$STAGE" "$NOME" \
    --platform=linux --arch="$ARCH" --electron-version="$ELECTRON" \
    --out="$OUT" --overwrite \
    --executable-name=lap-reunioes \
    --app-version="$VERSAO" \
    --icon=resources/brand/icon.png \
    --asar \
    --no-prune
  DIR="$NOME-linux-$ARCH"
  ASAR_LIST=$(npx -y @electron/asar list "$OUT/$DIR/resources/app.asar")
  grep -q "^/resources/assistente/guia-do-app.md$" <<<"$ASAR_LIST" || { echo "pack-linux.sh: falta o guia do Assistente ($ARCH)" >&2; exit 1; }
  grep -q "^/resources/meet-extension/manifest.json$" <<<"$ASAR_LIST" || { echo "pack-linux.sh: falta a extensão do Meet ($ARCH)" >&2; exit 1; }
  if grep -qiE "claude-agent|backend_fake|neonize-|\.dylib$" <<<"$ASAR_LIST"; then
    echo "pack-linux.sh: o pacote leva o agente, o cliente falso do WhatsApp ou o neonize ($ARCH)" >&2
    exit 1
  fi
  TGZ="LAP-Reunioes-$VERSAO-linux-$ARCH.tar.gz"
  tar -C "$OUT" -czf "dist/$TGZ" "$DIR"
  (cd dist && shasum -a 256 "$TGZ" > "$TGZ.sha256")
  echo "pronto: $PWD/dist/$TGZ ($(cut -d' ' -f1 "dist/$TGZ.sha256"))"
done
rm -rf "$OUT"
