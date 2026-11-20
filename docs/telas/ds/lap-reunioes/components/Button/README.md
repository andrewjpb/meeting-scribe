# Button

Código: `apps/desktop/src/renderer/src/design/Button.tsx`. Botão de ação. Um tamanho só, 32 px; o atalho opcional aparece à direita do rótulo.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Altura | 32 px (`h-8`, `--control-h`) |
| Padding | 0 12 (`px-3`) |
| Gap | 8 |
| Fonte | 13/20, peso 500 |
| Ícone | 16, traço 1,5 |
| Raio | 4 (`--radius-control`) |
| Atalho | `Shortcut`, 12, opacidade 0,8 |

## Variantes

| Variante | Como fica |
|---|---|
| primary | fundo `--accent`, texto `--on-accent`; hover opacidade 0,9 |
| secondary | contorno `--line-strong`, fundo `--bg-raised`, texto `--title`; hover `--bg-sunken` |
| danger | só o texto em `--rec`, sem contorno |
| disabled | opacidade 0,5, sem clique |
