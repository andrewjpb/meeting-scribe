# Contrato 59 — Convites: parser e gerador iCalendar (`shared/invite.ts`)
Feature: convites-agenda · Wave: 1 · Depende de: — · Spec: `docs/specs/convites-agenda/spec.md` (R1, R2 no que é texto, R3, N4, N5, N8, N10, N11) · Plan: `docs/specs/convites-agenda/plan.md` (D3)

Este contrato é **só o módulo puro** que lê o `.ics` de um email e escreve o REPLY, mais o empacotamento do `ical.js`.
Ninguém chama este módulo ainda: o parse do corpo e o envio são do 61, o registro e a agenda do 62, as telas do 63.
Por isso nada aqui muda o que o app faz para quem usa.

## Pré-condições
- Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-convites`, branch `convites-agenda`, `git status` limpo.
  Spec e plan aprovados pelo Andrew em 19/11/2026 (commit `45df8ec`).
- Ler antes: `apps/desktop/src/shared/calendar.ts` (`findJoinUrl`, `safeJoinUrl`, `CALENDAR_ATTENDEES_MAX`,
  `CALENDAR_TEXT_MAX`), `apps/desktop/src/shared/email.ts` (`EmailBody`, `EmailAttachmentInfo`), o `parseEmail` de
  `apps/desktop/src/main/email/service.ts` (só para ver como o `mailparser` entrega as partes; **não mexer**),
  `apps/desktop/electron.vite.config.ts`, `apps/desktop/scripts/pack.sh`, `apps/desktop/test/calendar.test.ts`.
- Versão do `ical.js`: **2.2.1** (a última no npm em 19/11/2026, publicada em 08/08/2025; MPL-2.0; ESM com
  `exports.require` CJS e tipos próprios em `dist/types`; sem dependências). Fixada sem `^` nem `~`.

## Superfície (todos os caminhos relativos a `apps/desktop/`, fora o lockfile)
| Arquivo | O que muda |
|---|---|
| `package.json` | `"ical.js": "2.2.1"` em `dependencies` |
| `../../pnpm-lock.yaml` | atualizado pelo `pnpm install` (único efeito da linha acima) |
| `electron.vite.config.ts` | `'ical.js'` no `externalizeDeps.exclude` do `main`, ao lado de `imapflow`/`nodemailer`/`mailparser`; comentário cita o contrato 59 |
| `scripts/pack.sh` | checagem de que o `ical.js` foi embutido no main do `.app` (CA12) |
| `src/shared/invite.ts` | **novo**: tipos, `parseInvite`, `buildReply`, `describeRecurrence`, `classifyRecurrence`, `compareInviteVersion`, constantes |
| `src/shared/windows-zones.ts` | **novo**: tabela Windows→IANA e `windowsToIana` |
| `src/shared/calendar.ts` | `JOIN_URL_PATTERN` passa a aceitar `https://teams.microsoft.com/meet/<id>?p=<senha>` (CA6) |
| `test/invite.test.ts` | **novo** |
| `test/calendar.test.ts` | um caso novo do `findJoinUrl` (Teams novo) |
| `test/fixtures/invites/*` | **novo**: as fixtures da tabela do CA14 |

