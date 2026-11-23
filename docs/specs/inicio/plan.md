---
status: pronto
feature: inicio
tipo: plan
data: 2026-11-22
semana: 2026-W47
base: main 81c71ae (versão 0.21.1)
contratos: 132 a 137
---

# Plan: Início (dashboard do dia)

PRD `prd.md` · Mockup `mockups/Inicio.dc.html` (artboards `InicioDia`, `InicioGravando`, `InicioVazio`; escolhas D1 a D5 do mockup valem como regra) · Branch `inicio` (base 81c71ae). Caminhos relativos a `apps/desktop/`. Contratos **132 a 137**.

## Decisões técnicas

1. **D1. Rota e item da barra.** `RouteId` ganha `'inicio'` e `ROUTE_PATHS.inicio = '/inicio'` (`src/shared/routes.ts`); linha nova **no topo** de `APP_ROUTES` (`renderer/src/app/routes.tsx:26`), com `nav: { label: 'Início', icon: House }`. A `Sidebar` monta `NAV_ITEMS` a partir de `APP_ROUTES` (`app/Sidebar.tsx:24`): nenhuma outra mudança nela, sem badge e sem nível em pilha. `'/'` continua sendo Reuniões (nenhum caminho existente muda).
2. **D2. Tela inicial.** Hoje é fixa: `INITIAL_ENTRIES = [ROUTE_PATHS.reunioes]` (`app/App.tsx:31`). Como `boot.tsx` já espera `loadSettings()` antes do `render`, `App` passa a ler `useSettings.getState().settings.inicio.telaInicial` uma vez, no primeiro render: `'inicio'` → `/inicio`, `'reunioes'` → `/`. Trocar a preferência vale na próxima abertura (sem navegar na hora).
3. **D3. Agenda do dia no main, o resto no renderer.** Só a agenda espelhada e as Pendências precisam de dado novo; Tarefas, Última reunião, Automações e "Gravando agora" reusam os stores que já existem no renderer (D9). Serviço novo `src/main/inicio/service.ts` com dependências injetadas (`calendar.dayEvents`, `macDay`, `meetings.list`, `whatsapp.chats`, `email.pendentesEmCache`, `timeZone`, `now`, `onChange`), sem timer próprio e sem gravar arquivo; domínio desligado ou com falha vale `null` (linha some).
4. **D4. Janela da agenda Google/Microsoft.** `calendar/service.ts:186-187` lê de agora −1 h a +24 h: não cobre a manhã já passada nem o "Amanhã" inteiro. A janela vira `[min(início do dia local, agora − 1 h), fim de amanhã local]` (mesmos endpoints, mesma cadência de 5 min: nenhuma rede nova). `CalendarService` ganha `dayEvents(from, to): CalendarEvent[]` (deduplicado por `dedupeEvents`, `shared/calendar.ts:56`) e a dependência `onRead?()`, chamada no fim de cada `doRefresh` (o `onView` só dispara quando "Próximas"/faixa mudam). Avisos, "Próximas", faixa e menu do ícone não mudam (`upcomingEvents` filtra por 24 h).
5. **D5. Calendário do Mac: comando novo `list`.** O helper só tem `find` (procura **um** evento por ids/UID/título+início, `native/calendar/main.swift:512`); não há listagem do dia. Mínimo: comando `list { start, end }` só de leitura (`events(from:to:in: nil)` já existe em `main.swift:456`), até 200 eventos, sem agendas `birthdays`, com `requireFullAccess()`; protocolo em `mac-calendar/protocol.ts` (args `.strict()`, resultado `{ events: eventOutSchema[] }`, `MAC_CALENDAR_VERSION = 'lap-calendar 2'`), `MacCalendar.list()` em `process.ts`, falso em `test/fixtures/fake-lap-calendar.mjs`. Acesso: `status` pelo `cachedCalendarReads` já existente (`chat/actions.ts:455`, ligado em `index.ts:1485`); "conceder" chama `macCalendar.requestAccess()` e depois `calendarReads.invalidate()`. No `pnpm dev` o `request-access` volta `unavailable/dev` (`process.ts:349`): a linha diz isso.
6. **D6. Leitura do Mac em memória.** `macDay` guarda o último `list` (hoje + amanhã) por 5 min (`CALENDAR_REFRESH_MS`), esquecido no `browser-window-focus` (como `index.ts:1486`) e depois do "conceder". Nada vai para disco.
7. **D7. Deduplicação entre fontes** (pura, `src/shared/inicio.ts`, `juntarAgenda`). Google×Microsoft já saem únicos (`dedupeKey`: `uid` ou título+início). Contra o Mac, o evento do Mac é o mesmo quando: (a) `externalIdentifier` do Mac é igual ao `uid` do evento da conta (comparação exata, como o `find`); **ou** (b) mesmo `allDay`, início igual ao minuto (|Δ| < 60 s) e título equivalente: `normalizar(t)` = NFD sem acentos, minúsculas, pontuação vira espaço, espaços colapsados, sem prefixos `convite:`/`invitation:`/`updated invitation:`; equivalentes se iguais, ou se um começa com o outro (≥ 6 caracteres) **e** o fim também é igual ao minuto. Fica a cópia da conta (tem `calendarKey` para Transcrever/link); `fontes` guarda as duas para a etiqueta. Cancelados (`status: 'cancelled'`) e recusados (`myResponse: 'declined'`) não entram.
8. **D8. Pendências** (contagens calculadas no main, `InicioPendencias = { whatsapp; convites; emails }`, `null` = fonte desligada):
   - **WhatsApp** — regra pura `whatsappSemResposta(chats, now)`: `kind === 'person'` (grupos não contam), `lastMessage` existe, `!lastMessage.fromMe` e chegou há ≤ 7 dias (`shared/whatsapp.ts:94`). `null` com o serviço parado/não instalado (`whatsapp.status()`).
   - **Convites** — eventos da agenda da conta (janela do D4) com `myResponse === 'none'`, confirmados, com participantes e que ainda não acabaram. `null` sem conta com agenda. (O `invites.json` não serve: só registra convites de mensagens abertas.)
   - **Email** — `EmailService.pendentesEmCache()` soma o `total` da pasta cuja última parte é "Pendentes" (sem diferenciar maiúsculas/acentos, como `organizeState.ts:99`) **só** do `folderCache` do LIST já guardado (`email/service.ts:1295`; `ImapFolderEntry.total`). Nunca abre sessão IMAP. `null` sem pasta "Pendentes" em cache.
