# Fase 0 — Prova técnica

Registro das provas que a spec (`docs/specs/meeting-scribe/spec-meeting-scribe-v1.2.md`, seção 11, item 0) exige antes de qualquer outra fase. Cada item tem veredito, fonte e o que mudou na spec. Pesquisas completas em `docs/fase0/`.

Data: 13/11/2026 (semana ISO 2026-W46).

## Parte A — Documentação (feita)

### A1. Electron e Core Audio Tap (`docs/fase0/fase0-electron-catap.md`)

| Pergunta | Veredito |
|---|---|
| A feature `MacCatapLoopbackAudioForScreenShare` existe no Chromium? | Confirmado. Entrou no M140 desligada, ligada por padrão no M142, **removida no M155**. No Chromium 156 (Electron 45) o Core Audio Tap é o único caminho no macOS 14.2+; a flag não faz nada. |
| Que tap o Chromium cria? | Global, privado, só da saída padrão, sem mutar. `restrictOwnAudio:true` exclui o próprio app (`loopbackWithoutChrome`). |
| Versão do Electron | Mínimo 39 (Chromium 142). **Escolhido: 45.3.2** (Chromium 156), estável em 12/11/2026. |
| API do Electron | `session.setDisplayMediaRequestHandler((req, cb) => cb({audio:'loopback'}), {useSystemPicker:false})` quando `!req.videoRequested && req.audioRequested`. Renderer: `getDisplayMedia({video:false, audio:{restrictOwnAudio:true}})`. A `session.md` do 45 ainda diz "só Windows"; a `desktop-capturer.md` já documenta macOS 14.2+. |
| Permissão | Só `NSAudioCaptureUsageDescription` e a permissão "Gravação de Áudio do Sistema". **Sem API pública de status; negação é silenciosa** (trilha `ended`). ScreenCaptureKit não entra no fluxo só de áudio. |

Mudanças na spec: Electron 45.3.2 sem flag; some o fallback ScreenCaptureKit, o opt-out e o `app.relaunch()`; entra a detecção de falha silenciosa (trilha `ended` ou RMS zero por 3 s).

### A2. Provedores de ASR (`docs/fase0/fase0-asr-provedores.md`)

| Provedor | Formato | Diarização em streaming | pt / ja / ko / zh | Limites | Preço |
|---|---|---|---|---|---|
| AssemblyAI `universal-3-6-pro` | PCM s16le mono, 16 kHz ok, frames binários de 50–100 ms, ritmo real | Sim: `speaker_label` por turno, `speaker` por palavra, `PENDING` em turnos curtos, **`SpeakerRevision`** reescreve falante de turnos já entregues | pt, ja, ko, zh (sem pt-BR separado) | 3 h por sessão; `inactivity_timeout` 5–3600 s; pausa com `KeepAlive` é cobrada | ≈ US$ 0,57/h com diarização |
| OpenAI Realtime `gpt-live-transcribe` | PCM16 **24 kHz** base64 em JSON | Não | sim | 60 min; sem VAD no servidor (cliente faz `commit`); sem timestamps nem confiança | ≈ US$ 1,02/h |
| Deepgram Nova-3 | linear16 binário, qualquer taxa | Sim, por palavra | pt-BR, ja, ko, zh | fecha após 10 s sem áudio (`KeepAlive`) | ≈ US$ 0,67/h |

Mudanças na spec: `speech_model=universal-3-6-pro`, `language_codes` em vez de `language`, rotação de sessão antes de 3 h com costura de offset, tratamento de `SpeakerRevision` (campo `providerTurnOrder`), `Terminate` em pausa acima de 2 min. OpenAI vira fallback "texto sem falante" com resample para 24 kHz e VAD no cliente. Deepgram entra como terceiro adaptador candidato com diarização.

Adendo de 14/11/2026 — tradução em tempo real na própria AssemblyAI (documentação conferida nesta data):