## Tipos (CA1) — exportados de `src/shared/invite.ts`
```ts
export const INVITE_ICS_MAX_BYTES = 512 * 1024          // teto por parte .ics (CA9)
export const INVITE_VEVENTS_MAX = 200                   // VEVENTs por arquivo (CA9)
export const INVITE_EXDATES_MAX = 500
export const INVITE_EXCEPTIONS_MAX = 100
export const INVITE_DESCRIPTION_MAX = 8000              // caracteres, depois de tirar o escape do iCalendar
export type InviteMethod = 'REQUEST' | 'CANCEL' | 'REPLY'
export type InvitePartstat = 'NEEDS-ACTION' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' | 'DELEGATED'
export type InviteReplyPartstat = 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'
export interface InvitePerson { address: string /* minúsculo, sem "mailto:" */; name: string | null /* CN */ }
export interface InviteAttendee extends InvitePerson { partstat: InvitePartstat }
export type InviteWeekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
export interface InviteRule {
  freq: 'SECONDLY' | 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number; count: number | null; until: string | null /* ISO UTC, ou AAAA-MM-DD se dia inteiro */
  byDay: { day: InviteWeekday; pos: number | null }[]; byMonthDay: number[]; byMonth: number[]; bySetPos: number[]
  weekStart: InviteWeekday | null
}
export type InviteRecurrenceBlock = 'sub-daily' | 'byhour' | 'byminute' | 'bysecond' | 'byweekno' | 'byyearday' | 'rdate' | 'exrule' | 'multiple-rrule' | 'invalid'
export interface InviteRecurrence {
  rule: InviteRule | null                 // null só quando não há RRULE (só RDATE) ou a RRULE é ilegível
  exdates: string[]                       // ISO UTC (ou AAAA-MM-DD), ordenadas, sem repetição, até INVITE_EXDATES_MAX
  text: string                            // português, CA5
  storable: boolean                       // N8: o EKRecurrenceRule grava?
  block: InviteRecurrenceBlock | null     // por que não grava; null quando storable
}
export interface InviteException { recurrenceId: string; start: string; end: string; cancelled: boolean }
export type InviteWarning = 'unknown-tzid' | 'floating-time' | 'attendees-clipped' | 'description-clipped' | 'other-uids-ignored' | 'exdates-clipped' | 'exceptions-clipped'
export interface EmailInvite {
  method: InviteMethod
  uid: string
  sequence: number                        // ausente ou inválido → 0
  dtstamp: string | null                  // ISO UTC
  recurrenceId: string | null             // ISO UTC (ou AAAA-MM-DD) quando o VEVENT principal é uma ocorrência
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED' | null
  title: string                           // SUMMARY sem escape, até CALENDAR_TEXT_MAX; vazio → "(sem título)"
  allDay: boolean
  start: string                           // ISO UTC com milissegundos ("2026-11-20T15:00:00.000Z") ou AAAA-MM-DD se allDay
  end: string                             // idem; dia inteiro: exclusivo
  timeZone: string | null                 // IANA (N11); null em dia inteiro ou fuso que não deu para nomear
  originalTzid: string | null             // TZID como veio (para o cartão mostrar o fuso de origem)
  location: string | null; description: string | null
  joinUrl: string | null                  // CA6
  organizer: InvitePerson | null
  attendees: InviteAttendee[]             // até CALENDAR_ATTENDEES_MAX, na ordem do arquivo
  attendeeCount: number                   // total real de ATTENDEE
  self: InviteAttendee | null             // N5: o ATTENDEE cujo endereço é um de `options.self`
  recurrence: InviteRecurrence | null     // null sem RRULE nem RDATE
  exceptions: InviteException[]           // VEVENTs do mesmo UID com RECURRENCE-ID (quando o principal é a série)
  warnings: InviteWarning[]
  source: string                          // o VCALENDAR escolhido, como texto (já decodificado), para o buildReply e o "Abrir no app de agenda"
}
export interface InvitePart { contentType: string /* com ou sem parâmetros */; filename: string | null; method: string | null /* parâmetro method= do Content-Type */; content: string | Uint8Array }
export type InviteParseError = 'none' | 'too-big' | 'malformed' | 'no-event' | 'no-method' | 'unsupported-method' | 'no-uid' | 'no-start'
export type InviteParseResult = { ok: true; invite: EmailInvite; ignoredParts: number } | { ok: false; error: InviteParseError }
export function parseInvite(parts: readonly InvitePart[], options: { self: readonly string[]; localTimeZone: string }): InviteParseResult
export type InviteReplyError = 'not-request' | 'no-organizer' | 'not-invited' | 'invalid' | 'malformed'
export type InviteReplyResult = { ok: true; ics: string; subject: string; to: InvitePerson; filename: 'invite.ics'; contentType: 'text/calendar; charset=utf-8; method=REPLY' } | { ok: false; error: InviteReplyError }
export function buildReply(invite: EmailInvite, options: { partstat: InviteReplyPartstat; self: readonly string[]; now: Date }): InviteReplyResult
export function describeRecurrence(rrule: string, dtstart: { start: string; timeZone: string | null; allDay: boolean }): string
export function classifyRecurrence(rrules: readonly string[], hasRdate: boolean, hasExrule: boolean): { storable: boolean; block: InviteRecurrenceBlock | null }
export function compareInviteVersion(a: { sequence: number; dtstamp: string | null }, b: { sequence: number; dtstamp: string | null }): -1 | 0 | 1
```
Nomes e formas acima são o contrato; campos internos a mais (não exportados) são livres. O `EmailInvite` precisa ser
JSON puro (vai dentro do `EmailBody` no 61): sem `Date`, sem classe do `ical.js`, sem `undefined` em campo obrigatório.

## Critérios de aceite

### Escolha da parte (N10)
- **CA2 — Quais partes contam.** Dado `parts`, Quando `parseInvite` roda, Então é candidata a parte cujo `contentType`
  (sem parâmetros, sem diferenciar maiúsculas) é `text/calendar` ou `application/ics`, **ou** cujo `filename` termina em
  `.ics` (qualquer caixa), qualquer que seja o tipo. As demais são ignoradas. Nenhuma candidata → `{ ok: false, error: 'none' }`.
  Ordem de tentativa: (1) `text/calendar` com `method` não nulo; (2) outro `text/calendar`; (3) o resto, na ordem de `parts`.
  A primeira que dá `ok` vence; as candidatas seguintes **com o mesmo UID** contam em `ignoredParts` e não mudam nada.
  Se todas falham, o erro é o da primeira candidata na ordem acima.
  *Teste:* a fixture `google-request.eml` lida pelo `simpleParser` do `mailparser` e convertida em `InvitePart`
  (`contentType`, `filename`, `headers.get('content-type')?.params?.method ?? null`, `content`) dá `ok: true` e
  `ignoredParts: 1`; com as partes em ordem invertida, o mesmo resultado (o `.ics` anexo não vence o `text/calendar`).
- **CA3 — Decodificação.** `content` em bytes é lido no `charset=` do `contentType` (`utf-8`, `iso-8859-1`,
  `windows-1252`; outro ou ausente → `utf-8`), sem o BOM inicial. Aceita fim de linha CRLF e só LF, e linhas dobradas
  (RFC 5545 §3.1). *Teste:* `outlook-windows-tz.ics` convertida para `windows-1252` e passada como bytes com
  `charset=windows-1252` dá o mesmo `title` com acento ("Planejamento — orçamento 2027") que a versão UTF-8; a fixture
  com LF puro (`zoom-sem-vtimezone.ics`, gravada com LF) é lida.

