# Label

Código: `apps/desktop/src/renderer/src/design/base.css (classe .label)`. Rótulo de seção ou grupo: títulos de `Section`, dias da lista, "Permissões", cabeçalhos de tabela, rótulos do Áudio e da Transcrição. Substitui a antiga `.caps` fora da fita e da marca.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Fonte | 11/16, peso 500 |
| Cor | `--text-muted` (na barra lateral, `--side-muted`) |
| Caixa | normal, sem espaçamento entre letras |

## Variantes

| Variante | Como fica |
|---|---|
| .label | na área principal |
| .label text-side-muted | na barra lateral (dias das conversas, Permissões) |
| .caps (não é rótulo) | só a fita ("VOCÊ", "PARTICIPANTES") e "LAP SOFTWARE": 10 px, `.14em`, caixa alta |