- O streaming `universal-3-6-pro` aceita o parâmetro de conexão `llm_gateway` (JSON com `model` e `prompt` ou `messages`; `{{turn}}` vira o texto final do turno, `{{history_1}}`..`{{history_10}}` dão contexto). A tradução chega na mesma conexão, na mensagem `LLMGatewayResponse` (`turn_order`, `transcript`, `data.choices[0].message.content`), em geral ≈ 100 ms depois do turno final com modelo pequeno.
- Só turnos finais são traduzidos; o idioma de destino vai no prompt (um por conexão); respostas de turnos curtos podem chegar fora de ordem; se a chamada falhar, não vem mensagem nenhuma para aquele turno (o cliente precisa de tempo limite e nova tentativa por outro caminho). Compatível com `speaker_labels` (junta por `turn_order`).
- O modelo é escolhido pelo cliente entre os ≈ 60 do LLM Gateway da AssemblyAI (padrão `gemini-2.5-flash-lite`); não é o catálogo do OpenRouter.
- Preço: US$ 0,45/h do streaming + US$ 0,12/h de diarização, cobrados pelo tempo de conexão aberta (ociosidade conta), mais os tokens do modelo de tradução. Duas conexões (microfone e sistema) dobram a base. US$ 50 de crédito grátis no cadastro.
- Token temporário para não expor a chave: `GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=60` com a chave no cabeçalho `Authorization`; a documentação também mostra `POST https://token.assemblyai.com/v1/token`. Conferir qual vale ao implementar.

### A3. OpenRouter (`docs/fase0/fase0-openrouter.md`)

| Pergunta | Veredito |
|---|---|
| `chat/completions` compatível com OpenAI | Confirmado. Cabeçalhos `HTTP-Referer` e `X-OpenRouter-Title` (`X-Title` ainda aceito). |
| Fallback de modelo | **Nativo**: array `models` no corpo; `response.model` diz qual respondeu. Substitui o fallback à mão. Fallback entre provedores do mesmo modelo é padrão. |
| JSON estruturado | `response_format: json_schema` + `provider.require_parameters: true` (Bedrock ignora o schema no Haiku/Sonnet 5.5 sem isso). |
| Lista de modelos | `GET /models/user` com a chave (filtrada pelas preferências da conta); `GET /models` público. Filtros na query: `input_modalities`, `output_modalities`, `supported_parameters`. `pricing.prompt`/`completion` são strings em US$/token (×1e6 para US$/1M; `-1` = variável). |
| Saldo | `GET /key` (`limit_remaining`, `usage_daily`). `/credits` exige management key; `/auth/key` não existe. `usage.cost` vem em toda resposta; `usage.include` é obsoleto. |
| Áudio | Chat com `input_audio` base64 em Gemini Flash, gpt-audio, Voxtral, Qwen omni; **nenhum Claude aceita áudio**. Existe `POST /audio/transcriptions` (desde 01/05/2026) com 32 modelos de STT, 25 MB, 60 s de timeout. **Sem streaming nem WebSocket: não serve para legenda ao vivo.** |
| IDs e preços (US$/1M entrada/saída) | `anthropic/claude-haiku-5.5` 0,10/0,50; `anthropic/claude-sonnet-5.5` 2/10; `anthropic/claude-opus-5.5` 4/20; `openai/gpt-6-luna` 0,10/0,50; `deepseek/deepseek-v4-flash` 0,09/0,18; `google/gemini-3.8-flash` 0,825/4,125 (aceita áudio). |

Mudanças na spec: fallback nativo por `models`; tela de configurações lê `/models/user` e `/key`; adaptador `openrouter-chunked` passa a usar `/audio/transcriptions` com blocos de 5–15 s e sobreposição; padrão de tradução `anthropic/claude-haiku-5.5` com reservas `openai/gpt-6-luna` e `deepseek/deepseek-v4-flash`.

## Parte B — Provas na máquina (em andamento)

Roteiro vindo de `fase0-electron-catap.md`, seção "O que testar nesta máquina". Máquina: macOS 26.x (Darwin 25.6), Apple M5.

