#!/usr/bin/env bash
# Gates do app desktop (docs/specs/desktop-shell/plan.md). Para no primeiro erro.
# Em shell que não deixa o Chromium montar o sandbox: SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step '1/8 typecheck'
pnpm --filter @meeting-scribe/desktop typecheck

step '2/8 lint'
pnpm --filter @meeting-scribe/desktop lint

step '3/8 test'
pnpm --filter @meeting-scribe/desktop test

step '4/8 build'
pnpm --filter @meeting-scribe/desktop build

step '5/8 smoke'
pnpm --filter @meeting-scribe/desktop smoke

step '6/8 literais de cor fora de tokens.css'
RENDERER_SRC="apps/desktop/src/renderer/src"
if matches="$(grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' "$RENDERER_SRC" --exclude=tokens.css)"; then
  echo "$matches"
  echo 'Literal de cor fora de design/tokens.css. Use as variáveis de tokens.css.' >&2
  exit 1
fi
echo 'nenhum literal de cor fora de tokens.css'

step '7/8 sem sombra, sem raio acima de 6 px, sem pílula'
# design.md: nenhuma sombra (CSS, Tailwind e estilo em linha do React), raio de 4 ou 6 px e nenhuma pílula.
bash apps/desktop/scripts/check-shapes.sh "$RENDERER_SRC"

step '8/8 serviço do WhatsApp (pytest)'
# Contrato 24: os testes do serviço, com o cliente do neonize substituído (nada de neonize, nada de rede além do
# pytest na primeira vez). Ambiente próprio em services/whatsapp-bridge/.venv-test, com hashes.
BRIDGE="services/whatsapp-bridge"
if [[ ! -x "$BRIDGE/.venv-test/bin/pytest" ]]; then
  python3 -m venv "$BRIDGE/.venv-test"
  "$BRIDGE/.venv-test/bin/python" -m pip install -q --isolated --disable-pip-version-check --require-hashes --only-binary=:all: -r "$BRIDGE/requirements-dev.txt"
fi
(cd "$BRIDGE" && .venv-test/bin/python -m pytest -q -p no:cacheprovider tests)

printf '\n\033[1mgates ok\033[0m\n'
