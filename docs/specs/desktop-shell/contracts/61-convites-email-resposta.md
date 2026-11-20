# Contrato 61 — Convites no email: o convite no corpo, corpos antigos e o REPLY com um clique
Feature: convites-agenda · Wave: 2 · Depende de: 59, 56 · Spec: `docs/specs/convites-agenda/spec.md` (R1, R3, N1, N5, N6, N7, N10, N12) · Plan: `docs/specs/convites-agenda/plan.md` (D4, D5)

Este contrato liga o módulo puro do 59 (`shared/invite.ts`) ao email: o convite passa a ser lido no mesmo parse do corpo
e guardado dentro dele, os corpos guardados antes desta feature ganham o convite uma vez, e o Aceitar / Talvez / Recusar
manda o REPLY ao organizador **só no clique**, pelo `deliver` que já existe, sem virar "enviado". É só main + preload +
IPC + testes. O registro `invites.json`, o Calendário do Mac e os canais `scribe:invite-state/-add/-update/-remove/
-calendars` são do 62; o cartão e qualquer tela, do 63. Por isso nada aqui aparece para quem usa (ver "Telas").

## Pré-condições
- **O 61 só é implementado depois do commit do contrato 56** (branch `email-agente`). O 56 mexe em
  `main/email/service.ts`, `shared/ipc.ts` e `main/email/fake-email.ts`, os mesmos arquivos deste contrato; começar antes
  dá conflito. Conferir na raiz do repo principal: `git log --oneline main | grep -i "contrato 56"` mostra o commit do 56
  já na main (se ainda estiver só na `email-agente`, **parar** e avisar quem coordena: não implementar em cima da branch dele).
- **Antes da primeira linha de código, o implementador faz merge da main** no worktree
  `/Users/andrew/Documents/GitHub/meeting-scribe-convites` (branch `convites-agenda`): `git status` limpo →
  `git merge main` → resolver conflitos (se houver, só em `pnpm-lock.yaml`/`package.json` ou docs; conflito em código
  do email = parar e avisar) → gates verdes **antes** de começar o 61. Depois do merge:
  - `grep '"version"' apps/desktop/package.json` mostra `0.16.0` ou mais nova (o worktree hoje está na 0.15.0: em
    19/11/2026 ele **não** tem os contratos 52, 53 e 54; quem traz é este merge);
  - `apps/desktop/src/main/email/rules.ts` existe e `service.ts` tem `moveQueued`, `pruneAccount`, `onMessage(message, { notify })`;
  - `apps/desktop/src/shared/invite.ts` (59) e `apps/desktop/src/main/mac-calendar/` (60) continuam lá.
