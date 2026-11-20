# SidebarItem

Código: `apps/desktop/src/renderer/src/app/Sidebar.tsx, app/SidebarStack.tsx, features/email/EmailNav.tsx, features/chat/ChatHistory.tsx`. Linhas da barra lateral em pilha: raiz, cabeçalho-voltar e linhas de nível. As alturas moram em `base.css` (`--side-row`, `--side-subrow`, `--side-indent`).

Medidas da densidade (feature `densidade`, 20/11/2026). Fonte da verdade: o componente e `design/tokens.css`; se divergir, vale o código. Exemplo renderizável em `preview.html` (claro e escuro).

## Medidas

| Medida | Valor |
|---|---|
| Raiz | 32 (`--side-row`), padding 0 10, gap 8, ícone 16, texto 13; 2 entre itens |
| Cabeçalho-voltar | 32, 4 abaixo, `ChevronLeft` + ícone da seção, 13/500 `--side-text` |
| Linha de nível | 28 (`--side-subrow`), recuo 28 (`--side-indent`), sem ícone, 13 |
| Pasta de email | 28, recuo 18 + 16 por nível, com ícone |
| Rodapé | "Bloquear" e permissões em linhas de 28; total 126 |
| Não lidas | 12/500 tabular `--side-text`, some em zero |

## Variantes

| Variante | Como fica |
|---|---|
| ativo | fundo `--side-active`, texto `--side-text`, `aria-current="page"` |
| inativo | texto `--side-muted`; hover `--side-text` |