### Leitura (R1)
- **CA4 — Campos, por fixture.** Para cada fixture da tabela do CA14, Quando `parseInvite([parte], { self:
  ['andrew.teste@example.org'], localTimeZone: 'America/Sao_Paulo' })` roda, Então o resultado é **exatamente** o da
  coluna "Esperado" (asserções campo a campo com `toBe`/`toEqual`, não `toMatchObject` frouxo). Regras gerais:
  - `METHOD` do VCALENDAR vence o `method` da parte; sem `METHOD` no arquivo, vale o `method` da parte; sem os dois →
    `no-method`. `PUBLISH`, `ADD`, `COUNTER`, `DECLINECOUNTER`, `REFRESH` → `unsupported-method` (F3).
  - VEVENT principal: o que **não** tem `RECURRENCE-ID`; se todos têm, o primeiro. VEVENTs de outro UID → ignorados,
    com `warnings` contendo `'other-uids-ignored'`. VEVENTs do mesmo UID com `RECURRENCE-ID` → `exceptions` (só quando
    o principal é a série), ordenadas por `recurrenceId`.
  - Sem `UID` → `no-uid`; sem `DTSTART` → `no-start`. Sem `DTEND`: usa `DURATION`; sem os dois, dia inteiro → fim =
    dia seguinte, com hora → fim = início (RFC 5545 §3.6.1).
  - Endereços: `mailto:` tirado sem diferenciar maiúsculas, endereço em minúsculo; `name` = parâmetro `CN` sem aspas,
    ou `null`. `PARTSTAT` ausente → `NEEDS-ACTION`; valor desconhecido → `NEEDS-ACTION`.
  - `self` casa sem diferenciar maiúsculas, mesmo além do 50º convidado (`attendees` é cortado, `self` não).
  - Textos (`title`, `location`, `description`) sem o escape do iCalendar (`\n`, `\,`, `\;`, `\\`), sem caractere de
    controle além de `\n` e `\t`; `description` acima de `INVITE_DESCRIPTION_MAX` é cortada e ganha
    `'description-clipped'`; `attendees` acima de 50 ganha `'attendees-clipped'`.
- **CA5 — Fuso (N11).** Os instantes `start`, `end`, `recurrenceId`, `exdates`, `until` e os de `exceptions` saem em UTC:
  - `TZID` com `VTIMEZONE` no arquivo: o VTIMEZONE é registrado no `ical.js` (`TimezoneService.register`) **só durante
    este parse** e removido no `finally` (mesmo quando o parse falha). `timeZone` = o TZID se ele é IANA válido
    (`Intl.DateTimeFormat` aceita), senão `windowsToIana(TZID)`, senão `null` (os instantes continuam certos pelo
    VTIMEZONE).
  - `TZID` **sem** `VTIMEZONE`: nome IANA válido → instante calculado pelo `Intl` naquele fuso; nome do Windows → pela
    tabela e depois pelo `Intl`; prefixo de caminho (ex.: `/mozilla.org/20050126_1/America/New_York`) → usa o trecho
    final que for IANA válido; nada disso → lê no `localTimeZone`, `timeZone: options.localTimeZone` e
    `warnings` com `'unknown-tzid'`.
  - Hora com `Z` → `timeZone: 'UTC'`. Hora flutuante (sem `TZID` nem `Z`) → `localTimeZone`, com `'floating-time'`.
  - Dia inteiro (`VALUE=DATE`) → `start`/`end` em `AAAA-MM-DD`, `timeZone: null`.
  - *Testes:* além das fixtures, (a) **isolamento**: um convite cujo VTIMEZONE chama `America/Sao_Paulo` com
    `TZOFFSETTO:+0500` e, em seguida, `zoom-sem-vtimezone.ics` (TZID `America/Sao_Paulo`, sem VTIMEZONE): o segundo dá
    `start: '2026-11-26T12:00:00.000Z'` (UTC−3 do `Intl`), e o número de fusos registrados no `ical.js` depois dos dois
    parses é o mesmo de antes; (b) TZID `Fuso Inventado/XYZ` sem VTIMEZONE → `'unknown-tzid'`, lido em São Paulo;
    (c) TZID com prefixo `/mozilla.org/20050126_1/America/New_York` sem VTIMEZONE → `timeZone: 'America/New_York'`.
- **CA6 — Link da reunião.** `joinUrl` = `findJoinUrl` (de `shared/calendar.ts`, sem cópia da regex) aplicado, nesta
  ordem, a `X-GOOGLE-CONFERENCE`, `X-MICROSOFT-SKYPETEAMSMEETINGURL`, `X-MICROSOFT-ONLINEMEETINGEXTERNALLINK`, `URL`,
  `LOCATION`, `DESCRIPTION`; o primeiro que der link vence. Link que não é Meet/Teams/Zoom → `null` (FaceTime, Webex
  etc. ficam fora). Em `shared/calendar.ts`, o `JOIN_URL_PATTERN` ganha a alternativa
  `teams\.microsoft\.com\/meet\/\d+(?:\?p=[\w-]+)?` (só isso muda no arquivo). *Teste em `calendar.test.ts`:*
  `findJoinUrl('Entrar: https://teams.microsoft.com/meet/2468013579123?p=AbCdEfGh12345.')` →
  `'https://teams.microsoft.com/meet/2468013579123?p=AbCdEfGh12345'`; os casos antigos do arquivo continuam passando.

