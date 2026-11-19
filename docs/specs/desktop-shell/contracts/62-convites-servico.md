# Contrato 62 — Serviço de convites: registro, Calendário do Mac e IPC
Feature: convites-agenda · Wave: 3 · Depende de: 60, 61 · Spec/Plan: `docs/specs/convites-agenda/spec.md`, `plan.md` (APROVADOS em 19/11/2026)

Liga o convite que o 61 extrai do corpo ao **Calendário do Mac** pelo cliente do 60. O serviço guarda o registro do app (N3), decide quando procurar, criar, atualizar ou tirar o evento (R4, R5a, R5c, R6), calcula o estado do cartão (R7) e oferece os canais que a tela do 63 consome. Nada aqui desenha tela, responde ao organizador (é do 61) nem roda em regra (é do 64). Decisões e regras que valem aqui: D6, D7, D8, D9 do plan; R4, R5a, R5b, R5c, R6, R7, R8, R9, R12, N3, N4, N6, N8, N9 e N11 da spec.

Os nomes que vêm do 61 (`EmailBody.invite`, `InviteRepliedEvent`, `onInviteReplied`, as recusas do `sendInviteReply`) foram conferidos com o texto final dele; os que o 63 e o 64 consomem daqui (`InviteState`, os sete canais, `addFromRule`, `addEvent`, `calendarPresent`, `inviteSelfAdding`, o smoke com o helper falso) estão escritos igual nos três.

## Pré-condições
- **O 62 só começa depois do commit do 61** na branch `convites-agenda` (e, com ele, a `email-organizacao` já juntada na branch, como o 61 exige). Conferir com `git log --oneline -5` que o commit do 61 está lá e que `git status` está limpo.
- **Antes da primeira linha de código, o implementador faz merge da main** no worktree `/Users/andrew/Documents/GitHub/meeting-scribe-convites` (`git merge main`; conflito em código do email = parar e avisar) e roda os gates verdes antes de começar.
- Do 61 este contrato usa três coisas, com os nomes do texto final dele:
  1. `EmailBody.invite?: EmailInvite | null` no corpo guardado (ausente = corpo antigo; `null` = sem convite) (61, CA1);
  2. o aviso de "REPLY enviado": `EmailServiceDeps.onInviteReplied?: (event: InviteRepliedEvent) => void`, chamado uma vez depois do SMTP com sucesso, com `InviteRepliedEvent = { accountId, messageId /* EmailMessage.id */, mailbox, uid, recurrenceId, sequence, dtstamp, partstat, respondedAt, replyMessageId }` (61, CA12); o 61 deixa a dep sem ligar e o 62 a liga (CA16, CA20);
  3. as recusas do `sendInviteReply` (`not-request`, `no-organizer`, `not-invited`), para o `replyable` do estado dizer o mesmo (61, CA8);
  4. o `FakeEmail.sent[].icalEvent` e o `FakeEmail.smtpHold` do SMTP falso (61, CA13), que o smoke do 63 usa sem mudança.
