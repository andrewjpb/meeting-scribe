# Contrato 155 — Dados, store, lógica pura, settings e rotas do Painel de e-mail
Feature: email-dashboard · Wave: 1 · Depende de: — · Spec: `docs/specs/email-dashboard/spec.md` (aprovada 2026-11-23) · Plan: D1, D2, D8, D10

Caminhos relativos a `apps/desktop/src`. Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`.
Este contrato **não tem UI nem IPC nem chamada de modelo**: só tipos, esquema, lógica pura, store em disco, settings e rotas, com testes. Tudo que ele exporta é a base dos contratos 156 (passada de IA/IPC) e 157 (tela), então os **nomes exportados abaixo são obrigatórios**.

## Pré-condições
- Worktree `~/Documents/GitHub/meeting-scribe-email-dashboard`, branch `email-dashboard`, base `47ad5c1`.
- Ler na spec: "Modelo de dados", R2, R4, R6, R19, N2, N4 e a seção "Ambiguidades da spec resolvidas aqui" do plan.
- Moldes a seguir (ler antes): `shared/tarefas-sugestoes.ts` e `main/tarefas/store.ts` (lógica pura + store com `ignorados`), `shared/email.ts:107 EmailMessage`, `main/email/export.ts:114 isPending` (não mover; reaproveitar por import se for puro, senão copiar a regra para a lógica pura recebendo os dados já prontos), `shared/settings-defaults.ts` (como `inviteSuggest`, `funil`, `tarefas` entram em defaults, schema e migração), `shared/routes.ts` (`email`, `emailPath`, `EmailRouteFolder`, `EmailNavigationState`).

## Superfície

### `shared/email-dashboard.ts` (novo; sem Node, sem Electron)
- Tipos: `EmailDashboardModel = 'haiku'|'sonnet'`, `EmailDashboardSuggestionKind = 'reply'|'move'`, `EmailDashboardItem`, `EmailDashboardStore`, `EmailDashboardLastRun`, `EmailDashboardView`, `EmailDashboardAttentionRow`, `EmailDashboardReplyRow`, `EmailDashboardMoveGroup`, `EmailDashboardAccountSummary` — campos exatamente como a seção "Modelo de dados" da spec (`items: Record<string, EmailDashboardItem>`, `ignored`, `opened`, `lastRun`).
- `DASHBOARD_LIMITS` (const, `as const`): `{ days: 7, perAccount: 60, perRun: 150, bodyDownloadsPerAccount: 30, previewChars: 1500, perCall: 15, callTimeoutMs: 60_000, reasonChars: 140, replyChars: 1200, folders: 40, attentionRows: 15, replyRows: 20, moveGroups: 10, moveRows: 50, keepIgnoredDays: 365 }`.
- `itemKey(accountId, messageKey): string` → `${accountId}:${messageKey}`; `ignoreKey(accountId, messageKey, kind)` → `${accountId}:${messageKey}:${kind}`.
- `emptyDashboardStore(): EmailDashboardStore` (version 1, items {}, ignored [], opened [], lastRun null).
- `selectMessagesToAnalyze(input: { now: number; accounts: { accountId: string; ownAddresses: string[]; inbox: EmailMessage[] }[]; store: EmailDashboardStore }): { accountId: string; message: EmailMessage }[]` — R2: só INBOX, `date >= now - 7 dias`, remetente fora de `ownAddresses` (comparação sem caixa), sem item cuja `analyzedAt >= message.date`; ordenadas por `date` desc; no máximo 60 por conta e 150 no total (corte por conta primeiro, depois global, mantendo as mais recentes).
- `allowedTargetFolders(folders: { path: string; name: string; specialUse?: string|null }[]): { path: string; name: string }[]` — R4: exclui INBOX (qualquer caixa do path), as de `specialUse` `\Sent`, `\Drafts`, `\Trash`, `\Junk`, `\All`, e as de nome (sem caixa, com acento normalizado) `Enviados`, `Sent`, `Sent Items`, `Rascunhos`, `Drafts`, `Lixeira`, `Trash`, `Deleted`, `Spam`, `Junk`, `Lixo`; devolve no máximo 40, em ordem alfabética do `name`. Use o tipo real de pasta do app se já existir em `shared/email.ts` (procurar `specialUse`/`EmailFolder`).
- `archiveFolder(folders): { path; name } | null` — plan: `specialUse` `\Archive`; senão nome `Archive`/`Arquivo`/`Arquivados`/`Arquivadas` (sem caixa); senão null.
- `buildDashboardView(input: { enabled: boolean; running: boolean; store: EmailDashboardStore; accounts: { accountId: string; name: string; pop3: boolean; ownAddresses: string[]; inbox: EmailMessage[]; pending: Set<string> /* messageKeys pendentes pela heurística */; folders: { path: string; name: string; specialUse?: string|null }[] }[] }): EmailDashboardView` — regras da seção "Visão para o renderer" da spec: `accounts` com `unread` (= `!seen` na INBOX) e `pending` (= `pending.size`); `attention` ≤ 15 por `importance` desc, depois `date` desc, só mensagens ainda na INBOX; `replies` ≤ 20: `needsReply && reply`, mensagem pendente (`pending` tem a chave) e não `answered`, não ignorada (`reply`), `opened` marcado quando a chave está em `store.opened`; `moves`: agrupa por `accountId + move.folder`, exclui conta `pop3`, ignoradas (`move`), pastas fora de `allowedTargetFolders(folders)`; `folderName` = `name` da pasta; grupo chamado "Arquivar" quando a pasta é a de `archiveFolder`; ≤ 10 grupos (os maiores primeiro) e ≤ 50 linhas no total. Com `enabled=false`: `attention` = mensagens pendentes não lidas (`importance 0`, `reason ''`), `replies=[]`, `moves=[]`.
- `pruneStore(store, input: { now: number; liveKeys: Set<string> /* itemKeys ainda na INBOX */ }): EmailDashboardStore` — remove `items` fora de `liveKeys`, `ignored`/`opened` com `at < now - 365 dias`; puro (devolve cópia).
- `withIgnored(store, accountId, messageKey, kind, now)`, `withOpened(store, accountId, messageKey, now)` — puros, sem duplicar chave.
- `clampModelItem(raw: unknown): Pick<EmailDashboardItem,'importance'|'reason'|'needsReply'|'reply'|'move'> | null` — aplica R6: `importance` inteiro 1–5 (fora disso → null para o item inteiro), `reason` cortada em 140, `reply` cortada em 1200 e só mantida se `needsReply`, `move.folder` string não vazia e `move.reason` cortada em 140; retorna null se o objeto não tiver `importance`.

### `shared/email-dashboard-schema.ts` (novo)
- Zod: `EmailDashboardItemSchema`, `EmailDashboardStoreSchema` (version literal 1), `EmailDashboardModelOutputSchema` = `{ items: Array<{ ref: string; importance: number; reason?: string; needsReply?: boolean; reply?: string|null; move?: { folder: string; reason?: string }|null }> }` com `.passthrough()` desligado (`strict` não; `strip` padrão).

### `main/email/dashboard-store.ts` (novo; Node sem Electron, molde `main/tarefas/store.ts`)
- `createEmailDashboardStore(dir: string)` → `{ load(): Promise<EmailDashboardStore>; save(store): Promise<void>; update(fn: (s)=>s): Promise<EmailDashboardStore>; removeAccount(accountId): Promise<void>; clear(): Promise<void> }`.
- Arquivo `<dir>/dashboard.json`, gravação atômica (tmp + rename), `mode 0o600`, pasta `0o700` se criar. JSON inválido ou versão diferente → `emptyDashboardStore()` (log de uma linha sem conteúdo). `update` serializa chamadas concorrentes (fila), como o store das tarefas.
- `removeAccount` apaga `items`, `ignored` e `opened` cujas chaves começam por `${accountId}:`; `clear` apaga o arquivo.

### `shared/settings-defaults.ts` (+ schema/migração onde o arquivo já faz isso)
- `emailDashboard: { enabled: true, model: 'haiku' }` nos defaults, no tipo `Settings`, no schema zod e na normalização de settings antigos (ausente → default). Nenhuma outra chave muda.

### `shared/routes.ts`
- `EMAIL_PAINEL_SLUG = 'painel'`, `EMAIL_PAINEL_PATH = '/email/painel'`, `emailPainelPath(): string`.
- A rota `email` continua `/email/:conta?/:pasta?`; `isEmailPainelPath(pathname)` devolve true para `/email/painel` (e `/email/painel/`). Documentar no comentário que `painel` é reservado como primeiro segmento (nenhuma conta usa id `painel`; adicionar essa checagem onde ids de conta são gerados, se o id for escolhido pelo app — conferir `main/email/service.ts add-account`; se o id é aleatório/uuid, só comentar).
- `EmailNavigationState.compose` passa a `{ to?: string[]; subject?: string; replyTo?: { messageKey: string; mailbox: string }; text?: string }` (os campos antigos continuam opcionais e compatíveis).

## Critérios de aceite
- CA1 Dado 3 contas com INBOX de 100 mensagens cada (datas espalhadas em 20 dias, 10 de remetente próprio, 5 com item `analyzedAt` posterior), quando `selectMessagesToAnalyze` roda, então devolve ≤ 60 por conta, ≤ 150 no total, nenhuma de remetente próprio, nenhuma com mais de 7 dias, nenhuma já analisada, e a primeira de cada conta é a mais recente.
- CA2 Dado pastas `[INBOX, Sent(\Sent), Lixeira, Newsletters, Clientes/ABF, Archive]`, `allowedTargetFolders` devolve `[Archive, Clientes/ABF, Newsletters]` (ordem por nome) e `archiveFolder` devolve `Archive`; sem `Archive` e com `specialUse \Archive` em `Arquivados`, devolve `Arquivados`.
- CA3 Dado store com 5 itens (`importance` 5,4,3,3,1), 2 com `needsReply+reply` (um deles `answered`), 3 com `move` (um para pasta inexistente, um em conta POP3, um ignorado `move`), quando `buildDashboardView(enabled=true)`, então `attention` vem ordenada 5,4,3,3,1 (empate por data desc), `replies` tem 1 linha, `moves` tem 0 grupos.
- CA4 Dado o mesmo store com `enabled=false`, então `attention` tem só as mensagens pendentes não lidas com `importance 0` e `reason ''`, `replies` e `moves` vazios, `accounts` preenchido.
- CA5 Dado store com 3 itens e `liveKeys` com 1, `ignored` com uma entrada de 400 dias, quando `pruneStore`, então sobra 1 item e 0 ignorados; o store original não é mutado.
- CA6 Dado `clampModelItem({importance: 7})` → null; `({importance: 3, reason: 'x'.repeat(200), needsReply: false, reply: 'oi'})` → `reason` com 140 chars e `reply null`; `({importance: 2, move: {folder: ''}})` → `move null`.
- CA7 Dado um diretório temporário, quando `save` grava e `load` lê, então o conteúdo é igual, o arquivo tem modo `0600`; dado JSON corrompido, `load` devolve `emptyDashboardStore()`; `removeAccount('a')` remove só chaves `a:*`; duas chamadas `update` concorrentes aplicam ambas (contador 2).
- CA8 Dado settings antigos sem `emailDashboard`, quando normalizados, então `emailDashboard` = `{enabled: true, model: 'haiku'}`; `model: 'opus'` é rejeitado pelo schema.
- CA9 `emailPainelPath()` === `/email/painel`; `isEmailPainelPath('/email/painel/')` true; `isEmailPainelPath('/email/abc/entrada')` false; `EmailNavigationState` aceita `{compose: {replyTo: {messageKey: '12', mailbox: 'INBOX'}, text: 'Olá'}}` no typecheck.

## Invariantes
- Nenhum arquivo em `main/email/service.ts`, `main/index.ts`, `shared/ipc.ts`, renderer ou `smoke.ts` muda neste contrato.
- `emailPath` e as rotas existentes continuam gerando os mesmos caminhos (testes existentes de rotas verdes).
- Nenhum teste existente é alterado para passar.

## Fora de escopo desta tarefa
- Passada de IA, prompt, IPC, agendamento, mover (156). Tela e Configurações (157). Smoke e docs (158).

## Gates
- `pnpm -C apps/desktop typecheck`, `pnpm -C apps/desktop lint`, `pnpm -C apps/desktop test` verdes (gates rápidos; o completo fica para o 157/158).
- Testes novos: `apps/desktop/test/shared/email-dashboard.test.ts` (CA1–CA6, CA9), `apps/desktop/test/main/email-dashboard-store.test.ts` (CA7), caso novo no teste de settings existente (CA8).

## Relatório final (formato)
Arquivos criados/alterados (lista); CA1–CA9 com ✔/✘ e o nome do teste que prova cada um; gates com números (testes totais); decisões tomadas onde o contrato deixou margem; nada mais.
