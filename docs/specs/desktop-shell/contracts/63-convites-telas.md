# Contrato 63 — Telas dos convites: cartão na leitura, ícone na lista, "Convites" em Configurações e o smoke
Feature: convites-agenda · Wave: 4 · Depende de: 62, 55 · Spec: `docs/specs/convites-agenda/spec.md` (Telas de impacto, R2, R3 na tela, R4, R5a/b/c na tela, R6, R7, R8, R9, N5, N6, N8, N9) · Plan: `docs/specs/convites-agenda/plan.md` (linha 63)

> 19/11/2026. O mockup e as decisões D1–D20 estão aprovados (abaixo; D5 confirmado: dá para mudar a resposta depois,
> e cada troca manda um REPLY novo). Os nomes, tipos e canais que vêm do 61 e do 62 foram conferidos com o texto deles
> e estão escritos aqui como lá. As decisões que eram **[decidir]** foram tomadas pelo coordenador (ver o fim). Falta o
> ok do Andrew **no texto deste contrato**.

Este contrato é **só o renderer**, mais os passos do smoke e o guia do app. Não cria canal IPC: tudo o que a tela faz
passa pelos canais do 61 e do 62 e pelo `scribe:open-privacy-settings` que já existe. Se faltar algo no main para
cumprir um CA, o implementador **para e relata** (não inventa canal, não lê `invites.json`, não chama o helper
`lap-calendar`, não liga peça falsa no smoke: isso é do 62).

## Desenho aprovado (19/11/2026)
Mockup `docs/specs/desktop-shell/mockups/ConvitesAgenda.dc.html` (quadros 01–16, mais 11b e 11c, cada um em claro e
escuro, tokens do `design.md` v2, mesmo esqueleto do mockup EmailOrganizacao), aprovado pelo Andrew em 19/11/2026 junto
com a spec. As decisões valem como critério; o CA que cumpre cada uma está entre parênteses.
- D1 Cartão entre o cabeçalho (remetente, Para, data) e o corpo, acima dos avisos do corpo (imagens bloqueadas, link
  externo). Forma do `CARD` do `ActionCards`: borda `--line-strong`, raio 6 (`--radius-panel`), `--bg-raised`, sem
  sombra. (CA2)
- D2 Etiqueta à direita do topo do cartão: Novo e Atualização pendente com contorno (`--title`); Na agenda em azul cheio
  (`--accent` / `--on-accent`); Já estava na agenda, Respondido, Resposta recebida e Antigo em cinza (`--bg-sunken` /
  `--text-muted`); Cancelado com contorno `--rec`; Sugestão tracejada (usada pelo 64). Raio 4, sem pílula, sem verde
  nem amarelo. (CA3)
- D3 Hora no fuso do Mac em destaque, "sex, 20 de novembro · 15:00–16:00 · 1 h"; fuso de origem embaixo, 12 px,
  `--text-faint`, só quando é outro: "13:00–14:00 no horário de Nova York (America/New_York)". (CA4)
- D4 "Pôr na agenda" numa linha própria, caixa de seleção e o seletor de agenda ao lado, acima dos botões; desligada,
  o seletor fica apagado; o padrão vem de Configurações. (CA6)
- D5 Aceitar primário; Talvez e Recusar secundários; todos com ícone. Respondido, os três viram o segmentado "Sua
  resposta" com o escolhido marcado; clicar em outro manda um REPLY novo. (CA7, CA8)
- D6 Link da reunião com o nome do serviço embaixo (pelo domínio); o clique passa pela confirmação "Abrir … no
  navegador?" dos links do corpo. (CA5)
- D7 Atualização: a linha que mudou ganha fundo `--hl`, valor antigo riscado → novo em negrito; local e link também; a
  resposta anterior continua valendo. (CA11)
- D8 Cancelado: "Tirar da agenda" secundário com contorno `--rec`, sem confirmação a mais, só quando o app gravou (N3);
  título riscado e detalhes apagados; sem gravação do app, só o aviso. (CA12)
- D9 Sem acesso: "Você aceitou … Resposta enviada" acima da nota; a nota tem "Abrir Ajustes" e "Abrir no app de
  agenda". (CA13)
- D10 "Não é para …": a frase da spec, a linha "Os convidados são outros endereços (<primeiro> e mais N). Para
  responder, abra o convite na conta convidada. Pôr na agenda continua possível.", sem botões de resposta, e "Pôr na
  agenda" vira o primário com o seletor ao lado. (CA14)
- D11 Resposta recebida: cartão compacto (quem e como, título e data), sem botões. (CA15)
- D12 "Sugerir evento" (ícone de brilho) na barra da leitura e o cartão "Sugestão — confira" (quadro 09): **contrato
  64**, que usa as peças do cartão deste contrato (CA27). Aqui fica só o interruptor em Configurações (CA21, linha 4).
- D13 Ícone na lista: calendário de 14 px em `--text-faint`, à direita do assunto e antes do ponto de não lida; no
  cancelamento, o calendário com X; só com o corpo já baixado. (CA19)
- D14 Bloco "Convites" no fim da aba Email do 55; a agenda padrão lista só as graváveis, agrupadas por conta, sem as
  cores das agendas; sem acesso, o seletor apagado e "Pedir acesso". (CA21, CA22)
- D15 O anexo `invite.ics` continua na lista de anexos, com "Baixar", abaixo do corpo. (CA2)
- D16 Conta que já põe sozinha (R5b): caixa desmarcada, seletor apagado, a frase "Sua conta já põe os convites na
  agenda dela." numa linha de apoio logo abaixo, com ícone de informação. (CA6)
- D17 Reconciliação (R5c): nota de uma linha dentro do cartão, abaixo de "Na agenda …", só na primeira vez que o
  cartão abre depois de juntar; a agenda passa a ser a da conta. (CA10)
- D18 Não encontrei (R6): etiqueta Respondido, linha com ícone de alerta em `--rec`, "Pôr de novo" secundário com o
  seletor de agenda ao lado. (CA16)
- D19 Repetição que não dá para copiar (N8): a linha de repetição descreve o que dá; "Pôr na agenda" sai do cartão; a
  nota leva "Abrir no app de agenda"; os botões de resposta ficam. (CA17)
- D20 Enviando (R3): sem spinner; o botão clicado mostra "Enviando resposta…" com um quadrado de 8 px que pulsa em
  opacidade; os outros botões e a linha de agenda a 50 % e sem clique; uma linha apagada diz o que sai e por qual
  conta; ao terminar, o cartão vai para o estado do quadro 02. (CA9)

## Pré-condições
- **O 63 só é implementado depois do 55 na main** (a aba Email de Configurações, o `ReadingPane` com o menu "Mais", a
  árvore de pastas e o `folderKey` por path) **e do 62 commitado** na branch `convites-agenda`.
- **Antes da primeira linha de código, o implementador faz merge da main** no worktree
  `/Users/andrew/Documents/GitHub/meeting-scribe-convites` (branch `convites-agenda`): `git status` limpo →
  `git merge main` (já com o 55) → conflito em código do email = parar e avisar → gates verdes antes de começar.
  `git log --oneline -8` mostra o 61 e o 62.
- Ler antes: o mockup inteiro no navegador (as legendas de cada quadro fazem parte do pedido); a spec e o plan; os
  contratos 55, 59, 60, 61 e 62; no renderer `features/email/{ReadingPane,EmailScreen,EmailNav,emailStore,format}.ts(x)`
  (como ficaram depois do 55), `features/chat/ActionCards.tsx` (o `CARD` e o envio do `email-resposta` com o token de
  clique), `features/meetings/menu.ts` (`useInlineMenu`), `features/settings/{SettingsScreen,settingsTabs}.ts(x)` e as
  seções da aba Email do 55, os componentes de `design/` (`Button`, `Switch`, `Segmented`, `SettingRow`, `Section`,
  `Note`, `Icon`), `shared/{invite,invite-state,email,ipc,privacy,settings-index,routes}.ts`, o preload (`emailSend`,
  `inviteReply` e o par `scribe:email-click`), `main/email/fake-email.ts` (`sent[].icalEvent`, `smtpHold`, `deliver`
  com `calendar`), `main/smoke-fixtures.ts` (`macCalendar`), `test/fixtures/invites/*`,
  `test/fixtures/fake-lap-calendar.mjs` (cabeçalho: formato do estado) e, no `main/smoke.ts`, o `emailChecks`, o
  `emailNotifyCheck` (bloqueio) e o passo de Configurações que confere "linhas fora do índice".

