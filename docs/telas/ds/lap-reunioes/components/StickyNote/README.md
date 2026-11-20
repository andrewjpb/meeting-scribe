# StickyNote

Código: `apps/desktop/src/renderer/src/design/StickyNote.tsx`. Anotação em card colorido (post-it), sem sombra.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Card | padding 12 (`p-3`), gap 8, raio 6, fio 1 px na cor da borda |
| Topo | 24 de altura: tempo 12/500 tabular sublinhado, "Concluir" e "Excluir" (24, 12/500, ícone 14) |
| Título | 14/22, peso 600 (cards da IA) |
| Texto | 14/22, mínimo 66 |
| Cores | seis quadrados de 20, raio 4; a atual com o fio na cor do texto |
| Resolvido | opacidade 0,62, ✓ e o motivo em 12/500 |

## Variantes

| Variante | Como fica |
|---|---|
| yellow, pink, green, blue, purple, orange | `--note-<cor>`, `--note-<cor>-border`, `--note-<cor>-text` |
| IA | marca `Sparkles` com opacidade 0,7 |
