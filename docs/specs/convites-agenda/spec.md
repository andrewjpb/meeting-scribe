---
status: aprovado
feature: convites-agenda
data: 2026-11-19
---

# Spec — Convites de reunião no email → Calendário do Mac

> Aprovado pelo Andrew em 19/11/2026, junto com o mockup `docs/specs/desktop-shell/mockups/ConvitesAgenda.dc.html` (D1–D20 como propostas; D5: dá para mudar a resposta depois, cada troca manda um REPLY novo).

## Problema e objetivo
Convite de reunião (Google, Outlook, Zoom, Teams) chega no email do app como um anexo `.ics` sem nome, que ninguém entende. Hoje o Andrew precisa abrir o arquivo, importar na mão e responder pelo webmail. O objetivo: o app reconhece o convite, mostra um cartão claro (o quê, quando, link da reunião, quem chamou), responde ao organizador com um clique e grava, atualiza ou tira o evento do **Calendário do Mac** — que já sincroniza com iCloud, Google e Exchange. Tudo é lido e gravado na máquina, sem IA e sem servidor novo; a IA só entra, como sugestão, no email que fala de reunião sem trazer convite.

## Decisão que muda uma regra antiga
O contrato 12 (agendas e avisos) diz que o app "só lê as agendas" e que nada é enviado a terceiros. Esta feature abre duas exceções, e só estas:
1. **Responder ao convite** (Aceitar / Talvez / Recusar) envia um email de resposta ao organizador, **somente no clique do Andrew**, pelo mesmo caminho do envio com token de clique do email (contrato 42).
2. **Gravar no Calendário do Mac** (EventKit). As agendas do Google e da Microsoft lidas pelo contrato 12 continuam só leitura; o app não ganha escopo de escrita nelas.

## Requisitos
- **R1 — Reconhecer.** QUANDO o corpo de um email é aberto (ou baixado para uma regra) e há uma parte `text/calendar` ou um anexo `.ics`/`application/ics` com `METHOD:REQUEST`, `CANCEL` ou `REPLY`, O SISTEMA DEVE extrair do iCalendar: UID, SEQUENCE, METHOD, título, início e fim com fuso (TZID/VTIMEZONE) ou dia inteiro, recorrência (RRULE/EXDATE), local, descrição, organizador, convidados com o PARTSTAT do próprio endereço, e o link da reunião (por `findJoinUrl` em LOCATION, DESCRIPTION, URL e `X-GOOGLE-CONFERENCE`/`X-MICROSOFT-*`).
- **R2 — Cartão.** QUANDO a mensagem aberta tem convite, O SISTEMA DEVE mostrar, entre o cabeçalho e o corpo, um cartão com título, data e hora no fuso do Mac (e o fuso de origem se diferente), duração, recorrência em português, local, link da reunião (abre pelo navegador, padrão `scribe:open-link`), organizador e número de convidados, e o estado (ver R7).
- **R3 — Responder.** QUANDO o Andrew clica Aceitar, Talvez ou Recusar, O SISTEMA DEVE enviar ao ORGANIZER um iTIP `METHOD:REPLY` (RFC 5546 §3.2.3; `text/calendar; method=REPLY` + anexo `invite.ics`) pela conta que recebeu o convite, com assunto "Aceito: <título>" / "Talvez: <título>" / "Recusado: <título>". O VEVENT leva: `ORGANIZER` copiado do convite, **um único** `ATTENDEE` com o valor exato do convite (o `mailto:` e o CN originais) e o PARTSTAT escolhido, `UID`, `SEQUENCE` do convite, `DTSTAMP` = agora em UTC, `RECURRENCE-ID` quando a resposta é a uma ocorrência, e `DTSTART`, `DTEND`, `SUMMARY` e o `VTIMEZONE` usado (para o Outlook casar a resposta). Enquanto um envio está em andamento para o mesmo convite, os botões ficam desabilitados e um segundo clique não envia nada.
- **R4 — Gravar.** QUANDO o Andrew aceita ou marca talvez (e "Pôr na agenda" está ligado no cartão, padrão ligado), O SISTEMA DEVE criar o evento na agenda escolhida do Calendário do Mac, com título, início, fim, fuso, dia inteiro, recorrência, local, URL = link da reunião, notas = link + descrição (texto puro, até 4000 caracteres) e disponibilidade "ocupado" (talvez: "provisório" quando a agenda permitir). Recusar não grava; se o evento já tinha sido gravado pelo app, recusar o tira (com o mesmo aviso do R6).
- **R5 — Não duplicar.** O Gmail, o Outlook.com e o Microsoft 365 põem o convite na agenda sozinhos, do lado do servidor, e o Calendário do Mac só sincroniza minutos depois. O EventKit não deixa gravar o UID do convite no evento criado pelo app. Por isso:
  - **R5a — Procurar antes.** ANTES de criar, O SISTEMA DEVE pedir ao Calendário que atualize as contas (`refreshSourcesIfNecessary`) e procurar em **todas** as agendas, na janela `[início − 1 dia, fim + 1 dia]`, um evento cujo `calendarItemExternalIdentifier` seja o UID do convite ou, sem isso, com o mesmo título e o mesmo início exato. Achou: não cria; o cartão diz "Já está na agenda <nome da agenda>" e o clique só responde.
  - **R5b — Conta que já põe sozinha.** QUANDO a conta de email que recebeu é Gmail/Google Workspace (IMAP `imap.gmail.com`) ou Microsoft (`outlook.office365.com`), "Pôr na agenda" começa **desligado** no cartão, com a frase "Sua conta já põe os convites na agenda dela." O Andrew pode ligar.
  - **R5c — Reconciliar.** QUANDO o app gravou um evento e, depois, aparece no Calendário uma cópia com o mesmo UID vinda da conta (sincronizou), O SISTEMA DEVE tirar a cópia que **o app** criou (N3) e passar o mapa para a cópia da conta, com aviso "Juntei com o evento que a sua conta pôs na agenda". A conferência roda ao abrir o cartão e a cada leitura de agenda do app.