## Superfície
| Arquivo (relativo a `apps/desktop/`) | O que muda |
|---|---|
| `src/renderer/src/features/email/InviteCard.tsx` | **novo**: o cartão e todos os estados (CA2–CA18) e as peças exportadas para o 64 (CA27) |
| `src/renderer/src/features/email/CalendarPicker.tsx` | **novo**: o seletor de agenda em menu na linha (CA22) |
| `src/renderer/src/features/email/inviteView.ts` | **novo, puro**: `inviteView(input)` decide etiqueta, linhas, botões e notas a partir do `EmailInvite` + `InviteState`; `afterReply` (CA7) |
| `src/renderer/src/features/email/inviteFormat.ts` | **novo, puro**: `inviteWhen`, `joinService`, `zoneCity`, `attendeesLabel`, `responseLine`, `notForLine`, `calendarLabel`, `INVITE_REPLY_ERRORS` |
| `src/renderer/src/features/email/inviteStore.ts` | **novo**: zustand com o `InviteState` por mensagem, as agendas, a escolha de cada cartão, a trava de envio e o último efeito por convite |
| `src/renderer/src/features/email/ReadingPane.tsx` | o cartão entre o cabeçalho e o corpo (nada na barra da leitura: o "Sugerir evento" é do 64) |
| `src/renderer/src/features/email/EmailScreen.tsx` | o ícone na linha da lista (CA19) |
| `src/renderer/src/features/settings/InvitesSection.tsx` | **novo**: o bloco "Convites" (CA21–CA23), montado no fim da aba Email do 55 |
| `src/renderer/src/features/settings/<aba Email do 55>` | só a montagem do `InvitesSection` depois de Avisos |
| `src/shared/settings-index.ts` | as linhas do bloco "Convites" na aba `email` (CA23) |
| `src/main/smoke.ts` | `inviteChecks` com os passos 1–11 da verificação e os prints (CA25) |
| `test/renderer/email-invite-format.test.ts`, `test/renderer/email-invite-view.test.ts` | **novos** (CA24) |
| `resources/assistente/guia-do-app.md` | CA26 |

Nenhum arquivo do main fora o `smoke.ts`. `shared/invite.ts` (59), `shared/invite-state.ts` e `main/invites/*` (62),
`main/email/service.ts` e `main/email/fake-email.ts` (61/62), `main/smoke-fixtures.ts` e `main/index.ts` (62),
`native/calendar/*` e `main/mac-calendar/*` (60) e o `README.md` (fechamento da feature) ficam sem diff.

## O que o 63 consome do 61 e do 62
Nada aqui é definido pelo 63; são os nomes e formatos dos contratos 61 e 62, escritos igual.
- **Corpo com o convite (61, CA1).** `EmailBody.invite?: EmailInvite | null` (tipo do 59) no corpo que o
  `scribe:email-get-body` devolve; objeto = há convite; ausente ou `null` = sem cartão. O cartão e o ícone leem daí; o
  renderer não lê `.ics` nem chama `parseInvite` (só `import type` de `@shared/invite`).
- **Responder (61, CA8 e CA14).** `window.__scribeApi.inviteReply({ accountId, id, partstat })`, com `partstat`
  `'ACCEPTED' | 'TENTATIVE' | 'DECLINED'` → `InviteReplySendResult` = `{ ok: true; messageId; reply: InviteRepliedEvent }
  | { ok: false; error: InviteReplySendError }`; o preload gera o token (`crypto.randomUUID()` + `scribe:email-click`,
  molde do `emailSend`) e chama `scribe:invite-reply`. `InviteReplySendError` = `click`, `invalid`, `account`,
  `not-found`, `no-invite`, `not-request`, `busy`, `no-organizer`, `not-invited`, `malformed`, `auth`, `connection`,
  `rejected`, `failed`. O renderer **nunca** chama `invoke('scribe:invite-reply')` direto. Sem ativação viva do usuário,
  o preload devolve `click` sem IPC.
- **Estado (62, CA1 e CA8–CA10).** `invoke('scribe:invite-state', { accountId, id })` → `InviteStateResult` =
  `{ ok: true; state: InviteState } | { ok: false; error: 'missing' | 'invalid' | 'unavailable' }`. Chamar este canal é
  o que dispara, no main, a procura do R5a e a reconciliação do R5c. Do `InviteState` a tela usa:
  - `kind`: `new`, `responded`, `in-calendar`, `already-in-calendar`, `update-pending`, `cancelled`, `old`,
    `reply-received`, `error`;
  - `response`: `{ partstat, at } | null` (o que o Andrew respondeu, do `invites.json`);
  - `calendar` (`InviteCalendarStatus`): `unavailable` (`reason`), `needs-access`, `no-access` (`access`), `absent`,
    `app` (`calendarId`, `calendarTitle`, `sourceTitle`: o app gravou e achou), `account` (`calendarTitle`,
    `sourceTitle`, `merged`: a cópia da conta), `missing` (`calendarId`, `calendarTitle | null`, `sourceTitle | null`:
    o app gravou e não acha mais), `skipped`, `error` (`code`);
  - `changes: InviteChange[]` (só em `update-pending`): `{ field: 'time'; before: InviteWhen; after: InviteWhen }` ou
    `{ field: 'title' | 'location' | 'url'; before; after }`;
  - `addDefault` (estado inicial da caixa), `addHint: 'account-adds' | null` (R5b), `defaultCalendarId`,
    `replyable`, `notForMe` (N5), `recurrenceBlocked` (N8), `replier` (REPLY), `notice: 'merged' | null` (R5c, só na
    primeira leitura depois de juntar), `error: { code, message } | null`;
  - `actions: { add, update, remove, openIcs, requestAccess, openSettings }`: **a tela mostra um botão de agenda só
    quando a ação correspondente é verdadeira**; não recalcula as regras do 62.
- **Gravar, atualizar, tirar (62, CA11, CA12).** `scribe:invite-add { accountId, id, calendarId, availability: 'busy' |
  'tentative' }`, `scribe:invite-update { accountId, id }`, `scribe:invite-remove { accountId, id }`, cada um →
  `InviteActionResult` = `{ ok: true; effect: 'created' | 'already' | 'updated' | 'removed' | 'none'; state } |
  { ok: false; error: InviteErrorCode; message; state: InviteState | null }`. O `message` é a frase fixa do
  `INVITE_ERROR_MESSAGES` do 62; a tela mostra essa frase, sem tabela própria. "Pôr de novo" é o `-add` com a agenda do
  seletor.
- **Agendas (62, CA13).** `scribe:invite-calendars` → `InviteCalendarsResult` = `{ ok: true; access:
  InviteCalendarAccess; calendars: InviteCalendarOption[]; defaultId: string | null } | { ok: false; error:
  'unavailable'; reason }`, com `InviteCalendarOption = { id, title, sourceTitle, sourceType, isDefault }` (já só as
  graváveis, na ordem do helper).
- **Permissão, Ajustes e `.ics` (62, CA13, CA15, CA18).** `scribe:invite-request-access` → `InviteAccessResult`;
  `scribe:invite-open-ics { accountId, id }` → `InviteOpenIcsResult`; "Abrir Ajustes" =
  `window.__scribeApi.send('scribe:open-privacy-settings', 'calendars')` (o evento que já existe; o 62 acrescenta
  `'calendars'` ao `PrivacyPane`).
- **Settings (62, CA19).** `inviteCalendarId: string | null`, `inviteAddOnAccept: boolean` (padrão `true`), `inviteSuggest:
  boolean` (padrão `false`), lidas e gravadas pelo `useSettings` de hoje.
- **Bloqueio (61/62, N6).** Os oito invokes acima (`invite-reply` e os sete do 62) são `refused` com o app bloqueado
  (`WHEN_LOCKED`), conferidos no `test/lock-ipc.test.ts` deles; o `scribe:open-privacy-settings` é `ignored`.