1. Rodar o app de prova pelo terminal e confirmar que o prompt "Gravação de Áudio do Sistema" aparece para o terminal/IDE; rodar empacotado e assinado e confirmar o prompt para o app.
2. Negar a permissão e confirmar a falha silenciosa (`track.readyState === 'ended'`); validar a detecção por trilha `ended` ou RMS zero.
3. Tocar áudio no Chrome, Zoom ou Meet com fone e com alto-falante; confirmar que só a saída padrão entra; trocar a saída padrão no meio e ver se o stream se recupera.
4. Confirmar que não há muting: continua-se ouvindo a reunião.
5. Com `restrictOwnAudio:true`, confirmar `getSettings().deviceId === 'loopbackWithoutChrome'` e que o som do próprio app não entra.
6. Confirmar que não aparece pedido de Gravação de Tela nem o ícone roxo.
7. Medir taxa e formato do loopback (esperado 48 kHz estéreo), latência e drift em 60 min.
8. Microfone em paralelo sem AEC/NS/AGC com Zoom em chamada: o outro lado continua ouvindo normalmente; medir eco e duplicação ao usar alto-falante.
9. Permissão de microfone: `AVCaptureDevice.authorizationStatus` consulta sem diálogo; segunda execução não pergunta.
10. Assinatura de `TCCAccessPreflight`/`TCCAccessRequest` no macOS 26 (via `nm` do framework TCC); se mudou, manter só o fallback por `getDisplayMedia`.
11. OPFS e `audioWorklet.addModule` funcionando na origem `scribe://app`.
12. Chamada de teste ao OpenRouter (`/models/user`, `/key`, uma tradução com `models` e `require_parameters`) e à AssemblyAI (sessão de 30 s com `speaker_labels`, conferir `Begin.configuration.model` e a referência dos timestamps).

Resultado de cada item vai para a tabela abaixo quando executado.

