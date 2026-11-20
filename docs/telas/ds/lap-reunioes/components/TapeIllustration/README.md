# TapeIllustration

Código: `apps/desktop/src/renderer/src/design/TapeIllustration.tsx`. A fita de níveis parada (estado vazio de Reuniões) e a fita sem sinal (gravação sem fonte).

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Fita parada | 320 × 80; barras de 3 px a cada 4; microfone para cima em `--mic`, sistema para baixo em `--sys`; fio central `--line-strong` |
| Fita sem sinal | 320 de largura; cada lado com 36 de altura, rótulo `.caps` (10 px, `.14em`, caixa alta) e "sem sinal" em `--text-faint`, tracejado 6/6 `--line-strong` |

## Variantes

| Variante | Como fica |
|---|---|
| TapeIllustration | uma conversa gravada |
| SilentTapeIllustration | as duas fontes sem sinal |
