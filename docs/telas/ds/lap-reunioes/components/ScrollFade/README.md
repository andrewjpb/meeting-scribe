# ScrollFade

Código: `apps/desktop/src/renderer/src/design/ScrollFade.tsx (classe .scroll-fade)`. Esmaecimento no pé de uma lista rolável da barra lateral, só enquanto há mais abaixo.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Altura | 24 |
| Fundo | gradiente de transparente para `--side-bg` |
| Posição | absoluta no pé da lista, irmã dela; `pointer-events: none` |
| Foco | a linha focada por teclado sob a faixa rola o que falta para o anel (4 px) aparecer |

## Variantes

| Variante | Como fica |
|---|---|
| visível | há conteúdo escondido abaixo |
| escondido | lista que cabe ou rolada até o fim |