- Os números de linha deste contrato **não** valem depois do merge: as âncoras são `arquivo:função`.
- Ler antes: `apps/desktop/src/shared/invite.ts` inteiro (`EmailInvite`, `InvitePart`, `parseInvite`, `buildReply`,
  `InviteReplyError`), `docs/specs/desktop-shell/contracts/59-convites-ical.md` (CA2, CA11), e na versão já com o merge:
  `apps/desktop/src/main/email/{service,smtp-client,email-store,fake-email,assistant-tools}.ts`,
  `apps/desktop/src/shared/{email,ipc}.ts`, `apps/desktop/src/preload/index.ts` (`emailSend`),
  o registro do email em `apps/desktop/src/main/index.ts` (`handle('scribe:email-send'…)`, `onEvent('scribe:email-click'…)`,
  `createEmailService({…})`), e os testes `apps/desktop/test/{email-service,email-smtp,email-pop3,email-automations,lock-ipc,invite}.test.ts`.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/shared/email.ts` | `EmailBody.invite?: EmailInvite \| null` (`import type` de `./invite`); tipos `InviteReplySendRequest`, `InviteReplySendError`, `InviteReplySendResult`, `InviteRepliedEvent` (CA1, CA9, CA12) |
| `src/main/email/email-store.ts` | `bodySchema` ganha `invite` (CA2) |
| `src/main/email/service.ts` | `EmailParse` com contexto e o convite no `parseEmail` (CA3); todos os `parse(...)` passam o contexto (CA4); N12 no `body()` (CA5); `Delivery.icalEvent` e `Delivery.record` no `deliver` (CA6, CA7); `sendInviteReply` (CA8–CA11); dep `onInviteReplied` e `timeZone` (CA12) |
| `src/main/email/smtp-client.ts` | `OutgoingMail.icalEvent` e o `buildMessage` com ele (CA6) |
| `src/main/email/fake-email.ts` | `sent[]` registra o `icalEvent`; campo `smtpHold` para segurar o envio (CA13) |
| `src/shared/ipc.ts` | `scribe:invite-reply` nos **quatro** lugares: mapa de tipos do invoke, `INVOKE`, `WHEN_LOCKED` (`'refused'`) e `ScribeApi.inviteReply` (CA14) |
| `src/preload/index.ts` | `inviteReply`, no molde do `emailSend` (ativação viva + token pelo `scribe:email-click`) (CA14) |
| `src/main/index.ts` | uma linha: `handle('scribe:invite-reply', …)`; **nenhum** `onInviteReplied` ligado ainda (é do 62) (CA14) |
| `test/invite-email.test.ts` | **novo**: CA3–CA12, CA15 |
| `test/email-smtp.test.ts` | casos do REPLY pelo `nodemailer` de verdade contra o SMTP falso de socket (CA6, CA7) |
| `test/lock-ipc.test.ts` | `scribe:invite-reply` na lista dos recusados (CA14) |

Nenhum outro arquivo muda. Em especial: `shared/invite.ts` (59), `main/mac-calendar/*` (60), `main/email/rules.ts`,
`main/email/assistant-tools.ts`, o MCP do agente do 56, `main/schedules/*`, o renderer e o `main/smoke.ts`.

## Critérios de aceite

### Tipos e corpo guardado (D4)
- **CA1 — `EmailBody`.** Em `shared/email.ts`: `EmailBody.invite?: EmailInvite | null`, com `import type { EmailInvite, InviteReplyPartstat }
  from './invite'` (só tipo: o renderer não puxa o `ical.js`, invariante do 59). Significado, e é o que o N12 usa:
  chave **ausente** = corpo guardado antes do 61; `null` = já lido pelo 61, sem convite (ou convite ilegível);
  objeto = o convite. *Teste estático em `invite-email.test.ts`:* `shared/email.ts` importa `./invite` só com
  `import type`; nenhum arquivo de `src/renderer/src` tem `from '@shared/invite'` sem `import type` (o mesmo teste do 59 continua passando).
- **CA2 — `bodySchema`** (`main/email/email-store.ts`). Ganha `invite: emailInviteSchema.nullable().optional().catch(null)`,
  onde `emailInviteSchema` é um `z.object(...).strict()` no formato exato do `EmailInvite` do 59 (strings com teto:
  `source` até `INVITE_ICS_MAX_BYTES` caracteres, `title` até `CALENDAR_TEXT_MAX`, `description` até
  `INVITE_DESCRIPTION_MAX`, `attendees` até `CALENDAR_ATTENDEES_MAX`, `exdates` até `INVITE_EXDATES_MAX`, `exceptions`
  até `INVITE_EXCEPTIONS_MAX`; enums com os valores do 59). Dado um corpo gravado com `setBody`, Quando `body()` relê,
  Então: (a) `invite` objeto volta `toEqual` ao gravado; (b) `invite: null` volta `null`; (c) corpo sem a chave volta
  **sem** a chave (`'invite' in body === false`); (d) arquivo com `invite` fora do formato (ex.: `uid: 42`) volta com
  `invite: null` e o resto do corpo intacto (o corpo não é descartado); (e) `setBody` com `invite` fora do formato
  lança, como hoje com o resto do corpo. *Teste:* os cinco casos, com o `EmailInvite` de `google-request.eml`.

### Leitura no parse (R1, N7, N10)
- **CA3 — `parseEmail` lê o convite.** `EmailParse` passa a ser
  `(raw: Buffer, context: { self: readonly string[]; localTimeZone: string }) => Promise<ParsedEmail>`. Em
  `service.ts:parseEmail`, depois do `simpleParser`, as partes de `parsed.attachments` viram `InvitePart`
  **exatamente** como no `emlParts` de `test/invite.test.ts` (`contentType`, `filename ?? null`,
  `headers.get('content-type')?.params?.method ?? null`, `content`) e vão a
  `parseInvite(parts, context)`. `ok` → `body.invite = result.invite`; qualquer erro (inclusive `none`) →
  `body.invite = null`; exceção inesperada → `null` (nunca derruba o parse do email). `body.attachments` continua igual
  (a parte `text/calendar` segue listada como hoje). O conteúdo das partes não é guardado fora do `invite.source`.
  *Testes:* `parseEmail(readFileSync('test/fixtures/invites/google-request.eml'), { self: ['andrew.teste@example.org'],
  localTimeZone: 'America/Sao_Paulo' })` → `body.invite.uid === '7kq2m9v0c3exampleuid@google.com'`,
  `method === 'REQUEST'`, `start === '2026-11-20T15:00:00.000Z'`, `self.partstat === 'NEEDS-ACTION'`, e **um** convite
  só (N10: a parte `text/calendar` e o anexo `invite.ics` não viram dois); um email sem `.ics` (montado no teste) →
  `body.invite === null`; um email com `malformed.ics` anexo → `body.invite === null` e `attachments.length === 1`.
- **CA4 — Todo parse com contexto.** Toda chamada de `parse(...)` em `service.ts` (POP3 em `poll`, IMAP em
  `downloadBody`, o corpo das regras do 53, o "Executar agora", o `peekServer` do Assistente e o N12) passa
  `{ self: [rt.account.address], localTimeZone: timeZone() }`, com `timeZone` da dep nova (CA12). *Teste estático:*
  em `service.ts`, toda ocorrência de `await parse(` tem dois argumentos (regex `/await parse\(\s*\w+\s*\)/` → zero).
  *Testes de fluxo* (IMAP falso do teste servindo `google-request.eml`, e POP3 falso do teste no molde de
  `email-pop3.test.ts`): **IMAP** — `body({ accountId, id })` da mensagem devolve `body.invite.uid` do Google e o
  arquivo do corpo em disco tem a chave `invite`; **POP3** — depois do poll, `store.body(...)` já tem `invite` (sem
  abrir a mensagem). Conta com endereço `outra@example.net` → `invite.self === null` (o convite continua lá; o N5 é no envio, CA10).

### Corpos antigos (N12)
- **CA5 — Reler uma vez.** Em `service.ts:body()` (o do IPC `scribe:email-get-body`), Dado um corpo em cache **sem a
  chave `invite`** e com algum anexo candidato (mesma regra do CA2 do 59: `contentType` sem parâmetros `text/calendar`
  ou `application/ics`, ou `filename` terminado em `.ics`, sem diferenciar maiúsculas), Quando a tela pede o corpo, Então:
  - há `.eml` guardado (`store.raw`: POP3 e enviados com anexo) → `parse(raw, contexto)`, `setBody` com o resultado e
    devolve o corpo novo; **nenhum** acesso ao servidor;
  - não há `.eml` e a mensagem é IMAP com `uid` → baixa de novo pelo mesmo caminho do `downloadBody`
    (`serverSource`), `parse`, `setBody`, devolve o corpo novo;
  - download `unavailable` (sem conexão) ou exceção → devolve o corpo em cache como está (`ok: true`, sem a chave),
    sem gravar nada: tenta de novo na próxima abertura;
  - `too-big`, `not-found` ou `uid: null` → grava o corpo em cache com `invite: null` e devolve; não tenta de novo.
  - Corpo sem a chave e **sem** anexo candidato → devolve como está, sem reler nem baixar.
  - Corpo com `invite` (objeto ou `null`) → devolve como está (é o "uma vez").
  Dois pedidos ao mesmo tempo da mesma mensagem fazem **um** download (o `bodyRequests` que já existe cobre).
  `cachedBody` (Assistente) **não** relê nem baixa (continua só leitura do store).
  *Testes:* (a) IMAP: corpo antigo gravado à mão sem `invite`, com `attachments: [{ filename: 'invite.ics',
  contentType: 'application/ics', size: 900 }]` → o primeiro `body()` chama `source` **uma** vez e devolve o convite; o
  segundo `body()` não chama `source` (contador do IMAP falso = 1); (b) POP3: o mesmo com `.eml` guardado → convite
  devolvido, contador de conexões POP3 = 0 durante o `body()`; (c) IMAP desconectado → `ok: true` sem `invite`, nada
  gravado; reconectado, o próximo `body()` baixa; (d) `source` devolve `null` → corpo gravado com `invite: null`, e o
  terceiro `body()` não chama `source`; (e) corpo antigo sem anexo candidato → `source` nunca chamado; (f) dois `body()`
  em paralelo → `source` chamado uma vez.

### REPLY pelo `deliver` (D5)
- **CA6 — `icalEvent` até o SMTP.** `smtp-client.ts:OutgoingMail` ganha
  `icalEvent?: { method: 'REPLY'; filename: 'invite.ics'; content: string } | undefined`; `buildMessage` passa ao
  `MailComposer` `icalEvent: { method: 'REPLY', filename, content }`. A mensagem montada tem de ter, e é isso que se
  testa (não a implementação do `nodemailer`): uma parte `text/calendar; charset=utf-8; method=REPLY` com o `content`
  byte a byte, **e** um anexo de nome `invite.ics` com o mesmo VCALENDAR. Se o `MailComposer` não puser o anexo sozinho,
  o `buildMessage` acrescenta (`{ filename: 'invite.ics', content, contentType: 'application/ics' }`). Sem `icalEvent`,
  a mensagem sai **idêntica** à de hoje. `service.ts:Delivery` ganha `icalEvent?: OutgoingMail['icalEvent']` e
  `record?: false`; o `deliver` repassa o `icalEvent` ao `OutgoingMail`.
  *Teste em `email-smtp.test.ts`* (o `nodemailer` de verdade contra o SMTP falso de socket do arquivo): o `data`
  recebido, lido pelo `simpleParser` e convertido em `InvitePart` como no CA3, dá em `parseInvite` `ok: true`,
  `method: 'REPLY'`, o `uid` do convite e `attendees.length === 1`; o envelope `to` é só o organizador; um envio comum
  (`send`) no mesmo teste não tem nenhuma parte `text/calendar` (regressão).
- **CA7 — `record: false`.** Com `record: false`, o `deliver`, depois do SMTP com sucesso, **pula**: a entrada em
  `sent` do store, o `setBody`/`setRaw` do enviado, a marca `answered` na mensagem respondida, o `APPEND` na pasta de
  enviados (IMAP), o `pruneAccount` e o `changed(accountId)`. Escreve só o log (sem assunto, sem endereço) e devolve
  `{ ok: true, messageId }`. Sem `record` (os envios de hoje), tudo como está, e o corpo do enviado passa a ser gravado
  com `invite: null` (para o CA5 nunca reler um enviado). *Testes:* depois de um REPLY, `store.read(conta).sent` tem o
  mesmo tamanho de antes, o diretório `<conta>.bodies/` tem os mesmos arquivos, a mensagem do convite continua
  `answered: false`, o IMAP falso registrou zero `appendSent` e `onMessagesChanged` não foi chamado; um `send` comum no
  mesmo teste continua gravando em `sent` e fazendo o `APPEND` (regressão).

### `sendInviteReply` (R3, N5)
- **CA8 — Entrada e ordem.** `EmailService.sendInviteReply(senderId: number, request: unknown): Promise<InviteReplySendResult>`,
  com `request` = `InviteReplySendRequest = { accountId: string; id: string /* EmailMessage.id */; partstat:
  InviteReplyPartstat; clickToken: string }` (zod `.strict()`). Os passos, nesta ordem, e o primeiro que falha devolve
  o erro sem fazer os seguintes:
  1. `guard.consume(senderId, clickToken)` — o mesmo guarda do `send` (token registrado pelo `scribe:email-click`,
     uso único, 10 s, da mesma janela); é gasto mesmo com o resto inválido → falhou: `click`;
  2. formato do pedido → `invalid`;
  3. conta existe e a senha abre → `account`;
  4. `findMessage(accountId, id, true)` acha a mensagem e ela **não** é da pasta de enviados → `not-found`;
  5. corpo **em cache** (`store.body`, nunca baixa aqui) → ausente: `not-found`; `invite` ausente ou `null`: `no-invite`;
  6. `invite.method !== 'REQUEST'` → `not-request` (CANCEL e REPLY não se respondem);
  7. trava por convite (CA9) → `busy`;
  8. `buildReply(invite, { partstat, self: [rt.account.address], now: new Date(now()) })` → erro do 59 repassado com o
     mesmo nome (`no-organizer`, `not-invited`, `invalid`, `malformed`; `not-request` já saiu no passo 6);
  9. `to.address` do REPLY passa no `emailAddressSchema` → senão `no-organizer`;
  10. `deliver({ accountId, to: [to.address], cc: [], bcc: [], subject, text, inReplyTo, attachments: [], icalEvent:
      { method: 'REPLY', filename: 'invite.ics', content: ics }, record: false }, 'resposta de convite enviada com o clique da pessoa')`,
      com `subject` = o do `buildReply` cortado em `EMAIL_SUBJECT_MAX`, `text` = `"<subject>\n"`, e `inReplyTo` = o
      `messageId` da mensagem do convite quando ele passa no `headerIdSchema` (senão `undefined`). Erro do SMTP volta
      com o nome do `EmailSendError` (`auth`, `connection`, `rejected`, `failed`, `account`).
  `InviteReplySendError = 'click' | 'invalid' | 'account' | 'not-found' | 'no-invite' | 'not-request' | 'busy' |
  'no-organizer' | 'not-invited' | 'malformed' | 'auth' | 'connection' | 'rejected' | 'failed'`.
  `InviteReplySendResult = { ok: true; messageId: string; reply: InviteRepliedEvent } | { ok: false; error: InviteReplySendError }`
  (CA12). Nunca lança (o handler do IPC ainda
  embrulha em `.catch(() => ({ ok: false, error: 'failed' }))`, como o do `email-send`).
  *Teste do caminho feliz* (conta `andrew.teste@example.org`, IMAP falso do teste com `google-request.eml`, corpo já
  aberto, SMTP do `fake-email`): `ACCEPTED` → `ok: true`; `fake.sent` tem **um** item com `to: ['ana@example.com']`,
  `subject: 'Aceito: Revisão do projeto'`, `icalEvent.method: 'REPLY'`; o `icalEvent.content` relido por `parseInvite`
  dá `method: 'REPLY'`, `uid` do Google, `sequence: 0`, `attendees: [{ address: 'andrew.teste@example.org', …,
  partstat: 'ACCEPTED' }]`. O mesmo para `TENTATIVE` (`Talvez: …`) e `DECLINED` (`Recusado: …`).
- **CA9 — Trava por convite e duplo clique.** Chave da trava: `accountId + '\n' + invite.uid + '\n' + (invite.recurrenceId ?? '')`,
  num `Set` em memória do serviço, posta no passo 7 e tirada num `finally` (sucesso, erro do `buildReply`, erro do SMTP
  ou exceção). Enquanto está posta, outro `sendInviteReply` do mesmo convite (mesma mensagem ou outra mensagem com o
  mesmo UID e a mesma ocorrência) devolve `busy` **sem** chamar o SMTP. Ocorrências diferentes da mesma série
  (`recurrenceId` diferente) e contas diferentes não se travam. Depois que a trava sai, um clique novo manda outro
  REPLY (D5 da spec: dá para mudar a resposta; cada troca é um REPLY novo).
  *Testes:* (a) **duplo clique**: dois tokens registrados, duas chamadas sem `await` entre elas, com o SMTP falso
  segurando a primeira numa promessa → uma volta `ok: true`, a outra `busy`, e `fake.sent.length === 1`; (b) o
  **mesmo** token duas vezes → a segunda `click`; (c) depois da primeira terminar, um terceiro clique com `DECLINED`
  manda o segundo REPLY (`fake.sent.length === 2`, o segundo com `PARTSTAT=DECLINED`); (d) SMTP que lança
  `SmtpError('connection')` → `connection`, e logo em seguida um clique novo **não** volta `busy` (a trava saiu);
  (e) duas mensagens com o mesmo UID ao mesmo tempo → uma `busy`; `occurrence-request.ics` e a série do mesmo UID ao
  mesmo tempo → as duas `ok`.
- **CA10 — Os casos de erro, cada um sem envio.** Para cada linha, Então o resultado é o erro indicado e
  `fake.sent.length` não muda (e o `smtp` não foi chamado):
  | Dado | Erro |
  |---|---|
  | **token de clique vencido**: `registerClick` e a chamada 10.001 ms depois (relógio da dep `now` do serviço, o mesmo do `createEmailClickGuard`) | `click` |
  | token nunca registrado, ou registrado por outra janela (`senderId` diferente) | `click` |
  | `partstat: 'NEEDS-ACTION'`, campo a mais no pedido, `id` vazio | `invalid` (e o token foi gasto: a mesma chamada certa com ele → `click`) |
  | conta inexistente | `account` |
  | mensagem que não existe, ou que é da pasta de enviados | `not-found` |
  | mensagem cujo corpo nunca foi aberto (sem cache) | `not-found` (nenhum download) |
  | corpo com `invite: null` | `no-invite` |
  | **convite CANCEL** (`google-cancel.ics` anexo num email) | `not-request` |
  | **convite REPLY** recebido (`reply-received.ics`) | `not-request` |
  | **ORGANIZER ausente** (o `google-request.eml` com a linha `ORGANIZER` tirada da parte `text/calendar` e do anexo, montado no teste) | `no-organizer` |
  | ORGANIZER com endereço que não passa no `emailAddressSchema` (`ORGANIZER:mailto:ana`, montado no teste) | `no-organizer` |
  | **N5 — endereço da conta fora dos ATTENDEE**: conta `outra@example.net` e o `google-request.eml` | `not-invited` |
  | conta com `password` que não abre (`safeStorage` falso que devolve lixo) | `account` |
  Nenhum desses erros põe a trava (os passos 1–6 vêm antes dela) ou a deixa posta (os 8–9 saem pelo `finally`).
- **CA11 — Conta POP3 e o SMTP dela.** Toda conta do app tem `outgoing` (é obrigatório no `emailServerSchema`); não
  existe conta POP3 "sem SMTP" no `settings.json` válido (conta sem `outgoing` some na leitura leniente e o pedido dá
  `account`). Dado uma conta **POP3** com o convite já baixado no poll (CA4), Quando o Andrew responde, Então o REPLY
  sai pelo SMTP da própria conta, como no IMAP, sem `APPEND` (o POP3 não tem) e sem gravar em enviados (CA7). SMTP da
  conta POP3 fora do ar → `connection`; usuário recusado → `auth`; servidor recusou → `rejected`; nada gravado, sem
  evento (CA12), trava liberada. *Testes:* POP3 + `fake-email.smtp` → `ok: true`, `fake.sent[0].icalEvent` presente;
  POP3 + `smtp` que lança `SmtpError('connection')` → `connection`, `onInviteReplied` não chamado; POP3 em
  `email-smtp.test.ts` com a porta do SMTP falso já fechada → `connection`.

### Interface para o 62
- **CA12 — Como o 62 sabe que o REPLY saiu.** Duas formas, as duas só depois do SMTP com sucesso, nunca em erro:
  - **Retorno** de `sendInviteReply`: `{ ok: true, messageId, reply }`.
  - **Evento**: `EmailServiceDeps.onInviteReplied?: (event: InviteRepliedEvent) => void`, chamado **uma vez** por REPLY
    enviado, depois do `deliver` com `ok: true` e antes de `sendInviteReply` devolver. Exceção dentro do callback é
    pega, vira log (`resposta de convite: aviso falhou`) e não muda o resultado. O 61 **não** liga essa dep no
    `main/index.ts` (é o 62 que passa o callback, para gravar `response`/`respondedAt` no `invites.json`).
  - `InviteRepliedEvent` (em `shared/email.ts`, JSON puro):
    `{ accountId: string; messageId: string /* EmailMessage.id do convite */; mailbox: string; uid: string;
    recurrenceId: string | null; sequence: number; dtstamp: string | null; partstat: InviteReplyPartstat;
    respondedAt: number /* now() da hora do envio */; replyMessageId: string /* Message-ID do REPLY, com < > */ }`.
    `uid`, `recurrenceId`, `sequence` e `dtstamp` são os do `EmailInvite` respondido (a chave do N3 é `accountId + uid + recurrenceId`).
  - Dep nova `timeZone?: () => string` (padrão `() => Intl.DateTimeFormat().resolvedOptions().timeZone`), usada no CA4.
  *Testes:* `onInviteReplied` espião: chamado uma vez com o objeto exato (`toEqual`, com `respondedAt` = o `now` fixo
  do teste e `replyMessageId` = o `messageId` do retorno); zero chamadas em cada linha do CA10 e no CA9 (d); callback
  que lança → `ok: true` mesmo assim; o `reply` do retorno é `toEqual` ao objeto do evento.

### SMTP falso
- **CA13 — `fake-email.ts` captura o REPLY.** O item de `FakeEmail.sent` ganha `icalEvent: { method: 'REPLY'; filename:
  string; content: string } | null` (`null` nos envios comuns). Campo novo, no molde do `failNextSend`:
  `FakeEmail.smtpHold: (() => Promise<void>) | null` (padrão `null`): com ele posto, o `smtp` espera essa promessa
  antes de registrar em `sent` e de responder; `null`, nada muda. Os testes do CA9 (a) e o smoke do 63 (quadro 16,
  "Enviando") usam o mesmo campo. O `deliver` do falso (entregar um convite na INBOX) **não** muda aqui: é do 62.
  Nenhuma mensagem nova na INBOX falsa do smoke. *Teste:* o smoke atual continua verde sem mudança (gate 5).

### IPC, preload e bloqueio (N6)
- **CA14 — `scribe:invite-reply`.** Em `shared/ipc.ts`, nos quatro lugares:
  1. mapa de tipos do invoke: `'scribe:invite-reply': { request: InviteReplySendRequest; response: InviteReplySendResult }`,
     com comentário "só com o token de clique do email (contrato 61); nunca regra, tarefa ou Assistente";
  2. `INVOKE`: `'scribe:invite-reply': true`;
  3. `WHEN_LOCKED`: `'scribe:invite-reply': 'refused'`, junto do bloco do email;
  4. `ScribeApi.inviteReply(request: Omit<InviteReplySendRequest, 'clickToken'>): Promise<InviteReplySendResult>`.
  No `preload/index.ts`, `inviteReply` no molde do `emailSend`: sem `navigator.userActivation.isActive` →
  `Promise.resolve({ ok: false, error: 'click' })`; senão `crypto.randomUUID()`, `ipcRenderer.send('scribe:email-click', token)`
  e `ipcRenderer.invoke('scribe:invite-reply', { accountId, id, partstat, clickToken })` (só esses quatro campos).
  No `main/index.ts`, só `handle('scribe:invite-reply', appOrigin, (event, request) => email.sendInviteReply(event.sender.id, request).catch(() => ({ ok: false, error: 'failed' }) as const))`.
  Nenhum evento novo do main para o renderer neste contrato.
  *Testes:* `lock-ipc.test.ts` — `scribe:invite-reply` na lista dos canais recusados e, com o app bloqueado, o invoke
  devolve `locked` sem chamar o handler (o mesmo teste que os outros canais do email já têm); estático: o preload tem
  `inviteReply` com `userActivation.isActive` antes do `randomUUID`, e o `invoke('scribe:invite-reply'` leva só
  `accountId`, `id`, `partstat`, `clickToken`.

### N1 — nada sai sem clique
- **CA15 — Só o clique chama.** *Teste estático em `invite-email.test.ts`*, no molde do de `sendForTask` em
  `email-automations.test.ts`: lendo todos os `.ts` de `src/main`, `src/preload` e `src/renderer/src`:
  - `sendInviteReply` aparece só em `main/email/service.ts` (definição) e `main/index.ts`; a única chamada é
    `main/index.ts: .sendInviteReply(event.sender.id, request)` dentro do `handle('scribe:invite-reply'`;
  - `'scribe:invite-reply'` aparece só em `shared/ipc.ts`, `preload/index.ts` e `main/index.ts` (o renderer usa
    `window.__scribeApi.inviteReply`, que é do 63);
  - `buildReply` é importado em `src/main` só por `main/email/service.ts`; `icalEvent` é posto num `Delivery` só
    dentro de `sendInviteReply` (uma ocorrência de `icalEvent:` em `service.ts` fora da interface e do repasse ao `OutgoingMail`);
  - nada disso aparece em `main/email/rules.ts`, `main/email/assistant-tools.ts`, `main/schedules/**`, `main/chat/**`,
    `main/acp/**` nem no MCP do agente do 56 (o teste lista esses caminhos e confere zero);
  - o `taskSendSchema` (do `sendForTask`) e o `sendSchema` (do `send`) não têm `icalEvent` nem `record`: `sendForTask`
    e `send` com `icalEvent` ou `record` no pedido → `invalid` e nada enviado (teste de fluxo);
  - `INVOKE_CHANNELS.filter((c) => /send|reply/.test(c))` é exatamente a lista de hoje mais `'scribe:invite-reply'`.

## Invariantes
- **N1.** A única saída nova da máquina é o REPLY de `sendInviteReply`, e só com o token de clique do email gasto no
  passo 1. Regra (53/64), tarefa agendada (51), Assistente (45) e o agente (56) nunca chamam `sendInviteReply`, nunca
  montam `icalEvent` e não ganham ferramenta de convite (CA15). Nada responde sozinho ao abrir, ao baixar ou ao chegar.
- **Ler não envia.** `parseEmail`, o N12 e o `body()` só leem e gravam no store local; nenhum teste deste contrato
  manda nada para fora do `127.0.0.1` do teste (os servidores são os falsos).
- **O REPLY não vira enviado** (CA7): nem na lista, nem no disco, nem no `APPEND`, nem no `answered`.
- **Envio comum igual.** `send`, `sendForTask`, o `MailComposer` sem `icalEvent`, Enviados, `APPEND`, `answered`,
  regras (53), assinatura (54), pastas (52), o agente (56) e os testes atuais de `email-*` passam sem mudança de asserção
  (só os acréscimos da Superfície). Corpo antigo sem `.ics` é lido como antes, sem rede.
- **Bloqueio (N6).** `scribe:invite-reply` é `'refused'`; nenhum canal novo é `allowed`.
- **Sem conteúdo no log.** Nada de título, organizador, convidados, endereço ou `.ics` no log: só o tipo do evento e o
  código de erro (`convite ignorado (malformed)`, `resposta de convite enviada com o clique da pessoa`, `envio falhou (connection)`).
- Nenhum segredo novo; o `invite` fica só no corpo local (0600, como o resto do `<conta>.bodies/`).

## Fora de escopo
- **Contrato 62:** o registro `userData/email/invites.json` (N3), o helper do calendário e o `find`/`create`/`update`/
  `remove`, a reconciliação (R5c), o R5b pelo host, os estados do R7, a permissão, o fallback do `.ics`, os sete canais
  `scribe:invite-state`, `-add`, `-update`, `-remove`, `-calendars`, `-request-access`, `-open-ics`, ligar o
  `onInviteReplied` no `main/index.ts` e ligar o helper falso e o `deliver` de convite no smoke.
- **Contrato 63:** o cartão, os botões, o ícone na lista, o bloco Convites em Configurações, os passos do smoke e os prints.
- **Contrato 64:** regra "É convite" / "Pôr na agenda" e o "Sugerir evento" (IA).
- `COUNTER`, `REFRESH`, delegar (`DELEGATED`), responder a CANCEL (F3); mandar o REPLY a mais alguém além do ORGANIZER.

## Telas de impacto no usuário
Nenhuma neste contrato: o `invite` vai no corpo, mas a tela ainda não o mostra, e nenhum botão chama `inviteReply`
(o cartão é do 63). Para quem usa, nada muda.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos (typecheck, lint, test,
  build, smoke, literais de cor, sombra/raio/pílula, pytest do WhatsApp), **depois** do merge da main (Pré-condições) e
  de novo no fim.
- Testes que precisam existir e passar: `test/invite-email.test.ts` com os blocos **corpo guardado (CA1, CA2)**,
  **parse (CA3, CA4)**, **corpos antigos (CA5 a–f)**, **record false (CA7)**, **sendInviteReply (CA8)**, **trava (CA9
  a–e)**, **erros (CA10, um `it` por linha da tabela)**, **POP3 (CA11)**, **evento para o 62 (CA12)**, **N1 estático
  (CA15)**; `test/email-smtp.test.ts` com o REPLY pelo `nodemailer` de verdade (CA6) e a regressão do envio comum;
  `test/lock-ipc.test.ts` com o canal novo (CA14).
- `git diff --stat` (contra o merge da main) só com os arquivos da Superfície.

## Decisões tomadas neste contrato (para o Andrew confirmar, se quiser)
- **E1 — `sendInviteReply(senderId, { accountId, id, partstat, clickToken })`.** A forma pedida era
  `sendInviteReply(accountId, messageKey, partstat, clickToken)`; o `senderId` entra porque o guarda de clique é por
  janela, e os campos vão num objeto validado por zod como em todo pedido do IPC. `messageKey` = `EmailMessage.id`,
  o mesmo `id` do `scribe:email-get-body`.
- **E2 — O mesmo guarda de clique do envio** (`scribe:email-click`), não um novo: um token serve a um envio só, seja
  email ou REPLY.
- **E3 — `invite` ausente ≠ `null`.** Ausente marca o corpo de antes do 61 (dispara o N12 uma vez); `null` marca "já
  lido, sem convite". Convite fora do formato no disco vira `null` sem perder o corpo.
- **E4 — N12 sem rede quando dá.** POP3 e enviados releem o `.eml`; só o IMAP baixa de novo. Falha de conexão tenta na
  próxima abertura; `too-big`/`not-found` gravam `null` e não tentam mais.
- **E5 — Responder só a partir do corpo em cache.** O `sendInviteReply` não baixa nada: o cartão só existe depois de
  abrir a mensagem, e o REPLY sai do mesmo `invite` que a tela mostrou.
- **E6 — Texto do REPLY = o assunto** ("Aceito: Revisão do projeto"), com `In-Reply-To` para o email do convite; nada
  de descrição, local ou convidados (C5 do 59).
- **E7 — O REPLY não fica em Enviados nem no servidor** (D5 da spec): para o Andrew, a resposta aparece no cartão
  ("Respondido", do 62/63), não como email.
- **E8 — Sinal para o 62 por dep (`onInviteReplied`) e pelo retorno**, não por um evento novo do main para o renderer:
  quem grava o `invites.json` é o main (62, pelo `recordReply`); a tela lê o estado pelo `scribe:invite-state` do 62.
  O serviço de convites não age sozinho depois do REPLY: é a tela (63) que, só depois do `ok`, chama `invite-add` ou
  `invite-remove` conforme "Pôr na agenda".
- **E9 — `busy` é erro tipado, não fila:** o segundo clique durante o envio não manda nada e não espera; a tela (63)
  já deixa os botões desabilitados (R3).

Conferido com os contratos 61–64 em 19/11/2026.