9. **D9. Blocos que reusam stores do renderer.** Tarefas: `useTarefasView()` + `particao(view.tarefas, view.hoje)` (`shared/tarefas-logic.ts:67`) para vencidas e Hoje (até 6); concluir = `useTarefas.getState().status(id, 'feita')`; a caixa reusa a de `TarefaLinha` (escolha D3 do mockup). Última reunião: `useMeetingsOverview()` (`features/meetings/useMeetingsOverview.ts`), primeira da lista, `summary.overview`. Automações: `useAutomations` (`status.next[0]`; falha = tarefa com `lastStatus` `'error'`/`'timeout'` mais recente, link para Automações › Execuções). Gravando: `useRecording` (`session`, `title`, `capture.phase`) com o padrão visual de `RecordingNow.tsx`. Transcrever: `useRecordEvent(calendarKey)` (`features/calendar/useRecordEvent.ts`) para evento de conta; evento só do Mac chama `useStartRecording()`.
10. **D10. IPC** (`src/main/inicio/ipc.ts`, `registerInicioIpc`; tipos em `src/shared/ipc.ts`): `scribe:inicio-get` → `InicioView = { hoje; agenda: { eventos: InicioEvento[]; amanha: number; contas: boolean; mac: 'ok' | 'sem-acesso' | 'dev' | 'indisponivel' }; pendencias; saudacaoNome: string | null }`; `scribe:inicio-mac-acesso` → `InicioView`; evento `scribe:inicio-changed` (view inteira). Os três `'refused'` em `WHEN_LOCKED`; broadcast só desbloqueado (padrão de `index.ts:1879`). `InicioEvento` nunca leva o link da chamada (só `chamada: 'meet' | 'teams' | 'zoom' | null`, como `CalendarUpcoming.hasJoinUrl`). Preload não muda (genérico sobre `INVOKE_CHANNELS`/`MAIN_EVENT_CHANNELS`). `reuniaoId` do evento: reunião com `calendar.eventId` igual, ou (Mac) `startedAt` em `[início − 10 min, fim]` com título equivalente (D7).
11. **D11. Feature no renderer** em `features/inicio/` (modelo: `features/tarefas/`): `inicioStore.ts` (zustand; `load` + `watch` como `tarefasStore.ts`, `rereadWhenUnlocked` como `calendarStore.ts`, relê no foco da janela), `InicioScreen.tsx`, `AgendaDia.tsx` (linha do tempo comprimida 08:00–19:00 do mockup D2, "agora" recalculado a cada minuto), `CartaoTarefas.tsx`, `CartaoPendencias.tsx`, `CartaoUltimaReuniao.tsx`, `CartaoAutomacoes.tsx`, `inicioFormat.ts` (saudação por hora, data por extenso pt-BR, "livre até HH:mm", "Amanhã: N eventos"). Duas colunas (agenda 380 px), só `tokens.css`, escala densa, raio ≤ 6, sem sombra.
12. **D12. Saudação.** `saudacaoNome` = primeiro nome do perfil da conta Google (ou Microsoft) já em memória; sem conta, só "Boa tarde". Nenhuma leitura nova.
13. **D13. Settings.** `InicioSettings = { telaInicial: 'inicio' | 'reunioes'; blocos: { agenda; tarefas; pendencias; ultimaReuniao; automacoes: boolean } }` em `shared/settings-defaults.ts` (padrão `'inicio'`, todos `true`), lenient + patch em `main/settings/schema.ts` (padrão de `tarefas`, `schema.ts:128-141,203,260`), linhas de busca em `shared/settings-index.ts`. `InicioSection.tsx` em Configurações › Geral logo depois de "Janela" e antes de `FunilSection` (`SettingsScreen.tsx:312-314`).
14. **D14. Smoke.** Hoje o smoke assume que o app abre em Reuniões (`smoke.ts:16425`). 135 adiciona `'inicio-dia'` a `SCREENS` (17 → 18) e `inicio-gravando-{light,dark}` por `extraShot` (durante `recordingChecks`); 136, ao virar a tela padrão, confere a rota `inicio` na abertura, fotografa `inicio-vazio-{light,dark}` ali e faz `clickNav('reunioes')` antes do `shoot('reunioes')`; mais `inicio-sem-acesso-mac-light` e `configuracoes-geral-inicio-light`. Eventos do Mac semeados no `statePath` do falso; Google pelo falso do contrato 12. Todo `detail` só com números e booleanos. `expectedShots` final: `SCREENS.length * THEMES.length + 228` (8 PNGs novos).
15. **D15. Só leitura.** Nenhum canal novo grava evento, convite, mensagem ou arquivo; a única escrita é a preferência (D13) e o concluir tarefa pelo canal existente.

