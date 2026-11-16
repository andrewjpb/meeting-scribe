---
titulo: Fase 0 - Verificacao de provedores ASR em streaming
data: 2026-11-12
semana_iso: 2026-W46
fonte: documentacao publica atual (AssemblyAI, OpenAI, Deepgram), consultada em 12/11/2026
---

# Fase 0 — Provedores ASR em streaming: o que a spec assume x o que a documentação diz

Legenda: **CONFIRMADO** / **NÃO CONFIRMADO** (doc não diz) / **CONTRADITO** (doc diz outra coisa).
Trechos curtos; o resto é paráfrase da página citada.

## AssemblyAI Universal Streaming v3

Fontes principais:
- API reference: https://www.assemblyai.com/docs/api-reference/streaming-api/streaming-api
- Erros/encerramentos: https://www.assemblyai.com/docs/streaming/common-session-errors-and-closures.md
- Sequência de mensagens: https://www.assemblyai.com/docs/streaming/message-sequence.md
- Diarização: https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md
- Modelos (referência p/ LLM): https://www.assemblyai.com/llms/models.md
- Preço: https://www.assemblyai.com/pricing

### 1. Formato de áudio / envio / chunk — CONFIRMADO
- Endpoint `wss://streaming.assemblyai.com/v3/ws` (há também `streaming.us.` e `streaming.eu.` para residência de dados). Auth: header `Authorization` com a API key (sem `Bearer`); no navegador, token temporário em `?token=`.
- `encoding`: `pcm_s16le` (padrão), `pcm_mulaw`, `opus`, `ogg_opus`, `aac`. `sample_rate`: inteiro 8000–96000, padrão 16000. Sem parâmetros: `universal-3-6-pro` a 16 kHz `pcm_s16le`.
- Mono: a doc recomenda uma sessão por canal para multicanal ("we recommend creating a separate session for each channel") → na prática, mono.
- Envio: **frames binários** crus (`application/octet-stream`). Base64 não é descrito.
- Chunk: entre 20 e 1000 ms (fora disso → erro 3007), recomendado **50–100 ms**. Enviar mais rápido que tempo real também gera 3007.

### 2. Parâmetros de sessão / idiomas — CONFIRMADO, com correções de nome
- `speech_model`: `universal-3-6-pro` (padrão), `universal-3-5-pro`, `universal-streaming-english`, `universal-streaming-multilingual`. O ID antigo `u3-rt-pro` (Universal-3 Pro Streaming) ainda aparece em páginas antigas, mas **não está no API reference atual**.
- Idioma: **não existe parâmetro `language`** no v3. Há `language_codes` (lista, "steering", só 3.5/3.6 Pro) e `language_detection` (bool, padrão false; adiciona `language_code` e `language_confidence` ao Turn). No 3.6 Pro a detecção automática é "built-in" e `language_code` singular é "silently ignored".
- Atenção: parâmetros desconhecidos são **ignorados sem erro**; a doc manda conferir `configuration.model` no evento `Begin`.
- Idiomas em streaming:
  - `universal-3-6-pro`: 32 idiomas, incluindo Portuguese, Japanese, Korean, Mandarin (e Cantonese separado). **pt-BR não é distinguido** (só "Portuguese").
  - `universal-streaming-multilingual`: só en, es, de, fr, pt, it → **sem ja/ko/zh**.
  - `universal-streaming-english`: só inglês.

### 3. Diarização em streaming — CONFIRMADO
- `speaker_labels=true` (+ opcional `max_speakers` 1–10, `speaker_labels_revision_interval_ms`, mínimo 120000, recomendado 300000). Suportado em `universal-3-6-pro`, `universal-streaming-english` e `-multilingual`.
- No evento: "Each Turn event includes a `speaker_label` field (e.g. `A`, `B`)" (falante dominante do turno) + `speaker_confidence`; e cada palavra **final** traz `speaker` ("only appears on words where `word_is_final: true`").
- Turnos com menos de ~1 s → `PENDING`. Fala sobreposta vai inteira para um falante; os primeiros 1–2 turnos podem sair errados.
- Correções chegam em mensagem separada `SpeakerRevision` (só o rótulo muda, texto e timestamps não); sempre uma revisão final antes do `Termination`.

