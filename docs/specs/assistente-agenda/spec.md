---
status: em-aprovacao
feature: assistente-agenda
data: 2026-11-20
semana: 2026-W47
---

# Spec: Assistente — eventos no Calendário do Mac, lembretes editáveis e tela sem cabeçalho

## Problema e objetivo

O Andrew pediu ao Assistente para pôr dois eventos na agenda e ele respondeu que só propõe lembretes do app. Ele também quer que o Assistente edite e apague lembretes, e que a tela do Assistente perca o cabeçalho "Assistente / Pergunte ou peça qualquer coisa…" (já removido nos artefatos de design). Tudo continua no modelo dos cartões: o Assistente propõe, o Andrew confirma com um clique, o app executa.

## Não-objetivos

- Editar ou apagar eventos do Calendário (nem os criados pelo app): fase seguinte, se o Andrew quiser.
- Alarmes nos eventos (o helper `lap-calendar` não mexe em alarme, por decisão do contrato 60).
- Editar lembretes pela tela de Automações (hoje "Editar" fica oculto para lembrete; continua assim).
- Ferramentas `lap-ferramenta` que alterem a agenda sem cartão.
- Google/Microsoft Calendar: só o Calendário do Mac, que é o que o helper escreve.

## O que existe hoje

- Lembrete = `ScheduledTask` com `reminder` (`shared/automations.ts`), criado por `automations.createReminder` (`main/schedules/service.ts`), avisado por notificação no tick de 30 s, listado em Automações › Tarefas agendadas; `saveTask` recusa editar lembrete; `scribe:tasks-delete` apaga.
- Cartões do Assistente: `CHAT_ACTION_KINDS` em `shared/assistant.ts`, bloco `lap-acao` validado em `main/chat/actions.ts` (`proposedSchema`, `resolve`), persistidos com zod em `main/chat/store.ts`, exibidos em `features/chat/ActionCards.tsx`, executados por `scribe:chat-action-reminder` (sem token de clique: o clique no cartão é a confirmação); `test/assistant.test.ts` fixa a lista de canais `scribe:chat-action-*`.
- Calendário do Mac: helper Swift `lap-calendar` (`main/mac-calendar/`) com `status`, `request-access`, `calendars` (id, título, fonte, `writable`, `isDefault`), `create` (`calendarId, title, start, end, allDay, timeZone, availability, location?, url?, notes?`), `update`, `remove`; permissão pedida em Configurações › Email › Convites; agenda padrão em `settings.inviteCalendarId`; eventos do app registrados em `userData/email/invites.json`, chaveados por conta de email.
- Contexto do Assistente: `ESTADO.md` e `AUTOMACOES.md` listam lembretes sem id e não listam agendas do Mac. Guia (`resources/assistente/guia-do-app.md:41,45,116`) e instrução de sistema (`main/claude-cli/chat.ts:159`) dizem que o Assistente não cria evento nem muda nada.
- Tela do Assistente (`features/chat/ChatScreen.tsx`): `PageHeader` "Assistente" com subtítulo, e abaixo a linha da conversa (título + Escopo + Modelo + Contexto). O artefato "Telas do LAP Reuniões" já mostra a tela sem o `PageHeader`.

## Regras

**R1. Cartão "evento".** Novo tipo `evento` em `CHAT_ACTION_KINDS`. O modelo propõe `{"tipo":"evento","titulo":"…","inicio":"<ISO com fuso>","fim":"<ISO>"|null,"diaInteiro":false,"local":"…"?,"notas":"…"?,"agenda":"<nome da agenda>"?}`. O app valida (`inicio` no futuro ou hoje; `fim` > `inicio`, padrão `inicio` + 1 h; dia inteiro ignora horas; título até 200, notas até 4000) e resolve a agenda: a nomeada, se existir e for gravável; senão `inviteCalendarId`; senão a agenda padrão gravável do Mac. O cartão mostra ícone `calendar`, título, "sex 20/11 · 20:00–21:00" (ou "dia inteiro"), local, e a agenda num seletor com as agendas graváveis (cor da agenda como ponto); botões **Pôr na agenda** (primário), **Editar** (título, data, hora início/fim, dia inteiro, local, notas) e **Descartar**. Clique em "Pôr na agenda" → canal `scribe:chat-action-event` `{chatId, index, actionId, calendarId, fields?}` → `macCalendar.create` → cartão `done` com "Evento criado · sex 20/11 20:00 · <Agenda>" e ids do EventKit gravados em `userData/chat-events.json` (novo registro `{ actionId, chatId, calendarId, eventIdentifier, calendarItemIdentifier, externalIdentifier, title, start, createdAt }`, para a fase de editar/apagar). Sem acesso ao Calendário: o cartão mostra `Note` "O app ainda não tem acesso ao Calendário" com botão **Pedir acesso** (`scribe:invite-request-access`) e, negado, **Abrir Ajustes**; o botão "Pôr na agenda" fica desabilitado até liberar. Erro do helper vira texto em pt-BR no cartão, status `failed`, com "Tentar de novo".