- Do 60, já na branch (`be1dcbb`): `createMacCalendar`, `locateMacCalendar`, `MacCalendar`, os tipos e limites de `src/main/mac-calendar/protocol.ts` (inclusive o campo `saved` do erro, da "Extensão aprovada na devolução") e o falso `test/fixtures/fake-lap-calendar.mjs`. Do 59 (`b47cc9e`): `EmailInvite`, `InviteRule`, `InviteReplyPartstat`, `compareInviteVersion`, `parseInvite` e as fixtures de `test/fixtures/invites/`.
- O número do D0 (3) — quanto tempo a cópia da conta leva para aparecer depois do `refresh` — está no Andamento do cofre. Ele **não** muda os CAs: a reconciliação roda ao abrir o cartão e a cada leitura de agenda (R5c), sem esperar.
- Ler antes: `apps/desktop/src/main/mac-calendar/{protocol,process}.ts`, `test/fixtures/fake-lap-calendar.mjs` (cabeçalho), `src/shared/invite.ts` (tipos e `compareInviteVersion`), `src/main/email/email-store.ts` (gravação atômica e fila, modelo do store), `src/main/email/service.ts` (`cachedBody`, `accounts`, `removeAccount`), `src/main/settings/schema.ts` e `src/shared/settings-defaults.ts` (modelo das chaves novas), `src/shared/ipc.ts`, `src/shared/privacy.ts`, o registro do email e do `micWatch` em `src/main/index.ts`, `test/lock-ipc.test.ts`, `test/mac-calendar.test.ts` (como o falso sobe nos testes).

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/shared/invite-state.ts` | **novo**: `InviteState` e os tipos de pedido e resposta dos canais (CA1). Puro, sem `node:*` nem `electron` |
| `src/main/invites/store.ts` | **novo**: o registro `invites.json` (CA2, CA3) |
| `src/main/invites/map.ts` | **novo**, puro: convite → argumentos do helper, recorrência, notas, mudanças, estado, `inviteSelfAdding` (CA4, CA5, CA9, CA23) |
| `src/main/invites/service.ts` | **novo**: `createInviteService` (CA6–CA17) |
| `src/main/invites/ics-file.ts` | **novo**: o `.ics` temporário do "Abrir no app de agenda" (CA15) |
| `src/main/email/service.ts` | só um leitor do convite guardado, sem rede (CA6); nada mais (a dep `onInviteReplied` já é do 61) |
| `src/shared/ipc.ts` | os sete canais nos quatro lugares (CA18) e `'calendars'` em `PrivacyPane` |
| `src/shared/privacy.ts` | a URL `Privacy_Calendars` (CA18) |
| `src/shared/settings-defaults.ts`, `src/main/settings/schema.ts` | `inviteCalendarId`, `inviteAddOnAccept`, `inviteSuggest` (CA19) |
| `src/main/index.ts` | cliente do Calendário, serviço, canais, ganchos e saída; no smoke, o helper falso (CA20, CA24) |
| `src/main/smoke-fixtures.ts` | `SmokeFixtures.macCalendar`: caminhos do estado e do log do helper falso e o leitor do log (CA24) |
| `src/main/email/fake-email.ts` | `deliver` aceita o convite (`calendar`): parte `text/calendar; method=…` + anexo `invite.ics` (CA24) |
| `test/invites-store.test.ts`, `test/invites-service.test.ts` | **novos** (CA21, CA22) |
| `test/fixtures/invites/servico-*.ics` | **novos**, dados fictícios (CA22) |

Nenhum outro arquivo. Em particular: nada no renderer, no `preload` além do que o tipo do `ScribeApi.invoke` já cobre, no `smoke.ts` (os passos do smoke são do 63 e do 64; aqui só a ligação do CA24), em `main/calendar/*` (contrato 12, F1/F4) e em `main/mac-calendar/*` (o 60 fica como está).

## Critérios de aceite
Âncoras: os testes de `test/invites-store.test.ts` (`describe('registro de convites')`) e de `test/invites-service.test.ts` (`describe('serviço de convites')` e `describe('verificação end-to-end contra o helper falso')`). O helper falso sobe como no `mac-calendar.test.ts` (`process.execPath` + `fake-lap-calendar.mjs`, `platform: 'darwin'`, `arch: 'arm64'`, `systemVersion: '26.6.0'`, `packaged: true`), com `FAKE_LAP_CALENDAR_STATE` e `FAKE_LAP_CALENDAR_LOG` numa pasta temporária; "o helper recebeu" é uma linha desse log.

**Tipos**
- **CA1 — `InviteState` e os resultados (`shared/invite-state.ts`).** Exatamente estes tipos (o 63 os consome sem adaptação):
  ```ts
  export const INVITE_KINDS = ['new', 'responded', 'in-calendar', 'already-in-calendar', 'update-pending', 'cancelled', 'old', 'reply-received', 'error'] as const
  export type InviteKind = (typeof INVITE_KINDS)[number]
  export type InviteCalendarAccess = 'full' | 'writeOnly' | 'denied' | 'restricted' | 'notDetermined'
  export type InviteCalendarStatus =
    | { status: 'unavailable'; reason: 'platform' | 'no-binary' | 'gave-up' | 'disposed' } // D9, N9
    | { status: 'needs-access' }                                                          // notDetermined: o primeiro "Pôr na agenda" pede (R8)
    | { status: 'no-access'; access: 'denied' | 'restricted' | 'writeOnly' }              // R8
    | { status: 'absent' }                                                                // não está na agenda; dá para pôr
    | { status: 'app'; calendarId: string; calendarTitle: string; sourceTitle: string }   // o app gravou e achou
    | { status: 'account'; calendarTitle: string; sourceTitle: string; merged: boolean }  // R5a (merged false) ou R5c (true)
    | { status: 'missing'; calendarId: string; calendarTitle: string | null; sourceTitle: string | null } // o app gravou e não acha mais (R6); nomes `null` se a agenda sumiu
    | { status: 'skipped' }                                                               // nada foi perguntado ao helper (CA8)
    | { status: 'error'; code: InviteErrorCode }                                          // falha passageira
  export interface InviteWhen { start: string; end: string; allDay: boolean; timeZone: string | null }
  export type InviteChange =
    | { field: 'time'; before: InviteWhen; after: InviteWhen }
    | { field: 'title' | 'location' | 'url'; before: string | null; after: string | null }
  export interface InviteState {
    accountId: string
    id: string                       // o EmailMessage.id pedido
    uid: string
    recurrenceId: string | null      // sem fração de segundo (CA4)
    method: 'REQUEST' | 'CANCEL' | 'REPLY'
    kind: InviteKind
    response: { partstat: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'; at: number } | null
    calendar: InviteCalendarStatus
    changes: InviteChange[]          // só em 'update-pending'
    addDefault: boolean              // estado inicial da caixa "Pôr na agenda" (R5b, R9)
    addHint: 'account-adds' | null   // a frase do R5b
    defaultCalendarId: string | null // R9 (CA13)
    replyable: boolean               // as recusas do sendInviteReply do 61 (CA9)
    notForMe: boolean                // N5: o endereço da conta não está entre os ATTENDEE
    recurrenceBlocked: boolean       // N8: repetição que o app não grava
    replier: { name: string | null; address: string; partstat: string } | null // só em REPLY
    notice: 'merged' | null          // R5c, só na primeira leitura depois de juntar
    actions: { add: boolean; update: boolean; remove: boolean; openIcs: boolean; requestAccess: boolean; openSettings: boolean }
    error: { code: InviteErrorCode; message: string } | null // só em 'error'
  }
  export type InviteErrorCode = 'missing' | 'invalid' | 'old' | 'not-request' | 'recurrence' | 'unavailable' | 'denied' | 'restricted' | 'no-calendar' | 'read-only-calendar' | 'not-owned' | 'not-found' | 'busy' | 'failed'
  export type InviteStateResult = { ok: true; state: InviteState } | { ok: false; error: 'missing' | 'invalid' | 'unavailable' }
  export type InviteEffect = 'created' | 'already' | 'updated' | 'removed' | 'none'
  export type InviteActionResult = { ok: true; effect: InviteEffect; state: InviteState } | { ok: false; error: InviteErrorCode; message: string; state: InviteState | null }
  export interface InviteCalendarOption { id: string; title: string; sourceTitle: string; sourceType: 'local' | 'exchange' | 'caldav' | 'mobileme' | 'subscribed' | 'birthdays'; isDefault: boolean }
  export type InviteCalendarsResult = { ok: true; access: InviteCalendarAccess; calendars: InviteCalendarOption[]; defaultId: string | null } | { ok: false; error: 'unavailable'; reason: string }
  export type InviteAccessResult = { ok: true; access: InviteCalendarAccess; granted: boolean } | { ok: false; error: 'unavailable'; reason: string }
  export type InviteOpenIcsResult = { ok: true } | { ok: false; error: 'missing' | 'invalid' | 'failed' }
  export const INVITE_ERROR_MESSAGES: Readonly<Record<InviteErrorCode, string>> // frases fixas em português (CA17)
  // Entradas sem IPC para o 64 (CA23)
  export type InviteRuleAddResult = { ok: true; effect: 'created' | 'already' | 'none' } | { ok: false; error: 'calendar-denied' | 'no-calendar' }
  export type InviteEventAddResult = { ok: true; effect: 'created' | 'already'; calendarTitle: string; sourceTitle: string } | { ok: false; error: InviteErrorCode; message: string }
  ```
  `shared/invite-state.ts` não importa nada de `main/`: o `InviteCalendarAccess` repete o enum do 60 e um teste confere que é igual a `accessSchema.options`.

**Registro (`main/invites/store.ts`, D6, N3)**
- **CA2 — Arquivo e formato.** `userData/email/invites.json` (a pasta do `email-store`, `EMAIL_DIR`), arquivo **0600**, gravação atômica (temporário `invites.json.tmp-<pid>-<n>` 0600 + `rename`, como `email-store.ts`), todas as gravações numa fila só (uma promessa encadeada). Formato:
  ```ts
  { version: 1, invites: InviteRecord[] }
  InviteRecord = {
    accountId: string; uid: string; recurrenceId: string | null          // a chave (N3)
    sequence: number; dtstamp: string | null                             // a maior versão vista (N4)
    response: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' | null; respondedAt: number | null
    messageId: string | null                                             // o EmailMessage.id da última vez que foi visto
    seenAt: number
    event: InviteEventRef | null                                         // SÓ quando o app gravou (N3)
    merged: { calendarItemIdentifier: string; calendarTitle: string; sourceTitle: string } | null // R5c, só para mostrar
    mergedNotice: boolean                                                // R5c: o aviso ainda não foi mostrado
    removed: boolean                                                     // ocorrência que o app tirou (CA11)
  }
  InviteEventRef = {
    eventIdentifier: string | null; calendarItemIdentifier: string; externalIdentifier: string | null
    calendarId: string; title: string; start: string                     // os campos do N3
    end: string; allDay: boolean; timeZone: string | null; location: string | null; url: string | null
    availability: 'busy' | 'tentative'; occurrence: string | null
    sequence: number; dtstamp: string | null                             // a versão gravada no evento (CA9)
  }
  ```
  Chave = `accountId` + `uid` + `recurrenceId` (com `null` como valor próprio), no máximo uma linha por chave. Esquema zod `.strict()` de cada linha; leitura leniente: linha inválida sai sozinha, sem levar as outras; arquivo ausente vale vazio; arquivo ilegível (JSON quebrado ou `version` diferente) é renomeado uma vez para `invites.json.invalid` (0600, sobrescrevendo o anterior) e vale vazio. Perder o registro só tira poderes do app (sem `event`, ele não mexe em nada), nunca dá poder a mais.
- **CA3 — API e limites.** `createInviteStore(root, now?)` devolve `{ get(key), list(accountId?), update(key, fn: (current | null) => InviteRecord | null), removeUid(accountId, uid), forgetAccount(accountId) }`; `update` com `null` apaga a linha; tudo passa pela fila e lê o estado já gravado pela operação anterior. Teto `INVITES_MAX = 2000` linhas: passou, saem primeiro as de `event: null` com `seenAt` mais antigo; ainda acima, as de `event.start` mais de 30 dias no passado; nunca uma com evento futuro (o arquivo pode passar do teto nesse caso). Nenhum dado de evento (título, local, URL, UID) vai para o log; o store loga só a operação e a contagem.

**Mapeamento puro (`main/invites/map.ts`)**
- **CA4 — Convite → `create` (R4, N8, N11).** `createArgs(invite, calendarId, availability)` devolve um `MacCalendarCreateArgs` que passa no `createArgsSchema` do 60:
  - `title`: `invite.title` cortado em `MAC_CALENDAR_MAX_TITLE`; `start`/`end`/`allDay` como vieram (o helper aceita a fração e descarta; dia inteiro em `AAAA-MM-DD` com `end` exclusivo); `timeZone`: `invite.timeZone` (`null` em dia inteiro e em hora flutuante).
  - `location`: até `MAC_CALENDAR_MAX_LOCATION`, omitido se `null`; `url`: `invite.joinUrl` só se for `http:`/`https:` e couber em `MAC_CALENDAR_MAX_URL`, senão omitido.
  - `notes` (R4): `joinUrl` + linha em branco + `description`, só os que existirem, texto puro, cortado em `MAC_CALENDAR_MAX_NOTES` (4000) sem partir par substituto; omitido se vazio.
  - `availability`: o pedido (`busy` ao aceitar, `tentative` no talvez); o fallback para `busy` é do helper (`availabilityFallback`).
  - `recurrence`: só com `invite.recurrence?.storable === true` e `rule !== null`: `freq` em minúsculas, `interval`, `count`/`until` quando não `null`, `byDay` (com `pos` só quando não `null`), `byMonthDay`, `byMonth`, `bySetPos` quando não vazios, `weekStart` quando não `null`. `exdates`: `recurrence.exdates` mais o `recurrenceId` das `exceptions` com `cancelled: true`, sem repetição, até `MAC_CALENDAR_MAX_EXDATES`.
  - `normalizeWhen(text)` tira a fração de segundo de um instante (`2026-11-20T18:00:00.000Z` → `2026-11-20T18:00:00Z`) e deixa data como está; vale para chaves do registro e para todo `recurrenceId` mandado ao helper.
  *Teste:* um caso por fixture do 59 (`google-request.eml`, `outlook-windows-tz.ics`, `zoom-sem-vtimezone.ics`, `icloud-allday.ics`, `weekly-exdate.ics`), cada resultado conferido com `createArgsSchema.parse`; notas com 5000 caracteres saem com 4000; `rdate.ics` (não gravável) sai sem `recurrence`.
- **CA5 — Atualização e mudanças (R6).** `updateFields(invite, ref)` devolve **todos** os campos do CA4 (`title`, `start`, `end`, `allDay`, `timeZone`, `location` — `''` quando o convite não tem —, `notes`, `availability` do `ref`), mais `url` quando houver (o protocolo não apaga URL: um link que sumiu fica o antigo, limitação aceita), e, só quando o convite **não** tem `recurrenceId`, `recurrence` (o mapeamento do CA4, ou `null` se o convite não repete mais) e `exdates`. `changesOf(ref, invite)` devolve, nesta ordem, `time` (se `start`, `end`, `allDay` ou `timeZone` mudou), `title`, `location`, `url`, só os que mudaram. *Teste:* SEQUENCE 2 com outro horário → `[{ field: 'time', before: { start: '…T18:00:00Z', … }, after: { start: '…T19:30:00Z', … } }]`.

**Serviço (`main/invites/service.ts`)**
- **CA6 — Dependências e entrada.** `createInviteService(deps)` devolve `InviteService = { state, add, update, remove, calendars, requestAccess, openIcs, recordReply, reconcileAll, addFromRule, addEvent, calendarPresent, forgetAccount, dispose }` (os sete primeiros são os canais do CA18; os quatro do meio, CA16, CA10 e CA23), com `deps = { root: string /* userData */, calendar: MacCalendar, settings: () => Pick<AppSettings, 'inviteCalendarId' | 'inviteAddOnAccept'>, source: (accountId, id) => Promise<InviteSource | null>, openPath: (path) => Promise<string>, now?, log? }`, em que `InviteSource = { account: EmailAccount; invite: EmailInvite; messageId: string }`. O `source` do `index.ts` é um leitor novo em `email/service.ts`, `inviteSource(accountId, id)`, com os mesmos passos 4 e 5 do `sendInviteReply` do 61 (`findMessage(accountId, id, true)` fora dos enviados, depois `store.body` **em cache**; `invite` ausente ou `null` → `null`) e o `rt.account` (61, CA8); nunca baixa nada nem abre conexão. Cada canal valida o pedido com zod `.strict()` (`accountId` em `EMAIL_ACCOUNT_ID_PATTERN`, `id` 1–1024 sem caractere de controle, `calendarId` 1–1024, `availability` `busy`|`tentative`) → `invalid`; sem mensagem, sem corpo guardado ou sem `invite` → `missing`. **O renderer nunca manda o convite**: título, horário e UID saem sempre do corpo guardado no main.
- **CA7 — Registro do que foi visto (N3, N4).** O `state` de um `REQUEST` cria ou atualiza a linha da chave: `sequence`/`dtstamp` passam a ser o maior dos dois por `compareInviteVersion` (nunca diminuem), `messageId` e `seenAt` atualizados. Um `CANCEL` só atualiza a versão de uma linha que já existe (não cria linha). Um `REPLY` nunca toca o registro. Convite com versão menor que a da linha (`compareInviteVersion < 0`) → `kind: 'old'` e nada muda no registro nem na agenda.
- **CA8 — Estado: o que é perguntado ao helper (D7, D9, R8).** Nesta ordem, parando no primeiro que decide:
  1. `REPLY`, `old`, ou `CANCEL` sem evento do app → `calendar: { status: 'skipped' }`, **nenhuma** chamada ao helper.
  2. `status()`: `unavailable` com `platform`, `no-binary`, `gave-up` ou `disposed` → `calendar.status: 'unavailable'` com o `reason`; outro `unavailable` (`timeout`, `exited`, `busy`, `bad-response`, `eventkit`) → `{ status: 'error', code: 'failed' }`; `notDetermined` → `needs-access`; `denied`/`restricted`/`writeOnly` → `no-access` com o `access`. O `state` **nunca** chama `requestAccess`.
  3. Com `full`: `calendars()` (para `defaultCalendarId` e os nomes), `refresh()` no máximo uma vez a cada `INVITE_REFRESH_MIN_MS = 60_000` (relógio injetável), e **um** `find` com `uid`, `title`/`start`/`end`/`allDay` do `ref` (havendo evento do app) ou do convite, `ids` do `ref` quando houver, e `recurrenceId` normalizado quando o convite tiver.
  4. Classificação do `find`: o primeiro `match` por id (`eventIdentifier`, `calendarItemIdentifier`, `externalIdentifier`) é o evento do app; sem ele e com `ref`, um único `title-start` **na mesma `calendarId` do `ref`** também é (N3, último passo da procura); achou → ids novos gravados no `ref` quando mudaram, `calendar: { status: 'app', … }`; não achou → `{ status: 'missing', calendarId: ref.calendarId, … }`, com `calendarTitle`/`sourceTitle` da lista do `calendars()` (ou `null` se a agenda sumiu). Sem `ref`: qualquer `uid` ou `title-start` → `{ status: 'account', merged: false }` com a agenda do primeiro; nada → `absent`. Nada achado não é erro (D7).
  5. Reconciliação (R5c, CA10) antes de montar o estado.
- **CA9 — `kind` e `actions` (R7).** `kind`, na ordem: `REPLY` → `reply-received` (com `replier` = o primeiro ATTENDEE do REPLY); versão menor → `old`; `CANCEL` ou `invite.status === 'CANCELLED'` → `cancelled`; `calendar.status === 'error'` → `error`; `REQUEST` com evento do app achado e `compareInviteVersion(invite, ref) > 0` → `update-pending` (com `changes`); `calendar.status` `app`, ou `account` com `merged: true` → `in-calendar`; `account` sem `merged` → `already-in-calendar`; `response` na linha → `responded`; senão `new`. `actions`:
  | Ação | Verdadeira quando |
  |---|---|
  | `add` | `REQUEST`, `kind` fora de `old`/`cancelled`, `!recurrenceBlocked`, `calendar.status` em `absent`, `needs-access` ou `missing` ("Pôr de novo") |
  | `update` | `kind === 'update-pending'`, `calendar.status === 'app'` e a repetição nova gravável |
  | `remove` | `calendar.status === 'app'` e (`CANCEL`, ou `REQUEST` para o "Recusar" do R4) |
  | `openIcs` | `REQUEST`, `kind !== 'old'` e (`calendar.status` `unavailable` ou `no-access`, ou `recurrenceBlocked`) |
  | `requestAccess` | `calendar.status === 'needs-access'` |
  | `openSettings` | `calendar.status === 'no-access'` |
  Evento que o app não gravou (`event: null`) nunca tem `update` nem `remove` (R6): o REQUEST novo mostra só o estado dele e o CANCEL só "Cancelado pelo organizador". `addDefault` = `settings.inviteAddOnAccept && !inviteSelfAdding(account)`; `addHint` = `'account-adds'` quando `inviteSelfAdding`. `inviteSelfAdding(account: Pick<EmailAccount, 'incoming'>): boolean` (R5b), exportada de `map.ts` junto com `INVITE_SELF_ADDING_HOSTS = ['imap.gmail.com', 'outlook.office365.com']` (o 64 usa a mesma): `account.incoming.host`, em minúsculas e sem ponto final, está na lista. `notForMe` = `invite.self === null`; `recurrenceBlocked` = `invite.recurrence !== null && !invite.recurrence.storable`; `replyable` = `REQUEST`, `organizer` e `self` presentes (as recusas `not-request`, `no-organizer` e `not-invited` do 61) e, por decisão da tela, `kind` fora de `old`/`cancelled` (o 61 não recusa versão antiga; quem esconde os botões é o 63). `response` vem só da linha (CA16), nunca do PARTSTAT do arquivo.
- **CA10 — Reconciliação (R5c).** Dado uma linha sem `recurrenceId`, com `event` do app achado pelos ids, quando o mesmo `find` traz um `match: 'uid'` cujo `calendarItemIdentifier` e `eventIdentifier` são diferentes dos do `ref`, então o serviço manda `remove { ids: ref, span: 'future' }` (sem `recurrenceId`: o item inteiro, que é o que **o app** criou) e, com o `remove` ok (ou `not-found`), grava `event: null`, `merged` com a agenda da cópia da conta e `mergedNotice: true`; as linhas de ocorrência do mesmo `uid` e conta perdem o `event` (a série agora é da conta). O estado sai `in-calendar` com `calendar: { status: 'account', merged: true }` e `notice: 'merged'` só nessa leitura (a seguinte grava `mergedNotice: false` e devolve `notice: null`). `remove` com outro erro: nada muda e tenta na próxima. `reconcileAll()` faz o mesmo para as linhas com `event` cujo `start` está em `[agora − 1 dia, agora + 60 dias]`, no máximo 20 por vez, no máximo uma vez a cada `INVITE_RECONCILE_MIN_MS = 300_000`, só com `status` `full` (nunca pede acesso), e **sem nenhuma chamada ao helper** quando não há linha com `event`. A cópia da conta nunca é apagada nem alterada: o `merged` só serve para mostrar.
- **CA11 — `add` (R4, R5a, R8).** `add({ accountId, id, calendarId, availability })`, e por dentro `addFor(source, { calendarId, availability, mayAskAccess })` (o IPC usa `mayAskAccess: true`; o 64 usará `false`). Ordem: (1) não é `REQUEST` → `not-request`; versão menor → `old`; `recurrenceBlocked` → `recurrence`; (2) `status`: indisponível → `unavailable`; `notDetermined` com `mayAskAccess` → `requestAccess()` (no dev volta `unavailable`/`dev` → `unavailable`), sem `mayAskAccess` → `denied`; o que não for `full` → `denied`/`restricted`; (3) `calendars()`: `calendarId` ausente → `no-calendar`, `writable: false` → `read-only-calendar`; (4) `refresh()` sempre (sem o intervalo do CA8) e `find` com os dados do convite (e os `ids` do `ref`, se houver); (5) qualquer `match` → **não cria**: por id → ids atualizados e `effect: 'already'` com `in-calendar`; `uid`/`title-start` → `effect: 'already'` com `already-in-calendar` (R5a), e a linha fica com `event: null`; (6) nada achado → `create(createArgs(…))`; ok → `event` gravado com os ids do `EventOut`, `calendarId`, campos e versão do convite, `effect: 'created'`; (7) para cada `exception` com `cancelled: false`, `update { ids, recurrenceId, span: 'this', fields: { start, end } }`, falhas só no log (código e quantidade). Um `missing` ("Pôr de novo") cria de novo e troca o `ref`. Erro do `create` com `error.saved` (60) → o `event` é gravado com os ids do `saved` e a `calendarId` pedida, e a resposta é `failed` com o `state` já `in-calendar`. `timeout`/`exited` no `create` → `failed`, **sem** repetir e sem adotar nada (o próximo `add` passa pelo `find` do passo 4 e, se o evento ficou gravado, ele aparece como `already-in-calendar`, não como do app: o app prefere perder o controle a mexer num evento que não sabe se é dele).
- **CA12 — `update` e `remove` (R6, D8, N8).** Só no clique (D8): nenhum caminho do serviço atualiza ou tira sem um destes dois pedidos, fora a reconciliação (CA10), que só tira o que o app criou. O dono do evento: com `recurrenceId`, a linha da ocorrência se tiver `event` (ou `removed: true`, que quer dizer "já tirada"), senão o `event` da linha da série; sem `recurrenceId`, a linha da chave. Sem dono → `not-owned`, **nenhuma** chamada de escrita ao helper. Antes de escrever, o serviço localiza como no CA8 (4); não achou → `not-found` e o estado `missing`.
  - `update({ accountId, id })`: só `REQUEST` com versão maior que a do `ref` (senão `old` ou `invalid`); `update { ids, span, fields: updateFields(…) }` com `recurrenceId` + `span: 'this'` quando o convite é de uma ocorrência (nunca a série, R6), e `span: 'future'` sem `recurrenceId`. Ok → os ids novos do `result.event` (os do falso mudam no `update`, e os do EventKit podem mudar), campos e versão gravados; numa ocorrência, o `ref` vai para a linha da ocorrência com `occurrence` preenchido; `effect: 'updated'`. Erro com `saved` → ids do `saved` gravados, resposta `failed`.
  - `remove({ accountId, id })`: `remove { ids, span: 'future' }` sem `recurrenceId` (o item inteiro), ou `{ ids, recurrenceId, span: 'this' }` com ele (só aquela ocorrência, N8). Ok, ou `not-found` (já não estava), conforme o convite da mensagem pedida (E3):
    - **CANCEL** ("Tirar da agenda") sem `recurrenceId` → **todas** as linhas daquele `uid` na conta saem (`removeUid`, a verificação diz "invites.json perde a linha"); o `state` seguinte do CANCEL volta `calendar: { status: 'skipped' }` (CANCEL sem evento do app, CA8);
    - **REQUEST** (o "Recusar" do R4, que a tela chama depois do REPLY ok) sem `recurrenceId` → a linha da chave fica, com `event: null` (a `response` gravada pelo `recordReply` continua), e as linhas de ocorrência do mesmo `uid` perdem o `event`; o `state` seguinte volta `responded` com `calendar: { status: 'absent' }`;
    - com `recurrenceId` (CANCEL ou REQUEST) → a linha da ocorrência fica com `event: null` e `removed: true` e a da série não muda.
    `effect: 'removed'`.
- **CA13 — Agendas e permissão (R8, R9).** `calendars()` devolve só as agendas com `writable: true`, na ordem do helper, como `InviteCalendarOption`, com `defaultId` = `settings.inviteCalendarId` se estiver na lista, senão a `isDefault` gravável, senão a primeira, senão `null`; o mesmo cálculo vale para o `defaultCalendarId` do estado. Sem acesso `full` → `{ ok: true, access, calendars: [], defaultId: null }` (a tela mostra o estado da permissão); indisponível → `{ ok: false, error: 'unavailable', reason }`. `requestAccess()` chama o `requestAccess` do cliente uma vez e devolve `{ ok: true, access, granted }`; no dev volta `{ ok: false, error: 'unavailable', reason: 'dev' }`. Nenhum outro canal pede acesso, fora o `add` (CA11).
- **CA14 — Um pedido por convite.** Enquanto um `add`, `update` ou `remove` de uma chave está em andamento, outro desses três para a mesma chave volta `busy` na hora, sem chamada ao helper. O `state` não espera nem trava. *Teste:* dois `add` ao mesmo tempo → um `effect: 'created'`, um `busy`, e uma linha `create` só no log do falso.
- **CA15 — "Abrir no app de agenda" (D9, N8, N9, R8).** `openIcs({ accountId, id })`: só `REQUEST` (senão `invalid`); grava `invite.source` em `userData/tmp/invite-<16 hex aleatórios>.ics` (pasta 0700 criada sob demanda, arquivo 0600; o nome nunca vem do email) e chama `deps.openPath`; texto de erro do `openPath` → `failed`, com o arquivo apagado. Funciona em qualquer plataforma e sem permissão do Calendário (é o Calendário, ou o app de agenda do Linux, que importa). `cleanTemp()` apaga todo `userData/tmp/invite-*.ics`: roda no início do serviço e no `dispose()` (o `will-quit`).
- **CA16 — Resposta enviada (do 61).** `recordReply(event: InviteRepliedEvent)` valida o evento com zod `.strict()` (inválido → log `resposta de convite: aviso inválido` e nada gravado) e grava na linha da chave `accountId` + `uid` + `normalizeWhen(recurrenceId)` (criando se preciso, com a versão do evento, como no CA7) `response = partstat`, `respondedAt = respondedAt` e `messageId`. Não lê o corpo nem chama o helper. Cada nova resposta troca a anterior (D5 do mockup). O 61 só chama depois do SMTP com sucesso; falha do envio não chega aqui. Ligado no `index.ts` como `onInviteReplied: (event) => void services.invites.recordReply(event)` em `createEmailService` (61, CA12); o retorno `reply` do `sendInviteReply` não é usado (um caminho só). O 62 não envia nada e não chama o `sendInviteReply`.
- **CA17 — Erros do helper → `InviteErrorCode`.** `denied` → `denied`; `restricted` → `restricted`; `not-found`/`calendar` → `no-calendar`; `not-found`/`event`|`occurrence` → `not-found` (no `remove`, CA12: vale como já tirado); `invalid`/`read-only-calendar` → `read-only-calendar`; `invalid`/`recurrence` → `recurrence`; outro `invalid` → `invalid`; `unavailable` com `platform`, `no-binary`, `dev`, `gave-up` ou `disposed` → `unavailable`; `unavailable` com `timeout`, `exited`, `busy`, `bad-response` ou `eventkit` → `failed`. O `message` da resposta é sempre `INVITE_ERROR_MESSAGES[code]`, nunca o `message` do helper. As frases, exatas (o 63 e o 64 mostram estas, sem tabela própria):
  | `code` | frase |
  |---|---|
  | `missing` | Não achei o convite desta mensagem. |
  | `invalid` | Não foi possível fazer isso agora. |
  | `old` | Há uma versão mais nova deste convite. |
  | `not-request` | Este convite não vai para a agenda. |
  | `recurrence` | Esta repetição o app não consegue copiar. |
  | `unavailable` | O Calendário do Mac não está disponível aqui. |
  | `denied` | Sem acesso ao Calendário. |
  | `restricted` | O acesso ao Calendário está restrito neste Mac. |
  | `no-calendar` | A agenda escolhida não existe mais. Escolha outra. |
  | `read-only-calendar` | Esta agenda não aceita eventos novos. Escolha outra. |
  | `not-owned` | O app não mexe em evento que ele não pôs na agenda. |
  | `not-found` | Não encontrei este evento na agenda. |
  | `busy` | Já há um pedido em andamento para este convite. |
  | `failed` | O Calendário não respondeu. Tente de novo. | Toda ação que falha devolve também o `state` recalculado (ou `null` se nem o convite deu para ler).

**IPC, settings e ligação**
- **CA23 — Entradas sem IPC para o 64 (regras e "Sugerir evento").** Nenhuma tem canal; o 64 as chama do main.
  - `addFromRule(source: InviteSource): Promise<InviteRuleAddResult>` (R10): o `addFor` do CA11 com `calendarId = settings.inviteCalendarId` (sem cair na `isDefault`: `null` → `no-calendar` sem chamar o helper), `availability: 'busy'` e `mayAskAccess: false` (nunca `request-access`). Nunca responde e grava a linha com `response` intocada (`null` se nova). Não é `REQUEST`, versão menor (`old`), `recurrenceBlocked` (`recurrence`) → `{ ok: true, effect: 'none' }` sem chamada ao helper; a linha já tem `event` → `effect: 'already'` (o `find` por id do CA11), e versão maior de um evento do app **não** atualiza (D8: `effect: 'none'`). `effect: 'already'` também no R5a. Erros: `denied`/`restricted` (inclusive `notDetermined` e `writeOnly`) → `calendar-denied`; `no-calendar`, `read-only-calendar`, `unavailable`, `failed` → `no-calendar`; `busy` → `{ ok: true, effect: 'none' }` (log `regras: pôr na agenda ignorado (busy)`). A conta do R5b não é conferida aqui (o 64 nem chama, pelo `inviteSelfAdding`).
  - `addEvent(request: { accountId: string; key: string; messageId: string; args: MacCalendarCreateArgs }): Promise<InviteEventAddResult>` (R11, gravar a sugestão do 64 no clique): mesma ordem do CA11 com `mayAskAccess: true`, `calendarId` = `args.calendarId`, trava do CA14 pela chave `accountId` + `key` + `null`. A linha usa `uid = key` (o 64 manda `suggest:<sha256 do id>`), `recurrenceId: null`, `sequence: 0`, `dtstamp: null`, `response: null`. Linha com `event` achado pelos ids, ou qualquer `match` do `find` (título + início) → `effect: 'already'` sem `create`; senão `create(args)` e `effect: 'created'`; `calendarTitle`/`sourceTitle` = a agenda do evento. Erros pelo CA17, com `message` do `INVITE_ERROR_MESSAGES`.
  - `calendarPresent(): Promise<boolean>`: `status()` do cliente **não** voltou `unavailable` com `platform`, `no-binary`, `gave-up` ou `disposed` (nunca pede acesso). O `rules-get` do 64 usa para o `invite.mac`.
  - *Testes* (em `invites-service.test.ts`, `describe('entradas do 64')`): `addFromRule` com `inviteCalendarId: null` → `no-calendar` e nenhum comando no log do falso; `access: "notDetermined"` → `calendar-denied` sem `request-access`; REQUEST novo → `refresh`, `find`, `create` e linha com `response: null`; o mesmo de novo → `already`, 0 `create`; v2 de um evento do app → `none`, 0 `update`; CANCEL → `none`, 0 comandos de escrita. `addEvent` duas vezes com a mesma `key` → 1 `create`, o segundo `already`. `calendarPresent` com `platform: 'linux'` → `false` sem `spawn`.
- **CA18 — Canais (N6).** Nos quatro lugares de `shared/ipc.ts` — o `import type` de `./invite-state`, a interface `InvokeChannels`, o mapa `INVOKE` e o `WHEN_LOCKED` (todos `'refused'`):
  | Canal | `request` | `response` |
  |---|---|---|
  | `scribe:invite-state` | `{ accountId: string; id: string }` | `InviteStateResult` |
  | `scribe:invite-add` | `{ accountId: string; id: string; calendarId: string; availability: 'busy' \| 'tentative' }` | `InviteActionResult` |
  | `scribe:invite-update` | `{ accountId: string; id: string }` | `InviteActionResult` |
  | `scribe:invite-remove` | `{ accountId: string; id: string }` | `InviteActionResult` |
  | `scribe:invite-calendars` | `undefined` | `InviteCalendarsResult` |
  | `scribe:invite-request-access` | `undefined` | `InviteAccessResult` |
  | `scribe:invite-open-ics` | `{ accountId: string; id: string }` | `InviteOpenIcsResult` |
  `PrivacyPane` ganha `'calendars'` e `shared/privacy.ts` a URL `x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars`. O "Abrir Ajustes" do R8 **não** é canal novo: é o evento `scribe:open-privacy-settings` que já existe (renderer → main, `RENDERER_EVENTS_WHEN_LOCKED: 'ignored'`), chamado pela tela como `window.__scribeApi.send('scribe:open-privacy-settings', 'calendars')`. Nenhum canal novo usa token de clique: gravar na agenda é local e o app só mexe no que criou; responder continua no 61. O `test/lock-ipc.test.ts` cobre os sete sem mudança (itera `WHEN_LOCKED`); o teste novo confere que os sete existem e são `'refused'`.
- **CA19 — Settings (R9).** Em `AppSettings`/`DEFAULT_SETTINGS` (`shared/settings-defaults.ts`) e nos esquemas `lenientSchema` e `patchSchema` de `main/settings/schema.ts`, no padrão das chaves que já existem: `inviteCalendarId: string | null` (padrão `null`; 1–1024 caracteres, sem caractere de controle; inválido → `null`), `inviteAddOnAccept: boolean` (padrão `true`), `inviteSuggest: boolean` (padrão `false`; só guardada aqui, quem lê é o 64). O main não confere se a agenda existe ao gravar: o CA13 cai para a padrão quando ela some.
- **CA20 — `main/index.ts`.** Em `createAppServices`: (1) `createMacCalendar` com `platform`, `arch`, `process.getSystemVersion()`, `app.isPackaged` e `command`: no smoke, o falso do CA24 (com `packaged: true`, para o `request-access` do falso funcionar no smoke); fora dele, `locateMacCalendar` (como o `micWatch`), com log só fora do pacote. (2) `createInviteService` com `source` = `email.inviteSource`, `openPath` = `shell.openPath`, `settings` = o store. (3) Os sete `handle(…, appOrigin, …)`, cada um com um `.catch` no formato do seu resultado: `state`, `calendars` e `request-access` → `{ ok: false, error: 'unavailable' }` (com `reason: 'failed'` nos dois últimos); `add`, `update` e `remove` → `{ ok: false, error: 'failed', message: INVITE_ERROR_MESSAGES.failed, state: null }`; `open-ics` → `{ ok: false, error: 'failed' }`. (4) `onInviteReplied` do `createEmailService` ligado ao `recordReply` (CA16); como o serviço de convites depende do `email.inviteSource`, o callback fecha sobre uma variável preenchida logo depois (`let invites: InviteService | null`), no molde de `emailService`. (5) `invites.reconcileAll()` no `onView` do `createCalendarService` (o intervalo do CA10 fica no serviço), sem `await`. (6) No `removeAccount` com sucesso, `invites.forgetAccount(accountId)`: as linhas saem, os eventos na agenda ficam. (7) No `will-quit`, `void services.invites.dispose()` (apaga o temporário, CA15) e `void services.macCalendar.dispose()`. O smoke de hoje passa sem mudança e, sem linha com `event`, nenhum processo do helper sobe (CA10).

- **CA24 — Smoke: o helper falso e o convite no IMAP falso.** É o único lugar que liga as peças falsas ao app; o 63 e o 64 só usam o que está aqui, sem mexer em `smoke-fixtures.ts`, `fake-email.ts` nem `index.ts` para isso.
  - `SmokeFixtures.macCalendar: { statePath: string; logPath: string; log(): Record<string, unknown>[] }`, com `statePath` = `<userData do smoke>/lap-calendar-falso.json` e `logPath` = `…/lap-calendar-falso.jsonl`; `log()` lê o `.jsonl` (arquivo ausente → `[]`). O estado é o JSON do cabeçalho do `fake-lap-calendar.mjs` (`access`, `onRequest`, `calendars`, `events`, `pending`): o smoke o escreve direto em `statePath` (o falso relê a cada requisição); arquivo ausente = o padrão do falso (`full`, `Trabalho` e `Feriados`).
  - No `index.ts`, com `smokeFixtures`: o `command` do `createMacCalendar` é `{ file: process.execPath, args: [join(app.getAppPath(), 'test/fixtures/fake-lap-calendar.mjs')], env: { ELECTRON_RUN_AS_NODE: '1', FAKE_LAP_CALENDAR_STATE: statePath, FAKE_LAP_CALENDAR_LOG: logPath, TZ: process.env.TZ } }`; `packaged: true`; `platform`/`arch`/`systemVersion` os reais (o smoke roda no Mac).
  - `FakeEmail.deliver` aceita `calendar?: { method: 'REQUEST' | 'CANCEL' | 'REPLY'; content: string }`: a mensagem sai `multipart/mixed` com o `text/plain`, uma parte `text/calendar; charset=utf-8; method=<method>` com o `content` e o anexo `invite.ics` (`application/ics`) com o mesmo conteúdo (como o Google manda, N10). Sem `calendar`, a mensagem sai igual à de hoje.
  - *Teste:* o smoke de hoje passa sem mudança; um teste de `fake-email` confere que `deliver` com `calendar` gera as duas partes e que `parseInvite` (com as partes do `simpleParser`) devolve um convite só.

**Testes**
- **CA21 — Registro (`test/invites-store.test.ts`).** 0600 no arquivo e no temporário (`stat().mode & 0o777`); 50 `update` ao mesmo tempo em chaves diferentes → as 50 linhas no arquivo; `update` lê o que o anterior gravou; linha com campo a mais sai sozinha e as outras ficam; JSON quebrado → `invites.json.invalid` e vazio; `recurrenceId` `null` e preenchido são chaves diferentes; `removeUid` tira série e ocorrências; `forgetAccount` só a conta pedida; teto: 2001 linhas sem evento → sai a de `seenAt` mais antigo, linha com evento futuro nunca sai; nenhum título, UID ou endereço nos logs.
- **CA22 — Verificação end-to-end contra o helper falso (`test/invites-service.test.ts`).** O `source` de teste devolve convites lidos por `parseInvite` das fixtures (as do 59 e as novas `servico-*.ics`, fictícias: `servico-request-v1.ics` REQUEST Meet America/New_York 15:00–16:00 de Brasília, SEQUENCE 1; `servico-request-v2.ics` o mesmo UID, SEQUENCE 2, 16:30–17:30; `servico-cancel.ics` o CANCEL dele; `servico-weekly.ics` série semanal; `servico-cancel-occurrence.ics` CANCEL com `RECURRENCE-ID` de uma ocorrência dela). Um caso por passo da verificação da spec:
  - **Passo 2** — Aceitar com "Pôr na agenda": `recordReply` com um `InviteRepliedEvent` de `partstat: 'ACCEPTED'` + `add(Trabalho, busy)` → o log do falso tem um `create` com `title`, `start` `…T18:00:00Z`, `end`, `timeZone: "America/New_York"`, `url: "https://meet.google.com/…"` e `notes` começando pelo link; `invites.json` tem a linha com `response: "ACCEPTED"` e `event.calendarItemIdentifier: "fake-item-1"`; `state` → `kind: 'in-calendar'`, `calendar: { status: 'app', calendarTitle: 'Trabalho', … }`.
  - **Passo 3** — o v2: `state` → `update-pending` com `changes[0].field === 'time'` (antes 18:00Z, depois 19:30Z) e `actions.update`; `update` → um `update` no log com os ids do `ref`, `span: "future"`; o `ref` passa aos ids novos que o falso devolve; `state` → `in-calendar`.
  - **Passo 4** — o CANCEL: `state` → `cancelled`, `actions.remove`; `remove` → um `remove` no log com `span: "future"` e sem `recurrenceId`; `invites.json` sem nenhuma linha do UID.
  - **Passo 5** — falso com um evento `origin: "account"` e `externalIdentifier` = UID: `state` → `already-in-calendar`, `calendar.merged: false`, `actions.remove: false`; `add` → `effect: 'already'`, nenhuma linha `create` no log, linha com `event: null`.
  - **Passo 6** — `add` cria `fake-item-1`; o falso tem `pending: [{ afterRefresh: 2, event: <cópia da conta com o UID> }]`; reabrir (`state`, com o relógio além de `INVITE_REFRESH_MIN_MS`) → um `remove` de `fake-item-1` com `span: "future"` no log, linha com `event: null` e `merged`, estado `in-calendar` com `calendar: { status: 'account', merged: true }` e `notice: 'merged'`; a leitura seguinte → `notice: null`; a cópia da conta continua no estado do falso.
  - **Passo 7** — conta com `incoming.host` `imap.gmail.com` → `addDefault: false`, `addHint: 'account-adds'`; o mesmo com `outlook.office365.com`; `mail.lapsoftware.com.br` → `addDefault: true`, `addHint: null`; `inviteAddOnAccept: false` → `addDefault: false` em qualquer host.
  - **Passo 8** — `add` da série semanal; `state` do CANCEL da ocorrência → `cancelled`, `actions.remove`; `remove` → um `remove` no log com `recurrenceId` da ocorrência (sem fração) e `span: "this"`; um `find` da série depois ainda acha as outras ocorrências; a linha da série com o mesmo `event`, a da ocorrência com `removed: true`; reabrir → `actions.remove: false` e nenhum `remove` novo.
  - **Passo 10** — falso com `access: "denied"`: `state` → `calendar: { status: 'no-access', access: 'denied' }`, `actions.openSettings`, `actions.openIcs`, `actions.add: false`; `add` → `denied`, nenhuma linha `create`; `recordReply` (ACCEPTED) grava a resposta mesmo assim e o `state` volta `kind: 'responded'`. Com `access: "notDetermined"` e `onRequest: "full"`: `state` → `needs-access` sem `request-access` no log; `add` → um `request-access` e um `create` no log.
  - **Além da verificação:** N4 (o v1 depois do v2 → `old`, `actions` todas falsas, `add` → `old` sem chamada ao helper); `not-owned` (o `remove` do passo 5 → `not-owned`, nenhuma linha `remove` no log); `title-start` em outra agenda não é adotado como do app; recorrência `rdate.ics` → `recurrenceBlocked`, `actions.add: false`, `actions.openIcs`, `add` → `recurrence`; `unavailable` fora do Mac (`platform: 'linux'`) → `calendar: { status: 'unavailable', reason: 'platform' }`, `actions.openIcs`, nenhum `spawn`; `timeout` no `create` (`FAKE_LAP_CALENDAR_HANG=create`, prazo curto) → `failed`, um `create` só no log; `busy` (CA14); `openIcs` grava `userData/tmp/invite-*.ics` 0600 com o `source` e chama o `openPath` falso, `dispose()` apaga; `reconcileAll` sem linha com `event` → nenhum `spawn`; `requestAccess` com `packaged: false` → `unavailable`/`dev`; settings (CA19) lenientes; os sete canais `'refused'` no `WHEN_LOCKED`; o log de todos os casos não contém título, UID, local, URL, notas nem endereço das fixtures; as checagens estáticas das Invariantes (rede e `remove(`/`update(`); os casos do CA23. **Recusar** um REQUEST com evento do app (`recordReply` DECLINED + `remove`) → um `remove` no log, a linha continua com `response: "DECLINED"` e `event: null`, e o `state` volta `responded`/`absent`.

## Invariantes
- **O app nunca apaga nem altera evento que não criou.** Só uma linha com `event` dá direito a `update` ou `remove`, e só pelos ids dela (o helper do 60 já recusa achar por título ou UID para escrever); a cópia da conta (R5a, R5c) só é lida. A reconciliação só tira o evento que o próprio app criou. Âncora: o teste `not-owned` e o passo 5, e `grep -n "remove(\|update(" src/main/invites/service.ts` só em funções que recebem um `InviteEventRef`.
- **Nada vai para a rede além do helper.** `src/main/invites/*` e `src/shared/invite-state.ts` não importam `node:net`, `node:http`, `node:https`, `node:dgram`, `node:dns`, o `net` do Electron, `imapflow`, `nodemailer` nem chamam `fetch` (teste estático); o `inviteSource` do email só lê o cache. A única coisa que sai da máquina nesta feature é o REPLY do 61.
- **Nenhum dado de evento vai para o log.** O log do serviço e do store diz só canal, operação, `code`, `reason` e contagens: nunca título, UID, local, URL, notas, endereço, nome de agenda ou `messageId`. Âncora: o teste de log do CA22.
- Nada muda na agenda sem clique, fora a reconciliação do R5c (D8). Nenhum canal envia email; nenhuma regra, tarefa agendada ou Assistente chama o serviço (o `assistant-tools.ts` e o MCP do agente sem diff).
- Bloqueado (N6): os sete canais `'refused'`; nada do serviço é transmitido às janelas (não há evento de main novo).
- `main/calendar/*` (contrato 12) e `main/mac-calendar/*` (contrato 60) sem diff; R12 não pede código: um evento gravado numa agenda do Mac que é de uma conta Google/Microsoft já lida entra nos avisos pelo caminho de hoje.

## Fora de escopo
- Extração do convite no corpo, corpos antigos (N12), `scribe:invite-reply`/`sendInviteReply` e a trava do duplo clique do REPLY: contrato 61.
- Cartão, ícone na lista, bloco "Convites" em Configurações, a ordem dos cliques (responder pelo 61 e, só depois do `ok`, `invite-add` ou `invite-remove`; o serviço não age sozinho depois do REPLY, só registra pelo `recordReply`), os passos do smoke e os prints: contrato 63.
- Condição "É convite", ação "Pôr na agenda" das regras (usa o `addFromRule` do CA23) e todo o "Sugerir evento" (R11: botão, cartão, `scribe:invite-suggest`/`-suggest-add`, `main/invites/suggest.ts`; grava pelo `addEvent` do CA23): contrato 64.
- Aviso de "Atualização pendente" para evento que o app não gravou (a conta atualiza sozinha; o cartão mostra a versão nova), apagar URL num `update`, POP3 do Gmail (`pop.gmail.com`) no R5b, evento de main para avisar a tela de mudanças. F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos **8 passos**.
- Testes novos em `test/invites-store.test.ts` e `test/invites-service.test.ts` (CA21, CA22), todos contra o helper falso; nada contra o binário de verdade nem o Calendário do Mac.
- `git diff --stat` só com os arquivos da Superfície.
- Sem commit: quem coordena commita pelo agente de commits.

## Decisões deste contrato (para o Andrew conferir na revisão)
- **E1 — O registro guarda um pouco mais que o N3.** O `event` ganha `end`, `allDay`, `timeZone`, `location`, `url`, `availability`, `occurrence` e a versão gravada (`sequence`, `dtstamp`), e a linha ganha `seenAt`, `merged`, `mergedNotice` e `removed`. Sem isso não dá para mostrar "antes → depois" (o `EventOut` do helper não traz o local) nem saber se a atualização já foi aplicada.
- **E2 — Depois de juntar (R5c), `event` vira `null`.** O "mapa" passa à cópia da conta só para mostrar (`merged`), sem dar ao app o direito de apagá-la: um CANCEL depois disso fica só no aviso, quem tira é a conta. Assim o invariante "só apaga o que criou" vale sem exceção.
- **E3 — CANCEL não cria linha** e "Tirar da agenda" (CANCEL) do evento inteiro apaga todas as linhas do UID (o passo 4 da verificação), mas tirar uma ocorrência deixa a linha dela com `removed: true`, para o botão não voltar. O "Recusar" de um REQUEST tira o evento e **mantém** a linha com `event: null`, senão a resposta recém-gravada se perderia.
- **E4 — Sem token de clique nos canais de agenda.** Gravar é local e só mexe no que o app criou; o token continua só no envio (61).
- **E5 — Timeout no `create` não adota evento.** Se ficou gravado, ele aparece como "Já estava na agenda", sem `event`. Prefere-se perder o controle a correr o risco de apagar um evento da pessoa.
- **E6 — `title-start` só é adotado como do app na mesma agenda do registro** (o último passo do N3); em qualquer outra agenda é a cópia de outra pessoa ou conta.
- **E7 — `refresh` no máximo a cada 60 s ao abrir o cartão, sempre antes de criar; reconciliação de fundo a cada 5 min, 20 eventos por vez, só com acesso já concedido.**

Conferido com os contratos 61–64 em 19/11/2026.
