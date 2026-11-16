# Contrato 02 — Captura, gravação ao vivo e reuniões locais
Feature: desktop-shell  ·  Wave: 2  ·  Depende de: 01

## Pré-condições
- Contrato 01 aceito; `apps/desktop/scripts/gates.sh` verde.
- Referência de captura já provada: `prova/main.js` e `prova/renderer/app.js` (só leitura). Resultados em `docs/fase0.md`, parte B.

## Superfície
- `apps/desktop/src/main/capture/display-media.ts` (handler), `src/main/meetings/store.ts`, registro de IPC, `src/preload/index.ts`, `src/shared/`.
- `apps/desktop/src/renderer/src/audio/`: `constraints.ts`, `capture.ts`, `pcm-worklet` (módulo do worklet), `levels.ts`, `resample.ts`, `frames.ts`, `silence.ts`, `clock.ts`.
- `apps/desktop/src/renderer/src/features/live/` (tela de gravação, fita, barra de controles, avisos, transcrição), `features/meetings/` (lista, detalhe).
- `apps/desktop/src/main/smoke.ts` (novas telas e dados de smoke).

## Critérios de aceite
- CA1: Dada `decideDisplayMedia({videoRequested, audioRequested, origin}, appOrigin)`, então devolve `{audio: 'loopback'}` só quando `videoRequested === false`, `audioRequested === true` e `origin === appOrigin`; nos demais casos devolve `null` e o handler nega o pedido. O handler é registrado com `useSystemPicker: false`. Teste unitário com pelo menos 5 casos.
- CA2: Dada `buildMicConstraints(settings)`, então devolve `{audio: {echoCancellation: settings.echoCancellation, noiseSuppression: false, autoGainControl: false, channelCount: 1}}`, com `deviceId: {exact: id}` só quando `settings.micDeviceId` não é nulo. Dada `buildSystemConstraints()`, então devolve `{video: false, audio: {restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false}}`. Testes unitários.
- CA3: Dado o resampler em `resample.ts`, quando recebe um seno de 1 kHz a 48 kHz com amplitude 0,5, então a saída a 16 kHz tem RMS dentro de ±0,5 dB da entrada; quando recebe 10 kHz, a saída fica pelo menos 40 dB abaixo. Funciona também com entrada a 44,1 kHz. Entrada estéreo vira mono pela média dos canais. Testes unitários.
- CA4: Dado `frames.ts`, quando recebe amostras a 16 kHz, então emite quadros de 100 ms com cabeçalho de 8 bytes (`versão=1`, `fonte` 0 para microfone e 1 para sistema, `seq` uint32 big-endian começando em 0 e crescendo de 1 em 1, 2 bytes reservados em zero) e carga de 3200 bytes PCM s16le. Teste unitário confere os bytes. Os quadros vão para uma interface `FrameSink`; nesta tarefa a única implementação conta quadros e descarta.
- CA5: Dado `SilenceDetector` com relógio injetado, quando o RMS é zero absoluto por 3000 ms, então o estado vira `silent`; qualquer amostra diferente de zero volta para `ok`; trilha encerrada vira `ended`. Teste unitário.
- CA6: Dado `RecordingClock` com relógio injetado, quando gravo 10 s, pauso 5 s e gravo 4 s, então `elapsedMs` é 14000. Teste unitário.
- CA7: Dado o orquestrador de captura com `getUserMedia` e `getDisplayMedia` injetados, quando `getDisplayMedia` rejeita, então o microfone segue `live` e o estado expõe `system: 'failed'`; e o inverso. Teste unitário.
- CA8: Dado um `devicechange`, então a lista de dispositivos é relida após 500 ms de debounce e nenhuma trilha é parada ou reiniciada. Teste unitário com temporizador falso.
- CA9: Dado o store de reuniões no main, quando crio, renomeio, listo e excluo, então `meetings.json` no `userData` reflete cada operação com escrita atômica, a lista vem ordenada por `startedAt` decrescente, e um arquivo corrompido resulta em lista vazia com o original preservado como `meetings.json.corrupt-<timestamp>`. Testes unitários em diretório temporário.
- CA10: Dada a tela Reuniões com registros, então mostra as linhas agrupadas por dia no formato de `design.md`. Clicar numa linha abre o detalhe. "Excluir" no detalhe pede confirmação e remove.
- CA11: Dado o clique em "Nova gravação" ou `⌘N`, então a captura das duas fontes começa a partir desse gesto, a rota vai para a gravação, o cronômetro corre e a fita desenha os níveis reais a pelo menos 30 quadros por segundo.
- CA12: Dado "Pausar" (ou barra de espaço fora de campo de texto), então cronômetro e fita param, as trilhas continuam `live` e nenhum quadro é emitido ao `FrameSink`; "Retomar" volta. Dado "Encerrar", então todas as trilhas param (`readyState === 'ended'`), os `AudioContext` fecham, o registro é salvo conforme N4 da spec e a rota vai para o detalhe.
- CA13: Dado o detector em `silent` ou `ended` na fonte do sistema, então aparece o aviso em linha com o texto de permissão e um link que abre `x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture`; o aviso some quando o estado volta a `ok`. Microfone negado mostra o aviso equivalente apontando para `Privacy_Microphone`.
- CA14: Dada a área de transcrição, então mostra "Transcrição indisponível: servidor não conectado." e o link "Ver exemplo"; ao clicar, aparece uma transcrição de exemplo em pt-BR com tradução, sob a etiqueta fixa "Exemplo", que nunca é salva.
- CA15: Dado o smoke, então gera também `gravacao-ao-vivo` (com fonte de nível sintética, só em smoke, e o exemplo aberto), `reunioes-com-dados` (3 registros semeados no `userData` temporário) e `detalhe`, nos dois temas, e `report.json` continua com `consoleErrors: []` e `externalRequests: []`.
- CA16: O implementador abriu os PNGs novos, comparou com `design.md` e listou no relatório os defeitos visuais encontrados e corrigidos.
- CA17 (achados da revisão do contrato 01, nas telas que esta tarefa já toca): (a) com reuniões na lista, o cabeçalho de Reuniões tem o botão primário "Nova gravação" com `⌘N` à direita do título; no estado vazio fica só o botão central; (b) o estado vazio fica no centro óptico da área (bloco começando por volta de 30% da altura útil), sem um vão grande entre o título e o conteúdo; (c) nas fitas (ilustração e ao vivo) a barra mais antiga nunca cai abaixo de 75% de opacidade no tema claro, para `--mic` não desbotar; (d) a tela de gravação nunca mostra um título que contradiz o corpo.
- CA18: Dadas as checagens de permissão do Chromium com `mediaType: 'unknown'` vindas da própria origem (caso de `enumerateDevices` e de rótulos de dispositivo), então a função de decisão de checagem as aceita para `media`, sem afrouxar o pedido de permissão (`decidePermission` continua exigindo só áudio). Teste unitário cobre o caso e os de outra origem.

## Invariantes
- Critérios do contrato 01 continuam passando (`gates.sh` inteiro).
- Áudio não é gravado em disco nem enviado pela rede.
- `prova/` e `docs/` não mudam.

## Fora de escopo desta tarefa
- Tela de configurações e seus controles (use os padrões N5 da spec por um módulo de padrões; o contrato 03 liga a persistência).
- Bloco de permissões da barra lateral, catálogo de modelos, backend, janela flutuante.

## Gates
- `apps/desktop/scripts/gates.sh`.
- Testes novos: CA1 a CA9.
