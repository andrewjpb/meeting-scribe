# SettingRow

Código: `apps/desktop/src/renderer/src/design/SettingRow.tsx`. Linha de configuração: nome e descrição à esquerda, controle numa coluna fixa à direita.

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Altura | mínimo 44 (`min-h-11`, `--row-h`) |
| Padding | 8 em cima e embaixo (`py-2`); 12 nas laterais vem da `Section` |
| Colunas | `minmax(0,1fr)` e 340 (`--settings-control-width`), gap 20 |
| Nome | 13/20, peso 500, `--text` |
| Descrição | 12/16 `--text-muted`, 1 px abaixo |

## Variantes

| Variante | Como fica |
|---|---|
| com `htmlFor` | o nome vira `<label>` do campo |
| realçada | achada pela busca: fundo `--bg-sunken` e fio `--accent` por 2 s |
