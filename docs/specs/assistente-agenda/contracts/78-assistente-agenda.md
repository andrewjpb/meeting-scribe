# Contrato 78 — Assistente: cartão de evento, editar/apagar lembrete, tela sem cabeçalho

Feature `assistente-agenda` · Wave 1 · Depende de: nada · Spec `../spec.md` (R1–R5, CA1–CA10) · Plan `../plan.md` · Mockup `../mockups/AssistenteAgenda.dc.html` (5 artboards, aprovado). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-assistente-agenda` (branch `assistente-agenda`).

## Pré-condições
Leia a spec inteira e, no código: `shared/assistant.ts` (`CHAT_ACTION_KINDS`, interfaces dos cartões), `main/chat/actions.ts` (`proposedSchema`, `resolve`, `extractActions`, `createChatActions().reminder`, `actionsHistory`), `main/chat/store.ts` (zod dos cartões persistidos), `features/chat/ActionCards.tsx` (`ReminderCard`) e `features/chat/chatStore.ts` (`createReminder`), `main/claude-cli/chat.ts:150-175` (instrução de sistema dos blocos), `main/chat/sources.ts` (`stateMarkdown`, `automationsMarkdown`), `main/schedules/service.ts` (`createReminder`, `saveTask`, `deleteTask`, `dueReminders`), `main/mac-calendar/protocol.ts` e `client`/`process.ts` (comandos `status`, `calendars`, `create`), `main/invites/service.ts:740-790` (`addFromRule`/`addEvent`: como chama `create` e trata `calendar-denied`/`no-calendar`), `features/settings/InvitesSection.tsx` (estado da permissão, `scribe:invite-calendars`, `scribe:invite-request-access`), `features/chat/ChatScreen.tsx` (PageHeader a remover), `resources/assistente/guia-do-app.md` (linhas 41, 45, 78, 116), `test/assistant.test.ts` (`:206-213` lista de canais; `:436` testes do guia), `test/fixtures/fake-acp-agent.mjs` (respostas por regex) e `test/fixtures/fake-lap-calendar.mjs`, `main/smoke.ts` `assistantChecks` (`:6371-6475`).

## Superfície

### `shared/assistant.ts`
- `CHAT_ACTION_KINDS` += `'evento' | 'lembrete-editar' | 'lembrete-apagar'`.
- `ChatActionEvent { kind: 'evento'; title; start: string (ISO); end: string (ISO); allDay: boolean; location: string | null; notes: string | null; calendarId: string | null; calendarTitle: string | null; calendars: { id; title; source; color: string | null; isDefault }[]; access: 'full' | 'not-determined' | 'denied' | 'unavailable'; status: 'proposed' | 'done' | 'failed' | 'dismissed'; result: string | null; error: string | null }`.
- `ChatActionReminderEdit { kind: 'lembrete-editar'; taskId; currentText; currentAt; text: string | null; at: string | null; status…; result; error }`, `ChatActionReminderDelete { kind: 'lembrete-apagar'; taskId; text; at; status…; result; error }`.
- Limites: `EVENT_TITLE_MAX = 200`, `EVENT_NOTES_MAX = 4000`, `EVENT_DEFAULT_DURATION_MS = 3600000`.

### Proposta pelo modelo (`main/chat/actions.ts`)
- `proposedSchema` aceita `{"tipo":"evento","titulo","inicio","fim"?,"diaInteiro"?,"local"?,"notas"?,"agenda"?}`, `{"tipo":"lembrete-editar","id","quando"?,"texto"?}` (ao menos um dos dois), `{"tipo":"lembrete-apagar","id"}`.
- `resolve` para `evento`: parse ISO (sem fuso → fuso do Mac); `inicio` ≥ hoje 00:00 local; `fim` padrão `inicio + 1 h`, exige `fim > inicio`; dia inteiro zera horas e `fim` = dia seguinte; título/notas cortados nos limites; agendas = `macCalendar.calendars()` filtradas por `writable`; `calendarId` = agenda com título igual (sem acento/caixa) → `settings.inviteCalendarId` se gravável → `isDefault` gravável → primeira gravável → `null`; `access` = `macCalendar.status()`. Com `access !== 'full'`, o cartão é montado com `calendars: []` e `calendarId: null` (R1: aviso + Pedir acesso). Proposta inválida (passado, fim ≤ início) vira texto, como hoje.
- `resolve` para lembretes: `automations.listTasks()` com `reminder` e `id` igual; não achou → texto. `lembrete-editar` com `quando` no passado → texto.
- `actionsHistory` ganha as linhas dos três tipos ("evento … (Evento criado …)", etc.).
- `createChatActions()` ganha `event({chatId, index, actionId, calendarId, fields?})` e `reminderChange({chatId, index, actionId, op, at?, text?})`: travam `busy`, exigem `proposed`, executam, gravam `done` + `result` ou `failed` + `error` (pt-BR). Erros do helper: `calendar-denied` → "O app não tem acesso ao Calendário", `no-calendar`/`read-only-calendar` → "Nenhuma agenda gravável escolhida", outros → "Não consegui gravar na agenda: <motivo curto>". `fields` permite a edição no cartão (título, start, end, allDay, location, notes, calendarId), revalidados no main com as mesmas regras.
- Evento criado → `main/chat/events-store.ts` (novo): `userData/chat-events.json` `{ version: 1, events: [{ actionId, chatId, calendarId, eventIdentifier, calendarItemIdentifier, externalIdentifier, title, start, end, allDay, createdAt }] }`, zod, 0600, atômico; só grava, ninguém lê ainda além dos testes.

### `main/chat/store.ts`
Zod dos três cartões persistidos (versão do arquivo compatível: cartão desconhecido em arquivo antigo continua tolerado como hoje).

### `main/schedules/service.ts`
`updateReminder(id, { at?: string; text?: string })` → `{ ok: true; task } | { ok: false; reason: 'missing' | 'past' | 'invalid' }`: só tarefa com `reminder`; `at` futuro; recalcula `schedule.once`/`nextRunAt`; mantém `runOnce`/`runOnceAction`; nome "Lembrete: <texto>" acompanha; persiste e emite `scribe:automations-changed`. `deleteTask(id)` como está (confira que emite).

### `shared/ipc.ts`, `main/index.ts`, `preload`
Canais `scribe:chat-action-event` e `scribe:chat-action-reminder-change` (`WHEN_LOCKED: 'refused'`), handlers com `.catch` tipado; `test/assistant.test.ts:206-213` passa a esperar os quatro canais `chat-action-*`; `lock-ipc.test.ts` verde.

### Contexto, instrução e guia
- `sources.ts`: `AUTOMACOES.md` e `ESTADO.md` listam cada lembrete como "Lembrete: <texto> · <quando> · id: <id>"; `ESTADO.md` ganha "## Agendas do Mac" com "- <título> (<fonte>)<, padrão>" das graváveis, ou "Sem acesso ao Calendário do Mac (peça em Configurações › Email › Convites)" / "Calendário indisponível". Nunca o id da agenda.
- `claude-cli/chat.ts`: instrução descreve os três blocos novos com exemplos, a regra "só proponha editar/apagar lembrete com o id listado em AUTOMACOES.md", "para evento use o nome de uma agenda listada em ESTADO.md ou omita", e troca "não cria tarefa, não envia mensagem, não muda nada" por "você propõe cartões; nada acontece sem o clique da pessoa".
- `resources/assistente/guia-do-app.md`: atualizar `:41` (lembrete pode ser alterado e apagado pelo Assistente, por cartão), `:45` ("não muda nada sozinho: tudo passa por cartão que você confirma"), `:116` ("o Assistente propõe eventos no Calendário do Mac por cartão; o app só grava quando você clica 'Pôr na agenda'; o app nunca apaga evento que não criou"); os testes do guia (`assistant.test.ts:436`) continuam verdes (marcadores `<!-- tela: … -->`).

### Renderer
- `ActionCards.tsx`: `EventCard` (artboards 02/03): ícone `calendar`, título, linha "sex 20/11 · 20:00–21:00" ou "sex 20/11 · dia inteiro" (pt-BR, `Intl`), local com ícone `map-pin` quando houver, seletor de agenda (`Select` do design com ponto de cor 8 px à esquerda do nome; some com `access !== 'full'` ou sem agendas), botões **Pôr na agenda** (primário, desabilitado sem `calendarId` ou sem acesso), **Editar** (abre campos: título, data, início, fim, dia inteiro, local, notas, agenda; Salvar/Cancelar só atualizam o cartão), **Descartar**; `Note` "O app ainda não tem acesso ao Calendário" + botão **Pedir acesso** (`scribe:invite-request-access`; depois refaz `resolve`? não: o cartão reconsulta `access`/agendas via canal `scribe:invite-calendars` existente e atualiza localmente) ou **Abrir Ajustes** quando `denied`; `done` → "Evento criado · <quando> · <agenda>" com ícone `check`; `failed` → erro + **Tentar de novo**.
- `ReminderEditCard` (04): "Lembrete: <texto atual>" e linha "antes → depois" (quando e/ou texto), **Salvar**, **Editar** (campos data/hora/texto), **Descartar**; `done` → "Lembrete alterado · <quando>".
- `ReminderDeleteCard` (05): "Apagar o lembrete '<texto>' de <quando>?", **Apagar lembrete** (`Button` variante `danger` existente), **Descartar**; `done` → "Lembrete apagado"; `failed` → "Esse lembrete não existe mais".
- `chatStore.ts`: `createEvent`, `changeReminder`; `data-chat-action="evento|lembrete-editar|lembrete-apagar"`, `data-action="chat-action-event-create|chat-action-event-edit|chat-action-reminder-save|chat-action-reminder-delete|chat-action-calendar-access"`.
- `ChatScreen.tsx`: remover o `PageHeader` e o subtítulo; a linha da conversa é o topo (mantém altura atual de 56 px e a borda inferior); nenhum espaço morto acima; sem conversa, o `EmptyState` atual.

### Smoke (`assistantChecks` += checks obrigatórios `eventCard`, `eventNoAccess`, `eventEdit`, `reminderEdit`, `reminderDelete`, `noHeader`)
- `fake-acp-agent.mjs`: regex "aniversário" → bloco `evento` (amanhã 20:00, local "Casa da Day", agenda "Pessoal"); "adie o lembrete" → `lembrete-editar` com o id que o smoke injeta na pergunta; "apague o lembrete" → `lembrete-apagar` idem; "evento inválido" → `evento` com início ontem (deve virar texto).
- `fake-lap-calendar.mjs`: confira que suporta `status`, `calendars` (com uma gravável "Pessoal" e uma só leitura) e `create`; se faltar, acrescente mantendo os testes de `mac-calendar.test.ts`. Para `eventNoAccess`, o falso precisa de um modo `not-determined` (variável de ambiente ou comando de teste já existente).
- `eventCard`: pergunta → `[data-chat-action="evento"]` com título e "Pessoal"; print `both('assistente-evento')`; clique em `chat-action-event-create` → `done`, `chat-events.json` com 1 evento, segundo clique não cria (contagem de `create` no falso).
- `eventEdit`: Editar, mudar título e hora, Salvar, Pôr na agenda → `create` recebeu os valores editados.
- `eventNoAccess`: com o falso em `not-determined`, cartão com a `Note` e "Pedir acesso", botão principal desabilitado.
- `reminderEdit`: criar lembrete pelo fluxo existente, perguntar "adie o lembrete <id> para amanhã 9h" → cartão antes→depois (print `assistente-lembrete-editar`), Salvar → tarefa com novo horário em `ctx.automations.listTasks()`, `[data-task-reminder]` atualizado.
- `reminderDelete`: cartão (print `assistente-lembrete-apagar`), Apagar → tarefa some; repetir com id apagado → cartão não aparece (texto).
- `noHeader`: `!document.querySelector('[data-page-header]')` na rota do Assistente (use o gancho que o `PageHeader` já tem, ou o título "Assistente" ausente) e a linha da conversa a 0 px do topo da área; prints antigos do Assistente ficam regravados automaticamente.
- `expectedShots += 6`.

### Testes unitários
`test/assistant.test.ts` (schemas e `resolve` dos três tipos: datas, agenda por nome, acesso, ids; lista de canais), `test/chat-events-store.test.ts` (novo), `test/automations-service.test.ts` (`updateReminder`: ok, missing, past, mantém runOnce), `test/chat.test.ts` (instrução contém os blocos novos e não contém mais "não muda nada"), `test/assistant.test.ts` guia.

## Critérios de aceite
CA1–CA10 da spec. pt-BR; tokens; sem cor literal/sombra/pílula; sem termos técnicos na UI; `lock-ipc` e `assistant` verdes.

## Invariantes
Cartões existentes (lembrete, whatsapp-resposta, email-*) intactos; convites por email intactos (`invites.json` não é tocado); o helper Swift não muda; nenhum evento é alterado ou apagado.

## Fora de escopo
Editar/apagar eventos; alarmes; Editar lembrete na tela de Automações; Google/Microsoft.

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-assistente-agenda && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde (smoke às vezes instável fora deste escopo: rode de novo e diga).

## Relatório final (formato)
Arquivos (uma linha cada); gates (contagens, `expectedShots` novo); diferenças em relação ao contrato/mockup e por quê; o que o revisor deve olhar nos prints.
