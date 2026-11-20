# Segmented

Código: `apps/desktop/src/renderer/src/design/Segmented.tsx`. Controle segmentado (tema, idioma, intervalo).

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Altura | 28 px (`h-7`, `--control-compact-h`) |
| Padding | 0 12 (`px-3`) |
| Fonte | 13/20; o marcado em 500 |
| Contorno | 1 px `--line-strong`, raio 4, divisor de 1 px entre opções |

## Variantes

| Variante | Como fica |
|---|---|
| marcado | fundo `--title`, texto `--bg` |
| outros | fundo `--bg-raised`, texto `--text`; hover `--bg-sunken` |