## Limitações aceitas da v1

- Transcrever num evento que só existe no Mac não vincula a gravação ao evento (o `calendar-record` só conhece eventos de conta); a gravação começa sem agenda.
- "Email pendentes" depende do cache do LIST: antes da primeira abertura da tela Email na sessão, a linha não aparece.
- Trocar a tela inicial nas Configurações vale na próxima abertura do app, não na hora.

## Grafo de tarefas

| # | Microtarefa | Arquivos principais | Depende de | Wave |
|---|---|---|---|---|
| 132 | Helper `list` do Calendário do Mac | `native/calendar/main.swift`, `src/main/mac-calendar/{protocol,process}.ts`, `test/fixtures/fake-lap-calendar.mjs`, `test/mac-calendar.test.ts` | — | 1 |
| 133 | `InicioSettings` (dados) e lógica pura | `src/shared/{settings-defaults,settings-index,inicio}.ts`, `src/main/settings/schema.ts`, `test/settings-store.test.ts`, `test/inicio-logic.test.ts` | — | 1 |
| 134 | Serviço agregado + IPC + janela da agenda + pendências | `src/main/inicio/{service,ipc}.ts`, `src/main/calendar/service.ts`, `src/main/email/service.ts`, `src/shared/ipc.ts`, `src/main/index.ts`, `test/{inicio-service,inicio-ipc,calendar,email-service,lock-ipc}.test.ts` | 132, 133 | 2 |
| 135 | Tela Início + rota + barra lateral | `src/shared/routes.ts`, `app/routes.tsx`, `features/inicio/**`, `src/main/smoke.ts`, `src/main/smoke-fixtures.ts`, `test/renderer/{inicio-format,sidebar-stack}.test.ts` | 134, artboards 01 e 02 | 3 |
| 136 | Configurações › Início, tela inicial padrão, estados menores, smoke | `app/App.tsx`, `features/settings/{SettingsScreen,InicioSection}.tsx`, `features/inicio/{InicioScreen,AgendaDia}.tsx`, `src/main/smoke.ts` | 135, artboard 03 | 4 |
| 137 | Docs e fechamento | `README.md`, `resources/assistente/guia-do-app.md`, `docs/specs/desktop-shell/design.md`, `docs/telas/**`, `docs/specs/inicio/{notas-release,auditoria-prints}.md` | 136 | 5 |

Arquivos quentes (um contrato por wave): `smoke.ts` 135 (3), 136 (4), 137 só auditoria (5) · `shared/ipc.ts`, `index.ts` 134 (2) · `routes.ts`, `routes.tsx` 135 (3) · `settings-defaults.ts`, `schema.ts` 133 (1) · `SettingsScreen.tsx`, `App.tsx` 136 (4) · `guia-do-app.md` 137 (5). Wave 1: 132 e 133 sem arquivo em comum.

