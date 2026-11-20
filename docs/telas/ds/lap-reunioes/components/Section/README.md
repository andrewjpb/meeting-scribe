# Section

Código: `apps/desktop/src/renderer/src/design/Section.tsx`. Grupo de configurações: rótulo, descrição opcional e as linhas num painel.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Rótulo | `.label` 11/16, peso 500, `--text-muted`, caixa normal, 4 abaixo (`mb-1`) |
| Descrição | 12/16 `--text-muted` |
| Painel | 8 abaixo do rótulo (`mt-2`); fio 1 px `--line-strong`, raio 6, fundo `--bg-raised` |
| Filhos | 12 nas laterais (`px-3`), fio `--line` entre eles |
| Entre seções | 24 (`gap-6`) na página |

## Variantes

| Variante | Como fica |
|---|---|
| com âncora | `#ancora` na URL rola até ela |