- **R6 — Atualizar e cancelar.** QUANDO chega um REQUEST com o mesmo UID e versão maior (par `SEQUENCE`, `DTSTAMP`, RFC 5546 §2.1.5), ou um CANCEL, para um evento que **o app gravou**, O SISTEMA DEVE mostrar no cartão o que mudou (horário antigo → novo, local, link) ou "Cancelado pelo organizador", com o botão "Atualizar na agenda" ou "Tirar da agenda". Se tiver `RECURRENCE-ID`, a ação vale só para aquela ocorrência (`span: thisEvent`), nunca para a série. Evento que o app não gravou só mostra o aviso; quem atualiza é a própria conta. Se o evento gravado não for mais encontrado (ver N3), o cartão diz "Não encontrei este evento na agenda" com "Pôr de novo".
- **R7 — Estados do cartão.** Novo · Respondido (com a resposta e a data) · Na agenda (nome da agenda) · Já estava na agenda · Atualização pendente · Cancelado · Antigo (SEQUENCE menor que o já visto: "Há uma versão mais nova deste convite") · Resposta recebida (METHOD:REPLY de um convidado: "Fulano aceitou", sem botões) · Erro (com a frase do erro).
- **R8 — Permissão.** QUANDO o Andrew grava pela primeira vez, O SISTEMA DEVE pedir ao macOS o acesso completo à agenda (`requestFullAccessToEvents`). Negado ou restrito: o cartão mostra "Sem acesso ao Calendário" com "Abrir Ajustes" (Privacidade › Calendários) e "Abrir no app de agenda" (abre o `.ics` no Calendário, que importa sozinho). Responder continua funcionando sem a permissão.
- **R9 — Configurações.** Em Configurações, um bloco "Convites" com: agenda padrão (lista das agendas graváveis do Calendário do Mac, agrupadas por conta), "Pôr na agenda ao aceitar" (padrão ligado), estado da permissão com o botão para pedir, e "Sugerir evento quando o email não tem convite" (R11, padrão desligado).
- **R10 — Regras.** As regras de email (contrato 53) ganham a condição "É convite" e a ação "Pôr na agenda" (grava como no R4/R5, sem responder; ambas forçam o download do corpo, como `needsBody`). Nenhuma regra responde ao organizador. Sem permissão do Calendário ou sem agenda padrão escolhida, a regra não pede nada: registra o erro da regra (`calendar-denied` / `no-calendar`) e segue. A ação não vale para conta do R5b, que já põe na agenda sozinha.
- **R11 — Sem convite (IA, opcional).** QUANDO ligado em Configurações e o Andrew clica "Sugerir evento" num email sem `.ics`, O SISTEMA DEVE pedir ao Claude (Haiku, `runClaudeOneShot`, purpose novo `invite-suggest`) título, data, hora, duração e link a partir do texto, e mostrar o cartão no estado "Sugestão — confira" com os campos editáveis; só grava no clique. Nada responde a ninguém.
- **R12 — Avisos de reunião.** Um evento gravado pelo app entra nos avisos do contrato 12 só se a agenda do Mac estiver numa conta que o app já lê (Google/Microsoft); ler o Calendário do Mac para os avisos fica fora desta feature (F4).

