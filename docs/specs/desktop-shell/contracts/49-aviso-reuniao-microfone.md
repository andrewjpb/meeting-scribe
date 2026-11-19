# Contrato 49 — Aviso de reunião em qualquer app (microfone/câmera ligados)

Parte 2 da implementação `aviso-reuniao` (branch `aviso-reuniao`). Depende do Contrato 48 já commitado (janela do aviso, regra `shouldPrompt`, IPC, configuração `meetingPrompt`).

## Objetivo

O mesmo aviso do Contrato 48 aparece quando **outro app** (Zoom, FaceTime, Slack, Teams desktop, Webex, Discord…) liga o microfone — sem precisar de extensão. O título vem do nome do app: "Reunião no Zoom".

## Binário Swift único: `lap-mic-watch`

- Fonte em `apps/desktop/native/mic-watch/main.swift` (um arquivo, sem pacote, sem dependências além dos frameworks do sistema: CoreAudio, CoreMediaIO, AppKit só se preciso para nome do app).
- Compilado no `pack.sh` com `swiftc -O -target arm64-apple-macos14.4` para `resources/bin/lap-mic-watch`, assinado junto com o app (mesma identidade/entitlements do `pack.sh`; conferir no fim do pack como as outras checagens "… ok"). Em dev, o main compila sob demanda para `out/` ou usa o mesmo comando se o binário não existir (`swiftc` ausente → recurso desligado, log claro, sem erro para o usuário).
- Não grava nada e não pede permissão de microfone: só observa estado.
- Detecção:
  - microfone em uso: `kAudioDevicePropertyDeviceIsRunningSomewhere` no dispositivo de entrada padrão, com listener (e listener de troca do dispositivo padrão);
  - qual app: `kAudioHardwarePropertyProcessObjectList` + `kAudioProcessPropertyIsRunningInput` + `kAudioProcessPropertyBundleID` (macOS 14.4+);
  - câmera (opcional, só informativa): `kCMIODevicePropertyDeviceIsRunningSomewhere`.
- Protocolo: uma linha JSON por mudança no `stdout`, ex.: `{"v":1,"mic":true,"apps":["us.zoom.xos"],"camera":false}`; linha inicial com o estado atual; sai sozinho quando o `stdin` fecha (o app morreu). Sem argumentos além de `--version`.

## Lado do app

- `src/main/mic-watch/process.ts` no molde de `src/main/whatsapp/process.ts`: `spawn` com stdio em pipe, parse de linha com zod `.strict()`, reinício com recuo exponencial se morrer (máx. 5 tentativas), parar no `will-quit`.
- Sobe só se `meetingPrompt` ligado (liga/desliga em `applySettings`).
- **Filtro de apps**: o próprio LAP Reuniões e os navegadores (Chrome, Edge, Safari, Arc, Brave `com.brave.Browser`, Firefox `org.mozilla.firefox`, Opera `com.operasoftware.Opera`, Vivaldi `com.vivaldi.Vivaldi` e Dia `company.thebrowser.dia`, todos por prefixo do bundle id, que pega os processos auxiliares) ficam de fora (o navegador é coberto pela extensão do Contrato 48; sem extensão, o navegador NÃO avisa — evita aviso a cada vídeo/áudio do site). Lista de navegadores e mapa `bundleId → nome amigável` ("us.zoom.xos" → "Zoom", "com.apple.FaceTime" → "FaceTime", "com.microsoft.teams2" → "Teams", "com.tinyspeck.slackmacgap" → "Slack", "com.cisco.webexmeetingsapp" → "Webex", "com.hnc.Discord" → "Discord"; desconhecido → nome do app pelo `NSWorkspace`/bundle, ou "outro app").
- Regra: estende `shouldPrompt` com a fonte `{ tipo: 'app', bundleId }`. Chave de "uma vez por reunião" = bundleId + início da sessão de microfone (desligou e ligou de novo depois de 2 min = reunião nova; constante exportada). Microfone precisa ficar ligado ≥ 3 s antes de avisar (evita ditado/áudio curto; constante exportada). Gravação em andamento, bloqueio e "não perguntar nesta reunião" valem igual.
- Se a extensão do Meet/Teams e o microfone de um navegador acontecerem juntos, vale só o aviso da extensão (já filtrado acima).

## Configurações

- A linha "Avisar quando uma reunião começar" (Contrato 48) muda a descrição: "Mostra um aviso no topo da tela quando você entra numa reunião: Meet e Teams no navegador (com o plugin) ou apps como Zoom e FaceTime."
- Nada de interruptor novo.

## Testes e gates

- Parse do protocolo (linhas válidas, inválidas, campos a mais recusados).
- Regra com fonte `app`: 3 s mínimos, 2 min para reunião nova, navegadores e o próprio app ignorados, nome amigável.
- Processo: reinício com recuo usando um binário falso (`test/fixtures/fake-mic-watch.mjs` que imprime linhas), parada no fechamento.
- Smoke: usar o fake no lugar do binário (como os outros fakes), emitir `mic:true` do Zoom → aviso abre com "Reunião no Zoom".
- `pack.sh`: compila, assina, confere que `resources/bin/lap-mic-watch --version` roda.
- Rodar em sequência: três `tsc`; `vitest run` nos arquivos tocados; lint; `swiftc -typecheck native/mic-watch/main.swift`; smoke completo uma vez no fim com `SMOKE_NO_SANDBOX=1`.

## Telas de impacto no usuário

- O aviso do Contrato 48 passa a aparecer também para Zoom, FaceTime e afins.
- Descrição da linha em Configurações › Gravação muda.

## Fora de escopo

Avisar por microfone de navegador sem extensão; detectar áudio do sistema; Intel (x86_64).

## Critério de pronto

Gates e smoke verdes; teste manual do Andrew: abrir o FaceTime ou o Zoom e ligar o microfone → aviso "Reunião no FaceTime" no topo. Sem commit — quem coordena commita.
