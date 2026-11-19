---
status: aprovado
feature: convites-agenda
data: 2026-11-19
---

# Plan — Convites de reunião no email → Calendário do Mac

> Aprovado pelo Andrew em 19/11/2026, junto com o mockup `docs/specs/desktop-shell/mockups/ConvitesAgenda.dc.html` (D1–D20 como propostas; D5: dá para mudar a resposta depois, cada troca manda um REPLY novo).

Spec: [spec.md](./spec.md). Contratos em `docs/specs/desktop-shell/contracts/` (59 a 64), como as outras features do app.

## Decisões técnicas
- **D1 — Calendário do Mac por um helper Swift `lap-calendar`.** Mesmo molde do `native/mic-watch`: `native/calendar/main.swift`, compilado no `scripts/pack.sh` (`swiftc -O -target arm64-apple-macos14.4`), com um Info.plist embutido (`-Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist`), assinado e verificado como o `lap-mic-watch`, em `Contents/Resources/bin/`. Protocolo: uma requisição JSON por linha no stdin, uma resposta por linha no stdout, com `id`; comandos `status`, `request-access`, `calendars`, `refresh` (`refreshSourcesIfNecessary`), `find {uid, title, start, end, ids?}` (todas as agendas), `create`, `update` e `remove` com `recurrenceId?` e `span: 'this' | 'future'`. Instantes em UTC + fuso IANA (N11). `create` devolve `eventIdentifier`, `calendarItemIdentifier` e `calendarItemExternalIdentifier` lidos depois de salvar. Sai quando o stdin fecha. Por que: o EventKit não tem binding no Node, e um processo separado não derruba o app.
- **D0 — Teste rápido no Mac real antes do 60.** Um script Swift descartável, rodado pelo Andrew dentro de um `.app` de teste, responde três perguntas que mudam o desenho: (1) o pedido de acesso do helper filho aparece em nome do app e é lembrado entre versões assinadas ad hoc; (2) o `calendarItemExternalIdentifier` de um evento que o Gmail pôs na agenda é o UID do convite (Google/CalDAV e Exchange); (3) quanto tempo leva para a cópia da conta aparecer depois do `refresh`. Resultado vai para a nota do cofre e, se preciso, ajusta o R5.
- **D2 — Acesso completo, não "só adicionar".** O acesso só de escrita (`requestWriteOnlyAccessToEvents`) não lista agendas, não acha evento existente e não atualiza: inviabiliza R5, R6 e R9. `extendInfo.plist` ganha `NSCalendarsFullAccessUsageDescription` (e a chave antiga `NSCalendarsUsageDescription`).
- **D3 — Parser de iCalendar: `ical.js`** (Mozilla, MPL-2.0 sem a cláusula de incompatibilidade, então compatível com a GPL-3.0 do projeto, MPL §3.3). Trata desdobramento de linhas, TZID/VTIMEZONE, RRULE/EXDATE/RECURRENCE-ID. O módulo puro `shared/invite.ts` envolve o `ical.js`, registra o VTIMEZONE do convite (`TimezoneService.register`), converte TZID do Windows por tabela (N11), devolve o tipo `EmailInvite` e gera o REPLY completo do R3. **Empacotamento:** `ical.js` entra no `exclude` do `electron.vite.config.ts` (como `imapflow`/`nodemailer`/`mailparser`), e o `pack.sh` confere que o módulo existe dentro do `.app` (os gates não rodam o `pack.sh`, então a 59 inclui essa checagem).
- **D4 — Extração no parse do corpo.** `parseEmail` (`main/email/service.ts`) passa a guardar `invite?: EmailInvite` dentro do `EmailBody` (a parte `text/calendar` já vem em `attachments` do mailparser; vale a regra N10). O `bodySchema` de `main/email/email-store.ts` (hoje `z.object` não estrito, que descartaria a chave nova) ganha `invite` opcional. Corpos antigos: N12.
- **D5 — REPLY pelo caminho que já existe, sem registro.** `Delivery` ganha `icalEvent?: { method: 'REPLY'; content: string }` e `record?: false`; o `deliver` passa o `icalEvent` ao `OutgoingMail` (o nodemailer monta `text/calendar; method=REPLY` e o `invite.ics`) e, com `record: false`, **pula** a gravação em Enviados, o `setBody`, o `APPEND` e a marca `answered`. Entrada nova `sendInviteReply(accountId, messageKey, partstat, clickToken)` no service, que monta destinatário, assunto e ICS no main, com trava por convite (R3).
- **D6 — Registro do app.** `main/invites/store.ts` com `userData/email/invites.json` (0600, gravação atômica, fila), como o `email-store`, no formato do N3 (todo convite visto; `event` só quando o app gravou).
- **D7 — Não duplicar.** Antes do `find`, `refresh`; `find` olha todas as agendas e casa por external id = UID ou por título + início exato (R5a). Conta Gmail/Microsoft pelo host IMAP: padrão desligado (R5b). Reconciliação do R5c ao abrir o cartão e a cada leitura de agenda. Não acha ≠ erro.
- **D8 — Atualizar e cancelar no clique.** Mudança e cancelamento mostram o botão; não aplicam sozinhos. Por que: o Andrew decide se mexe na própria agenda, e um CANCEL forjado não apaga nada sem ele ver.
- **D9 — Sem o Mac.** Fora do macOS ou sem o helper, o serviço responde `unavailable` e a tela troca para "Abrir no app de agenda" (`shell.openPath` num `.ics` temporário em `userData/tmp`, apagado ao sair).
- **D10 — IA só no R11**, com `runClaudeOneShot` (Haiku), purpose novo `invite-suggest`, resposta em JSON validada por zod; nenhum dado vai sem o clique "Sugerir evento".