- **Smoke (61, CA13; 62, CA24).** `smokeFixtures.email.sent[].icalEvent`, `smokeFixtures.email.smtpHold` (segurar o
  envio), `smokeFixtures.email.deliver({ …, calendar: { method, content } })` (entregar o convite na INBOX falsa) e
  `smokeFixtures.macCalendar` (`statePath` para escrever o estado do helper falso, `log()` para ler o que ele recebeu).
  O helper falso já sobe ligado ao app no smoke (62, CA20/CA24).

## Critérios de aceite

### Cartão na leitura (quadros 01–08, 12–16)
- **CA1 — Quando aparece (R2, N6).** Dado um corpo carregado com `invite` objeto (estado do `useEmail.bodies` diferente
  de `loading`/`error`), quando a mensagem abre, então o `ReadingPane` mostra **um** `[data-invite-card]` com
  `data-invite-state="<kind>"` e chama `scribe:invite-state` uma vez por abertura (e de novo depois de cada ação do
  cartão e a cada `scribe:email-changed` da conta). Sem `invite` no corpo (ausente ou `null`), nenhum
  `[data-invite-card]` e nenhuma chamada. Com `useLock.status.locked === true`, o `InviteCard` devolve `null` (nenhum
  `[data-invite-card]` no DOM, nem atrás da camada de bloqueio) e não chama nenhum canal; ao desbloquear, relê o
  estado. Corpo ainda `loading`: nada do cartão (o esqueleto do corpo de hoje fica igual). `invite-state` que falha
  (rejeição ou `{ ok: false }`): o cartão aparece com o que o `invite` do corpo diz, com `data-invite-state="error"`,
  etiqueta Erro, a frase "Não foi possível conferir a agenda agora." e sem botões de agenda (os de resposta ficam,
  conforme o `invite`: `REQUEST` com `organizer` e `self`).
  Âncora: `ReadingPane.tsx`; asserção no smoke: `document.querySelectorAll('[data-invite-card]').length === 1`.
