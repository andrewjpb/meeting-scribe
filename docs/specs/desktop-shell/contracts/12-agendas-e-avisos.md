# Contrato 12 — Agendas Google e Microsoft: avisar a reunião e avisar quando não está gravando
Feature: desktop-shell  ·  Wave: 22  ·  Depende de: 11 (OAuth com PKCE + loopback, aba "Contas", cofre de tokens) e 22 (bloqueio: notificações não mostram conteúdo com o app bloqueado)

## Pré-condições
- Contrato 11 aceito; `gates.sh` verde.
- Pedido do Andrew (15/11/2026 20:40): "integração com agendas, Google e Microsoft por enquanto, avisar que terá reunião, e se não estiver gravando enquanto tiver reunião subir um aviso falando que a reunião não está sendo gravada ou foi cancelada". Escolha às 20:48: **aviso 5 min antes + aviso de não gravando**; e os **dados da agenda** entram na reunião (título e participantes).
- Microsoft: o Andrew registra um app no Microsoft Entra ("Contas em qualquer diretório organizacional e contas Microsoft pessoais", plataforma "Cliente público/nativo" com `http://localhost`, "Permitir fluxos de cliente público" = Sim, permissões delegadas do Graph `User.Read`, `Calendars.Read`, `offline_access`). Só o **ID do aplicativo (cliente)**; sem segredo.

## Superfície
- `src/main/accounts/` (o OAuth do 11, agora com o provedor Microsoft), `src/main/microsoft/` (novo), `src/main/google/` (agenda), `src/main/calendar/` (novo: junta as agendas, agenda os avisos).
- Settings, `src/shared/` (tipos, IPC), preload, `src/shared/meetings.ts` (campo `calendar`).
- `features/settings/` (linha Microsoft no bloco "Contas", bloco "Agenda"), barra lateral ou tela de Reuniões (próximas reuniões), gravação ao vivo (título vindo da agenda).
- `src/main/claude-cli/summary.ts` (participantes na instrução).
- `src/main/smoke.ts` + fixtures.

