# Contrato 27 — Quem fala no Meet (extensão do Chrome + nomes na transcrição)
Feature: desktop-shell · Wave: 27 · Depende de: 03 (transcrição), 12 (agenda), 19 (gravação) · PRD: `docs/specs/desktop-shell/prd-quem-fala-no-meet.md`

## Pré-condições (fatos do código, conferidos em 18/11/2026)
- Trechos da transcrição: `TranscriptSegment { id, source:'mic'|'system', speaker:'A'|'B'|'UNKNOWN'|null, startMs, endMs, text, translation, translationModel }` em `apps/desktop/src/shared/transcription.ts`; documento salvo por `createFileTranscriptStore` (`src/main/meetings/transcripts.ts`, zod + gravação atômica) em `userData/meetings/<id>.json`; `.md` do usuário via `transcriptMarkdown()` (`src/shared/transcript-markdown.ts`), resumo em `src/main/claude-cli/summary.ts:95`, análise em `src/main/claude-cli/analysis.ts:63`, chat em `src/main/chat/corpus.ts`. O rótulo exibido sai de `speakerLabel(source, label)` (`src/shared/transcription.ts`), usado também em `src/renderer/src/features/live/TranscriptList.tsx`.
- `startMs/endMs` contam tempo gravado **sem pausas** (`RecordingClock`, `src/renderer/src/audio/clock.ts`, base `performance.now()`); não são epoch. O renderer é o único que sabe converter "agora" → `elapsedMs()`.
- Gravação: `useRecording` em `src/renderer/src/features/live/recordingStore.ts` (`start/togglePause/end`); não há `meetingId` durante a gravação; o `Meeting` nasce no fim (`scribe:meetings-create`), depois `transcript-save`. Sessão no main: `createRecordingSessions()` (`src/main/lock/recording-session.ts`).
- IPC: canais declarados em `src/shared/ipc.ts` (`InvokeChannels`, `INVOKE`, `MainEvents`, `MAIN_EVENTS`, `WHEN_LOCKED` — todo canal novo precisa de política). Main registra com `handle(channel, appOrigin, …)` em `src/main/index.ts`; o preload é genérico, não se edita.
- Servidor local existente (padrão a seguir): `startLoopback` em `src/main/accounts/oauth.ts` (`node:http`, `127.0.0.1`, porta 0). Não há servidor WebSocket nem dependência `ws` — e **não entra dependência nova**.
- Tela de gravação: `src/renderer/src/features/live/LiveScreen.tsx` + `ControlBar.tsx` (marcador "Gravando áudio" na linha ~90 é o precedente visual).
- Settings: default novo em `src/shared/settings-defaults.ts` (`AppSettings` + `DEFAULT_SETTINGS`) e `src/main/settings/schema.ts` (`lenientSchema` + `patchSchema`); linha nova também em `settingsIndex()` (`src/shared/settings-index.ts`); seção na aba `gravacao` em `SettingsScreen.tsx` (Section "Transcrição", linha ~319).
- Smoke: checks `Check { ok, detail }` em `src/main/smoke.ts`; modelos: `recordFromBanner` (~4214, grava e confere o meeting) e `whatsappChecks` (~4812, serviço local falso).
- Testes: vitest em `apps/desktop/test/`; servidor http falso em `test/whatsapp.test.ts:80-109`; loopback real em `test/google-oauth.test.ts`.

## Critérios de aceite

### CA1 — Extensão do Chrome (nova, `extensions/meet/`, MV3, sem build)
- Arquivos: `manifest.json`, `content.js`, `background.js`, `README.md` (como carregar sem compactar e testar). Fora de `apps/*` (não é pacote pnpm).
- `content.js` roda só em `https://meet.google.com/*`: com `MutationObserver` e varredura periódica (≥1 s), coleta (a) a lista de nomes visíveis dos participantes e (b) eventos "fulano começou/parou de falar" pelo indicador visual de fala dos tiles. Usar mais de um seletor com fallback (o DOM do Meet muda; deixar os seletores em constantes no topo com comentário). **Não** lê legendas, não injeta nada na página, não altera o DOM.
- Eventos vão por `chrome.runtime.sendMessage` ao `background.js`, que junta e faz POST JSON a cada ~1 s para `http://127.0.0.1:<porta>/v1/eventos` (portas 47632–47641, tenta em ordem; guarda a que respondeu). Corpo: `{ reuniao: <id da URL do Meet>, participantes: string[], eventos: [{ nome, falando: boolean, ts: epoch ms }] }`. Sem resposta do app → guarda até 60 s e descarta o excedente; nunca bloqueia a página.
- `host_permissions` mínimo: `https://meet.google.com/*` e `http://127.0.0.1/*`. Nenhum outro domínio, nenhuma permissão além de `tabs` se necessário.