- **CA2 — Lugar e forma (D1, D15).** O `[data-invite-card]` é irmão seguinte do bloco remetente/Para/data e vem
  **antes** do `ask` de link externo e do `MessageBody` (logo, antes do aviso de imagens bloqueadas). Classes do
  `CARD`: `rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised`, `p-4`, `gap-3`, largura da coluna de
  leitura (`max-w-[760px]` do contêiner, sem o `72ch` do chat). Topo (`[data-invite-head]`): ícone `Calendar` 14 px,
  o rótulo do tipo em 12 px `--text-muted` ("Convite de reunião"; "Convite atualizado" em `update-pending`; "Convite
  cancelado" em `cancelled`; "Resposta ao convite" em `reply-received`) e a etiqueta (CA3) à direita. Título
  (`[data-invite-title]`, `<h3>`, 15 px negrito `--title`, `select-text`). O anexo `invite.ics` continua em
  `[data-email-attachments]` com "Baixar", igual a hoje.
  Âncora: `InviteCard.tsx`; asserção no smoke: `card.compareDocumentPosition(document.querySelector('[data-email-body]')) & Node.DOCUMENT_POSITION_FOLLOWING` e `[data-email-attachment]` com o nome `invite.ics`.
- **CA3 — Etiqueta (D2, R7).** `[data-invite-badge]` com `data-invite-badge-tone` e o texto exato:
  | quando | texto | tom (`tone`) | classes |
  |---|---|---|---|
  | `kind: 'new'` | Novo | `outline` | `border border-title text-title` |
  | `kind: 'update-pending'` | Atualização pendente | `outline` | idem |
  | `kind: 'in-calendar'` | Na agenda | `solid` | `bg-accent text-on-accent` |
  | `kind: 'already-in-calendar'` | Já estava na agenda | `muted` | `bg-bg-sunken text-text-muted` |
  | `kind: 'responded'` (inclui sem acesso e `calendar.status: 'missing'`) | Respondido | `muted` | idem |
  | `kind: 'reply-received'` | Resposta recebida | `muted` | idem |
  | `kind: 'old'` | Antigo | `muted` | idem |
  | `kind: 'cancelled'` | Cancelado | `danger` | `border border-rec text-rec` |
  | `kind: 'error'` (e o CA1 sem estado) | Erro | `danger` | idem |
  | (só no 64) sugestão | Sugestão — confira | `dashed` | `border border-dashed border-line-strong text-text-faint` |
  Altura 20 px, `px-1.5`, 11 px peso 500, `rounded-[var(--radius-control)]` (4 px). A escolha sai do `inviteView`
  (CA24), não do componente; o tom `dashed` existe no `InviteBadge` para o 64 (CA27) e o 63 não o usa.
- **CA4 — Quando (D3, R2).** `[data-invite-time]` (ícone `Clock`) com `inviteWhen(invite, macTimeZone())`, em que
  `macTimeZone()` = `Intl.DateTimeFormat().resolvedOptions().timeZone`:
  - Mesmo dia: "<dia da semana abreviado>, <d> de <mês por extenso> · HH:MM–HH:MM · <duração>", com a duração em
    `--text-muted` ("30 min", "1 h", "1 h 30 min", "2 h"). Ex.: "sex, 20 de novembro · 15:00–16:00 · 1 h".
  - Dias diferentes: "sex, 20 de novembro, 22:00 – sáb, 21 de novembro, 01:00 · 3 h".
  - Dia inteiro (`allDay`): "sex, 20 de novembro · dia inteiro"; vários dias: "sex, 20 – dom, 22 de novembro · dia
    inteiro" (o `end` do 59 é exclusivo). Sem linha de fuso de origem.
  - Ano diferente do atual: o ano entra depois do mês ("qui, 7 de janeiro de 2027 · …").
  - `[data-invite-origin-time]` (12 px, `--text-faint`) só quando o deslocamento do fuso do convite no início é
    diferente do do Mac: "<HH:MM–HH:MM> no horário de <cidade> (<IANA>)", com `zoneCity` = tabela pt-BR curta (Nova
    York, São Paulo, Lisboa, Londres, Madri, Paris, Berlim, Chicago, Denver, Los Angeles, Cidade do México, Buenos
    Aires, Santiago, Bogotá, Tóquio, Xangai, Singapura, Sydney, UTC→"UTC") e, fora dela, o último segmento do IANA com
    `_` → espaço. `timeZone: null` (flutuante ou não nomeado): sem a linha.
  - O dia da semana e as horas no fuso do Mac (`Intl.DateTimeFormat('pt-BR', { timeZone })`), 24 h, sem ponto no dia
    abreviado ("sex", não "sex.").
- **CA5 — Detalhes (R2, D6).** `[data-invite-details]`, uma linha por item, ícone 16 px `--text-muted` à esquerda:
  - `[data-invite-recurrence]` (`Repeat`) com `invite.recurrence.text` do 59, quando há recorrência.
  - `[data-invite-location]` (`MapPin`) com `location`, quando há.
  - `[data-invite-join]` (`Video`) com o link sem `https://` e sem barra final, ícone `ExternalLink` 12 px, e embaixo
    `[data-invite-join-service]` com `joinService(url)`: `meet.google.com` → "Google Meet"; `teams.microsoft.com`,
    `teams.live.com` → "Microsoft Teams"; `zoom.us` e `*.zoom.us` → "Zoom"; `*.webex.com` → "Webex"; outros → o
    domínio. O clique **não abre**: chama o mesmo `openLink` do corpo, que mostra o `Note#email-external-link`
    "Abrir <url> no navegador?" com Abrir/Cancelar (D6; ver Invariantes). `joinUrl` que não é `https:` cai no
    "O app só abre links seguros (https)…" de hoje.
  - `[data-invite-organizer]` (`User`): nome em negrito, endereço em `--text-muted`, "Organizador" embaixo em 12 px.
    Sem nome: só o endereço. Sem organizador: sem a linha.
  - `[data-invite-attendees]` (`Users`): `attendeesLabel(attendeeCount)` — "1 convidado", "8 convidados"; com 0, sem a
    linha.
  - Textos com `select-text`; nada de HTML do convite (texto puro, como o 59 entrega).
- **CA6 — "Pôr na agenda" (R4, R5b, D4, D16).** `[data-invite-add-row]` numa linha própria acima dos botões, quando
  `state.actions.add` é verdadeiro, `state.calendar.status` é `absent` ou `needs-access` (o `missing` tem o "Pôr de
  novo" do CA16) e `state.notForMe` é falso (o CA14 tem o próprio botão). Contém:
  - Caixa `[data-invite-add]` (`<input type="checkbox">` com rótulo "Pôr na agenda", 16 px, raio 4, `accent-color`
    pelo token). Valor inicial: `state.addDefault` (o 62 já calcula `inviteAddOnAccept` e o R5b). Lembrado por
    mensagem no `inviteStore` enquanto o app está aberto; não grava em settings.
  - Seletor `[data-invite-calendar]` (o `CalendarPicker` do CA22) com as agendas de `scribe:invite-calendars`.
    Valor inicial: `state.defaultCalendarId` (o 62 já faz `inviteCalendarId` → `isDefault` → primeira). A escolha vale
    só para este convite: **não** grava `inviteCalendarId` (a agenda padrão só muda em Configurações). Com a caixa
    desmarcada: `disabled` e `opacity-50`.
  - Com `state.addHint === 'account-adds'`: a caixa começa desmarcada (é o `addDefault`) e, logo abaixo,
    `[data-invite-account-adds]` com `Info` 14 px e "Sua conta já põe os convites na agenda dela." (12 px,
    `--text-muted`). Marcar a caixa não esconde a frase.
  - `calendar.status: 'needs-access'`: a linha aparece normal, e o seletor mostra "Escolher agenda" até haver lista; o
    pedido do macOS sai no primeiro `invite-add` (R8, o 62 pede).
- **CA7 — Responder (R3, D5, N1).** Com `state.replyable` e `response === null`, `[data-invite-actions]` com, nesta
  ordem: `Button` primário `data-action="invite-accept"` (`Check`) "Aceitar"; secundários `invite-tentative`
  (`CircleHelp`) "Talvez" e `invite-decline` (`X`) "Recusar". O clique (a ordem é esta e o serviço não age sozinho):
  1. passa pelo `inviteStore.reply(accountId, id, partstat)`, que liga a trava da mensagem (CA9) **antes** de chamar
     `window.__scribeApi.inviteReply` (61);
  2. só com `ok`, calcula `afterReply(state, partstat, addChecked)` (puro, em `inviteView.ts`, com o `state` lido antes
     do clique):
     - `'add'` quando `partstat` é `ACCEPTED` ou `TENTATIVE`, a caixa está marcada, `state.actions.add` e
       `state.calendar.status` em `absent`/`needs-access` → `invoke('scribe:invite-add', { accountId, id, calendarId:
       <a do seletor>, availability: partstat === 'TENTATIVE' ? 'tentative' : 'busy' })`;
     - `'remove'` quando `partstat === 'DECLINED'` e `state.actions.remove` (o app gravou: R4, recusar tira o que o app
       pôs) → `invoke('scribe:invite-remove', { accountId, id })`;
     - senão `null` (nada na agenda; em `already-in-calendar` nunca há `-add`, R5a);
  3. relê `scribe:invite-state` e desenha.
  Falha do REPLY: `[data-invite-error]` (`role="alert"`, 12 px `--rec`) com a frase por código do 61, na tabela
  `INVITE_REPLY_ERRORS` de `inviteFormat.ts`: `click` "Clique de novo para responder."; `busy` "A resposta anterior
  ainda está saindo."; `not-invited` "Este convite não é para este endereço."; `no-organizer` "O convite não diz quem
  organizou: não há para quem responder."; `auth` "O servidor de envio recusou o usuário ou a senha."; `connection`
  "Sem conexão com o servidor de envio. Nada foi enviado."; `rejected` "O servidor de envio recusou a resposta.";
  `account`, `not-found`, `no-invite`, `not-request`, `invalid`, `malformed`, `failed` "Não foi possível enviar a
  resposta. Tente de novo." Os botões voltam e nenhum canal de agenda é chamado. REPLY ok e `-add`/`-remove` com
  `{ ok: false }`: a resposta vale (a linha do CA8 aparece) e `[data-invite-error]` diz "A resposta foi enviada, mas a
  agenda não mudou. <message>" com o `message` do `InviteActionResult` (frase do 62).
- **CA8 — Depois de responder: "Sua resposta" (D5, quadros 02, 06, 13, 14).** Com `state.replyable` e `response` não
  nulo, no lugar dos três botões, `[data-invite-response]`: rótulo "Sua resposta" (12 px `--text-faint`) e um
  segmentado de 28 px com "Aceito" (`Check`), "Talvez" (`CircleHelp`) e "Recusado" (`X`), o escolhido com
  `aria-checked="true"`, `bg-title text-bg` peso 500 (`role="radiogroup"`, setas mudam o foco, Enter/Espaço escolhe).
  Escolher outro chama o mesmo fluxo do CA7 com o novo partstat (um REPLY novo a cada troca, D5), com a trava do CA9;
  escolher o que já está marcado não faz nada. Acima, a linha de estado `[data-invite-status-line]` (ícone `Calendar`
  16 px):
  - `calendar.status: 'app'` (`kind: 'in-calendar'`): "**Na agenda <calendarTitle>** (<sourceTitle>)" e embaixo, 12 px
    `--text-faint`, `responseLine` — "Você aceitou hoje às 11:20. Resposta enviada a Daniel Brooks." ("aceitou" /
    "marcou talvez" / "recusou"; "hoje às HH:MM", "ontem às HH:MM", "em 18/11 às HH:MM", a partir de `response.at`; o
    organizador pelo nome, sem nome pelo endereço).
  - `calendar.status: 'account'` sem `merged` (`kind: 'already-in-calendar'`, quadro 03): "**Já está na agenda
    <calendarTitle>** (<sourceTitle>)" e embaixo "A sua conta já pôs na agenda. Responder não cria outro evento." (a
    mesma frase para qualquer provedor). Os três botões de resposta (CA7) ficam enquanto não houver `response`, e o
    `afterReply` nunca devolve `'add'` aqui (R5a).
  - `kind: 'responded'` sem agenda (caixa desmarcada, recusado, ou conta do R5b): só a `responseLine`, sem "Na agenda".
  - Trocar de Aceito/Talvez para Recusado com `actions.remove` (o app gravou): o `afterReply` dá `'remove'` e a linha
    passa a "Você recusou …". De Recusado para Aceito/Talvez: o estado volta com `actions.add` e a linha "Pôr na agenda"
    (CA6) aparece de novo com a caixa em `addDefault`; o add segue o CA7 passo 2.
- **CA9 — Enviando (R3, D20, quadro 16).** Entre o clique e a resposta do 61, o `inviteStore` mantém `sending[key] =
  partstat` (chave `accountId\nid`, a mesma do `bodyKey`); com ela ligada:
  - o botão clicado (ou o segmento) troca o rótulo por "Enviando resposta…" com `[data-invite-sending-mark]`, um
    quadrado de 8 px `bg-on-accent` (no primário) que pulsa só em `opacity` (animação de `--duration-slow`, nenhuma
    com `prefers-reduced-motion`), sem spinner nem ícone girando;
  - os outros botões, o segmentado e a `[data-invite-add-row]` ficam `disabled`, `opacity-50`, `pointer-events-none`;
    o contêiner tem `aria-busy="true"`;
  - `[data-invite-sending]` (12 px `--text-faint`): "Enviando “<Aceito|Talvez|Recusado>” a <organizador> pela conta
    <accountLabel>…";
  - um segundo clique (no mesmo ou em outro botão, ou a mesma mensagem aberta de novo) não chama o preload: o
    `reply` sai cedo quando `sending[key]` existe. A trava do main (61, CA9: `busy`) é a palavra final; esta é a da tela.
  - a trava vale até o fim do passo 2 do CA7 (o `-add`/`-remove`); ao terminar (ok ou erro), `sending[key]` sai e o
    cartão relê o estado (com ok, vai ao quadro 02).
- **CA10 — Reconciliado (R5c, D17, quadro 13).** Com `state.notice === 'merged'` (o estado vem `in-calendar` com
  `calendar: { status: 'account', merged: true }`), a linha de estado é "**Na agenda <calendarTitle>**
  (<sourceTitle>)" e, abaixo, `[data-invite-reconciled]` (12 px `--text-muted`): "Juntei com o evento que a sua conta
  pôs na agenda." A agenda mostrada é a da conta (ex. "Trabalho (Google)"). Na leitura seguinte (`notice: null`), a
  nota some e a linha de "Na agenda" fica.
- **CA11 — Atualização pendente (R6, D7, quadro 04).** `kind: 'update-pending'` (o app gravou e chegou versão nova):
  - cada item de `state.changes` marca a linha dele (`time` → `[data-invite-time]`, `title` → `[data-invite-title]`,
    `location` → `[data-invite-location]`, `url` → `[data-invite-join]`) com `data-invite-changed` e fundo `bg-hl`
    (`rounded-[var(--radius-control)]`, `px-1`); o valor antigo (`before`) em `[data-invite-old]` com `line-through`
    `--text-muted`, a seta " → " e o novo (`after`) em `[data-invite-new]` negrito. Na hora: só o trecho que mudou
    ("sex, 20 de novembro · ~~15:00~~ → **16:30**–17:30 · 1 h"; se mudou o dia, o dia inteiro entra no riscado), com o
    `inviteWhen` do `before` e do `after`; o fuso de origem mostra só o novo. Local: "~~Northwind, sala Hudson~~ →
    **Northwind, sala Chelsea**". Link sem mudança: o serviço vira "Google Meet · sem mudança"; link que mudou: riscado
    → novo, só o novo é clicável.
  - `[data-invite-status-line]` com `RefreshCw`: "**O organizador mudou o convite**" e embaixo "Na agenda
    <calendarTitle> o evento ainda está no horário antigo. Sua resposta continua: <Aceito|Talvez>." (sem resposta: sem a
    segunda frase).
  - `Button` primário `data-action="invite-update"` (`RefreshCw`) "Atualizar na agenda", só com `actions.update` →
    `scribe:invite-update`; durante a chamada, "Atualizando…" e desligado. Nada é atualizado sem esse clique (D8 do plan).
  - Versão nova de evento que **o app não gravou**: o 62 não manda `changes` nem `update-pending` (fica `new`,
    `responded` ou `already-in-calendar`); o cartão mostra o convite desta mensagem como ele é, sem marcar mudanças e
    sem botão (quem atualiza é a conta).
