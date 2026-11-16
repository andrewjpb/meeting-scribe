#!/usr/bin/env bash
# Gates do app desktop (docs/specs/desktop-shell/plan.md). Para no primeiro erro.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step '1/7 typecheck'
pnpm --filter @meeting-scribe/desktop typecheck

step '2/7 lint'
pnpm --filter @meeting-scribe/desktop lint

step '3/7 test'
pnpm --filter @meeting-scribe/desktop test

step '4/7 build'
pnpm --filter @meeting-scribe/desktop build

step '5/7 smoke'
pnpm --filter @meeting-scribe/desktop smoke

step '6/7 literais de cor fora de tokens.css'
RENDERER_SRC="apps/desktop/src/renderer/src"
if matches="$(grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' "$RENDERER_SRC" --exclude=tokens.css)"; then
  echo "$matches"
  echo 'Literal de cor fora de design/tokens.css. Use as variáveis de tokens.css.' >&2
  exit 1
fi
echo 'nenhum literal de cor fora de tokens.css'

step '7/7 sem sombra, sem raio acima de 6 px, sem pílula'
# design.md: nenhuma sombra (CSS, Tailwind e estilo em linha do React), raio de 4 ou 6 px e nenhuma pílula.
bash apps/desktop/scripts/check-shapes.sh "$RENDERER_SRC"

printf '\n\033[1mgates ok\033[0m\n'
