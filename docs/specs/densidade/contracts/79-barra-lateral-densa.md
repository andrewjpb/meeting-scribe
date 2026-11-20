# Contrato 79 — Barra lateral densa

Feature transversal (pedido do Andrew em 2026-11-20, aprovado com o mockup `../mockups/SidebarDensa.dc.html` (copiado da spec do Instagram)) · Roda na branch `densidade` (worktree `~/Documents/GitHub/meeting-scribe-densidade`), em paralelo com o contrato 80 (arquivos disjuntos); a branch do Instagram recebe `densidade` antes do contrato 72 · Referência de regras: `docs/specs/_archive/sidebar-pilha/spec.md` (R1–R10 continuam valendo, só as medidas mudam) e `docs/specs/desktop-shell/design.md`. **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-densidade`.

## Objetivo
Barra lateral no ritmo do painel lateral do Claude Desktop: linhas mais baixas, menos respiro vertical, rótulos de seção menores e apagados. Fonte continua 13 px. Largura continua 224 px. Cores, ícones, slide e regras de foco não mudam.

## Medidas (de → para)
| Elemento | Hoje | Proposta |
|---|---|---|
| Linha da raiz (`app/Sidebar.tsx`, item `data-nav`) | 40 px (`h-10`), gap 10 (`gap-2.5`) | **32 px**, gap **8** (`gap-2`) |
| Cabeçalho de nível (`BackHeader` em `SidebarStack.tsx`) | 40 px, `mb-2` | **32 px**, `mb-1` |
| Linha de nível sem ícone (abas de Configurações, conversas do Assistente, linhas de conta/seção do Redes) | 30 px, `pl-8` | **28 px**, recuo **28 px** (`pl-7`) |
| Linha de pasta do Email (`EmailNav.tsx`, já tem ícone) | 30 px | **28 px**, recuo atual mantido (18 + 16 por nível) |
| Linha de conta do Email | 40 px | **28 px** (distingue-se pela seta e pela ausência do ícone de pasta) |
| Margem acima da lista (`side-stack`, `mt-6`) | 24 px | **16 px** (`mt-4`) |
| Espaço abaixo do cabeçalho de nível | 16 px | **4 px** |
| Rótulos de seção ("Hoje/Ontem/Quarta-feira" no Assistente, "Permissões" no rodapé) | 12 px caixa alta espaçada | **11 px**, caixa normal, cor `text-side-muted`, sem `tracking`; os rótulos de dia alinhados ao texto das conversas, linha de 28 px |
| Rodapé (Bloquear, Permissões) | 168 px no total, linhas de 40 | **126 px**, linhas de **28 px**; permissões continuam em **12 px** (13 estoura "Áudio do sistema · não verificado") |
| Marca no topo | igual | igual |
| Badges | 12 px tabular | igual |
| Padding lateral das linhas, 2 px entre linhas | 10 px / 2 px | iguais |

Implemente as alturas como classes/variáveis num só lugar quando houver repetição (ex.: constante `SIDE_ROW`/`SIDE_SUBROW` em `SidebarStack.tsx` ou variáveis `--side-row: 32px; --side-subrow: 28px` em `design/base.css`), para o 72 reutilizar.

## Onde mexer
`app/Sidebar.tsx`, `app/SidebarStack.tsx` (BackHeader, EmailLevel, SettingsLevel, AssistantLevel), `features/email/EmailNav.tsx` (contas e pastas), `features/chat/ChatHistory.tsx` (Nova conversa 32 px, busca 28 px, rótulos de dia, linhas 28 px), `app/LockButton.tsx`, `app/PermissionsBlock.tsx` (ou onde o rodapé mora), `design/base.css` (`.side-stack` margem), `docs/specs/desktop-shell/design.md` (bloco "Barra lateral em pilha": atualizar as medidas e registrar a decisão de 2026-11-20), `README.md` só se citar as alturas.

## Smoke e testes
- Ajuste os checks que medem altura (`rootItems` 40 → 32; linhas de nível 30 → 28; cabeçalho 40 → 32; `levelFits`/`emailFits`) e qualquer asserção de `getBoundingClientRect().height`; o check `emailFits` continua provando que nome longo não corta o badge em 224 px.
- Prints da barra (`sidebar-raiz/email/configuracoes/assistente-*`) ficam regravados automaticamente; `expectedShots` não muda.
- `test/renderer/sidebar-stack.test.ts` continua verde (lógica pura).

## Critérios de aceite
- Medidas da tabela conferidas no DOM pelo smoke (raiz 32, cabeçalho 32, nível 28, pasta 28, rodapé 28, margem 16).
- Nada corta em 224 px: badges, nomes longos com reticências, anel de foco inteiro (ScrollFade recalcula).
- Slide de 180 ms, voltar sem navegar, foco, duplo clique e movimento reduzido inalterados (checks existentes verdes).
- Rótulos de seção em caixa normal e 11 px; nenhum `uppercase`/`tracking` sobrando na barra.
- Sem cor literal; tokens; design.md atualizado.

## Fora de escopo
Qualquer mudança de cor, ícone, largura, ordem de itens ou comportamento.

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde no worktree.

## Relatório final (formato)
Arquivos; gates (contagens); onde ficaram as constantes de altura; o que ficou diferente da tabela e por quê; confirmação visual de 2 prints (raiz e Email).
