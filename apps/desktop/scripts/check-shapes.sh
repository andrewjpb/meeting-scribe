#!/usr/bin/env bash
# Passo 7 dos gates (design.md): nenhuma sombra, raio só de 4 ou 6 px e nenhuma pílula, no CSS, nas
# classes do Tailwind e no estilo em linha do React. Uso: check-shapes.sh <pasta>. Sai com 1 se achar
# algo. Os casos que ele pega e os que deixa passar estão em test/check-shapes.test.ts.
set -uo pipefail

DIR="${1:?uso: check-shapes.sh <pasta>}"
Q="\"'\`"
errors=0

report() {
  echo "$1"
  echo "$2" >&2
  errors=1
}

# Sombra em CSS: cada declaração `box-shadow: <valor>` (até `;`, `}` ou fim de linha) tem que ser `none`.
# Com `-o`, `box-shadow: none; }` na mesma linha passa.
if matches="$(grep -rnoE 'box-shadow[[:space:]]*:[^;}]*' "$DIR" | grep -vE ':[[:space:]]*none[[:space:]]*(!important)?[[:space:]]*$')"; then
  report "$matches" 'box-shadow diferente de none.'
fi

# Sombra no estilo em linha do React (`boxShadow: ...`), a não ser `'none'`.
if matches="$(grep -rnoE "boxShadow[[:space:]]*:[^,}]*" "$DIR" --include='*.tsx' --include='*.ts' | grep -vE ":[[:space:]]*[$Q]none[$Q][[:space:]]*$")"; then
  report "$matches" 'boxShadow no estilo em linha.'
fi

# Utilitários de sombra do Tailwind (shadow-*, ring-* também desenham box-shadow).
if matches="$(grep -rnE "(^|[[:space:]$Q:!])(shadow|ring|inset-shadow|inset-ring)(-[^[:space:]$Q]+)?([[:space:]$Q]|$)" "$DIR" --include='*.tsx' --include='*.ts' | grep -vE "(shadow|ring)-(none|0)([[:space:]$Q]|$)")"; then
  report "$matches" 'Utilitário de sombra (shadow-*, ring-*) no renderer.'
fi

# Raio acima de 6 px: CSS (qualquer um dos valores, `border-radius: 4px 8px`), Tailwind (`rounded-lg`…,
# `rounded-[8px]`) e React (`borderRadius: 8`, `'8px'`, `'4px 8px'`).
RADIUS_PX='([7-9]|[1-9][0-9]+)(\.[0-9]+)?'
if matches="$(grep -rnE "radius[^:;{]*:[^;}]*(^|[^0-9.a-z-])${RADIUS_PX}px|[Rr]adius[[:space:]]*:[[:space:]]*[$Q][^$Q]*(^|[^0-9.])${RADIUS_PX}px|rounded(-[a-z]{1,2})?-(lg|xl|[2-9]xl)\b|rounded(-[a-z]{1,2})?-\[${RADIUS_PX}px\]|[Rr]adius[[:space:]]*:[[:space:]]*[$Q]?${RADIUS_PX}(px)?[$Q]?[[:space:]]*([,}]|$)" "$DIR")"; then
  report "$matches" 'Raio acima de 6 px.'
fi

# Raio em % ou em rem/em (50% é círculo; rem e em fogem da escala de 4 e 6 px).
if matches="$(grep -rnE "radius[^:;{]*:[^;}]*[0-9.]+(%|r?em)|rounded(-[a-z]{1,2})?-\[[^]]*[0-9.]+(%|r?em)\]|[Rr]adius[[:space:]]*:[[:space:]]*[$Q][^$Q]*[0-9.]+(%|r?em)" "$DIR")"; then
  report "$matches" 'Raio em % ou em rem/em.'
fi

# Pílula.
if matches="$(grep -rnE 'rounded(-[a-z]{1,2})?-full|9999|999px' "$DIR")"; then
  report "$matches" 'Pílula (rounded-full, 9999, 999px).'
fi

if [ "$errors" -ne 0 ]; then exit 1; fi
echo 'nenhuma sombra, nenhum raio acima de 6 px, nenhuma pílula'