## Regras de negócio
- **N1 — Nada sai sem clique.** A única coisa que sai da máquina é o REPLY do R3, e só pelo `send` com token de clique. Regra, tarefa agendada e Assistente nunca respondem convite.
- **N2 — Local.** O `.ics` é lido no main, sem IA e sem rede. O R11 é o único uso de IA, opcional, desligado por padrão, e manda só o texto do email aberto, como o resto do Assistente.
- **N3 — Registro do app.** `userData/email/invites.json` (0600) guarda **todo convite visto**, com chave `accountId + uid + recurrenceId`: `{ sequence, dtstamp, response, respondedAt, messageId, event: null | { eventIdentifier, calendarItemIdentifier, externalIdentifier, calendarId, title, start } }`. `event` só existe quando **o app** gravou. Como o `eventIdentifier` muda quando o evento troca de agenda ou na primeira sincronização, o app procura nesta ordem: `eventIdentifier`, `calendarItemIdentifier`, `externalIdentifier`, e por fim agenda + título + início; e atualiza os ids quando acha. Só eventos com `event` são atualizados ou removidos pelo app; o app nunca apaga um evento que ele não criou.
- **N4 — Versão.** Um convite com versão (`SEQUENCE`, `DTSTAMP`) menor que a do registro nunca sobrescreve o evento e mostra o estado "Antigo".
- **N10 — Uma parte por convite.** O Google manda a parte `text/calendar` **e** o anexo `.ics` com o mesmo conteúdo. Vale a parte `text/calendar` com `method`; as demais com o mesmo UID são ignoradas.
- **N11 — Fuso.** O helper recebe instantes em UTC mais um nome de fuso IANA (ou nenhum, para dia inteiro). TZID do Windows ("E. South America Standard Time") é convertido por tabela Windows→IANA; TZID sem VTIMEZONE é lido como IANA; o VTIMEZONE do convite é registrado no `ical.js` antes de ler.
- **N12 — Corpos antigos.** Corpos guardados antes desta feature não têm o convite. No POP3 o app relê o `.eml` guardado; no IMAP o cartão aparece só depois de o app baixar a mensagem de novo, o que ele faz uma vez, ao abrir uma mensagem que tem anexo `text/calendar`/`.ics` sem convite no corpo guardado.
- **N5 — Conta certa.** O REPLY sai pela conta de email que recebeu o convite. Se o endereço dessa conta não está entre os ATTENDEE, o cartão avisa "Este convite não é para <endereço>" e os botões de resposta somem (gravar continua possível).
- **N6 — Bloqueio.** Com o app bloqueado, o cartão não aparece e todos os canais novos respondem `refused`, como o resto do email.
- **N7 — POP3 e IMAP.** Vale para as duas; o convite é extraído no mesmo parse do corpo e guardado junto, dentro do corpo (sem baixar a mensagem de novo, salvo o N12).
- **N8 — Recorrência.** O que o `EKRecurrenceRule` representa (FREQ diária, semanal, mensal ou anual, com INTERVAL, COUNT ou UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS) é gravado como série; cada EXDATE vira a remoção daquela ocorrência (`span: thisEvent`). Exceção de uma ocorrência (`RECURRENCE-ID`) atualiza ou tira só aquela ocorrência. FREQ abaixo de diário, BYHOUR/BYMINUTE, RDATE e mais de uma RRULE não são gravados: o cartão mostra "Esta repetição o app não consegue copiar" e oferece "Abrir no app de agenda".
- **N9 — Só Mac.** Fora do macOS (Linux), não há destino: o cartão mostra o convite, responde, e "Pôr na agenda" vira "Abrir no app de agenda".