### 4. Eventos (parcial x final), timestamps, confidence — CONFIRMADO (timestamp de palavra: parcial)
- Mensagens: `Begin` (`id`, `expires_at`), `SpeechStarted`, `Turn`, `SpeakerRevision`, `Heartbeat` (opcional), `Termination`, `Error`.
- `Turn`: `turn_order`, `transcript`, `end_of_turn`, `turn_is_formatted`, `end_of_turn_confidence`, `utterance` (só no fim do turno), `words[]` com `text`, `start`, `end` (ms), `confidence`, `word_is_final`.
- Parcial: `end_of_turn:false`. Final no 3.6 Pro: `end_of_turn:true` e `turn_is_formatted:true` na mesma mensagem. Em Universal-Streaming com `format_turns=true` chegam **duas** finais (sem formatação e formatada) no mesmo `turn_order`; a doc diz para tratar como completo só quando os dois flags forem true. `include_partial_turns` padrão true.
- Timestamps: `SpeechStarted.timestamp` é "relative to the beginning of the audio stream"; `start`/`end` das palavras estão em ms, e os exemplos indicam a mesma referência, mas a página **não declara isso** para palavras → tratar como "ms desde o início do áudio enviado na sessão" e validar no teste.
- Não há campo `confidence` no turno: só `end_of_turn_confidence` (confiança de fim de turno) e `confidence` por palavra.

### 5. Inatividade / duração máxima / pausa — CONFIRMADO
- `inactivity_timeout`: 5–3600 s, **sem timeout se não definido**. Erro 3006 quando expira "with no audio or messages".
- Duração máxima: **3 horas** (erro 3008, "Session exceeded 3 hour limit"; fecha ao fim do turno atual ou até 60 s depois). Token temporário pode reduzir o limite.
- Pausar sem fechar: mensagem `KeepAlive` reseta o timer de inatividade. Mas a cobrança é pelo **tempo de WebSocket aberto** (pausa custa). Há `UpdateConfiguration` (muda keyterms, idioma etc. no meio da sessão), `ForceEndpoint` e `Terminate`.

### 6. Preço — CONFIRMADO
- `universal-3-6-pro`: **US$ 0,45/h**. `universal-streaming-english` e `-multilingual`: **US$ 0,15/h**.
- Diarização: **+US$ 0,12/h**, cobrada sobre a sessão inteira ("apply to the entire session, not just speaking time").
- Keyterms incluso no 3.6 Pro e no Multilingual (+US$ 0,04/h no English).
- Portanto 3.6 Pro + diarização ≈ **US$ 0,57/h de conexão aberta**.

## OpenAI Realtime API (transcrição)

Fontes:
- Guia: https://developers.openai.com/api/docs/guides/realtime-transcription
- Referência de eventos: https://developers.openai.com/api/reference/resources/realtime/client-events
- Modelo: https://developers.openai.com/api/docs/models/gpt-live-transcribe.md
- Diarize: https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize
- Limite de sessão: https://developers.openai.com/api/docs/guides/realtime-conversations.md
- Preço: https://developers.openai.com/api/docs/pricing