## Grafo de tarefas
| # | Microtarefa | Arquivos que toca | Depende de | Wave |
|---|---|---|---|---|
| D0 | Teste rápido no Mac real (TCC do helper, external id = UID no Google e no Exchange, tempo de sincronia) | script descartável fora do repo | — | 0 |
| 59 | Parser e gerador iCalendar: `EmailInvite`, `parseInvite` (N10, N11), `buildReply` completo (R3), link da reunião, recorrência em português e o que dá ou não para gravar (N8), testes com convites reais anonimizados (Google, Outlook com TZID do Windows, Teams, Zoom sem VTIMEZONE, iCloud) | `package.json` (`ical.js`), `electron.vite.config.ts`, `scripts/pack.sh` (checagem do módulo), `shared/invite.ts`, `shared/windows-zones.ts`, `test/invite.test.ts`, `test/fixtures/invites/*` | — | 1 |
| 60 | Helper `lap-calendar` (EventKit; ocorrência por `recurrenceId` + `span`; ids lidos depois de salvar) + cliente `main/mac-calendar/process.ts` + helper falso para o smoke + plist do app e do helper | `native/calendar/main.swift`, `native/calendar/Info.plist`, `src/main/mac-calendar/*`, `build/extendInfo.plist`, testes | D0 | 1 |
| 61 | Email: convite no parse e no `bodySchema`, corpos antigos (N12), REPLY pelo `deliver` com `record: false` e trava por convite, canal `scribe:invite-reply`, testes com o SMTP falso | `main/email/{service,smtp-client,email-store}.ts`, `shared/{email,ipc}.ts`, `test/lock-ipc.test.ts` | 59, email-organizacao na main, 56 commitado | 2 |
| 62 | Serviço de convites: registro `invites.json` (N3), `refresh`/`find`/`create`/`update`/`remove`, reconciliação (R5c), R5b pelo host, estados do R7, permissão, fallback do `.ics`, IPC (`scribe:invite-state`, `-add`, `-update`, `-remove`, `-calendars`), testes | `main/invites/*`, `main/index.ts`, `main/email/service.ts` (endereço da conta e corpo), `shared/ipc.ts`, settings (`inviteCalendarId`, `inviteAddOnAccept`, `inviteSuggest`) | 60, 61 | 3 |
| 63 | Telas: cartão no `ReadingPane`, ícone na lista, bloco "Convites" em Configurações, smoke com os passos 1–11 da verificação e prints `email-convite-*-light/-dark` | `renderer/src/features/email/*`, `renderer/src/features/settings/*`, `main/smoke.ts`, guia do app, README | 62, mockup aprovado, 55 na main | 4 |
| 64 | Regras: condição `isInvite` e ação `addToCalendar` (com `needsBody` e erros `calendar-denied`/`no-calendar`) + IA "Sugerir evento" (R11) | `shared/email-rules.ts`, `main/email/rules.ts`, `main/email/service.ts`, editor de regras do 55, `main/invites/suggest.ts`, `main/acp/profiles/types.ts` (`AcpPurpose`), `main/meetings/claude-one-shot.ts` | 62, 53 e 55 na main | 5 |

- A wave 0 é só do Andrew (precisa do Mac real e do `.app`). A 59 não depende dela e pode correr junto.
- Wave 1 (59 e 60) não toca nenhum arquivo do email nem os da sessão que faz 53/55/56: pode começar logo depois da aprovação, num worktree próprio (`meeting-scribe-convites`, branch `convites-agenda`), a partir da main.
- Teste navegado do fechamento: só com o SMTP e o helper falsos; o teste com convite real é manual, do Andrew, no `.app` (no `pnpm dev` o pedido de acesso do macOS não funciona).
- 61 e 62 mexem em `service.ts` e `ipc.ts`, os mesmos do 56. Começam depois que a `email-organizacao` estiver na main e o 56 commitado (ou numa janela combinada com a outra sessão).
- 63 depende do 55 por causa do `ReadingPane` e da aba Email.

## Gates desta feature
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos em toda tarefa.
- 60, além disso: `swiftc` compila o helper sem aviso, e o `pack.sh` gera o `.app` com o helper assinado (`codesign --verify --strict`).
- Teste manual do Andrew no fim: convite real do Google e do Teams no Calendário do Mac (passo 8 da verificação).
