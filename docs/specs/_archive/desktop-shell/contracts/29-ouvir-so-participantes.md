# Contrato 29 — Botão "Ouvir só os participantes" (gravar sem o microfone)
Feature: desktop-shell · Wave: 29 · Depende de: 04 (captura), 03 (transcrição), 19 (gravação) · Pedido do Andrew (18/11/2026 11:12: "preciso que tenha um botao, ouvir apenas cliente")

## Problema
Em reunião que o Andrew só assiste (treinamento, apresentação de cliente), o microfone dele capta ruído da sala
e vira transcrição "Você" inútil. Ele quer um botão para ouvir só o lado de lá.

## Pré-condições (fatos do código, conferidos em 18/11/2026 — árvore com contratos 27/28 não commitados; não tocar nos arquivos do Meet)
- Captura `apps/desktop/src/renderer/src/audio/capture.ts`: `SOURCES=['mic','system']` fixo (:83); `start()` abre as duas fontes (:140-151, mic via `askMic`/`getUserMedia` :203-219); `CaptureState {phase, mic, system, failure, silence, heard, devices}` (:52-62), `SourceStatus='idle'|'starting'|'live'|'failed'|'ended'` (:48); pause/resume são globais (:153-164); não existe desligar uma fonte; `onBlock` (:283-293) alimenta silêncio/heard e, se não pausado, medidor+framer; `release` é só do stop (:320-327); `TrackLike` (:12-17) não expõe `enabled`.
- .m4a: mixagem no renderer, `audio/mixer.ts:9-32` (`createMixedRecorder`), cada fonte entra por `onStream` (`capture.ts:276` → `recordingStore.ts:358`); os nós ficam num array sem chave por fonte (`mixer.ts:16,24-25`).
- AssemblyAI `transcription/sink.ts`: um WebSocket por fonte, `start(sources)` (:137-155) recebe `['mic','system']` fixo de `recordingStore.ts:382` (na prática só fontes não-failed, :436-438); sem quadros a API pode fechar por inatividade → `scheduleReconnect` (:339-354, 4 tentativas → `failed` + aviso); `retry(source)` (:204-212) já trata uma fonte só; pause/resume valem para todas (:179-201).
- `Meeting.sources {mic,system}` vem de `heard` no stop (`capture.ts:180`, `recordingStore.ts:607,679`); rótulos em `SourceDots.tsx:4-10` ("Só participantes" já existe).
- UI: `ControlBar.tsx` — ordem Pausar | Anotações | Analisar | … (:46-104); `BarButton` com `pressed`/`aria-pressed`, `title`, `iconOnly` (:114-148); barra apertada em 1120px (Bloquear já é iconOnly por isso, :127). Medidor: `LevelTape.tsx` (níveis de `takeLevels`, `capture.ts:187-197`; fonte não-live → tracejado "sem sinal"); avisos de mic em `noticeRules.ts` (mic `failed` → "Nenhum microfone…"); eco em `transcription/echo.ts` (sem mic, nada quebra).
- Settings de áudio: `micDeviceId`, `echoCancellation` (`settings-defaults.ts:49-80`), seção "Áudio" em `SettingsScreen.tsx:307-318`.

## Critérios de aceite

### CA1 — Alternador por fonte na captura
- `CaptureSession` ganha `setMicEnabled(enabled: boolean)` (ou equivalente por fonte): desligado, as trilhas do mic ficam `enabled=false` E um flag `micOff` faz `onBlock` descartar os quadros do mic (nada vai a medidor, framer, detector de silêncio ou `heard`). Religar volta tudo sem novo `getUserMedia` (as trilhas continuam vivas). `CaptureState` expõe o estado (ex.: `micOff: boolean`) — é um estado próprio, NÃO é `failed` nem `ended`.
- O .m4a fica sem a voz do usuário no período desligado (trilha `enabled=false` já entrega silêncio ao mixer; aceitável manter o nó ligado). `heard.mic` não liga por período desligado; se o mic nunca foi ouvido, a reunião sai "Só participantes" (`SourceDots`) sem mudança extra.

### CA2 — Transcrição sem socket pendurado
- Mic desligado: a sessão AssemblyAI do mic é ENCERRADA de propósito (sem reconexão, sem aviso de falha em `TranscriptionNotices`); religado: reabre (padrão do `retry(source)`). Nenhum trecho "Você" nasce no período desligado. O sink ganha a operação por fonte que isso exigir; pause/resume globais continuam como são.

### CA3 — Botão na ControlBar
- `BarButton` `iconOnly` logo após "Pausar": ícone `Mic` (ligado) / `MicOff` (desligado), `title` "Ouvir só os participantes" / "Voltar a me ouvir", `pressed` quando desligado, marcado `data-action="mic-off"`. Cabe em 1120px. Dark ok.
- Estado por gravação (começa sempre ligado; não persiste em settings). Funciona também pausado (o estado vale ao retomar).
- No medidor, a fita "Você" mostra o estado desligado de forma própria (ex.: rótulo "mic desligado", sem o tracejado de "sem sinal" e SEM os avisos de `noticeRules` de mic ausente/bloqueado).

### CA4 — Segurança e invariantes
- Nada de rede nova; nenhum canal IPC novo (tudo no renderer). `prova/` não muda. Contratos 01–28 continuam passando. Não tocar em `extensions/`, `src/main/meet/`, `meetStore.ts`.

### CA5 — Testes e smoke
- Vitest: captura — desligar descarta quadros do mic e não marca `heard`; religar volta a entregar; estado não vira `failed`. Sink — desligar fecha só o socket do mic sem aviso; religar reabre. Store — fluxo liga/desliga não dispara aviso de mic.
- Smoke: na gravação curta existente, clicar `[data-action="mic-off"]` → `aria-pressed=true`, fita "Você" no estado desligado, sem aviso de mic; clicar de novo → volta. Sem PNG novo obrigatório.

## Fora de escopo
- Escolher antes de começar (o clique já grava); persistir em Configurações; desligar o áudio do sistema; atalho de teclado.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Tela de gravação: botão novo de microfone na barra; fita "Você" com estado "mic desligado".

## Notas do coordenador
- NÃO commitar. NÃO editar nada enquanto o `pnpm dev` do Andrew estiver com gravação ao vivo (editar `src/**` reinicia/recarrega o app e mata a gravação) — confirmar com o coordenador antes de começar.