- **CA12 — Cancelado (R6, D8, quadro 05).** `kind: 'cancelled'`: título `[data-invite-title]` com `line-through`;
  `[data-invite-details]` com `opacity-60` e sem a linha do link nem a de convidados; nenhum botão de resposta nem
  "Pôr na agenda". `[data-invite-status-line]` com o ícone em `--rec`: "**Cancelado pelo organizador**" e embaixo:
  - com `actions.remove` (o app gravou; `calendar.status: 'app'`): "O evento ainda está na agenda <calendarTitle> (o
    app pôs lá). Só sai no seu clique." e o botão `data-action="invite-remove"` (`Trash2`) "Tirar da agenda",
    secundário com `border-rec text-rec`, sem confirmação a mais → `scribe:invite-remove`. Com `effect: 'removed'`, o
    `inviteStore` guarda (em memória, por mensagem) o último efeito e o nome da agenda de antes, e o cartão mostra
    "Tirado da agenda <agenda>." no lugar da frase e sem botão. O estado relido do CANCEL vem sem evento do app
    (`calendar.status: 'skipped'`, as linhas do UID saíram: E3 do 62); sem o efeito guardado (o app reiniciou), vale
    a frase do item seguinte;
  - sem `actions.remove`: "Se ele estiver na sua agenda, a sua conta tira." e nenhum botão.
  Com `recurrenceId` (uma ocorrência), a frase diz a data: "A ocorrência de <dia> foi cancelada." no lugar de
  "Cancelado pelo organizador", e o resto igual (o `span: "this"` é do 62).
- **CA13 — Sem acesso ao Calendário (R8, D9, quadro 06).** `calendar.status: 'no-access'` (`denied`, `restricted` ou
  `writeOnly`):
  - já respondido: a `responseLine` fica **acima** da nota ("Você aceitou hoje às 11:20" em negrito e "Resposta enviada
    a <organizador>." embaixo);
  - `Note` `[data-invite-no-access]` (`TriangleAlert`, `role="status"`): "**Sem acesso ao Calendário**" e "O macOS não
    deixou o app pôr o evento na agenda. Permita em Ajustes › Privacidade › Calendários, ou abra o convite no app de
    agenda, que importa sozinho." com os botões `data-action="invite-open-settings"` "Abrir Ajustes" (com
    `actions.openSettings` → `window.__scribeApi.send('scribe:open-privacy-settings', 'calendars')`) e
    `data-action="invite-open-ics"` "Abrir no app de agenda" (com `actions.openIcs` → `scribe:invite-open-ics`);
  - sem "Pôr na agenda" (o 62 manda `actions.add: false`); os botões de resposta (ou o segmentado) continuam e
    funcionam (responder não precisa da permissão). Etiqueta: Respondido (ou Novo, antes de responder).
  - `calendar.status: 'unavailable'` (fora do macOS, sem helper — N9 e D9 do plan): sem a nota; no lugar da linha "Pôr
    na agenda", o botão secundário "Abrir no app de agenda" (`invite-open-ics`, com `actions.openIcs`).
  - Pedido negado no primeiro gravar (o `-add` volta `denied`): a resposta já saiu; o cartão relê e cai neste estado.
- **CA14 — "Este convite não é para …" (N5, D10, quadro 07).** `state.notForMe` com `method: 'REQUEST'`:
  - `[data-invite-not-for]` com "**Este convite não é para <endereço da conta>**" e embaixo `notForLine`: "Os convidados
    são outros endereços (<primeiro> e mais <N−1>). Para responder, abra o convite na conta convidada. Pôr na agenda
    continua possível." (um só convidado: "(<primeiro>)"; nenhum: "O convite não lista convidados." e o resto igual);
  - nenhum `invite-accept`/`-tentative`/`-decline` no DOM (o 62 manda `replyable: false`; não só desligados);
  - com `actions.add`, "Pôr na agenda" vira `Button` primário `data-action="invite-add"` (`CalendarPlus`) com o
    seletor ao lado, sem a caixa; o clique chama `scribe:invite-add` com `availability: 'busy'`, sem REPLY.
