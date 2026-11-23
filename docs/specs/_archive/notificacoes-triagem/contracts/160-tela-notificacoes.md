# Contrato 160 — Tela Notificações: rota, item da barra com badge, lista e atalho no Início

Feature: notificacoes-triagem  ·  Wave: 2  ·  Depende de: 159 (só pelos tipos; não usa IPC novo)  ·  Gate humano: desenho aprovado pelo Andrew (`mockups/png/01-notificacoes-*.png`, `02-notificacoes-vazia-*.png`, `09-inicio-pendencias-*.png`)

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Base: main em `891b951` ou posterior. Desenho aprovado (ver acima). Gates rápidos verdes antes de começar.
- Só renderer + `shared/routes.ts` + `shared/notificacoes.ts` (novo). **Nenhum** canal IPC novo; nenhuma mudança em `main/*`, `features/email/*`, `EmailScreen`, `features/whatsapp/*`, `main/smoke.ts`.

## Contexto mínimo
Um item "Notificações" na raiz da barra lateral, com badge, e uma tela que lista cada conversa do WhatsApp com não lidas e cada e-mail não lido da Entrada de todas as contas. Tudo sai dos stores que o `Shell` já sincroniza: `features/email/emailStore.ts` (`accounts`, `folders['<accountId>:inbox']`, `markRead`, `load`, `loadFolder`) e `features/whatsapp/whatsappStore.ts` (`chats`). O clique reaproveita a navegação do clique nas notificações do macOS (`app/useMainNavigation.ts:51` e `:62`): `navigate(ROUTE_PATHS.whatsapp, { state: { chatId } })` e `navigate(emailPath(accountId, 'inbox'), { state: { messageId: id } })`.

Desenho (mockup 01/02/09): título "Notificações" com subtítulo-resumo; segmentado Todas · WhatsApp · Email (28 px); linhas de 44 px em duas linhas de texto: quadrado 28 à esquerda (iniciais para WhatsApp; contorno com ícone `Mail` para e-mail), nome em destaque seguido de rótulo cinza com ícone ("WhatsApp" com `Smartphone`/ícone já usado na barra, "Email" com `Mail`), prévia abaixo (última mensagem; ou "assunto · conta"); à direita a hora e, no WhatsApp, "N não lidas" em `--accent`; no e-mail, botão ghost 32 px "Marcar como lida" (ícone `MailOpen`) antes da hora, visível no hover e no foco por teclado. Estado vazio "Nada por ler." centrado, texto secundário. Cartão de pendências do Início ganha "Ver notificações" no cabeçalho, como "Abrir Tarefas" já faz.

## Superfície
- Alterar `apps/desktop/src/shared/routes.ts`: `RouteId` ganha `'notificacoes'`; `ROUTE_PATHS.notificacoes = '/notificacoes'`; `NOTIFICACOES_ROOT_PATH`.
- Criar `apps/desktop/src/shared/notificacoes.ts` (puro, testável):
  ```ts
  export type NotificacaoItem =
    | { kind: 'whatsapp'; chatId: string; nome: string; previa: string; at: number; naoLidas: number; urgente: boolean }
    | { kind: 'email'; accountId: string; id: string; de: string; assunto: string; at: number; conta: string }
  export type NotificacoesFiltro = 'todas' | 'whatsapp' | 'email'
  export function montarNotificacoes(input: { chats: readonly WhatsAppChat[]; incluirGrupos: boolean; etiquetas: Readonly<Record<string, Etiqueta>>; contas: readonly { id: string; label: string }[]; folders: Readonly<Record<string, readonly EmailMessage[] | undefined>> }): NotificacaoItem[]  // ordem: at desc; WhatsApp só unread > 0 e (pessoa ou incluirGrupos); e-mail só !seen da `<id>:inbox`
  export function filtrarNotificacoes(items, filtro): NotificacaoItem[]
  export function contarNotificacoes(items): { total: number; whatsapp: number; email: number }   // whatsapp = soma de naoLidas; email = linhas
  export function resumoNotificacoes(c): string   // "7 por ler: 5 mensagens no WhatsApp e 2 e-mails." · singular/plural ("1 mensagem", "1 e-mail") · só uma origem: "2 e-mails por ler." · zero: "Nada por ler."
  export function previaDaMensagem(m: WhatsAppMessage | null): string   // texto em 1 linha; mídia sem texto → "[imagem]"/"[áudio]"/… (mesmos rótulos de `chipsDe`-style já usados no app, se houver helper, reutilizar)
  ```
- Criar `apps/desktop/src/renderer/src/features/notificacoes/NotificacoesScreen.tsx` (+ `NotificacaoRow.tsx` se preferir) e `notificacoesSelectors.ts` (hook `useNotificacoes()` que combina os stores e as settings do renderer: `incluirGrupos = settings.whatsappNotifyGroups`; `etiquetas = {}` neste contrato — o 162 liga o `triagemStore`).
- Alterar `apps/desktop/src/renderer/src/app/routes.tsx`: entrada `{ id: 'notificacoes', path: ROUTE_PATHS.notificacoes, element: <NotificacoesScreen />, nav: { label: 'Notificações', icon: Bell } }` **logo depois de `inicio`**.
- Alterar `apps/desktop/src/renderer/src/app/Sidebar.tsx`: badge para `item.id === 'notificacoes'` = `unreadBadge(total)` com `total` de `contarNotificacoes(montarNotificacoes(...)).total` (mesmo hook/selector; sem duplicar a regra).
- Alterar `apps/desktop/src/renderer/src/features/inicio/CartaoPendencias.tsx`: link "Ver notificações" → `ROUTE_PATHS.notificacoes` no cabeçalho do cartão, no mesmo padrão dos links existentes (`LINHA_CLASS`).
- Criar `apps/desktop/test/renderer/notificacoes-logic.test.ts` (e, se existir teste de rotas/barra que enumera itens, estender).