### 7. Sessão só de transcrição / formato / envio — CONFIRMADO, mas modelo mudou
- Abrir: `wss://api.openai.com/v1/realtime?intent=transcription` (sem `model` na URL) e/ou `session.update` com `session.type: "transcription"`.
- Formato: `audio/pcm` → "Only a 24kHz sample rate is supported". Também `audio/pcmu` e `audio/pcma` (G.711, 8 kHz). **16 kHz PCM não é aceito** → reamostrar para 24 kHz.
- Envio: `input_audio_buffer.append` com áudio em **base64** (máx. 15 MiB por evento); `input_audio_buffer.commit` no fim de cada turno.
- Modelos aceitos no enum: `gpt-live-transcribe`, `gpt-transcribe`, `gpt-realtime-whisper`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` (+ snapshot 2025-12-15), `whisper-1`. O **guia atual recomenda `gpt-live-transcribe`** e nem menciona `gpt-4o-*-transcribe` (lançamento dos novos atribuído a 29/07/2026 por fonte de terceiros).

### 8. Eventos, VAD, diarização, timestamps — CONFIRMADO / CONTRADITO em parte
- Eventos: `conversation.item.input_audio_transcription.delta` (texto incremental) e `.completed` (final do item). Casar por `item_id`; completions de turnos diferentes **podem chegar fora de ordem**.
- VAD server-side: `turn_detection` aceita `server_vad`, `semantic_vad` ou `null`, **mas** `gpt-live-transcribe` "doesn't support `server_vad` or `semantic_vad`" (idem `gpt-realtime-whisper`) → o cliente precisa de VAD próprio e mandar `commit`. VAD server-side só vale para os modelos `gpt-4o-*`/`whisper-1`. → Se a spec assume VAD no servidor com o modelo recomendado: **CONTRADITO**.
- Diarização: **não há** em realtime. "`gpt-live-transcribe` doesn't return word-level timestamps, speaker labels, or transcription confidence scores." `gpt-4o-transcribe-diarize` só no `v1/audio/transcriptions` (Realtime "not supported"; modelo marcado como Deprecated).
- Timestamps por palavra: **não**. Confiança: só `logprobs` via `include: ["item.input_audio_transcription.logprobs"]` (modelos gpt-4o-*).
- Extras: `noise_reduction` (`near_field`/`far_field`), `prompt`, `keywords`, `languages` (no live-transcribe, plural; não mandar `language` junto), `delay` (`minimal`…`xhigh`).
- Idiomas: códigos ISO 639-1, alguns 639-3 (`cmn`, `yue`) e `zh-cn`/`zh-tw`/`zh-hk`. pt/ja/ko não aparecem listados um a um na página (NÃO CONFIRMADO explicitamente, mas são ISO 639-1 válidos e cobertos pela família Whisper/GPT-4o).
- Duração: "The maximum duration of a Realtime session is **60 minutes**" (guia de conversas; vale para Realtime em geral). Há relato de usuário (Azure) de quedas antes disso.

### 9. Preço — CONFIRMADO
| Modelo | US$/min | US$/h |
|---|---|---|
| gpt-live-transcribe | 0,017 | 1,02 |
| gpt-transcribe | 0,0045 | 0,27 |
| gpt-4o-transcribe | 0,006 | 0,36 |
| gpt-4o-mini-transcribe | 0,003 | 0,18 |
| whisper-1 | 0,006 | 0,36 |
(A página chama de "Estimated cost"; gpt-4o-* são cobrados por token de áudio, US$ 2,50/1M entrada no 4o e 1,25 no mini.)

## Bônus: Deepgram (Nova-3 / Flux) streaming

Fontes: https://developers.deepgram.com/docs/encoding · https://developers.deepgram.com/docs/diarization · https://developers.deepgram.com/docs/models-languages-overview · https://developers.deepgram.com/docs/audio-keep-alive · https://deepgram.com/pricing
- Formato: raw `linear16`, `linear32`, `mulaw`, `alaw`, `opus`, `ogg-opus` (ou containers WAV/Ogg/WebM sem `encoding`); com `encoding` é obrigatório `sample_rate`. Áudio em frames binários (SDK `send_media`).
- Interim: `interim_results`, com `is_final` e `speech_final`.
- Diarização streaming: **sim** (`diarize_model=latest`/`v1`; `diarize=true` deprecated mas funciona). `speaker` inteiro por palavra; em streaming **sem `speaker_confidence`**.
- Idiomas Nova-3: `pt`/`pt-BR`/`pt-PT`, `ja`, `ko`/`ko-KR`, `zh`/`zh-CN`/`zh-Hans`/`zh-TW` — todos.
- Inatividade: **10 s** sem áudio nem KeepAlive → NET-0001 e fecha. KeepAlive `{"type":"KeepAlive"}` em frame de texto a cada 3–5 s.
- Preço PAYG: Nova-3 mono US$ 0,0077/min (0,46/h), multi US$ 0,0092/min (0,55/h); Flux en 0,0077, multi 0,0078; diarização +US$ 0,0020/min (0,12/h).

## Tabela comparativa

| | AssemblyAI `universal-3-6-pro` | OpenAI Realtime `gpt-live-transcribe` | Deepgram Nova-3 |
|---|---|---|---|
| Formato | PCM s16le (ou mulaw/opus/aac), binário cru | PCM16 base64 em JSON (ou G.711) | linear16/opus/mulaw…, binário |
| Taxa | 8–96 kHz (padrão 16 kHz) | **só 24 kHz** (PCM) | qualquer, informar `sample_rate` |
| Chunk | 20–1000 ms (ideal 50–100) | até 15 MiB/evento | livre |
| Diarização em streaming | **Sim** (`speaker_label` por turno + `speaker` por palavra final, `SpeakerRevision`), +US$ 0,12/h | **Não** | **Sim** (`speaker` por palavra), +US$ 0,12/h |
| pt / ja / ko / zh | sim / sim / sim / sim (Mandarin); pt-BR não separado | zh explícito; pt/ja/ko via ISO 639-1 (não listados) | sim / sim / sim / sim |
| Interim | `Turn` parcial (`end_of_turn:false`) | `.delta` | `interim_results` / `is_final` |
| Timestamps | ms por palavra | **não** | por palavra |
| Confiança | por palavra | **não** (live); logprobs nos gpt-4o-* | por palavra |
| VAD/turno | servidor (turn detection) | **cliente** (live não tem server VAD) | servidor (endpointing) |
| Inatividade | configurável 5–3600 s; sem padrão; `KeepAlive` | não documentado | **10 s**; KeepAlive |
| Duração máx. | **3 h** (3008) | **60 min** | não verificado |
| Preço/h | 0,45 (+0,12 diar.) = **0,57** | **1,02** (gpt-transcribe 0,27; 4o-mini 0,18) | 0,55 multi (+0,12) = **0,67** |

## Impacto na spec

1. **AssemblyAI diariza em streaming** — a premissa se mantém. Mas a spec precisa tratar: rótulo por turno (`speaker_label`) **e** por palavra final; valor `PENDING` em turnos curtos; e a mensagem **`SpeakerRevision`**, que reescreve o falante de turnos já gravados (o armazenamento tem de permitir atualizar o speaker de um turno por `turn_order`). Definir `speaker_labels_revision_interval_ms` (≥120000) se quiser correção durante a reunião.
2. **Modelo**: usar `speech_model=universal-3-6-pro`. Universal-Streaming Multilingual **não cobre ja/ko/zh** e o ID `u3-rt-pro` está fora do reference. Validar no `Begin` (`configuration.model`), porque parâmetro errado é ignorado em silêncio.
3. **Idioma**: trocar qualquer `language=pt-BR` por `language_codes=["pt", ...]` (steering) e/ou `language_detection=true`. Não há código pt-BR em streaming; o idioma detectado vem por turno (`language_code`).
4. **Áudio**: 16 kHz PCM s16le mono em frames **binários** de 50–100 ms, ritmado em tempo real (enviar rápido demais dá 3007). Mantém 16 kHz.
5. **Reuniões longas**: limite de **3 h** por sessão → a spec precisa de rotação de sessão (abrir nova antes de `expires_at`, costurar `turn_order`/offset de tempo, já que os timestamps zeram em cada sessão).
6. **Pausa**: dá para manter aberta com `KeepAlive`, mas **se paga o tempo aberto** (diarização inclusive). Para pausas longas, fechar com `Terminate` e reabrir sai mais barato; a spec deve escolher um limiar.
7. **Timestamps**: a doc não diz explicitamente a referência dos `start`/`end` das palavras → incluir no teste de Fase 1 a validação "ms desde o primeiro byte enviado na sessão".
8. **Fallback OpenAI**: se a spec cita `gpt-4o-transcribe`/`gpt-4o-mini-transcribe` como modelo recomendado, atualizar: o guia atual recomenda `gpt-live-transcribe` (sem VAD de servidor → precisa VAD no cliente e `commit` manual). E mais: **24 kHz obrigatório** (reamostrar de 16k), **base64 em JSON**, **sem diarização, sem timestamps, sem confiança** e **60 min** por sessão. Ou seja, o OpenAI só serve como fallback "texto sem falante"; se a spec promete falantes no fallback, está CONTRADITO.
9. **Custo**: AssemblyAI 3.6 Pro + diarização ≈ US$ 0,57/h de conexão; OpenAI live ≈ US$ 1,02/h; Deepgram Nova-3 multi + diarização ≈ US$ 0,67/h. Se a spec traz outros números, atualizar.
10. **Deepgram** é a alternativa real de fallback com diarização (pt/ja/ko/zh, binário, qualquer taxa), mas fecha após **10 s sem áudio**: exige KeepAlive a cada 3–5 s durante pausas.