### Recorrência (N8, R2)
- **CA7 — Texto em português.** `describeRecurrence` devolve **exatamente** (dia da semana e datas no fuso do evento;
  `timeZone` nulo → UTC; sem acento faltando):

  | RRULE (DTSTART) | Texto |
  |---|---|
  | `FREQ=DAILY` | `Todo dia` |
  | `FREQ=DAILY;INTERVAL=3` | `A cada 3 dias` |
  | `FREQ=WEEKLY` (DTSTART numa quarta) | `Toda semana, às quartas` |
  | `FREQ=WEEKLY;BYDAY=FR` | `Toda semana, às sextas` |
  | `FREQ=WEEKLY;BYDAY=SA` | `Toda semana, aos sábados` |
  | `FREQ=WEEKLY;BYDAY=MO,WE` | `Toda semana, às segundas e quartas` |
  | `FREQ=WEEKLY;BYDAY=SA,MO,WE` | `Toda semana, às segundas, quartas e aos sábados` |
  | `FREQ=WEEKLY;BYDAY=SU,SA` | `Toda semana, aos sábados e domingos` |
  | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` | `Todo dia útil (segunda a sexta)` |
  | `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU` | `A cada 2 semanas, às terças` |
  | `FREQ=MONTHLY;BYMONTHDAY=15` | `Todo mês, no dia 15` |
  | `FREQ=MONTHLY` (DTSTART dia 7) | `Todo mês, no dia 7` |
  | `FREQ=MONTHLY;BYDAY=2TU` | `Todo mês, na segunda terça` |
  | `FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2` | `Todo mês, na segunda terça` |
  | `FREQ=MONTHLY;BYDAY=1SA` | `Todo mês, no primeiro sábado` |
  | `FREQ=MONTHLY;BYDAY=-1FR` | `Todo mês, na última sexta` |
  | `FREQ=MONTHLY;BYDAY=-1SU` | `Todo mês, no último domingo` |
  | `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1` | `A cada 3 meses, no dia 1` |
  | `FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=10` | `Todo ano, em 10 de março` |
  | `FREQ=YEARLY` (DTSTART 2026-12-05, dia inteiro) | `Todo ano, em 5 de dezembro` |
  | `FREQ=YEARLY;INTERVAL=2;BYMONTH=6;BYMONTHDAY=1` | `A cada 2 anos, em 1 de junho` |
  | `FREQ=DAILY;COUNT=5` | `Todo dia, 5 vezes` |
  | `FREQ=WEEKLY;BYDAY=FR;UNTIL=20261218T130000Z` (DTSTART 2026-11-20, São Paulo) | `Toda semana, às sextas, até 18 de dezembro` |
  | `FREQ=WEEKLY;BYDAY=MO;UNTIL=20270131T130000Z` (DTSTART 2026-12-07, São Paulo) | `Toda semana, às segundas, até 31 de janeiro de 2027` |
  | `FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1` | `Repetição personalizada` |
  | `FREQ=HOURLY` | `Repetição personalizada` |
  | `FREQ=DAILY;BYHOUR=9,15` | `Repetição personalizada` |
  | `isto não é RRULE` | `Repetição personalizada` |

  Regras por trás da tabela: dias na ordem segunda→domingo; artigo "às" (dias úteis) / "aos" (sábado, domingo) no
  primeiro item e de novo só quando o gênero muda; ordinais 1–4 = primeira/segunda/terceira/quarta (primeiro/segundo/
  terceiro/quarto no sábado e no domingo), −1 = última/último, outro → `Repetição personalizada`; "até" sem o ano quando
  o fim cai no mesmo ano do início, com o ano quando não; mês em minúsculo. Qualquer parte fora de FREQ, INTERVAL,
  COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS e WKST, ou combinação que a tabela não cobre → `Repetição
  personalizada`. Em `EmailInvite.recurrence.text`, só RDATE sem RRULE → `Repetição por datas`.
- **CA8 — O que dá para gravar (N8).** `classifyRecurrence` devolve, na primeira regra que bate, nesta ordem:
  mais de uma RRULE → `multiple-rrule`; EXRULE → `exrule`; RDATE → `rdate`; FREQ `SECONDLY`/`MINUTELY`/`HOURLY` →
  `sub-daily`; `BYHOUR` → `byhour`; `BYMINUTE` → `byminute`; `BYSECOND` → `bysecond`; `BYWEEKNO` → `byweekno`;
  `BYYEARDAY` → `byyearday`; RRULE ilegível, `COUNT` junto com `UNTIL`, `INTERVAL` < 1, `BYDAY` com número em
  `FREQ=WEEKLY` ou `DAILY` → `invalid`; senão `{ storable: true, block: null }`. EXDATE **não** bloqueia (vira remoção
  de ocorrência no 62). *Teste:* um caso por código, mais `FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=…` e
  `FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1` → `storable: true`. `parseInvite` usa a mesma função: nunca há
  `storable: true` com `block` não nulo, nem o contrário.
- **CA9 — Teto e arquivo ruim (os casos de erro).**
  - Parte com mais de `INVITE_ICS_MAX_BYTES` (512 KiB, em bytes antes de decodificar) → `too-big`, **sem** chamar o
    `ical.js` (teste com espião em `ICAL.parse`, ou medindo que o resultado sai sem tocar o parser). *Teste gerado no
    próprio teste, sem fixture:* 600 KiB → `too-big`; um REQUEST de ~400 KiB com 2.000 ATTENDEE, sendo
    `andrew.teste@example.org` o 1.999º → `ok`, `attendees.length === 50`, `attendeeCount === 2000`, `self` achado,
    `'attendees-clipped'` em `warnings`.
  - Mais de `INVITE_VEVENTS_MAX` VEVENTs → `too-big`. EXDATEs e exceções acima do teto são cortadas
    (`'exdates-clipped'`, `'exceptions-clipped'`).
  - `malformed.ics` (`BEGIN:VCALENDAR` sem `END`, linha sem `:`) → `malformed`; texto vazio ou só espaços → `malformed`;
    `BEGIN:VCARD` no lugar de VCALENDAR → `malformed`. Nenhum desses lança exceção para fora de `parseInvite`.
  - `no-vevent.ics` (VCALENDAR com só VTODO) → `no-event`. `no-method.ics` com `method: null` → `no-method`; a mesma com
    `method: 'REQUEST'` → `ok`. `publish.ics` → `unsupported-method`.
  - A recorrência **nunca é expandida** (nenhum `iterator()` do `ical.js`): `FREQ=SECONDLY` sem fim é lida em tempo
    constante e dá `sub-daily`.

### Versão (N4, R6)
- **CA10 — `compareInviteVersion`.** Compara `sequence` primeiro; empate → `dtstamp` (`null` é menor que qualquer data);
  empate nos dois → `0` (RFC 5546 §2.1.5). *Teste:* `google-cancel.ics` contra `google-request.eml` → `1`; o inverso →
  `-1`; o mesmo convite contra ele mesmo → `0`; `{1, null}` contra `{0, '2030-…'}` → `1`; `{0, null}` contra
  `{0, '2026-…'}` → `-1`.

### Resposta (R3, N5)
- **CA11 — `buildReply`.** Dado o `EmailInvite` de um REQUEST e `{ partstat, self, now }`, Então:
  - `method` diferente de `REQUEST` → `not-request`; `organizer` nulo ou `ORGANIZER` que não é `mailto:` →
    `no-organizer`; nenhum ATTENDEE do `source` com endereço em `self` → `not-invited`; `partstat` fora dos três ou
    `now` inválido → `invalid`; `source` que não relê → `malformed`.
  - `ok`: `ics` com linhas terminadas em CRLF, nenhuma linha com mais de 75 octetos (dobra sem partir caractere UTF-8),
    terminando em `END:VCALENDAR\r\n`. Estrutura: `VCALENDAR` com `PRODID:-//LAP//LAP Reunioes//PT-BR`,
    `VERSION:2.0`, `CALSCALE:GREGORIAN`, `METHOD:REPLY`; os `VTIMEZONE` do `source` cujo TZID aparece em
    `DTSTART`/`DTEND`/`RECURRENCE-ID` do VEVENT respondido, copiados como vieram; **um** `VEVENT` com `UID`,
    `SEQUENCE` (o do convite; `SEQUENCE:0` quando o convite não tinha), `DTSTAMP` = `now` em UTC no formato
    `AAAAMMDDTHHMMSSZ`, `RECURRENCE-ID` (só quando `invite.recurrenceId` não é nulo), `DTSTART`, `DTEND` (ou o
    `DURATION`, se era o que o convite tinha), `SUMMARY`, `ORGANIZER` e **um único** `ATTENDEE`.
  - `ORGANIZER`, `UID`, `RECURRENCE-ID`, `DTSTART`, `DTEND`/`DURATION` e `SUMMARY`: mesmo nome, mesmos parâmetros e
    mesmo valor do `source` (comparando as linhas desdobradas, parâmetro a parâmetro). `ATTENDEE`: o do `self`, com o
    valor idêntico ao do convite, inclusive a caixa (`mailto:Andrew.Teste@example.org` continua assim), os mesmos
    parâmetros (`CN` etc.) fora `PARTSTAT` = o escolhido e `RSVP` removido.
  - O REPLY **não** leva `DESCRIPTION`, `LOCATION`, `URL`, `X-*`, `VALARM`, `ATTACH` nem outro `ATTENDEE`
    (asserção: nenhuma dessas linhas no `ics`; `ics.match(/^ATTENDEE/gm).length === 1`).
  - `subject`: `Aceito: <título>` / `Talvez: <título>` / `Recusado: <título>`, sem CR/LF. `to` = `organizer`.
  - *Testes:* para `google-request.eml`, `outlook-windows-tz.ics`, `icloud-allday.ics` e `occurrence-request.ics`, o
    `ics` relido por `parseInvite` dá `method: 'REPLY'`, o mesmo `uid`, `sequence`, `start`, `end`, `recurrenceId` e
    `attendees` com um item no `partstat` pedido; `dtstamp` igual a `now`. `zoom-sem-vtimezone.ics` → REPLY sem
    `VTIMEZONE` e com o `DTSTART;TZID=America/Sao_Paulo:…` copiado. `google-cancel.ics` → `not-request`;
    `self: ['outra@example.org']` → `not-invited`. O mesmo `invite` + `now` dá o mesmo `ics` byte a byte (determinismo).