## Comportamento
1. Ao montar a tela: se `useEmail.accounts === null`, chama `load()`; para cada conta conectada sem `folders['<id>:inbox']`, chama `loadFolder(id, 'inbox')`. Chats vêm do `useWhatsAppSync` do Shell (nada a pedir).
2. Lista = `filtrarNotificacoes(montarNotificacoes(...), filtro)`; filtro em estado local (padrão `todas`); segmentado com `data-notificacoes-filtro`.
3. Linha é um `<button>` de linha inteira com `data-notificacao="whatsapp:<chatId>"` ou `"email:<accountId>:<id>"`. Clique: WhatsApp → `navigate(ROUTE_PATHS.whatsapp, { state: { chatId } satisfies WhatsAppNavigationState })`; e-mail → `navigate(emailPath(accountId, 'inbox'), { state: { messageId: id } satisfies EmailNavigationState })`.
4. "Marcar como lida" (`data-notificacao-lida`): `useEmail.getState().markRead(accountId, id, true)`; a linha some quando o store atualiza `seen` (não remover à mão); `stopPropagation` para não abrir. Enquanto a promessa roda, botão `disabled`.
5. Hora: hoje → "HH:MM"; ontem → "ontem"; mesma semana → dia abreviado; senão "dd/mm" (reutilizar o helper que `ChatRow` do WhatsApp já usa, se exportável; senão o do e-mail; não criar um terceiro se já houver dois).
6. Estado vazio: `EmptyState` (design) com "Nada por ler." e, quando o filtro não é `todas`, "Nada por ler no WhatsApp." / "Nenhum e-mail por ler.".
7. Chip "Urgente" (20 px, raio 4, `--accent`/`--on-accent`) à direita do nome quando `item.urgente` (fica inerte neste contrato porque `etiquetas = {}`; o 162 passa a alimentar).
8. Atualização ao vivo: nenhuma assinatura nova; a tela reage às mudanças dos stores (zustand).

## Critérios de aceite
- CA1: `montarNotificacoes` com 3 chats (`unread:2` pessoa, `unread:0` pessoa, `unread:4` grupo) e `incluirGrupos:false` → 1 item WhatsApp (`naoLidas:2`); com `true` → 2. E-mails: 2 contas, inbox com `[seen:false, seen:true]` e `[seen:false]` → 2 itens e-mail com `conta` = label da conta. Ordem por `at` desc misturando as origens. `urgente` vem de `etiquetas[chatId]?.urgente === true`.
- CA2: `contarNotificacoes` → `{total:7, whatsapp:5, email:2}` para 5 não lidas em 2 chats + 2 e-mails; `resumoNotificacoes` → `"7 por ler: 5 mensagens no WhatsApp e 2 e-mails."`; `{1,1,0}` → `"1 mensagem no WhatsApp por ler."`; `{1,0,1}` → `"1 e-mail por ler."`; `{0,0,0}` → `"Nada por ler."`.
- CA3: `filtrarNotificacoes(items,'email')` só e-mails; `'whatsapp'` só WhatsApp; `'todas'` tudo.
- CA4: `previaDaMensagem` corta em 1 linha (sem `\n`), mídia sem texto vira rótulo entre colchetes, `null` → `''`.
- CA5 (typecheck/leitura): `routes.tsx` tem `notificacoes` imediatamente depois de `inicio`; `Sidebar` mostra `data-nav-badge` com o total quando > 0 e nada quando 0; o `RouteId` novo não quebra `sidebarLevels.ts` (item plano, `levelFor` devolve raiz).
- CA6 (leitura): `NotificacoesScreen` usa `PageHeader`, `Segmented` e `EmptyState` do design; nenhuma cor literal (gate 6), nenhuma sombra/pílula/raio > 6 (gate 7); linhas com `data-notificacao`; botão com `data-notificacao-lida` só em linhas de e-mail; clique chama `navigate` com os `state` exatos do item 3.
- CA7: `CartaoPendencias` tem link com texto "Ver notificações" para `/notificacoes` (teste de renderer existente do cartão estendido ou leitura).
- CA8: `pnpm --filter desktop typecheck && lint && test` verdes; testes novos cobrindo CA1–CA4.

## Invariantes
- `git diff --stat` não mostra `main/`, `preload/`, `shared/ipc.ts`, `features/email/`, `features/whatsapp/`, `features/chat/`.
- Os badges de Email, Redes e Tarefas na barra não mudam de fonte nem de valor.
- A ordem dos itens existentes da barra não muda (o smoke confere `automacoes` após `funil` após `email` após `assistente`).

## Fora de escopo desta tarefa
- `triagemStore` e etiquetas reais (162); cartão `abrir` com `notificacoes` (163); captura no smoke e `SCREENS` (164); marcar WhatsApp como lida (não existe).

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` (da raiz). Smoke só no fim da wave 3 / 164.

## Relatório esperado
≤ 30 linhas: arquivos, contagem de testes, helper de hora reutilizado (qual), decisões onde o contrato deixou escolha, cláusulas não cumpridas.