## Critérios de aceite
- CA1: Microsoft no bloco "Contas": "Configurar…" com um campo "ID do aplicativo (cliente)" (cifrado como no 11), "Entrar com Microsoft" (`https://login.microsoftonline.com/common/oauth2/v2.0/authorize`, PKCE, loopback `http://localhost:<porta>`, escopos `openid profile email offline_access User.Read Calendars.Read`), nome, e-mail e foto (`/me/photo/$value`, se houver), "Sair". Tokens cifrados em `userData/accounts/microsoft.bin`, renovação automática, `invalid_grant` → "Entre de novo". Testes com servidor falso.
- CA2: Google: o login pede também `https://www.googleapis.com/auth/calendar.readonly` (`include_granted_scopes=true`). Quem já entrou no 11 vê "Permitir acesso à agenda" na linha do Google (novo consentimento só com o escopo que falta).
- CA3: bloco **"Agenda"** em Configurações: interruptor "Avisar reuniões da agenda" (padrão ligado quando há alguma conta com agenda), "Avisar antes" (`Segmented`: 1, 5, 10 min; padrão **5**), interruptor "Avisar se a reunião não estiver sendo gravada" (padrão ligado), e quais agendas usar (lista das agendas de cada conta, com caixa de marcar; padrão: a principal de cada uma). Settings com zod; `settings.json` antigo carrega com os padrões. Testes.
- CA4: leitura das agendas no main: Google `calendar/v3/calendars/<id>/events` (`singleEvents=true`, `orderBy=startTime`, de agora −1 h a +24 h, com `showDeleted=true` para ver cancelamentos); Microsoft Graph `/me/calendarView` (mesma janela, `Prefer: outlook.timezone="UTC"`). Atualiza a cada 5 min, ao abrir o app, ao acordar o Mac (`powerMonitor` `resume`) e ao trocar de conta. Sem internet: usa a última leitura (guardada em memória e em `userData/calendar-cache.json`, só os campos do CA5). Testes com APIs falsas.
- CA5: evento normalizado: `{ provider, calendarId, id, title, start, end, allDay, status: 'confirmed' | 'cancelled', myResponse: 'accepted' | 'tentative' | 'declined' | 'none', attendees: { name, email }[] (até 50), joinUrl: string | null (Meet, Teams, Zoom achado em `hangoutLink`, `onlineMeeting.joinUrl`, `conferenceData` ou no local/descrição) }`. Conta como **reunião** para os avisos: não é dia inteiro, não foi recusada por mim, e tem outro participante **ou** um link de chamada. Testes.
- CA6: aviso **antes**: N min antes do início (CA3), notificação do macOS (`Notification`) "Reunião em 5 min: <título>" com o corpo "<hora> · <até 3 participantes>" e o botão "Gravar". Clicar na notificação ou em "Gravar" traz o app para a frente e começa a gravação já com o título do evento (se a pessoa já está gravando, só traz o app). Um aviso por evento (o mesmo evento com horário mudado avisa de novo).
- CA7: aviso **não está gravando**: 2 min depois do início, se não há gravação em andamento e o evento ainda não terminou, notificação "A reunião "<título>" começou e não está sendo gravada." com "Gravar" e, dentro do app, uma faixa no topo da tela (tokens de aviso, sem sombra) com o mesmo texto, "Gravar" e "Ignorar". Repete uma vez aos 10 min se continuar sem gravar e não foi ignorado. Some quando a gravação começa ou o evento acaba.
- CA8: **cancelada**: se um evento que já foi avisado (CA6) passa a `cancelled` ou some da agenda antes de acabar, notificação "A reunião "<título>" das <hora> foi cancelada." e a faixa do CA7 (se houver) some. Se a pessoa está gravando com o título desse evento, a notificação diz "…foi cancelada. A gravação continua." (nunca para sozinha).
- CA9: dados da agenda na reunião: ao começar a gravar, se há um evento-reunião que começa em até 10 min ou está acontecendo (o mais próximo do agora; empate: o que tem link de chamada), a gravação usa o título do evento e a reunião salva ganha `calendar: { provider, eventId, title, start, end, attendees, joinUrl } | null` (`meetings.json` antigo carrega com `null`). A lista (contrato 10) mostra os participantes; o detalhe mostra "Da agenda: <provedor> · <hora>" e os participantes. O resumo (contrato 08) recebe os nomes dos participantes na instrução para preencher melhor o "Quem" (sem inventar: só nomes da lista ou ditos na conversa). Testes.
- CA10: tela de Reuniões ganha no topo a seção "Próximas" (até 3 eventos-reunião das próximas 24 h: hora, título, participantes, link "Entrar na chamada" que abre o `joinUrl` no navegador só se for `https://`, e "Gravar"). Some sem contas ou sem eventos.
- CA11: rede nova só no main via `net.fetch`: `login.microsoftonline.com` (navegador e token), `graph.microsoft.com`, `www.googleapis.com/calendar/v3`. Tokens e dados da agenda nunca em log nem no smoke report. A CSP do renderer não muda. `joinUrl` só abre com `shell.openExternal` se for `https://`.
- CA12: smoke com Google e Microsoft falsos: dois eventos (um começando em 5 min, um em andamento sem gravação, um cancelado depois de avisado); confere as notificações (substituto de `Notification` que registra), a faixa "não está sendo gravada", "Gravar" começando a gravação com o título do evento, `calendar` salvo na reunião, a seção "Próximas"; PNGs `reunioes-proximas-light.png`, `gravacao-faixa-agenda-light.png`, `configuracoes-agenda-light.png`. `externalRequests: []`.

## Invariantes
- Contratos 01 a 11 continuam passando. Sem contas, nada de pedido de rede novo e nada de aviso.
- Nenhum e-mail, convite ou mensagem é enviado a ninguém: o app **só lê** as agendas (regra do Andrew: nunca enviar nada a terceiros).
- `prova/` e `docs/` não mudam.

## Fora de escopo
- Criar ou editar eventos, responder convites, entrar na chamada sozinho, gravar sozinho sem clique, outras agendas (iCloud, CalDAV), várias contas do mesmo provedor.

## Gates
- `gates.sh` (smoke à mão com `--no-sandbox`) e `scripts/pack.sh`.

## Telas de impacto no usuário
- Configurações: Microsoft no bloco "Contas"; bloco "Agenda".
- Notificações do macOS: reunião em 5 min, reunião sem gravar, reunião cancelada.
- Faixa no topo do app quando a reunião começou e não está gravando.
- Reuniões: seção "Próximas"; participantes da agenda na lista e no detalhe.

## Notas do coordenador
- Notificações com botão no macOS dependem da assinatura do app; com a assinatura ad-hoc, o botão pode não aparecer. Nesse caso o clique na notificação faz o mesmo que "Gravar". Relatar o que se viu.
- Nada de commit.
