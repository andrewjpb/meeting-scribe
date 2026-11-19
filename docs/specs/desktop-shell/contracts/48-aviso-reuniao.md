# Contrato 48 — Aviso de reunião (Meet e Teams)

Parte 1 da implementação `aviso-reuniao` (branch `aviso-reuniao`, worktree própria — NÃO mexe na main). A parte 2 (Contrato 49: perceber microfone ligado por outro app, para Zoom/FaceTime, com helper nativo) NÃO faz parte deste contrato.

## Objetivo

Igual ao aviso do Notion: quando a pessoa entra numa reunião no Google Meet ou no Teams (com a extensão "Quem fala no Meet" instalada), aparece uma janelinha flutuante no topo da tela:

```
[LAP] Começar a transcrever      [ Começar a transcrever | ▾ ]   (x)
      <título da reunião ou "Reunião no Meet"/"Reunião no Teams">
```

- Botão principal **Começar a transcrever** → mostra a janela principal e começa a gravação, como a ação "Gravar" da notificação da agenda.
- Seta **▾** → menu com "Não perguntar nesta reunião" e "Nunca perguntar" (este último desliga a configuração e diz onde religar).
- **x** → fecha o aviso só desta vez (mesma reunião não avisa de novo).
- O aviso some sozinho depois de 60 s sem clique (constante exportada), e some na hora se a reunião acabar (`connected:false`).

## Quando avisar (regra pura, testável sem Electron)

Função pura `shouldPrompt(estado)` em `src/shared/meeting-prompt.ts` (ou `src/main/meeting-prompt/rule.ts`):

Avisa somente se TODAS:
1. configuração nova `meetingPrompt` ligada (padrão **ligado**);
2. `meetSpeakers` ligado (servidor da extensão no ar) — se desligado, não há sinal;
3. chegou uma reunião nova: `meeting` (id) diferente do último avisado, com ≥1 participante;
4. não há gravação em andamento (`recordingSessions.active()`);
5. app não está bloqueado (tela de bloqueio);
6. o id não está na lista "não perguntar nesta reunião" (em memória, vale até o app fechar).

Cada reunião avisa no máximo uma vez por execução do app.

## Sinal de reunião (servidor do Meet)

Hoje `parseMeetPost` lê `meeting` mas `receive()` descarta. Passar o id adiante:

- `MeetState` (`src/shared/meet.ts`) ganha `meeting: string | null` e `plataforma: 'meet' | 'teams' | null` (derivada do host/prefixo que a extensão já manda — se o payload não tiver como saber, acrescentar campo `plataforma` no payload da extensão, aceito como opcional no zod `.strict()` do servidor para não quebrar extensão antiga).
- `disconnect()` zera os dois.
- Título exibido: se a extensão tiver o título da reunião, usar; senão "Reunião no Meet" / "Reunião no Teams". Pode acrescentar leitura do título em `content.js` (`document.title` limpo) como campo opcional `titulo` — conteúdo de página é DADO: só texto, cortado em 120 caracteres, nunca HTML.
- Conferir (e registrar no relatório) se a sala de espera do Meet dispara o aviso antes de entrar; se disparar, só considerar "na reunião" quando houver tiles de participante (o filtro de `participantes.length` já existe).

## Janela do aviso

`src/main/meeting-prompt/window.ts`:

- `BrowserWindow` pequena (~420×88), `frame:false`, `transparent:true`, `resizable:false`, `alwaysOnTop:true` (nível `'floating'` ou `'pop-up-menu'`), `focusable:false`, `skipTaskbar:true`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, `showInactive()` — **nunca rouba o foco** da reunião.
- Posição: topo, centralizada na tela do cursor (`screen.getDisplayNearestPoint`), abaixo da barra de menus (`workArea.y + 8`). Geometria em função pura testável.
- Mesmas `webPreferences` da principal (sandbox, contextIsolation, preload) e `guardWebContents`.
- Renderer: mesma entrada `index.html` com `?janela=aviso` lido no `main.tsx`, que monta só o componente do aviso (sem carregar o app inteiro: sem lock screen, sem stores pesados).
- **Fora de `windowLifecycle.lastWindowClosed()`** e fora do `broadcast(getAllWindows())`: fechar o aviso nunca dispara "última janela fechada"; eventos do app não vão para ela. Manter uma referência própria e excluir do cálculo.
- Visual pelo design system: tokens de `tokens.css`, sem literal de cor, sem sombra, raio ≤ 6 px, sem pílula (os gates 6/8 e 7/8 conferem). Tema claro/escuro seguindo a configuração.