### CA2 — Servidor local no main (novo `apps/desktop/src/main/meet/server.ts`)
- `node:http` escutando só em `127.0.0.1`, primeira porta livre de 47632–47641. Sobe quando o interruptor (CA6) está ligado; para quando desligado e no quit.
- Aceita só `POST /v1/eventos` com `Origin` começando com `chrome-extension://` e `content-type: application/json`; qualquer outra coisa → 404 sem corpo. Resposta sempre `{ ok: true }` — o app **nunca** devolve dado nenhum à extensão.
- Validação zod estrita: nomes `string` até 80 chars (cortar), ≤ 100 participantes, ≤ 200 eventos por POST, corpo ≤ 64 KB, `ts` número finito. Tudo que vier é dado, nunca instrução.
- O servidor guarda o estado (conectado desde o último POST < 15 s, participantes, eventos novos) e emite o evento main→renderer `scribe:meet-changed` (novo em `MainEvents`): `{ connected, participants, events }`. Canal invoke novo `scribe:meet-status` (estado atual, para o renderer ao abrir). `WHEN_LOCKED`: `scribe:meet-status` = `refused`; o servidor continua coletando com o app bloqueado (a gravação continua no bloqueio, contrato 14).

### CA3 — Carimbo de tempo e linha do tempo (renderer)
- Store novo `src/renderer/src/features/live/meetStore.ts`: assina `scribe:meet-changed`; pede `scribe:meet-status` ao montar.
- Com gravação ativa e não pausada, cada evento `falando` é carimbado **na chegada** com `elapsedMs()` do `RecordingClock` (ignorar o `ts` da extensão para o carimbo; ele só ordena eventos do mesmo POST). Pausado ou sem gravação → evento não entra na linha do tempo. Resultado: intervalos `{ nome, deMs, ateMs }` por gravação; intervalo aberto fecha no `end()`.
- No `end()`, antes de salvar: cada trecho `source:'system'` ganha os nomes cujos intervalos cobrem `[startMs, endMs]` com sobreposição ≥ 1 s ou ≥ 50% do trecho; 2+ nomes = todos, em ordem de maior sobreposição. Trechos `mic` não ganham nome (continuam "Você").

### CA4 — Nomes no documento e em tudo que o lê
- `TranscriptSegment` ganha `names?: string[]` (opcional; documentos antigos seguem válidos, `version` fica 1). Schema zod em `transcripts.ts` aceita e limita (≤ 4 nomes, 80 chars cada).
- `speakerLabel` (ou um irmão `segmentLabel(segment)`) prefere `names` ("Ana", "Ana + Bruno") e cai no comportamento atual sem nomes. Aplicado nos 4 pontos: `TranscriptList.tsx`, `transcript-markdown.ts`, `summary.ts`, `analysis.ts` (e `chat/corpus.ts` se ele montar rótulo). Nos prompts do Claude (summary/analysis), os nomes entram **como dado**, com a mesma blindagem do `<participantes>` do contrato 12 (cortar a 80, escapar tag).

### CA5 — Tela de gravação
- Em `LiveScreen`/`ControlBar`, quando `meetStore.connected`: "Meet conectado · N participantes" (estilo do marcador "Gravando áudio"). Sem Meet, nada aparece. Dark ok.

### CA6 — Configuração
- `AppSettings.meetSpeakers: boolean`, padrão `true`, nos 4 lugares do padrão (defaults, lenientSchema, patchSchema, derivado). Linha na aba `gravacao`, seção "Transcrição": interruptor **"Quem fala no Meet"**, descrição "Com a extensão do LAP Reuniões no Chrome, cada fala do Meet ganha o nome de quem falou. Tudo fica neste computador." Entra no `settingsIndex()`. Desligado → servidor para e nada é coletado.