| # | Resultado | Data | Observações |
|---|---|---|---|
| 1 | parcial (ok pelo terminal) | 13/11/2026 | `npm start` (Electron 45.3.1, Chromium 156.0.8078.96): o macOS pediu "Gravação de Áudio do Sistema" uma vez e o Andrew aceitou. Handler devolveu `{audio:'loopback'}` para `video=false audio=true gesto=true`; trilha "System audio" `live`, `deviceId=loopback`, 48 kHz, 2 canais no worklet. Nenhum pedido de Gravação de Tela, nenhum processo de UI do ScreenCaptureKit. Observação: a trilha de loopback veio com `echoCancellation/noiseSuppression/autoGainControl=true` (padrão do Chromium); o app real deve pedir os três `false` também para o sistema. Falta o empacotado. |
| 2 | pendente | | Exige revogar "Gravação de Áudio do Sistema" nos Ajustes do Sistema; fica com o Andrew (a IA não altera ajustes de privacidade). O detector por RMS zero já foi exercitado: dispara em 3 s de silêncio absoluto e some quando o som volta. |
| 3 | pendente | | Falta chamada real no Zoom/Meet e a troca da saída padrão no meio. Observação de 13 e 14/11/2026: o macOS dispara `devicechange` a cada 3–8 s nesta máquina mesmo sem captura ativa (provável dispositivo Bluetooth oscilando); o app real não pode reiniciar a captura a cada `devicechange`, só quando a trilha encerrar ou o dispositivo padrão mudar de fato. |
| 4 | ok (indireto) | 14/11/2026 | Com o loopback ativo, o microfone interno gravou a fala que saía pelo alto-falante (−32 dBFS no mic contra −21 dBFS no loopback): o som continuou saindo, sem muting. |
| 5 | ok | 14/11/2026 | `restrictOwnAudio:true` → `deviceId=loopbackWithoutChrome`. Com só o tom de 440 Hz do próprio app tocando, o loopback ficou em RMS zero absoluto. Controle sem a restrição: `deviceId=loopback`, tom detectado em ≈ 99 ms e aviso de silêncio sumiu. Áudio de outro processo (`afplay`) entra nos dois modos. |
| 6 | ok (parcial) | 13–14/11/2026 | Nenhum pedido de Gravação de Tela em várias capturas. Falta só olhar o ícone na barra de menus. |
| 7 | parcial | 14/11/2026 | Loopback: 48 kHz, 16 bits, 2 canais idênticos (L==R com fonte mono; `channelCount:1` no `getSettings`), então reduzir para mono não perde nada. Latência app → loopback ≈ 99–125 ms (inclui o bloco de 1024 quadros do worklet). Gravação de 30 s rendeu 29,93 s; WAV nativo e WAV 16 kHz mono com o mesmo nível (−21,1 dBFS). Falta o drift em 60 min. |
| 8 | parcial | 14/11/2026 | Microfone e loopback juntos, cada um no seu `AudioContext` a 48 kHz; mic com `echoCancellation/noiseSuppression/autoGainControl=false` confirmados no `getSettings`. No alto-falante do notebook, o áudio do sistema vaza para o microfone ≈ 11 dB abaixo (−32 contra −21 dBFS): sem fone, a fala dos participantes aparece nas duas trilhas e precisa de tratamento (AEC opcional ou supressão do trecho duplicado). Falta a chamada real no Zoom. |
| 9 | ok | 13–14/11/2026 | `getMediaAccessStatus('microphone')` devolveu `granted` sem diálogo na abertura; `getUserMedia` não perguntou de novo em nenhuma captura. |
| 10 | parcial | 13/11/2026 | `prova/scripts/tcc-symbols.sh` no macOS 26.6.2: o framework TCC não está no disco (dyld shared cache); `dyld_info` lista `_TCCAccessPreflight`, `_TCCAccessRequest`, `...WithAuditToken`, `...Indirect`, `...IndirectWithOptions`. Os símbolos existem; a assinatura ainda precisa ser confirmada (Hopper). |
| 11 | parcial | 13/11/2026 | `audioWorklet.addModule` por URL funcionou em `file://` (log `addModule: url`). OPFS e `scribe://app` ficam para o esqueleto real do app. |
| 12 | parcial (AssemblyAI ok; OpenRouter pendente) | 14/11/2026 | **AssemblyAI, transcrição:** sessão real de 30 s com o WAV 16 kHz do loopback (`prova/scripts/test-assemblyai.mjs`, chave em `prova/.env`, fora do git). `Begin.configuration.model=universal-3-6-pro`, `mode=balanced`. Texto em pt-BR correto, com pontuação; `speaker_label=A` nos turnos finais (`-` nos parciais); tempos das palavras em ms a partir do início do stream (o turno 1 começa em 12.576 ms, igual à posição no áudio). Turno final chega ≈ 0,7–1,3 s depois do fim da fala. Parciais chegaram a cada ≈ 3,5 s, contra ≈ 1 s na documentação: investigar antes de prometer legenda "ao vivo" fluida. Cobrança: 31 s de sessão para 30 s de áudio. **AssemblyAI, tradução na mesma conexão:** com `llm_gateway={"model":"qwen3.5-4b-32k-fast","prompt":"... {{turn}}"}` cada turno final recebeu um `LLMGatewayResponse` com a tradução para inglês 100–200 ms depois (34–103 tokens por turno). Com o modelo padrão `gemini-2.5-flash-lite` não veio nenhuma tradução e nenhum erro: a chamada direta ao gateway devolve 400 "Your account does not have access to this LLM Gateway model". O app precisa validar o modelo com uma chamada direta a `https://llm-gateway.assemblyai.com/v1/chat/completions` ao selecionar, listar os modelos por `GET /v1/models` (60 hoje, com `pricing`) e ter tempo limite por turno. **OpenRouter:** pendente, sem `OPENROUTER_API_KEY`. |

Notas de 14/11/2026:

- Os testes 4, 5, 7 e 8 foram executados pela IA controlando a janela do app de prova por acessibilidade. O clique por acessibilidade conta como gesto do usuário (`gesto=true` no handler), então `getDisplayMedia` funciona em teste automatizado.
- Fonte de som: fala em pt-BR gerada com `say -v Luciana` e tocada com `afplay`. Os WAVs ficam em `prova/out/` (fora do git) e servem de entrada para o teste 12.
- O detector de tom do app de prova dá falso positivo com fala tocando; o teste 5 só vale com silêncio no resto do sistema, como foi feito.