**R2. Cartões "lembrete-editar" e "lembrete-apagar".** Novos tipos. O modelo propõe `{"tipo":"lembrete-editar","id":"<id da tarefa>","quando":"<ISO>"?,"texto":"…"?}` e `{"tipo":"lembrete-apagar","id":"…"}`. O app só aceita `id` de tarefa com `reminder` existente (senão vira texto). Editar: cartão mostra "Lembrete: <texto atual> · <quando atual>" → "<novo>", com **Salvar** (e **Editar** para ajustar antes) e **Descartar**; apagar: cartão "Apagar o lembrete '<texto>' de <quando>?" com **Apagar lembrete** (botão de perigo) e **Descartar**. Canal `scribe:chat-action-reminder-change` `{chatId, index, actionId, op: 'update'|'delete', at?, text?}` → `automations.updateReminder(id, {at?, text?})` (novo no serviço: mantém `runOnce`, recalcula `nextRunAt`, recusa passado) ou `automations.deleteTask(id)`; cartão `done` com "Lembrete alterado · …" / "Lembrete apagado". Lembrete já disparado ou apagado entre a proposta e o clique → `failed` com "Esse lembrete não existe mais".

**R3. O modelo precisa dos ids e das agendas.** `AUTOMACOES.md` e `ESTADO.md` passam a listar cada lembrete com `id`; `ESTADO.md` ganha a seção "Agendas do Mac" com as agendas graváveis (nome, fonte, padrão) ou a frase "Sem acesso ao Calendário do Mac" (nunca o id da agenda: o app resolve pelo nome). Instrução de sistema (`claude-cli/chat.ts`) e guia do app descrevem os três blocos novos e corrigem as frases "não cria eventos"/"não muda nada" para "propõe cartões; só você confirma". Limite de 6 cartões por resposta continua.

**R4. Tela do Assistente sem cabeçalho.** `ChatScreen.tsx` perde o `PageHeader` ("Assistente" + subtítulo): a linha da conversa (título editável + Escopo + Modelo + Contexto, 52 px, borda inferior) passa a ser o topo da tela, como no artefato. Sem conversa aberta, o `EmptyState` existente continua. Nada muda no nível Assistente do sidebar nem no trilho Contexto. O guia e `docs/telas` acompanham.

**R5. Segurança e bloqueio.** Os dois canais novos entram em `WHEN_LOCKED` como `refused`; `test/assistant.test.ts` atualiza a lista fixa de canais. Nenhuma ação roda sem clique no cartão; texto de terceiros nunca vira instrução; o evento criado nunca é apagado nem alterado sem cartão (fase seguinte).

## Telas de impacto no usuário

1. **Assistente**: tela sem o cabeçalho "Assistente / Pergunte ou peça qualquer coisa…".
2. **Assistente › cartões**: três cartões novos (evento no Calendário; editar lembrete; apagar lembrete), com estados proposto/feito/erro e o aviso de permissão do Calendário.
3. **Painel Contexto**: nada muda de visual; o `ESTADO.md` cresce.
4. **Automações › Tarefas agendadas**: lembretes editados/apagados pelo Assistente refletem na lista (sem UI nova).

## Critérios de aceite

- **CA1.** Pergunta "marque o aniversário do Jefferson hoje às 20h" → cartão evento com título, horário, agenda padrão; "Pôr na agenda" cria o evento (no smoke, no helper falso) e o cartão vira "Evento criado · …"; segundo clique não cria de novo.
- **CA2.** Sem acesso ao Calendário, o cartão mostra o aviso e "Pedir acesso"; com acesso, some.
- **CA3.** Início no passado, fim antes do início ou agenda só de leitura → o cartão nem é montado (vira texto) ou a edição recusa com a razão.
- **CA4.** Editar no cartão (data, hora, título, agenda) antes de confirmar funciona e o evento criado reflete a edição.
- **CA5.** `AUTOMACOES.md`/`ESTADO.md` trazem `id` dos lembretes e a seção "Agendas do Mac"; `ESTADO.md` sem id de agenda.
- **CA6.** "adie o lembrete X para amanhã 9h" → cartão lembrete-editar com antes/depois; Salvar muda a tarefa (próxima execução e texto) e o cartão vira "Lembrete alterado"; id inexistente → texto.
- **CA7.** "apague o lembrete X" → cartão de perigo; Apagar remove a tarefa; Descartar não; lembrete já apagado → "não existe mais".
- **CA8.** Tela do Assistente sem `PageHeader`; a linha da conversa é o topo; prints do smoke do Assistente regravados; nenhum check antigo depende do título "Assistente".
- **CA9.** Canais novos `refused` bloqueado; `assistant.test.ts` e `lock-ipc.test.ts` verdes; guia e instrução atualizados e cobertos pelos testes do guia.
- **CA10.** Smoke: checks `eventCard`, `eventNoAccess`, `reminderEdit`, `reminderDelete`, `noHeader`; prints `assistente-evento`, `assistente-lembrete-editar`, `assistente-lembrete-apagar` (claro/escuro).

## Prints exigidos
Os do CA10 e os prints existentes do Assistente regravados sem cabeçalho.

## Riscos
- O modelo pode inventar id de lembrete: o app descarta e o cartão não aparece (CA6).
- Fuso: `inicio` com fuso explícito; sem fuso, o app assume o do Mac e o cartão mostra o horário local.
- Agenda padrão inexistente (sem `inviteCalendarId` e sem agenda gravável): cartão com aviso "Nenhuma agenda gravável" e botão desabilitado.

## Fora de escopo
Ver Não-objetivos.

## Verificação end-to-end
Build local (junto com a frente Instagram): Andrew pede um evento real, confirma e vê no Calendário do Mac; edita e apaga um lembrete pelo Assistente; teste navegado em sessão nova depois.