### Empacotamento (D3)
- **CA12 — `ical.js` embutido no main.** `package.json` tem `"ical.js": "2.2.1"` (exato); `electron.vite.config.ts`
  tem `'ical.js'` no `exclude` do `main`; `pnpm install --frozen-lockfile` passa com o lockfile do commit. No
  `pack.sh`, depois das checagens do asar: extrair o asar numa pasta temporária (`npx -y @electron/asar extract`) e
  falhar com `pack.sh: o main ainda pede o ical.js de fora do pacote` se algum `.js` de `out/main/` tiver
  `require("ical.js")`, `require('ical.js')` ou `from "ical.js"`/`from 'ical.js'`, e com
  `pack.sh: o pacote não leva o ical.js` se não achar neles um literal que só existe no código do `ical.js` (escolher
  um texto de `node_modules/ical.js/dist/ical.js` que não aparece em `src/`, conferido com `grep -r`, e citá-lo no
  comentário). Sucesso imprime `ical.js ok`. A pasta temporária sai no `trap`. *Teste estático em
  `invite.test.ts`:* lê `electron.vite.config.ts` e `package.json` como texto/JSON e confere as duas primeiras frases.
  Os gates não rodam o `pack.sh`: o implementador roda `bash apps/desktop/scripts/pack.sh` uma vez se a máquina deixar
  (precisa de `../../prova` e do `swiftc`); se não der, roda as duas buscas acima direto em `apps/desktop/out/main/`
  depois do `pnpm build` e mostra a saída no relatório.