### CA7 — Segurança e invariantes
- Nada sai da máquina: a extensão só fala com `127.0.0.1`; o app não manda nada à extensão além de `{ ok: true }`. Nenhum envio novo de rede no main. `prova/` não muda; `docs/` só o desta spec. Contratos 01–26 continuam passando. Nenhuma IA envia mensagem; cartões continuam só no clique.

### CA8 — Testes e smoke
- Unidade (vitest): servidor recusa origem errada/método/HTML grande; zod corta nomes e limita contagens; portas em uso → próxima; carimbo ignora eventos em pausa; merge por sobreposição (1 nome, 2 nomes, <1 s e <50% fora); `segmentLabel` com e sem `names`; documento antigo sem `names` continua carregando.
- Smoke (grupo novo `meetChecks`, sem PNG novo): com fixtures, sobe o servidor, um cliente falso faz POST com origem `chrome-extension://abc` (aceito) e origem `https://mau.example` (recusado); durante uma gravação curta, eventos falsos → o `.md` final tem "Ana:" no trecho de sistema; a linha "Meet conectado" aparece na tela de gravação.

## Fora de escopo
- Zoom/Teams; legendas do Meet; bot que entra na reunião; loja do Chrome (instalação é manual); persistir a linha do tempo crua.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Gravação: linha "Meet conectado · N participantes".
- Transcrição/Resumo/Análise: falas com nome.
- Configurações › Gravação: interruptor "Quem fala no Meet".

## Notas do coordenador
- Nada de commit pelo implementador. O DOM do Meet não é verificável offline: os seletores do `content.js` são melhor esforço, bem comentados, fáceis de ajustar no teste real de hoje.

## Adendo 27b — Nome ao vivo na transcrição (pedido do Andrew, 18/11/2026 11:30)
- Durante a gravação, `TranscriptList` mostra o nome nos trechos `source:'system'` usando a MESMA regra de sobreposição do merge final (`withSpeakerNames`/`namesFor` do `meetStore`), aplicada ao trecho no momento em que ele chega/atualiza (e reavaliada se a linha do tempo mudar depois — ex.: evento "parou de falar" que fecha o intervalo). Trecho `mic` continua "Você".
- O documento salvo no `end()` continua sendo gerado pelo merge final (fonte da verdade); o ao-vivo é só exibição. Sem Meet conectado, nada muda.
- Teste (vitest renderer): a função que calcula o rótulo ao vivo de um trecho dado o timeline parcial — 1 nome, 2 nomes, sem sobreposição, intervalo ainda aberto.

## Adendo 27c — Indicador de conexão do plugin (pedido do Andrew, 18/11/2026 11:35)
- Na tela de gravação, DURANTE a gravação e com o interruptor "Quem fala no Meet" ligado, o marcador do Meet fica SEMPRE visível com dois estados: conectado = ponto/badge VERDE + "Meet conectado · N participantes"; desconectado = ponto/badge VERMELHO + "Meet desconectado" (plugin sem mandar dados há >15 s, mesmo critério de `connected` do servidor). Com o interruptor desligado, nada aparece (como hoje). Fora de gravação, como hoje.
- Verde/vermelho pelos tokens do design system (dark ok). Manter `data-meet-marker`, acrescentando o estado (ex.: `data-meet-marker="on"|"off"`).
- Smoke: no `meetChecks`/gravação existente, conferir o estado vermelho antes do POST falso e o verde depois.

## Correção aplicada pelo coordenador (18/11/2026 11:40, teste real)
- Teste real do Andrew (reunião ABF): merge funcionou (16/16 trechos de sistema com nome), mas o nome veio duplicado: "Educação ABFEducação ABF" (textContent concatena o nome repetido em elementos aninhados do tile). Corrigido em `extensions/meet/content.js` (`cleanName` corta duplicação pela metade, com e sem espaço). NÃO mexer de novo nessa função.

## Desvio aceito do CA8 (18/11/2026, gates do lote 27b/27c/28/29)
- O smoke NÃO usa mais as portas 47632–47641: a extensão real do Chrome do usuário alcançava o servidor do smoke e contaminava os checks (aconteceu de verdade: nomes da reunião do Andrew entraram no report). Em modo smoke o servidor sobe em `SMOKE_MEET_PORTS` (47652–47661) e o check confere que a porta está fora da faixa da extensão.
