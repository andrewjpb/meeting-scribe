# Note

Código: `apps/desktop/src/renderer/src/design/Note.tsx`. Aviso em linha no formato de nota dos documentos da LAP. Nunca modal.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Padding | 12 nas laterais, 8 em cima e embaixo (`px-3 py-2`) |
| Gap | 10 |
| Fonte | 13/20 `--text` |
| Fundo | `--bg-sunken`, barra de 3 px `--title` à esquerda |
| Ícone | 16 `--text-muted` |
| Ação | link `--accent`, sublinhado, peso 500 |

## Variantes

| Variante | Como fica |
|---|---|
| role alert / status | para leitor de tela |
| as li | dentro de lista |