## Waves e contratos

### Wave 1 — fontes
**132 · Calendário do Mac: listar o dia.** Comando `list { start, end }` no helper, no protocolo, no cliente e no falso (D5); só leitura, até 200, sem `birthdays`, exige acesso total. Versão `lap-calendar 2`. *Gate:* `test/mac-calendar.test.ts` com casos de `list` (janela, limite, `denied` → erro tipado, chave a mais recusada); `swiftc` do `pack.sh` compila com `-warnings-as-errors`; `pnpm gates` verde.

**133 · Dados e regras puras do Início.** `InicioSettings` (D13) e `src/shared/inicio.ts`: tipos de `InicioView`, `juntarAgenda` (D7), `whatsappSemResposta`, `convitesSemResposta` (D8), `diaLocal`/fim de amanhã no fuso do Mac, `reuniaoDoEvento` (D10). *Gate:* `test/inicio-logic.test.ts` cobre cada ramo do D7 (uid, título normalizado, prefixo + fim, all-day × hora, cancelado/recusado fora) e do D8; `test/settings-store.test.ts` (padrão, lenient, patch); lint zero avisos.

### Wave 2 — agregado no main
**134 · Serviço `inicio` e IPC.** Janela da agenda e `dayEvents`/`onRead` (D4), `macDay` com cache em memória (D6), `pendentesEmCache` no email (D8), serviço (D3) e canais (D10) ligados em `index.ts` (só blocos de ligação); `scribe:inicio-changed` em `onRead`, na leitura do Mac, em `scribe:whatsapp-message` e na mudança de pastas do email. *Gate:* `test/inicio-service.test.ts` (fontes desligadas → `null`; Mac `sem-acesso`/`dev`; dedupe ponta a ponta; nenhum link de chamada na view); `test/inicio-ipc.test.ts` (zod `.strict()`, `refused` bloqueado); `test/calendar.test.ts` com a janela nova e avisos inalterados; `test/email-service.test.ts` prova que `pendentesEmCache` não abre sessão; `test/lock-ipc.test.ts` verde.

### Wave 3 — a tela
**135 · Tela Início, rota e item da barra.** D1, D9, D11, D12 conforme `InicioDia` e `InicioGravando`: cabeçalho, agenda com evento atual destacado e Transcrever, "Reunião gravada", "Amanhã: N", cartões; teclado alcança tudo; app ainda abre em Reuniões. *Gate:* `test/renderer/inicio-format.test.ts` (saudação, extenso, "livre até", linha comprimida); `sidebar-stack.test.ts` com Início primeiro; smoke `inicio-dia-{light,dark}` e `inicio-gravando-{light,dark}`, checks de concluir tarefa (some do cartão e da tela Tarefas) e de dedupe (evento Google + cópia no Mac = 1 linha); `expectedShots` `+ 224`.

### Wave 4 — configurações e estados
**136 · Configurações › Início, tela inicial e estados menores.** `InicioSection` (tela inicial + 5 blocos), D2 em `App.tsx`, linha "Calendário do Mac sem acesso — conceder" (e a variante do dev), "Sem eventos hoje", Pendências oculta sem nenhuma, bloco desligado não renderiza. *Gate:* smoke confere abertura em `/inicio`, `inicio-vazio-{light,dark}`, `inicio-sem-acesso-mac-light` (o falso em `denied`; clicar chama `request-access` no log do falso), `configuracoes-geral-inicio-light`; com `telaInicial: 'reunioes'` gravado, a próxima abertura volta a `/`; `expectedShots` `+ 228`.

### Wave 5 — fechamento
**137 · Docs.** README (tela Início), `guia-do-app.md` (seção Início e a preferência), `design.md`, `docs/telas`, auditoria dos 8 prints, notas da versão. *Gate:* `test/assistant.test.ts` (marcador do guia) verde; auditoria lista cada PNG novo contra o artboard; `pnpm gates` verde.

## Gates

Da raiz do worktree: `cd <worktree> && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` (typecheck node/preload/web, eslint `--max-warnings 0`, vitest, build, smoke, cores só de `tokens.css`, `check-shapes.sh`, pytest da ponte). Ajuste mecânico liberado: testes que quebrarem só por `AppSettings.inicio` obrigatório (133) ou `CalendarServiceDeps.onRead` (134) ganham o campo com o padrão, sem mudar asserção; o relatório lista os arquivos.
