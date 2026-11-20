# ActionButton

Código: `apps/desktop/src/renderer/src/design/ActionButton.tsx`. Botão compacto das barras de ação (leitura de email, WhatsApp, transcrição).

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Altura | 28 px (`h-7`, `--control-compact-h`) |
| Padding | 0 8 (`px-2`); só ícone: 28 × 28 |
| Gap | 6 |
| Fonte | 12/16, peso 500 |
| Ícone | 14 |
| Contorno | 1 px `--line-strong`, raio 4 |

## Variantes

| Variante | Como fica |
|---|---|
| normal | texto `--title` |
| danger | texto `--rec` |
| iconOnly | só o ícone, rótulo no `aria-label` e na dica |
