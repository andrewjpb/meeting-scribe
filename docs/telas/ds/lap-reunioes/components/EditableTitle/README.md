# EditableTitle

Código: `apps/desktop/src/renderer/src/design/EditableTitle.tsx`. Título da reunião ou da conversa que vira campo ao clicar.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Fonte | 15/20, peso 700, `-0.2px`, `--title` |
| Recuo | 6 nas laterais, compensado (`-mx-1.5 px-1.5`) |
| Hover | fundo `--bg-sunken` |
| Editando | campo com contorno `--line-strong`, Enter confirma, Esc cancela |

## Variantes

| Variante | Como fica |
|---|---|
| parado | botão com o texto truncado |
| editando | campo com o texto selecionado |