- **CA15 — Resposta recebida (R7, D11, quadro 08).** `kind: 'reply-received'`: cartão compacto, sem
  `[data-invite-details]`, sem botões e sem "Pôr na agenda". Topo "Resposta ao convite" + etiqueta; uma linha
  `[data-invite-replier]` "**<nome> <aceitou|marcou talvez|recusou|delegou>**" (de `state.replier`) e embaixo
  "<endereço> · <quando chegou>" (12 px); o título e `[data-invite-time]` numa linha só ("Alinhamento ABF Expo 2027 qua,
  25 de novembro · 10:00–11:00 · 1 h"). Sem nome, o endereço.
- **CA16 — Não encontrei o evento (R6, D18, quadro 14).** `calendar.status: 'missing'`: etiqueta Respondido (ou Novo,
  sem resposta); `[data-invite-missing]` com `TriangleAlert` em `--rec`: "**Não encontrei este evento na agenda**" e
  "O app pôs na agenda <calendarTitle> (<sourceTitle>), mas ele não está mais lá. Pode ter sido apagado no Calendário."
  (com `calendarTitle: null`: "O app tinha posto este evento na agenda, mas ele não está mais lá."); abaixo, com
  `actions.add`, o botão secundário `data-action="invite-readd"` (`CalendarPlus`) "Pôr de novo" com o seletor de
  agenda ao lado (começa em `calendar.calendarId` se ela está na lista, senão em `defaultCalendarId`) →
  `scribe:invite-add` com a agenda escolhida e `availability` pela resposta (`TENTATIVE` → `tentative`, senão
  `busy`); o segmentado "Sua resposta" continua. A resposta enviada não muda.
- **CA17 — Repetição que não dá para copiar (N8, D19, quadro 15).** `state.recurrenceBlocked`:
  `[data-invite-recurrence]` com o texto do 59 e, ao lado em 12 px `--text-faint`, o motivo curto por `block`
  (`rdate` "Repetição por datas (RDATE)"; `sub-daily` "Repete mais de uma vez por dia"; `byhour`/`byminute`/`bysecond`
  "Repetição por horário"; `multiple-rrule` "Mais de uma regra de repetição"; outros "Repetição fora do padrão");
  sem "Pôr na agenda"; `Note` `[data-invite-not-storable]` "**Esta repetição o app não consegue copiar**" e "O
  Calendário do Mac não representa este tipo de repetição pelo app. Abra o convite no app de agenda, que importa todas
  as datas." com "Abrir no app de agenda" (`invite-open-ics`, com `actions.openIcs`); os botões de resposta ficam.
- **CA18 — Estados sem quadro: Antigo e Erro (R7, N4).** `kind: 'old'`: etiqueta Antigo; `[data-invite-old-version]`
  "Há uma versão mais nova deste convite." (12 px `--text-muted`); sem botões nem "Pôr na agenda"; os detalhes
  aparecem como no convite desta mensagem. `kind: 'error'`: etiqueta Erro e `[data-invite-error]` com
  `state.error.message` (a frase fixa do `INVITE_ERROR_MESSAGES` do 62, ex. `failed` "O Calendário não respondeu.
  Tente de novo."); os botões de resposta ficam (com `replyable`).

### Lista (quadro 10)
- **CA19 — Ícone na linha (D13, tela 2 da spec).** Em `EmailScreen.tsx`, na linha de assunto, entre
  `[data-email-row-subject]` e o `[data-email-unread-dot]`, `[data-email-row-invite]` com `Icon` 14 px `--text-faint`:
  `Calendar` e `data-email-row-invite="invite"` para `REQUEST`/`REPLY`; `CalendarX` e `="cancel"` para `CANCEL`;
  `title="Convite de reunião"` (ou "Convite cancelado") e `<span class="sr-only">` com o mesmo texto. A decisão lê
  **só** `useEmail.bodies[bodyKey(conta, id)]` já carregado (`invite` objeto): nada de pedido de corpo novo por causa
  do ícone; corpo não baixado (ou `loading`/`error`) → sem ícone (o convite da Julia no quadro 10). A prévia da linha
  (`previewLine`) não muda.

### Configurações › Email › Convites (quadros 11, 11b, 11c)
- **CA20 — (sem efeito).** O "Sugerir evento" da barra da leitura saiu deste contrato: é do 64 (D12). O número fica
  para as referências do 64 e do plan não mudarem.
- **CA21 — Bloco "Convites" (R9, D14).** `InvitesSection` (`Section` com `title="Convites"`, `anchor="convites"`)
  no **fim** da aba Email do 55, depois de Avisos; `settingsPath('email', 'convites')` abre nele (o 64 linka para cá).
  Não depende do seletor de conta do 55 (vale para todas as contas). Lê `scribe:invite-calendars` ao abrir. Quatro
  `SettingRow`, cada uma `data-setting-row`, nesta ordem e com os textos exatos:
  1. "Agenda padrão" — "Onde entra o convite aceito. Dá para trocar em cada convite." — `CalendarPicker`
     `#invite-default-calendar` (CA22) com o valor `defaultId` do resultado. Sem acesso (`access` diferente de `full`):
     descrição "Permita o acesso ao Calendário para ver as agendas." e o seletor desligado com "Escolher agenda".
  2. "Pôr na agenda ao aceitar" — "Ligado, Aceitar e Talvez também gravam o evento no Calendário do Mac. Dá para
     desligar em cada convite." — `Switch` `data-action="invite-add-on-accept"` ligado ao `inviteAddOnAccept` (grava na
     hora).
  3. "Acesso ao Calendário do Mac" — "Acesso completo: o app lista as agendas, acha o convite que já está lá e
     atualiza o que ele mesmo gravou. Nunca apaga evento que não criou." — `[data-invite-access]` com
     `data-invite-access="<access ou unavailable>"` e o texto: `full` "permitido"; `notDetermined` "não pedido" +
     `Button` secundário `data-action="invite-request-access"` "Pedir acesso" (→ `scribe:invite-request-access`);
     `denied`/`restricted`/`writeOnly` "negado" + "Abrir Ajustes" (`invite-open-settings` →
     `window.__scribeApi.send('scribe:open-privacy-settings', 'calendars')`); `{ ok: false, error: 'unavailable' }`
     "só no macOS" sem botão. Depois do "Pedir acesso", relê `scribe:invite-calendars` e a linha muda sem recarregar a
     tela.
  4. "Sugerir evento quando o email não tem convite" — "Mostra “Sugerir evento” na leitura. No clique, o Claude
     (Haiku) lê só o texto do email aberto e preenche um evento para você conferir. Nada é gravado nem respondido sem
     você." — `Switch` `data-action="invite-suggest-toggle"` ligado ao `inviteSuggest` (padrão desligado). Só o
     interruptor: o botão e o cartão que ele liga são do 64.
  Com `{ ok: false, error: 'unavailable' }`, as linhas 1 e 2 ficam desligadas com a nota "O Calendário do Mac só
  existe no macOS."
- **CA22 — Seletor de agenda (D14, quadro 11b).** O mesmo componente `CalendarPicker` serve ao CA6, ao CA14, ao CA16,
  ao CA21 e ao cartão de sugestão do 64. É um **menu na própria linha** (botão que abre a lista logo abaixo, com o
  `useInlineMenu` de `features/meetings/menu.ts`), como no quadro 11b, e não um `<select>` nativo. Fechado: "<title>
  <sourceTitle em --text-muted>" ("Trabalho iCloud"). Aberto: as agendas do `InviteCalendarOption[]` (já só as
  graváveis), agrupadas por `sourceTitle` na ordem em que aparecem, com o cabeçalho do grupo em caixa alta 10 px
  `--text-faint` ("ICLOUD", "ANDREW.JPBARBOSA@GMAIL.COM"), a escolhida com `Check`, e o rodapé "Só as agendas em que dá
  para gravar. Feriados e agendas assinadas não aparecem." Sem bolinha nem cor de agenda (as cores do EventKit não são
  tokens). Teclado: abre com Enter/Espaço/↓, ↑/↓ andam, Enter escolhe, Esc fecha e devolve o foco; `role="listbox"` e
  `aria-selected`. Em Configurações, escolher grava `inviteCalendarId`; no cartão, a escolha fica só naquele convite
  (CA6). Agenda gravada que sumiu da lista: o seletor de Configurações mostra "Escolher agenda" (o cartão já recebe a
  `defaultCalendarId` do 62).
- **CA23 — Busca ⌘F.** `shared/settings-index.ts` ganha, na aba `email`, seção "Convites", as quatro linhas com os
  mesmos nomes e descrições do CA21 (as descrições como constantes exportadas, usadas na tela e no índice, como o
  `EMAIL_POLL_DESCRIPTION`). Buscar "convite", "agenda", "calendário" e "sugerir" acha ao menos uma linha de "Email ›
  Convites"; o passo do smoke "linhas fora do índice" continua verde.

