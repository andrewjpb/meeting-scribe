# Field

Código: `apps/desktop/src/renderer/src/design/Field.tsx (TextField, Select)`. Campo de texto e seletor no padrão dos controles.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Altura | 32 px (`h-8`, `--control-h`) |
| Padding | 0 10 (`px-2.5`) |
| Fonte | 13/20 `--text`; placeholder `--text-faint` |
| Contorno | 1 px `--line-strong`, raio 4, fundo `--bg-raised` |
| Largura | `TextField` flex 1 1 280; `Select` mínimo 240 |

## Variantes

| Variante | Como fica |
|---|---|
| text / password / search | o mesmo desenho |
| disabled | opacidade do navegador |
