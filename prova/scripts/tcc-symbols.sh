#!/usr/bin/env bash
# Teste 10: procura TCCAccessPreflight/TCCAccessRequest exportados pelo framework TCC.
# Só lê e imprime; não altera nada. Mostra a presença do símbolo, não os parâmetros:
# para ver a assinatura (argumentos) é preciso desmontar (Hopper/otool) a função.
set -u
BIN=/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC
PADRAO='TCCAccessPreflight|TCCAccessRequest'

echo "macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion))"

if [ -f "$BIN" ]; then
  echo "== nm -gU $BIN"
  nm -gU "$BIN" 2>/dev/null | grep -i -E "$PADRAO" || echo "(nenhum símbolo encontrado com nm)"
  exit 0
fi

echo "$BIN não existe no disco (o framework está só no dyld shared cache)."
if command -v dyld_info >/dev/null 2>&1; then
  echo "== dyld_info -exports $BIN"
  dyld_info -exports "$BIN" 2>/dev/null | grep -i -E "$PADRAO" || echo "(dyld_info não achou os símbolos)"
else
  echo "dyld_info não está instalado (vem com as Command Line Tools do Xcode)."
fi
echo
echo "Para ver os parâmetros: abrir no Hopper o dyld shared cache"
echo "(/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld/dyld_shared_cache_arm64e),"
echo "escolher a imagem TCC.framework e procurar TCCAccessPreflight / TCCAccessRequest."