### Tabela de fusos (N11)
- **CA13 — `windows-zones.ts`.** Exporta `WINDOWS_ZONES: Readonly<Record<string, string>>` gerado do
  `windowsZones.xml` do CLDR (território `001`; a versão do CLDR usada vai no comentário do topo) e
  `windowsToIana(name: string): string | null` (sem diferenciar maiúsculas, ignora espaço nas pontas e aspas).
  *Testes:* pelo menos 130 entradas; **todo** valor é aceito por `new Intl.DateTimeFormat('en', { timeZone })`;
  `E. South America Standard Time` → `America/Sao_Paulo`, `SA Eastern Standard Time` → `America/Cayenne`,
  `Central Brazilian Standard Time` → `America/Cuiaba`, `Tocantins Standard Time` → `America/Araguaina`,
  `Bahia Standard Time` → `America/Bahia`, `SA Western Standard Time` → `America/La_Paz`,
  `Eastern Standard Time` → `America/New_York`, `Central Standard Time` → `America/Chicago`,
  `Pacific Standard Time` → `America/Los_Angeles`, `GMT Standard Time` → `Europe/London`,
  `W. Europe Standard Time` → `Europe/Berlin`, `Romance Standard Time` → `Europe/Paris`,
  `Tokyo Standard Time` → `Asia/Tokyo`, `UTC` → `Etc/UTC`; `'  "pacific standard time" '` → `America/Los_Angeles`;
  `Customized Time Zone` → `null`.

