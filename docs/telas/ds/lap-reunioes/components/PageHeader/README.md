# PageHeader

Código: `apps/desktop/src/renderer/src/design/PageHeader.tsx`. Cabeçalho de tela: título à esquerda, ações à direita.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Título de página | 20/26, peso 700, `-0.3px`, `--title` |
| Título de seção | 15/20, peso 700 (`size="section"`, a aba de Configurações) |
| Descrição | 12/16 `--text-muted`, 2 abaixo |
| Ações | gap 8; entre título e ações, 12 |

## Variantes

| Variante | Como fica |
|---|---|
| page | título de tela |
| section | título de uma parte da tela |
