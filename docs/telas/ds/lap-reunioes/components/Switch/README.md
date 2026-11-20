# Switch

Código: `apps/desktop/src/renderer/src/design/Switch.tsx`. Alternador quadrado.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Tamanho | 36 × 20 (`w-9 h-5`) |
| Botão | 14 × 14, raio 2, 2 px de folga |
| Contorno | 1 px; raio 4 |

## Variantes

| Variante | Como fica |
|---|---|
| desligado | fundo `--bg-sunken`, contorno `--line-strong`, botão `--text-muted` à esquerda |
| ligado | fundo e contorno `--accent`, botão `--on-accent` à direita |
| disabled | opacidade 0,5 |