### Fixtures (CA14)
- **CA14 — `test/fixtures/invites/`, todas anonimizadas.** Pessoas fictícias, endereços só em `example.com`,
  `example.org` ou `example.net`, UIDs e ids de reunião inventados, nada copiado de email real do Andrew ou de cliente.
  Montadas no formato que cada provedor manda de verdade (ordem das propriedades, `X-` próprias, dobra de linha).
  *Teste de anonimização em `invite.test.ts`:* em todo arquivo da pasta, todo endereço de email (regex
  `[\w.+-]+@[\w-]+(\.[\w-]+)+`) termina em `@example.com`, `@example.org` ou `@example.net`, salvo o domínio técnico do
  UID (`@google.com` só depois de um UID inventado) — o teste lista a exceção explicitamente.
  Self de todas: `andrew.teste@example.org` (às vezes com outra caixa, como indicado).

  | Fixture | Conteúdo | Esperado (CA4) |
  |---|---|---|
  | `google-request.eml` | Email inteiro do Google Agenda: `multipart/mixed` com `multipart/alternative` (text/plain, text/html, `text/calendar; charset=UTF-8; method=REQUEST`) + anexo `application/ics; name="invite.ics"` com o **mesmo** VCALENDAR (base64). UID `7kq2m9v0c3exampleuid@google.com`, SEQUENCE 0, DTSTAMP `20261118T120000Z`, `DTSTART;TZID=America/New_York:20261120T100000`, DTEND 11:00, VTIMEZONE America/New_York completo (EST/EDT), SUMMARY `Revisão do projeto`, `X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij`, ORGANIZER `CN=Ana Organizadora:mailto:ana@example.com`, 3 ATTENDEE (Ana ACCEPTED; `andrew.teste@example.org` NEEDS-ACTION RSVP=TRUE com `CUTYPE`, `ROLE`, `X-NUM-GUESTS`; `bruno@example.net` TENTATIVE) | `method: 'REQUEST'`, `start: '2026-11-20T15:00:00.000Z'`, `end: '2026-11-20T16:00:00.000Z'`, `timeZone: 'America/New_York'`, `joinUrl: 'https://meet.google.com/abc-defg-hij'`, `attendeeCount: 3`, `self.partstat: 'NEEDS-ACTION'`, `recurrence: null`, `warnings: []`, `ignoredParts: 1` |
  | `outlook-windows-tz.ics` | Outlook/Exchange: `TZID:E. South America Standard Time` com VTIMEZONE no estilo do Windows (STANDARD −0300→−0300, DTSTART 16010101T000000), `DTSTART;TZID=E. South America Standard Time:20261124T140000`, DTEND 15:00, UID longo `040000008200E00074C5B7101A82E008…` inventado, `X-MICROSOFT-CDO-*`, `X-MICROSOFT-SKYPETEAMSMEETINGURL` e DESCRIPTION com `https://teams.microsoft.com/l/meetup-join/19%3ameeting_EXAMPLE%40thread.v2/0?context=%7b%7d`, SUMMARY `Planejamento — orçamento 2027`, ORGANIZER `CN="Carla Exemplo":mailto:carla@example.com`, ATTENDEE `ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Andrew Teste:mailto:Andrew.Teste@example.org` | `start: '2026-11-24T17:00:00.000Z'`, `timeZone: 'America/Sao_Paulo'`, `originalTzid: 'E. South America Standard Time'`, `joinUrl` = o link `meetup-join`, `self.address: 'andrew.teste@example.org'`, `organizer.name: 'Carla Exemplo'` |
  | `teams-new-link.ics` | Teams (Microsoft 365) com link no formato novo na DESCRIPTION (`https://teams.microsoft.com/meet/2468013579123?p=AbCdEfGh12345`) e `TZID=Pacific Standard Time` **sem** VTIMEZONE, `DTSTART…:20261201T090000`, DTEND 09:30 | `start: '2026-12-01T17:00:00.000Z'`, `end: '2026-12-01T17:30:00.000Z'`, `timeZone: 'America/Los_Angeles'`, `joinUrl: 'https://teams.microsoft.com/meet/2468013579123?p=AbCdEfGh12345'` |
  | `zoom-sem-vtimezone.ics` | Zoom, gravada com LF puro, `DTSTART;TZID=America/Sao_Paulo:20261126T090000`, DTEND 10:00, sem VTIMEZONE, `LOCATION:https://us02web.zoom.us/j/81234567890?pwd=ExAmPlE123`, ORGANIZER `mailto:zoom.organizador@example.com` | `start: '2026-11-26T12:00:00.000Z'`, `timeZone: 'America/Sao_Paulo'`, `joinUrl: 'https://us02web.zoom.us/j/81234567890?pwd=ExAmPlE123'` |
  | `icloud-allday.ics` | iCloud (`PRODID:-//Apple Inc.//iCloud…`), dia inteiro `DTSTART;VALUE=DATE:20261205`, `DTEND;VALUE=DATE:20261206`, `RRULE:FREQ=YEARLY`, `LOCATION:Rua Exemplo\, 100`, sem link, ORGANIZER `CN=Davi Exemplo;EMAIL=davi@example.com:mailto:davi@example.com`, ATTENDEE com `MAILTO:ANDREW.TESTE@EXAMPLE.ORG` | `allDay: true`, `start: '2026-12-05'`, `end: '2026-12-06'`, `timeZone: null`, `location: 'Rua Exemplo, 100'`, `joinUrl: null`, `recurrence.text: 'Todo ano, em 5 de dezembro'`, `recurrence.storable: true` |
  | `google-cancel.ics` | Mesmo UID do `google-request.eml`, `METHOD:CANCEL`, `STATUS:CANCELLED`, SEQUENCE 1, DTSTAMP `20261119T090000Z` | `method: 'CANCEL'`, `status: 'CANCELLED'`, `sequence: 1` |
  | `occurrence-request.ics` | REQUEST de **uma** ocorrência: UID `serie-semanal-0001@example.com`, `RECURRENCE-ID;TZID=America/Sao_Paulo:20261209T100000`, `DTSTART…:20261209T150000`, DTEND 16:00, SEQUENCE 1, VTIMEZONE America/Sao_Paulo | `recurrenceId: '2026-12-09T13:00:00.000Z'`, `start: '2026-12-09T18:00:00.000Z'`, `recurrence: null`, `exceptions: []` |
  | `weekly-exdate.ics` | Série do mesmo UID: `DTSTART;TZID=America/Sao_Paulo:20261202T100000`, DTEND 11:00, `RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270131T130000Z`, `EXDATE;TZID=America/Sao_Paulo:20261223T100000,20261230T100000` e outra linha `EXDATE;TZID=America/Sao_Paulo:20261228T100000`; mais um VEVENT de exceção `RECURRENCE-ID…:20261216T100000` com `DTSTART…:20261216T110000`, DTEND 12:00 | `recurrence.text: 'Toda semana, às segundas e quartas, até 31 de janeiro de 2027'`, `storable: true`, `block: null`, `exdates: ['2026-12-23T13:00:00.000Z', '2026-12-28T13:00:00.000Z', '2026-12-30T13:00:00.000Z']`, `exceptions: [{ recurrenceId: '2026-12-16T13:00:00.000Z', start: '2026-12-16T14:00:00.000Z', end: '2026-12-16T15:00:00.000Z', cancelled: false }]`, `rule.byDay: [{ day: 'MO', pos: null }, { day: 'WE', pos: null }]` |
  | `rdate.ics` | `RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=6` + `RDATE;TZID=America/Sao_Paulo:20270115T100000` | `recurrence.text: 'Todo mês, na última sexta, 6 vezes'`, `storable: false`, `block: 'rdate'` |
  | `reply-received.ics` | `METHOD:REPLY` do `bruno@example.net` para o UID do Google, `PARTSTAT=ACCEPTED` | `method: 'REPLY'`, `attendees: [{ address: 'bruno@example.net', name: …, partstat: 'ACCEPTED' }]`, `self: null` |
  | `malformed.ics` | `BEGIN:VCALENDAR` sem `END`, linha sem `:` | `error: 'malformed'` |
  | `no-vevent.ics` | VCALENDAR com só um VTODO | `error: 'no-event'` |
  | `no-method.ics` | REQUEST válido sem a linha `METHOD` | `error: 'no-method'` (com `method: null` na parte) |
  | `publish.ics` | `METHOD:PUBLISH` | `error: 'unsupported-method'` |

  As datas acima são o que a fixture tem de ter; o implementador escreve os arquivos para que dêem exatamente esses
  valores. Fixture que só serve a um teste de erro pode ser mínima.

## Invariantes
- **Nada fora da Superfície muda.** Em especial: `main/email/*`, `shared/email.ts`, `shared/ipc.ts`, o preload, o
  renderer, `main/index.ts` e o smoke ficam intactos (`git diff --stat` só com os arquivos da tabela).
