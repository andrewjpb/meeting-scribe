#!/usr/bin/env bash
# Prepara uma versão para o GitHub Releases (contrato 14). Confere a árvore limpa e a branch main, roda os
# gates, sobe a versão no package.json, monta o .dmg e o .sha256, faz o commit "versão <versão>" e a tag
# local v<versão>. NÃO faz push nem publica: no fim imprime os comandos para o Andrew rodar.
# Uso (de qualquer lugar): bash apps/desktop/scripts/release.sh 0.2.0
set -euo pipefail

VERSAO="${1:-}"
if [[ ! "$VERSAO" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "uso: bash apps/desktop/scripts/release.sh <x.y.z>" >&2
  exit 1
fi

if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" != "1" ]]; then
  echo 'a versão é montada só para Apple Silicon (arm64): rode num Mac M1 ou mais novo' >&2
  exit 1
fi

DESKTOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$DESKTOP/../.." && pwd)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo 'árvore com mudanças: faça o commit (ou guarde) antes de gerar a versão' >&2
  exit 1
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "a versão sai da branch main (atual: $BRANCH)" >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$VERSAO" >/dev/null; then
  echo "a tag v$VERSAO já existe" >&2
  exit 1
fi
ATUAL="$(node -p "require('$DESKTOP/package.json').version")"
if ! node -e "
  const p = (v) => v.split('.').map(Number)
  const [a, b] = [p('$VERSAO'), p('$ATUAL')]
  const d = a.map((n, i) => n - b[i]).find((n) => n !== 0) ?? 0
  process.exit(d > 0 ? 0 : 1)
"; then
  echo "a versão $VERSAO não é maior que a atual ($ATUAL)" >&2
  exit 1
fi

bash "$DESKTOP/scripts/gates.sh"

# Daqui em diante, uma falha desfaz o que der: a versão volta no package.json; com o commit já feito e
# a tag não, diz como terminar ou desfazer (a árvore estava limpa no começo).
ETAPA=inicio
desfazer() {
  local codigo=$?
  [[ $codigo -eq 0 ]] && return
  case "$ETAPA" in
    versao)
      git -C "$ROOT" checkout HEAD -- "$DESKTOP/package.json"
      echo "release.sh falhou: package.json voltou para $ATUAL; nada foi commitado." >&2
      ;;
    commit)
      echo "release.sh falhou depois do commit \"versão $VERSAO\" e antes da tag." >&2
      echo "  para terminar: git tag v$VERSAO  (e siga os comandos do README)" >&2
      echo "  para desfazer: git reset --hard HEAD~1" >&2
      ;;
    tag)
      echo "release.sh falhou depois da tag v$VERSAO (só as notas faltaram): escreva dist/notas-v$VERSAO.md à mão." >&2
      ;;
  esac
}
trap desfazer EXIT

# Sobe a versão (o app compara o tag_name do release com app.getVersion()).
ETAPA=versao
node -e "
  const fs = require('fs')
  const file = '$DESKTOP/package.json'
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  pkg.version = '$VERSAO'
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
"

bash "$DESKTOP/scripts/pack.sh"

git add "$DESKTOP/package.json"
git commit -m "versão $VERSAO"
ETAPA=commit
git tag "v$VERSAO"
ETAPA=tag

# Notas do release: o log desde a tag anterior, para o Andrew revisar antes de publicar.
NOTAS="$DESKTOP/dist/notas-v$VERSAO.md"
ANTERIOR="$(git describe --tags --abbrev=0 "v$VERSAO^" 2>/dev/null || true)"
{
  echo "## LAP Reuniões $VERSAO"
  echo
  if [[ -n "$ANTERIOR" ]]; then git log --format='- %s' "$ANTERIOR..v$VERSAO^"; else git log --format='- %s' "v$VERSAO^"; fi
  echo
  echo 'Para instalar: baixe o LAP-Reunioes-'"$VERSAO"'-arm64.dmg, abra e arraste o LAP Reuniões para Aplicativos.'
} > "$NOTAS"

ETAPA=fim
cd "$DESKTOP"
echo
echo "versão $VERSAO pronta: commit e tag v$VERSAO locais. Revise $NOTAS e rode:"
echo
echo "  git push origin main v$VERSAO"
echo "  cd $DESKTOP && gh release create v$VERSAO dist/*.dmg dist/*.sha256 --title \"LAP Reuniões $VERSAO\" --notes-file dist/notas-v$VERSAO.md"