### Testes, smoke e docs
- **CA24 — Testes de unidade (Vitest, `test/renderer/`, só funções puras).**
  - `email-invite-format.test.ts`: `inviteWhen` (mesmo dia, virada de dia, dia inteiro de 1 e de 3 dias, ano
    diferente, duração 30 min/1 h/1 h 30 min, fuso de origem só quando o deslocamento difere — America/New_York vs
    America/Sao_Paulo mostra; America/Bahia vs America/Sao_Paulo não; `timeZone: null` não), com `TZ` fixado no teste;
    `zoneCity` (tabela e fallback com `_`); `joinService` (Meet, Teams nos dois domínios, Zoom com subdomínio, Webex,
    outro); `attendeesLabel` (0, 1, 8); `responseLine` (cada partstat; hoje, ontem, outra data; organizador sem nome);
    `notForLine` (0, 1, 8 convidados); `INVITE_REPLY_ERRORS` tem os 14 códigos do `InviteReplySendError`.
  - `email-invite-view.test.ts`: `inviteView` para cada `kind` do `INVITE_KINDS` do 62 e cada quadro (01–08, 12–16):
    etiqueta e tom do CA3, quais blocos aparecem (add-row, botões, segmentado, notas, "Atualizar", "Tirar", "Pôr de
    novo", "Abrir no app de agenda", "Abrir Ajustes"), com as combinações de `calendar.status` (cada um dos nove),
    `actions`, `addDefault`/`addHint`, `recurrenceBlocked`, `notForMe`, `replyable`, `notice` e o CA1 sem estado;
    `afterReply` (aceitar e talvez com e sem caixa, com `calendar.status` `account` e `missing`, recusar com e sem
    `actions.remove`, trocar de resposta; `availability` pelo partstat); a trava (`sending` ligada não deixa outro
    `reply`). Os `InviteState` dos testes são montados com os tipos de `@shared/invite-state` (`import type`).
- **CA25 — Smoke `inviteChecks`.** Usa só o que o 61 e o 62 já ligaram (ver "O que o 63 consome", Smoke): o IMAP/SMTP
  falso do email (`smokeFixtures.email`), o `deliver` com `calendar` para entregar o convite (parte `text/calendar;
  method=…` e anexo `invite.ics`), o `smtpHold` para segurar o envio e o helper falso pelo `smokeFixtures.macCalendar`
  (o smoke escreve o estado em `statePath` antes de cada passo e lê o que o helper recebeu por `log()`). Este contrato
  não muda `smoke-fixtures.ts`, `fake-email.ts` nem `index.ts`. Os convites vêm das fixtures do 59
  (`test/fixtures/invites/*`) e das `servico-*.ics` do 62, dados fictícios. O smoke não muda o fuso do processo: a hora
  esperada é calculada com o mesmo `inviteWhen(invite, macTimeZone())`, e a linha de fuso de origem é exigida quando o
  fuso do Mac não é o do convite. Os passos 1–11 da verificação end-to-end da spec, cada um um `checks['convite-<n>']`
  com a asserção exata:
  1. REQUEST com Meet em America/New_York: `[data-invite-card][data-invite-state="new"]`, `[data-invite-time]` com a
     hora convertida para o fuso do Mac e `[data-invite-origin-time]` com "no horário de Nova York
     (America/New_York)", `[data-invite-join-service]` = "Google Meet". Clicar no link mostra `#email-external-link`
     com "Abrir https://meet.google.com/… no navegador?" e **nenhum** `scribe:open-link` antes de "Abrir". → print
     `email-convite-novo`.
  2. Aceitar com a caixa ligada: com `smtpHold` segurando o envio, o cartão mostra `[data-invite-sending]` e
     `aria-busy` → print `email-convite-enviando`; solto o envio, `smokeFixtures.email.sent` ganha **um** item com
     `icalEvent.method === 'REPLY'` e o `icalEvent.content` com `PARTSTAT=ACCEPTED`, o `ATTENDEE` da conta e o mesmo
     `UID`; o `log()` do helper tem, depois do REPLY, um `create` com `title`, `start`, `end`, `timeZone`, `url` e
     `notes`; o `scribe:invite-state` seguinte volta `kind: 'in-calendar'` (o registro é conferido pelo canal, não pelo
     arquivo); o cartão mostra "Na agenda Trabalho". → `email-convite-na-agenda`.
  3. Mesmo UID com SEQUENCE 2 e outro horário: `[data-invite-state="update-pending"]`, `[data-invite-time]` com
     "15:00 → 16:30" (texto sem os espaços extras do riscado), "Atualizar na agenda" → o `log()` tem um `update`.
     → `email-convite-atualizado`.
  4. CANCEL: `cancelled`, "Cancelado pelo organizador", "Tirar da agenda" → o `log()` tem `remove` com `span:
     "future"`; o `scribe:invite-state` seguinte volta `calendar.status: 'skipped'` e `actions.remove: false` (as
     linhas do UID saíram, E3 do 62) e o cartão diz "Tirado da agenda Trabalho.". → `email-convite-cancelado`.
  5. Convite cujo UID o falso já tem (`origin: "account"` no estado, conta Gmail do passo 7):
     `already-in-calendar`, "Já está na agenda" e "A sua conta já pôs na agenda."; Aceitar manda **um** REPLY e o
     `log()` **não** tem `create`. → `email-convite-ja-na-agenda`.
  6. "Ainda não sincronizou": o falso sem o evento, o app cria; o estado do falso ganha `pending` com a cópia da conta
     (`afterRefresh`); reabrir a mensagem → o `log()` tem `remove` com os ids do evento do app e o cartão mostra
     `[data-invite-reconciled]`; reabrir de novo → a nota some. → `email-convite-juntado`.
  7. Segunda conta com `incoming.host: 'imap.gmail.com'` no mesmo IMAP falso: `[data-invite-add]` desmarcada,
     `[data-invite-calendar]` desligado e `[data-invite-account-adds]` com a frase do R5b. → `email-convite-gmail`.
  8. CANCEL de uma ocorrência (`RECURRENCE-ID`) de uma série gravada pelo app: "Tirar da agenda" → o `log()` tem
     `remove` com `recurrenceId` daquela ocorrência e `span: "this"`; a série continua no estado do falso.
  9. Duplo clique em Aceitar (dois `click()` no mesmo tick, e um terceiro depois de 50 ms): `sent` cresce em **um**.
  10. `access: "denied"` no estado do falso: `[data-invite-no-access]` com "Abrir Ajustes" e "Abrir no app de agenda";
      Aceitar ainda manda o REPLY e o `log()` não tem `create`; "Abrir Ajustes" põe a URL `Privacy_Calendars` em
      `smokeFixtures.openedUrls`. → `email-convite-sem-acesso`.
  11. `scribe:lock-now`: com a mensagem do passo 1 aberta, `document.querySelector('[data-invite-card]') === null`; um
      `invoke` de cada um dos oito canais (`invite-reply` e os sete do 62) volta recusado; desbloquear → o cartão volta.
  Mais, sem passo na spec (para os prints e para fechar os estados): "não é para você" (fixture com outro
  `ATTENDEE`; sem `invite-accept` no DOM), resposta recebida (`reply-received.ics`), repetição por RDATE
  (`rdate.ics`, sem `[data-invite-add-row]`), não encontrei (apagar o evento no estado do falso; `[data-invite-missing]`
  e "Pôr de novo" → `create`), a lista com os ícones (um `invite` e um `cancel`, e a linha cujo corpo não foi pedido
  sem ícone) e Configurações › Email › Convites (permitido, seletor aberto, `notDetermined` com "Pedir acesso" →
  `onRequest: "full"` → "permitido").
  **Prints**, em claro e escuro, passando nos gates 6 e 7, conferidos à mão contra o quadro do mockup:
  `email-convite-novo` (01), `email-convite-na-agenda` (02), `email-convite-ja-na-agenda` (03),
  `email-convite-atualizado` (04), `email-convite-cancelado` (05), `email-convite-sem-acesso` (06),
  `email-convite-nao-e-para-voce` (07), `email-convite-resposta-recebida` (08), `email-convite-lista` (10),
  `email-convite-configuracoes` (11), `email-convite-configuracoes-agendas` (11b),
  `email-convite-configuracoes-sem-acesso` (11c), `email-convite-gmail` (12), `email-convite-juntado` (13),
  `email-convite-nao-encontrado` (14), `email-convite-repeticao` (15), `email-convite-enviando` (16) — cada um com
  `-light` e `-dark`, **34 prints**. Os do quadro 09 (`email-convite-sugestao-*`) e do editor de regras
  (`configuracoes-email-regra-convite-*`) são do 64; nenhum nome se repete entre os dois contratos. Os prints que já
  existem (`email-*`, `configuracoes-email-*` do 55) continuam; `configuracoes-email-*` passa a sair com o bloco
  Convites no fim (fora do recorte, se o print for do topo).
  Regra do `~/CLAUDE.md`: o smoke só fala com o SMTP e o helper falsos; nenhum passo usa conta ou agenda reais.
- **CA26 — Guia do app.** `resources/assistente/guia-do-app.md`: na seção Email, um parágrafo sobre o cartão do convite
  (Aceitar/Talvez/Recusar mandam a resposta ao organizador só no clique, dá para mudar a resposta, "Pôr na agenda" no
  Calendário do Mac, conta Gmail/Microsoft que já põe sozinha, atualizar e tirar só no clique, "Abrir no app de
  agenda" sem permissão); em Configurações › Email, o bloco Convites; que o Assistente não responde convite. O
  `README.md` fica para o fechamento da feature (como no 55).
- **CA27 — Peças para o 64.** `InviteCard.tsx` exporta, sem mudar o cartão: `InviteCardShell` (a moldura do CA2 com o
  topo: ícone, rótulo do tipo, etiqueta e o `children`), `InviteBadge` (`tone`: `outline` | `solid` | `muted` |
  `danger` | `dashed`, CA3), `InviteNote` (a nota de 12 px com ícone dos CA13/CA17) e `InviteStatusLine` (a linha de
  estado com ícone do CA8); `CalendarPicker.tsx` exporta `CalendarPicker` (CA22). O 64 monta o cartão "Sugestão —
  confira" com essas peças, sem copiar classes. *Teste:* o typecheck do 64 importa as cinco; neste contrato, o
  `inviteView` cobre o tom `dashed` só no `InviteBadge` (sem `kind` que o use).

## Invariantes
- **Só tokens de `tokens.css`** (gate 6): nenhuma cor literal; etiquetas, realce e o quadrado do "Enviando" com
  `--accent`, `--on-accent`, `--title`, `--rec`, `--hl`, `--bg-sunken`, `--line-strong`, `--text-*`. Raio 4 ou 6, sem
  sombra, sem pílula (gate 7). Ícones `lucide-react` pelo `Icon`. Textos em pt-BR, iguais aos do mockup e deste
  contrato.
- **Com o app bloqueado, o cartão não aparece**: `InviteCard` devolve `null` com `locked`, não chama canal, e o ícone
  da lista só usa o que já estava na memória (que o desbloqueio relê). Nenhum dado do convite em notificação.
- **O link da reunião passa pela confirmação "Abrir … no navegador?"** (D6): o cartão não chama
  `scribe:open-link` direto; usa o `openLink` do `ReadingPane`. Os links da descrição do convite não viram link no
  cartão (a descrição não aparece no cartão; o corpo já mostra o texto).
- **Nenhum botão de resposta sem token de clique**: Aceitar, Talvez, Recusar e cada troca no segmentado só passam por
  `window.__scribeApi.inviteReply` (61), que gera o token (`crypto.randomUUID()` + `scribe:email-click`); nenhum
  caminho do renderer chama `invoke('scribe:invite-reply', …)`, e nada responde sozinho (abrir o cartão, regra,
  Assistente, smoke sem clique). O smoke clica pelo DOM (`.click()`), como o envio de email de hoje.
- **Ordem dos cliques**: primeiro o REPLY (61); só depois do `ok`, e conforme "Pôr na agenda", o `invite-add` ou o
  `invite-remove` (62). O serviço de convites não grava nem tira nada por causa do REPLY (só registra a resposta).
- Gravar, atualizar e tirar só no clique: abrir o cartão só lê (`invite-state`); "Atualizar na agenda" e "Tirar da
  agenda" nunca rodam sozinhos (D8 do plan). A única exceção é a reconciliação do R5c, que é do main (62).
- O app nunca oferece tirar evento que não gravou: "Tirar da agenda" e o `-remove` do recusar só com `actions.remove`.
- Email sem convite: a leitura, a lista e Configurações iguais às do 55 (sem `[data-invite-*]`, sem chamadas novas),
  fora o bloco Convites; `invite.ics` continua na lista de anexos.
- Layout estreito (< 900 px): o cartão ocupa a largura da leitura; as linhas quebram, os botões vão para a linha de
  baixo; nada corta.
- Nenhum título, organizador, endereço ou descrição de convite vai para log, settings ou mensagem de erro.

## Fora de escopo
- Parser, REPLY, registro, helper, canais e a ligação das peças falsas no smoke (59, 60, 61, 62).
- Todo o "Sugerir evento": o botão na barra da leitura, o cartão "Sugestão — confira" (quadro 09), a chamada ao Claude
  e os canais `scribe:invite-suggest`/`-suggest-add` (64). Aqui só o interruptor de Configurações e as peças do CA27.
- Condição "É convite" e ação "Pôr na agenda" no editor de regras (64).
- Ler o Calendário do Mac para os avisos e "Próximas" (F4); propor novo horário (F3); criar convite (F2).
- Esconder o anexo `invite.ics` (D15 manteve).
- `README.md` (fechamento da feature).
- Teste navegado (sessão nova, item 12 da verificação) e o teste do Andrew no `.app` (item 13).

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos: 1 typecheck, 2 lint,
  3 test (com os dois arquivos novos do CA24), 4 build, 5 smoke (com o `inviteChecks` do CA25), 6 literais de cor fora
  de `tokens.css`, 7 sem sombra / raio acima de 6 px / pílula (`check-shapes.sh`), 8 pytest do serviço do WhatsApp.
- Gate de cor (6) e de forma (7) valem também para o CSS da animação do quadrado (só `opacity`; nada de `box-shadow`
  nem `rounded-full`).
- Os 34 prints do CA25 conferidos à mão contra o mockup aprovado, quadro a quadro, claro e escuro, antes de passar ao
  revisor.
- `git diff --stat` só com os arquivos da Superfície.

## Telas de impacto no usuário
1. **Email › leitura** — cartão do convite entre o cabeçalho e o corpo, com os estados do R7, Aceitar / Talvez /
   Recusar, "Sua resposta" para trocar, "Pôr na agenda" com o seletor, Atualizar / Tirar / Pôr de novo, as notas de
   sem acesso, "não é para você" e repetição.
2. **Email › lista** — ícone de calendário (ou calendário com X) na linha da mensagem com convite.
3. **Configurações › Email** — bloco "Convites" no fim (agenda padrão, pôr ao aceitar, acesso, sugerir evento).
4. **macOS** — o pedido de acesso ao Calendário (frase do 60/62), uma vez.

Há telas: depois da implementação dá para gerar a apresentação do cliente com os prints reais do smoke e do teste
navegado — perguntar ao Andrew antes de gerar.

## Decisões deste contrato
Tomadas pelo coordenador em 19/11/2026 (eram **[decidir]**); o Andrew confirma no ok do texto.
- **Pulso do "Enviando" (CA9) no ritmo do `rec-pulse` do app (1,6 s), não em `--duration-slow`.** Com 180 ms por ciclo o
  quadrado piscaria 5,5 vezes por segundo, o que não dá para usar; vale o pulso que o app já usa no quadrado de gravação
  (só opacidade, nada com `prefers-reduced-motion`). Registrado na devolução do 63, em 19/11/2026.
- **"Pôr na agenda" depois de responder** (devolução do 63): com resposta Aceito ou Talvez e o evento fora da agenda
  (`calendar.status` `absent`/`needs-access` com `actions.add`), a caixa do CA6 vira o botão secundário
  `data-action="invite-add-after"` "Pôr na agenda" com o seletor ao lado, no padrão do "Pôr de novo" (CA16). Chama só o
  `scribe:invite-add`, sem REPLY. Trocar a resposta no segmentado não grava sozinho.
- **"Sugerir evento" é todo do 64** (botão na barra, cartão do quadro 09, IA e canais). O 63 fica com o interruptor em
  Configurações e exporta as peças do cartão (CA27).
- **A agenda escolhida no cartão não vira a padrão.** Vale só para aquele convite; a padrão só muda em Configurações (o
  quadro 11 diz "Dá para trocar em cada convite").
- **"Já está na agenda" com frase genérica**: "A sua conta já pôs na agenda.", sem nome de provedor.
- **Seletor de agenda = menu na própria linha** (quadro 11b), não `<select>` nativo.
- **README no fechamento da feature**, não aqui; aqui só o guia do app.
- **A ordem dos cliques é da tela** (`afterReply`): REPLY primeiro, `invite-add`/`invite-remove` só depois do `ok`.
- **"Tirado da agenda <agenda>." vem do último efeito guardado na memória da tela**, porque o registro do CANCEL some
  (E3 do 62); depois de reiniciar o app, o cartão do CANCEL mostra a frase de "sem evento do app".
- Etiqueta "Antigo" e "Erro" sem quadro no mockup: seguem o D2 (cinza e contorno `--rec`).

Conferido com os contratos 61–64 em 19/11/2026.