- **Módulo puro.** `shared/invite.ts` e `shared/windows-zones.ts` importam só `ical.js`, `./calendar` e
  `./windows-zones` (e `zod`, se quiser): nada de `node:*`, `electron`, `fetch`, `process`, disco, relógio ou IA. Sem
  `Date.now()` nem `new Date()` sem argumento: o tempo vem de `options.now`. *Teste estático em `invite.test.ts`:* lê os
  dois arquivos e confere a lista de `import` e a ausência de `Date.now(`, `new Date()`, `fetch(`, `require(`.
- **Sem estado entre chamadas.** O `TimezoneService` do `ical.js` termina cada `parseInvite` como começou (CA5a).
- **Nunca lança.** `parseInvite` e `buildReply` devolvem erro tipado para qualquer entrada; nenhuma exceção sai deles
  (teste com as fixtures de erro e com `content` aleatório de 4 KiB, 50 rodadas com semente fixa).
- **O renderer não puxa o `ical.js`.** Nenhum arquivo de `src/renderer/` importa valor de `shared/invite` (só
  `import type`), e nada aqui é importado pelo renderer ainda. *Teste estático:* `grep` em `src/renderer/src` por
  `from '@shared/invite'` sem `import type` → zero.
- **Comportamento do app igual.** `findJoinUrl` só ganha um formato a mais; os eventos do Google e da Microsoft lidos
  pelo contrato 12 continuam com o mesmo `joinUrl` (os testes atuais de `calendar.test.ts`, `google-*` e `microsoft-*`
  passam sem mudança).
- Nenhum segredo, nenhum dado real nas fixtures.

## Fora de escopo
- Ler o convite no `parseEmail`, o `invite` no `bodySchema`, corpos antigos (N12), o envio do REPLY pelo `deliver` e a
  trava por convite: contrato 61.
- Helper `lap-calendar`, EventKit, permissão, plist: contrato 60. Registro `invites.json`, `find`/`create`/`update`/
  `remove`, reconciliação, estados do R7, R5b pelo host, fallback do `.ics`: contrato 62.
- Cartão, ícone na lista, Configurações, smoke e prints: contrato 63. Regras de email e "Sugerir evento" (IA): 64.
- Expandir recorrência, calcular ocorrências, `COUNTER`/`REFRESH` (F3), link de FaceTime/Webex/outros.
- Enviar qualquer email (este contrato só monta o texto do REPLY; nenhum teste manda nada a lugar nenhum).

## Telas de impacto no usuário
Nenhuma neste contrato: o módulo ainda não é chamado pelo app. As telas são do 63.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos.
- `pnpm install --frozen-lockfile` passa na raiz (lockfile coerente com o `package.json`).
- Testes novos que precisam existir e passar: `test/invite.test.ts` com os blocos **partes (CA2, CA3)**, **fixtures
  (CA4, um `it` por fixture)**, **fuso (CA5 a–c)**, **link (CA6)**, **texto da recorrência (CA7, um caso por linha da
  tabela)**, **gravável (CA8, um por código)**, **teto e erros (CA9)**, **versão (CA10)**, **REPLY (CA11)**,
  **empacotamento (CA12, estático)**, **fusos do Windows (CA13)**, **anonimização (CA14)**, **módulo puro e renderer
  (Invariantes)**; e o caso novo do Teams em `test/calendar.test.ts`.
- Empacotamento: saída do `pack.sh` com `ical.js ok`, ou as duas buscas do CA12 em `out/main/` (no relatório).

## Decisões tomadas neste contrato (para o Andrew confirmar, se quiser)
- **C1 — Teto de 512 KiB por `.ics`** (um convite do Teams com HTML grande fica em ~100 KiB; acima disso é anômalo) e
  200 VEVENTs. Acima, o email abre sem cartão.
- **C2 — O `EmailInvite` guarda o `source`** (o VCALENDAR escolhido) dentro do corpo: o REPLY copia as linhas exatas
  dele e o "Abrir no app de agenda" (D9) usa o mesmo texto. Custa até 512 KiB por corpo com convite.
- **C3 — Ordem do link:** propriedades dedicadas (`X-GOOGLE-CONFERENCE`, `X-MICROSOFT-*`) antes de `URL`, `LOCATION` e
  `DESCRIPTION`, porque a descrição às vezes traz outros links de reunião (de dial-in, de outra chamada).
- **C4 — `METHOD` do arquivo vence o `method=` do Content-Type**; só sem os dois o anexo é ignorado (`.ics` de
  "adicionar à agenda" sem METHOD não vira cartão, como a spec diz).
- **C5 — REPLY tira o `RSVP`** do ATTENDEE e não leva descrição, local, outros convidados nem `X-`: nada além do que o
  organizador precisa para casar a resposta.
- **C6 — Fuso que não dá para nomear:** com VTIMEZONE, os instantes vêm dele e `timeZone` fica `null`; sem VTIMEZONE,
  lê no fuso do Mac e marca `unknown-tzid`. Hora em UTC (`Z`) mostra "UTC" como fuso de origem.
- **C7 — Texto da recorrência no estilo do mockup** ("Toda semana, às sextas, até 18 de dezembro"); o que a tabela do
  CA7 não cobre vira "Repetição personalizada", mesmo quando dá para gravar.
- **C8 — Vários convites no mesmo email:** vale o primeiro UID na ordem do CA2; os outros UIDs são ignorados com aviso.
- **C9 — Teams novo em `shared/calendar.ts`:** a regex ganha `teams.microsoft.com/meet/<número>?p=<senha>`, o que também
  passa a achar esse link nas agendas do Google e da Microsoft do contrato 12 (melhora, sem mudar os casos antigos).
