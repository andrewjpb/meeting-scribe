# Tabs

Código: `apps/desktop/src/renderer/src/design/Tabs.tsx`. Abas em linha (Detalhe da reunião, Automações, painel de anotações).

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Altura | 32 px (`h-8`) |
| Gap entre abas | 20 |
| Fonte | 13/20, peso 500 |
| Marca da atual | sublinhado de 2 px em `--accent`, que pousa no fio de baixo (`-mb-px`) |

## Variantes

| Variante | Como fica |
|---|---|
| atual | texto `--title` |
| outras | texto `--text-muted`; hover `--title` |