## Telas de impacto no usuário
1. **Email › leitura** — cartão novo do convite entre o cabeçalho e o corpo, com os estados do R7 e os botões Aceitar / Talvez / Recusar, "Pôr na agenda" e o seletor de agenda do evento.
2. **Email › lista** — ícone de convite na linha da mensagem que tem `.ics` (quando o corpo já foi baixado).
3. **Configurações** — bloco "Convites" (R9). Fica na aba Email do contrato 55 quando ela existir; antes disso, na aba Contas, junto do bloco Agenda.
4. **Regras** — condição "É convite" e ação "Pôr na agenda" no editor de regras (contrato 55).
5. **macOS** — o pedido de acesso ao Calendário, uma vez, com a frase "Para pôr na sua agenda os convites de reunião que chegam por email."

Há telas: o mockup do cartão e do bloco de Configurações precisa do ok do Andrew antes do contrato de UI. Depois da implementação dá para gerar a apresentação com prints reais.

## Fora de escopo
- **F1** Escrever nas agendas do Google e da Microsoft pela API (continua só leitura).
- **F2** Criar convite e chamar pessoas (o app não organiza reunião).
- **F3** Propor novo horário (`COUNTER`) e `REFRESH`.
- **F4** Ler o Calendário do Mac para os avisos de reunião e "Próximas" (pode virar outra feature).
- **F5** Modelo de IA local (Ollama etc.); o R11 usa o Claude que o app já tem.
- **F6** CalDAV/iCloud direto, sem o Calendário do Mac.
- **F7** Convites no WhatsApp ou em outros canais.

## Verificação end-to-end
1. No servidor IMAP falso do smoke, chega um email com `invite.ics` (REQUEST, Meet, fuso America/New_York). A leitura mostra o cartão com o horário convertido para São Paulo e o link do Meet.
2. Clicar Aceitar com "Pôr na agenda" ligado: o SMTP falso recebe um REPLY com `PARTSTAT=ACCEPTED`, ATTENDEE da conta e o mesmo UID; o helper de agenda falso recebe o `create` com título, início, fim, fuso, URL e notas; `invites.json` ganha a linha; o cartão fica "Na agenda Trabalho".
3. Chega o mesmo UID com SEQUENCE 2 e outro horário: o cartão mostra "15:00 → 16:30" e "Atualizar na agenda"; o clique manda `update` ao helper.
4. Chega o CANCEL: o cartão mostra "Cancelado pelo organizador" e "Tirar da agenda"; o clique manda `remove`; `invites.json` perde a linha.
5. Um convite cujo UID o helper já tem (simulando o Gmail): o cartão diz "Já está na agenda", Aceitar só manda o REPLY, nenhum `create`.
6. "Ainda não sincronizou": o helper falso não tem o evento, o app cria; depois o helper passa a ter uma cópia da conta com o mesmo UID; ao reabrir o cartão o app manda `remove` da cópia dele e o mapa aponta para a da conta.
7. Conta Gmail (host `imap.gmail.com` no servidor falso): "Pôr na agenda" começa desligado com a frase do R5b.
8. CANCEL de uma ocorrência (`RECURRENCE-ID`) de uma série gravada: o helper recebe `remove` com `span: thisEvent` daquela ocorrência; a série continua.
9. Duplo clique em Aceitar: o SMTP falso recebe um REPLY só.
10. Permissão negada no helper falso: "Sem acesso ao Calendário" com os dois botões; Aceitar ainda responde.
11. Com o app bloqueado, a leitura não mostra o cartão e os canais respondem `refused`.
12. Teste navegado (sessão nova, IA): usa **só** o SMTP e o helper falsos; nenhuma IA clica Aceitar num convite real (regra do `~/CLAUDE.md`: IA não envia email a terceiros).
13. No Mac real, **só pelo Andrew**, no `.app` empacotado (no `pnpm dev` o pedido de acesso do macOS não funciona): um convite verdadeiro do Google e um do Teams aparecem no Calendário com o link, sem duplicar, e o organizador vê a resposta.
