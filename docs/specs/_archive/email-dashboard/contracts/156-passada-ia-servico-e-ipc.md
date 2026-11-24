# Contrato 156 — Passada de IA, serviço do Painel, IPC, lotes de mover e agendamento diário
Feature: email-dashboard · Wave: 2 · Depende de: 155 · Spec: `docs/specs/email-dashboard/spec.md` (aprovada 2026-11-23) · Plan: D3, D4, D7, D9

Caminhos relativos a `apps/desktop/src`. Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`.
Este contrato liga a lógica do 155 ao modelo, ao cache de e-mail, aos lotes de mover e ao IPC. **Sem UI** (157) e **sem checks de smoke** (158), mas a fixture do smoke precisa responder ao `purpose` novo para o 158 não depender de modelo real.

## Pré-condições
- Contrato 155 commitado na branch (`shared/email-dashboard.ts`, `shared/email-dashboard-schema.ts`, `main/email/dashboard-store.ts`, settings `emailDashboard`, rotas).
- Ler na spec: R1–R9, R18, R19, R25–R28, N1–N6, CA1–CA4, CA7–CA10.
- Moldes (ler antes): `main/invites/suggest.ts` e `main/funil/extract.ts` (passada Haiku sem ferramentas via `runClaudeOneShot`, um pedido por vez, prazo, log só com números), `main/claude-cli/funnel.ts` (prompt e parse com `extractJsonObject`), `main/meetings/claude-one-shot.ts:36` (união `purpose`), `main/email/organize.ts` (`mover_emails`, lotes, `undoBatch`), `main/email/batches.ts`, `main/email/export.ts` (`isPending`, `emailRef`), `main/email/service.ts` (`cached()`, `cachedBody()`, `loadBody`, `moveMessages`, lista de pastas em cache, `EmailServiceDeps`), `main/index.ts` (registro dos canais `scribe:email-*`, recusa com app bloqueado em `shared/ipc.ts:1497+`, `remove-account`, critério de bloqueio de `inicioChanged` `:1234`), `apps/desktop/test/fixtures/fake-claude.mjs` (como responde por `purpose`), `main/email/fake-email.ts` (pastas que o servidor falso cria).

## Superfície

### `main/claude-cli/email-dashboard.ts` (novo)
- `buildEmailDashboardPrompt(input: { accountName: string; ownAddresses: string[]; folders: { path: string; name: string }[]; archive: { path: string } | null; messages: { ref: string; from: string; to: string[]; subject: string; dateIso: string; seen: boolean; answered: boolean; pending: boolean; knownContact: boolean; preview: string | null }[] }): string` — pede JSON fechado `{ "items": [{ ref, importance 1–5, reason ≤140, needsReply, reply|null, move: {folder, reason}|null }] }`, em texto puro, sem ferramentas, `reply` no idioma do e-mail (pt-BR na dúvida), começando pela saudação, sem assinatura; `move.folder` só entre os `folders` passados (path exato), `null` quando deve ficar na Caixa de Entrada; newsletters, avisos automáticos e notificações tendem a `move`; cobrança, cliente, prazo e pergunta direta tendem a `importance` alta. Prévias cortadas em `DASHBOARD_LIMITS.previewChars` **antes** de montar o prompt.
- `parseEmailDashboardOutput(text: string): { ref: string; item: ReturnType<typeof clampModelItem> }[]` — `extractJsonObject` + `EmailDashboardModelOutputSchema` + `clampModelItem`; `move.folder` fora da lista de pastas permitidas vira `null` (R4); entradas com `ref` desconhecido são descartadas. Nunca lança por texto malformado: devolve `[]`.

### `main/email/dashboard.ts` (novo) — `createEmailDashboardService(deps)`
- `deps`: `{ store: ReturnType<typeof createEmailDashboardStore>; email: { accounts(): {accountId, name, pop3: boolean, ownAddresses: string[]}[]; inbox(accountId): EmailMessage[]; sentAfter(accountId, sinceMs): EmailMessage[] /* ou o que `isPending` precisa */; folders(accountId): {path,name,specialUse?}[]; cachedBody(accountId, messageKey): Promise<string|null>; loadBody(accountId, messageKey): Promise<string|null>; moveMessages(accountId, fromPath, uids: number[], toPath): Promise<...>; isKnownContact(address): boolean }; batches: { record(batch): Promise<string /*batchId*/> } /* o mesmo mecanismo de `organize.ts`, com `origem: 'painel'` */; settings: () => { emailDashboard: { enabled; model } }; runOneShot: typeof runClaudeOneShot; isLocked(): boolean; isOnline(): boolean; now(): number; log: (line: string) => void; onChanged: (view: EmailDashboardView) => void }`. Se `isKnownContact` exigir o funil, usar o store do funil só por leitura (`main/funil/service.ts`).
- `view(): Promise<EmailDashboardView>` — `buildDashboardView` do 155 com os dados do cache; `pending` calculado pela heurística de `export.ts:isPending` (reaproveitar a função; se ela não for exportada, exportá-la sem mudar comportamento).
- `run(trigger: 'manual'|'daily'): Promise<{ started: boolean; running: boolean }>` — R1/N5: se já está rodando devolve `{started:false, running:true}`; se `enabled=false` devolve `{started:false, running:false}` sem chamar o modelo (R9); senão seleciona com `selectMessagesToAnalyze`, baixa corpos ausentes até `bodyDownloadsPerAccount` por conta (R3), monta lotes de `perCall` por conta, chama `runOneShot({ purpose: 'email-dashboard', model: settings.emailDashboard.model, timeoutMs: callTimeoutMs, ... })` um lote por vez, grava itens via `store.update` após **cada** lote (falha de um lote não perde os anteriores, R5), ao final `pruneStore`, grava `lastRun {at, model, analyzed, costUsd, error}` e chama `onChanged(view)` (R8). `error` é texto genérico fixo ("N chamadas falharam"), nunca a mensagem do modelo.
- `ignore(accountId, messageKey, kind)`, `markOpened(accountId, messageKey)` → gravam via `withIgnored`/`withOpened` e devolvem `view()`.
- `applyMove(accountId, folder, messageKeys: string[]): Promise<{ batchId: string; moved: number }>` — R18/R28: valida que a conta existe e não é POP3, que `folder` está em `allowedTargetFolders(folders(accountId))`, que cada `messageKey` está na INBOX em cache (resolve UID a partir da mensagem); qualquer violação → `throw` com texto fixo sem dados do e-mail e **nenhum** MOVE executado. Move via `moveMessages(accountId, 'INBOX', uids, folder)`, registra o lote com `origem: 'painel'` (mesmo formato que `organize.ts` usa para o Desfazer funcionar por `scribe:email-batch-undo` sem mudança), remove os itens movidos do store e chama `onChanged`.
- `startDailyScheduler(): () => void` — D7: `setInterval` de 15 min (e uma checagem 30 s após o início); roda `run('daily')` quando `!isLocked() && isOnline()` e `lastRun` é nulo ou de outro dia civil local (`toDateString()` local); devolve função que para o timer.
- Log (R7): uma linha por passada: `email-dashboard: contas=N analisadas=N baixadas=N chamadas=N falhas=N modelo=haiku custo=0.0123 ms=12345`. Nada mais.

### `main/meetings/claude-one-shot.ts`
- União `purpose` ganha `'email-dashboard'`. Nada mais muda.

### `main/email/batches.ts` / `organize.ts`
- O lote ganha o campo opcional `origem?: 'agente'|'painel'` (padrão `'agente'` para os existentes); `undoBatch` continua igual. Se o lote já tiver um campo equivalente, reaproveitar.

### `shared/ipc.ts`, `preload`, `main/index.ts`
- Canais novos (invoke): `scribe:email-dashboard-get` → `EmailDashboardView`; `scribe:email-dashboard-run` → `{started, running}`; `scribe:email-dashboard-ignore` `{accountId, messageKey, kind}` → view; `scribe:email-dashboard-opened` `{accountId, messageKey}` → view; `scribe:email-dashboard-apply-move` `{accountId, folder, messageKeys}` → `{batchId, moved}`. Evento main→renderer: `scribe:email-dashboard-changed` (view).
- Todos recusados com o app bloqueado, no mesmo lugar que os `scribe:email-*` (R25). Payloads validados com zod no main (strings não vazias, `messageKeys` 1–500, `kind` enum).
- `preload`: funções `emailDashboardGet/Run/Ignore/Opened/ApplyMove` e `onEmailDashboardChanged` seguindo o padrão das funções `email*` já expostas.
- `index.ts`: cria o store em `userData/email/`, o serviço, registra canais, chama `startDailyScheduler()` depois do serviço de e-mail subir (e para no `before-quit`); em `scribe:email-remove-account` chama `store.removeAccount(accountId)`; quando a última conta sai, `store.clear()` (R26). `onMessagesChanged` do e-mail também dispara `onChanged(view)` (a visão muda quando mensagens somem da INBOX) — sem chamar o modelo.

### `apps/desktop/test/fixtures/fake-claude.mjs`
- Para `purpose: 'email-dashboard'`, devolve JSON determinístico: para cada `ref` recebido no prompt (regex sobre o texto), `importance` cíclica 5,4,3,2,1, `reason` fixa "Motivo de teste N", `needsReply: true` + `reply "Olá, obrigado pela mensagem. Retorno ainda hoje."` nos refs ímpares, `move: {folder: <primeiro path da lista de pastas do prompt>, reason: "Newsletter"}` nos refs pares. Se `fake-email.ts` não cria nenhuma pasta além das padrão, criar a pasta `Newsletters` lá (só no servidor falso).

## Critérios de aceite
- CA1 Dado 2 contas em cache (IMAP com 6 mensagens e pastas `[INBOX, Newsletters, Sent(\Sent)]`; POP3 com 4) e `runOneShot` falso que devolve o JSON da fixture, quando `run('manual')`, então o store tem 10 itens, `lastRun.analyzed=10`, `runOneShot` foi chamado 2 vezes (um lote por conta), `view().replies.length=5`, `view().moves` tem 1 grupo (só da conta IMAP, pasta Newsletters, 3 linhas) e nenhuma linha da POP3 em `moves`.
- CA2 Dado o estado do CA1, quando `run('manual')` de novo sem mensagem nova, então `runOneShot` não é chamado e `lastRun.analyzed=0`.
- CA3 Dado `enabled=false`, quando `run('manual')`, então devolve `{started:false, running:false}` e `runOneShot` não é chamado.
- CA4 Dado `run` em andamento (promise pendente do `runOneShot`), quando `run` é chamado de novo, então devolve `{started:false, running:true}` e o modelo recebe no total só as chamadas da primeira passada.
- CA5 Dado 1 lote que rejeita (timeout simulado) e 1 que responde, então os itens do lote bom são gravados, `lastRun.error` é a string fixa e não contém nenhum assunto nem remetente do teste.
- CA6 Dado 40 mensagens sem corpo em cache numa conta, quando `run`, então `loadBody` é chamado no máximo 30 vezes e as 10 restantes vão ao prompt com `preview: null`.
- CA7 Dado `applyMove('imap', 'Newsletters', [k1,k2,k3])`, então `moveMessages` é chamado uma vez com os 3 UIDs, um lote `origem:'painel'` é registrado, os 3 itens saem do store e `onChanged` é chamado. Dado `applyMove('pop3', ...)`, `applyMove('imap','INBOX',...)`, `applyMove('imap','Inexistente',...)` ou um `messageKey` fora da INBOX, então lança e `moveMessages` não é chamado.
- CA8 Dado `ignore(a, k, 'reply')`, então a linha sai de `replies`, `store.ignored` tem a chave `a:k:reply`; `run` seguinte não a devolve (item reanalisado continua com `needsReply` mas a view o exclui).
- CA9 Dado `lastRun.at` = ontem 23:00 local, app desbloqueado e online, quando o scheduler checa, então `run('daily')` roda uma vez; na checagem seguinte do mesmo dia não roda; com `isLocked()=true` não roda.
- CA10 Teste estático: o arquivo `main/email/dashboard.ts` e `main/claude-cli/email-dashboard.ts` não passam `subject`, `from`, `preview`, `reply` ou `reason` para `log`, `console.*`, `Error(` nem para `lastRun.error` (grep no teste, como já se faz em outros testes estáticos do repo).
- CA11 Com o app bloqueado, os 5 canais `scribe:email-dashboard-*` são recusados (estender o teste existente de recusa por bloqueio).
- CA12 `fake-claude.mjs` devolve, para um prompt com 4 refs e a pasta `Newsletters`, JSON válido pelo `EmailDashboardModelOutputSchema` com 2 `reply` e 2 `move` para `Newsletters`.

## Invariantes
- `scribe:email-send`, `moveMessages`, `undoBatch`, `EMAILS.md`, as ferramentas do Assistente, o Início e as regras não mudam de comportamento (testes existentes verdes, sem alteração).
- `runClaudeOneShot` continua um pedido por vez e com o mesmo log para os `purpose` existentes.
- Nenhum e-mail (assunto, remetente, prévia, resposta) em log, erro ou nome de arquivo.

## Fora de escopo desta tarefa
- Tela, Configurações, `EmailNav`, Composer (157). Checks e prints do smoke, docs (158). Mudar o Início.

## Gates
- Rápidos: `pnpm -C apps/desktop typecheck`, `lint`, `test`. Não rodar o smoke aqui.
- Testes novos: `apps/desktop/test/main/email-dashboard.test.ts` (CA1–CA9), `test/main/email-dashboard-static.test.ts` (CA10), caso novo no teste de bloqueio de IPC (CA11), `test/fixtures` ou teste da fixture (CA12).

## Relatório final (formato)
Arquivos; CA1–CA12 com ✔/✘ e o teste; números dos gates; decisões onde houve margem (em especial: de onde veio `isKnownContact`, como o lote `origem` foi acomodado, se `isPending` foi exportado); riscos.