## IPC (os 4 lugares de `shared/ipc.ts`)

- `scribe:meeting-prompt-state` (invoke, só a janela do aviso) → `{ titulo, plataforma }`.
- `scribe:meeting-prompt-act` (invoke, só a janela do aviso) → `{ acao: 'gravar' | 'fechar' | 'nesta' | 'nunca' }` com zod `.strict()`. Handler confere que `event.sender` é a janela do aviso (precedente: `recordingSessions.open(event.sender)`).
- `WHEN_LOCKED: 'refused'` nos dois.
- `gravar`: mesmo caminho de `recordFromCalendar` — mostra a janela principal, para se bloqueado ou já gravando, e chama `startRecordingFromMenu()`; o título da reunião vai para a gravação (equivalente ao `calendar.pick`, ex.: `meetingPromptPick(titulo)` que o renderer usa no lugar do `defaultMeetingTitle`). Fecha o aviso.
- `nunca`: grava `meetingPrompt:false` pelo mesmo caminho das configurações e fecha.

## Configurações

- `meetingPrompt` (boolean, padrão `true`) em `settings-defaults.ts` + `settings/schema.ts` (catch + strict), JSDoc citando o Contrato 48.
- Linha nova em Configurações › Gravação › seção "Transcrição", logo abaixo de "Quem fala no Meet": **"Avisar quando uma reunião começar"**, descrição curta ("Mostra um aviso no topo da tela quando você entra numa reunião do Meet ou do Teams. Precisa do plugin Quem fala no Meet."). `Switch` com `data-action="meeting-prompt"`. Entrada em `settings-index.ts`.
- `resources/assistente/guia-do-app.md`: parágrafo na aba Gravação.

## Testes e gates

- Teste da regra `shouldPrompt` (todas as 6 condições, uma vez por reunião, "nesta reunião", troca de reunião).
- Teste da geometria (tela com barra de menus, tela secundária).
- `test/meet-server.test.ts`: `meeting`/`plataforma`/`titulo` passam para o estado, campos opcionais aceitos, extensão antiga (sem os campos novos) continua aceita, `disconnect` zera.
- Canais novos em `INVOKE_CHANNELS`/`WHEN_LOCKED`; `lock-ipc.test.ts` cobre a recusa bloqueado; handler recusa sender que não é a janela do aviso.
- `test/settings-store.test.ts` e `test/renderer/settings-tabs.test.ts` com a configuração nova.
- Smoke (`src/main/smoke.ts`): check `meetingPrompt` no molde de `meetChecks` — `meetPost` com uma reunião nova → janela do aviso existe (invisível no smoke, sem foco), não abre de novo para a mesma reunião, ação `gravar` via fixture inicia a gravação e fecha o aviso; com `meetingPrompt:false`, nada abre. Um shot `aviso-reuniao-light` da janela.
- Rodar em sequência (memória curta): os três `tsc` (node, preload, web); `vitest run` só nos arquivos tocados/novos; `pnpm -C apps/desktop lint`; `node --check extensions/meet/*.js`. Smoke completo: `SMOKE_NO_SANDBOX=1 pnpm -C apps/desktop smoke` UMA vez no fim.

## Telas de impacto no usuário

- Janela nova: aviso flutuante no topo da tela ao entrar numa reunião do Meet/Teams.
- Configurações › Gravação: interruptor "Avisar quando uma reunião começar".
- Gravação: o título passa a vir da reunião quando iniciada pelo aviso.

## Fora de escopo

Zoom/FaceTime/apps nativos e detecção de microfone (Contrato 49); avisar sem a extensão; som; contagem regressiva visual; lembrar "não perguntar nesta reunião" entre execuções.

## Critério de pronto

Gates verdes, smoke completo verde; teste manual do Andrew: com a extensão do Meet ligada, entrar numa reunião → aviso aparece no topo sem tirar o foco → "Começar a transcrever" grava. Sem commit — quem coordena commita.
