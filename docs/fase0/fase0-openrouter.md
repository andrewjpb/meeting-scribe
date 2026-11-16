---
titulo: Fase 0 - OpenRouter (tradução por LLM + transcrição opcional)
data: 2026-11-13
semana: 2026-W46
fontes: documentação pública openrouter.ai/docs + GET público /api/v1/models (sem chave)
---

# Fase 0 — o que a spec assume sobre o OpenRouter

Pesquisa feita em 13/11/2026, só com documentação pública e o catálogo público
`GET /api/v1/models` (que não exige chave). Nenhuma chave foi usada e nada foi instalado.
Snapshot do catálogo: `scratchpad/dl/models.json` (472 modelos de saída texto) e
`scratchpad/dl/stt.json` (32 modelos de transcrição).

Legenda: **CONFIRMADO** / **NÃO CONFIRMADO** (a doc não diz) / **CONTRADITO** (a doc diz outra coisa).

---

## 1. `POST /api/v1/chat/completions`

| Afirmação da spec | Veredito | Evidência |
|---|---|---|
| Endpoint `POST https://openrouter.ai/api/v1/chat/completions` | CONFIRMADO | https://openrouter.ai/docs/api-reference/overview — lista "Chat Completions: POST https://openrouter.ai/api/v1/chat/completions". Também existe `POST /api/v1/responses` (Responses API), que a doc passou a apresentar primeiro. |
| Compatível com o formato OpenAI | CONFIRMADO (com ressalvas) | Mesma página: "request and response schemas are very similar to OpenAI's APIs, with a few small differences". Dá para usar o SDK OpenAI trocando `baseURL`. |
| Cabeçalho `Authorization: Bearer <key>` | CONFIRMADO | Mesma página. |
| `HTTP-Referer` (opcional) | CONFIRMADO | Mesma página: URL do site, usado para ranking no openrouter.ai. |
| `X-Title` | CONFIRMADO, mas renomeado | O nome atual é **`X-OpenRouter-Title`**; a doc diz que `X-Title` "is also accepted". Recomendo mandar o novo (e opcionalmente os dois). Há ainda `X-OpenRouter-Categories`. |
| `response_format` JSON / structured outputs | CONFIRMADO, com ressalva por provedor | https://openrouter.ai/docs/guides/features/structured-outputs — `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` e também `{ type: "json_object" }`. Suporte é **por endpoint/provedor**, não por modelo: filtrar com `supported_parameters=structured_outputs` e mandar `provider.require_parameters: true` para só rotear a provedores que suportam. Exemplo real do catálogo: `anthropic/claude-haiku-5.5` em Amazon Bedrock e "Claude Platform on AWS" **não** lista `structured_outputs`; em Anthropic/Google/Azure lista. Sem `require_parameters`, o provedor "may ignore unknown parameters" e o JSON pode vir solto. |
| Parâmetro `models` (lista) para fallback | CONFIRMADO | https://openrouter.ai/docs/guides/routing/model-fallbacks — "If the first model returns an error, OpenRouter will automatically try the next model in the list." Gatilhos: erro de contexto, moderação, rate limit, indisponibilidade. A resposta traz em `model` o modelo efetivamente usado; cobra pelo preço do modelo usado. |
| `route: "fallback"` | NÃO CONFIRMADO (legado) | Aparece no schema TypeScript do overview (`route?: 'fallback'`), mas a página de fallbacks atual não menciona; só o array `models`. Não usar. |
| `provider` (roteamento de provedor) | CONFIRMADO | https://openrouter.ai/docs/guides/routing/provider-selection — `order`, `allow_fallbacks` (padrão `true`), `require_parameters` (padrão `false`), `data_collection` (`allow`/`deny`), `zdr`, `sort` (`price`/`throughput`/`latency`), `max_price`, `preferred_max_latency` (p50/p75/p90/p99, em segundos; só despriorizar, não exclui). "Failed requests are retried against the remaining providers." |

**Isso substitui o fallback feito à mão?** Em grande parte sim — ver "Impacto na spec".

## 2. `GET /api/v1/models`

| Afirmação | Veredito | Evidência |
|---|---|---|
| Campos `id`, `name`, `context_length` | CONFIRMADO | https://openrouter.ai/docs/api-reference/models/get-models e conferido no JSON real. Outros campos reais: `canonical_slug`, `created` (unix), `description`, `top_provider{context_length,max_completion_tokens,is_moderated}`, `per_request_limits`, `default_parameters`, `expiration_date`, `knowledge_cutoff`, `reasoning`, `benchmarks`, `endpoints`, `links`, `supported_voices`, `hugging_face_id`. |
| `pricing.prompt` / `pricing.completion` | CONFIRMADO — **unidade: USD por token, como string** | Doc: "Price in USD per token for prompt (input) processing". Ex. real: Haiku 5.5 `"prompt": "0.0000001"` = US$ 0,10 / 1M. Multiplicar por 1e6 para exibir "por 1M". Campos extras opcionais: `request`, `image`, `audio`, `input_audio_cache`, `input_cache_read`, `input_cache_write`, `internal_reasoning`, `web_search`. Modelos roteadores (`openrouter/auto`) vêm com `-1` — tratar como "variável". |
| `architecture.input_modalities` / `output_modalities` | CONFIRMADO | Também `modality`, `tokenizer`, `instruct_type`. Valores vistos: `text`, `image`, `file`, `audio`, `video`; saída inclui `transcription`, `speech`, `image`, `embeddings`. |
| `supported_parameters` | CONFIRMADO | Lista com `temperature`, `tools`, `response_format`, `structured_outputs`, `reasoning` etc. **Atenção:** no nível do modelo é a união dos provedores; o detalhe por provedor está em `GET /api/v1/models/{author}/{slug}/endpoints`. |
| Filtro por modalidade na query | CONFIRMADO | Query params: `input_modalities` (text/image/audio/file), `output_modalities` (padrão **text**; aceita `all`, `transcription`…), `supported_parameters`, `q`, `model_authors`, `providers`, `category`, `context`, `min_price`/`max_price` e `min_output_price`/`max_output_price` (em $/M), `zdr`, `region`, `sort` (`pricing-low-to-high`, `newest`…), `offset`/`limit` (até 1000). Resposta: `data`, `total_count`, `links.next`. |
| Endpoint "do usuário" `/models/user` | CONFIRMADO | `GET https://openrouter.ai/api/v1/models/user` — "List models filtered by user provider preferences, privacy settings, and guardrails" (https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails). Exige Bearer. SDK: `listForUser`. Também padrão text-output. |
| Latência por modelo | NÃO CONFIRMADO no público | `/models/{slug}/endpoints` tem `latency_last_30m`, `throughput_last_30m`, `uptime_*` — mas vieram **`null`** em todas as consultas sem chave (só `uptime` preenchido). Não dá para mostrar latência sem testar com chave. |

## 3. Entrada de áudio / transcrição

| Afirmação | Veredito | Evidência |
|---|---|---|
| `input_audio: { data, format }` em chat/completions | CONFIRMADO | https://openrouter.ai/docs/guides/overview/multimodal/audio — content part `input_audio` com `data` base64 e `format`. "Audio files must be base64-encoded - direct URLs are not supported for audio content." Formatos: Responses API só `wav`/`mp3`; Chat Completions aceita os do provedor (`aiff`, `aac`, `ogg`, `flac`, `m4a`, `pcm16`, `pcm24`). |
| Quais modelos aceitam áudio no chat | CONFIRMADO (via catálogo) | `?input_modalities=audio`. Exemplos reais: `google/gemini-3.8-flash`, `google/gemini-3.5-flash-lite`, `google/gemini-3.1-flash-lite`, `google/gemini-2.5-flash(-lite)`, `openai/gpt-audio`, `openai/gpt-audio-mini`, `mistralai/voxtral-small-24b-2507`, `qwen/qwen3.8-omni-flash`, `xiaomi/mimo-v2.6-flash`. **Nenhum Claude** aceita áudio (Claude 5.5 = text,image,file). |
| Limite de duração/tamanho no chat | NÃO CONFIRMADO | A página de áudio não fala de limite. Vale o limite de cada provedor + contexto do modelo. |
| Endpoint de transcrição `/audio/transcriptions` | **CONFIRMADO (existe desde 01/05/2026)** | https://openrouter.ai/docs/guides/overview/multimodal/stt e https://openrouter.ai/docs/api/api-reference/stt/create-transcription — `POST /api/v1/audio/transcriptions`, JSON com `input_audio{data,format}` ou `{url,format}`, ou multipart OpenAI-compatível (`file`, max 25 MB). Campos: `model`, `language`, `temperature`, `response_format` (`json`/`verbose_json`; `text`/`srt`/`vtt` dão 400), `timestamp_granularities`, `diarize`, `keyterms` (até 1000), `provider`. Resposta: `text` + `usage{seconds, input_tokens, output_tokens, total_tokens, cost}` ("Total cost of the request in USD"). Timeout: "upstream providers time out after 60 seconds per request". Anúncio: https://openrouter.ai/blog/announcements/announcing-audio-apis (01/05/2026). |
| Modelos STT disponíveis | CONFIRMADO | `?output_modalities=transcription` → 32 modelos, ex.: `openai/whisper-large-v3-turbo` (US$ 0,0002/min), `openai/whisper-1` (US$ 0,006/min), `openai/gpt-4o-mini-transcribe` e `gpt-4o-transcribe` (por token), `openai/gpt-transcribe`, `deepgram/nova-3` (~US$ 0,0043/min), `elevenlabs/scribe-v2`, `assemblyai/universal-3-6-pro`, `google/chirp-3`, `mistralai/voxtral-mini-transcribe-3-0`, `qwen/qwen3-asr-1.7b`, `nvidia/parakeet-tdt-0.6b-v3`. Preço STT em `pricing.prompt` = **USD por segundo** de áudio (ex. whisper-1 `0.0001`/s). |
| Streaming de transcrição / WebSocket / Realtime | **CONTRADITO / NÃO EXISTE** | O schema do STT "has no `stream` parameter"; único content-type de resposta é `application/json`. Nenhuma página da doc (inclusive o índice `llms.txt`) tem realtime ou WebSocket. O cookbook de push-to-talk é batch ("posts the recording to one route on your server", ~10 s por turno). Existe um modelo chamado `nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b`, mas via OpenRouter ele é servido pelo mesmo endpoint request/response. |

**Resposta direta:** o OpenRouter **não serve para ASR em tempo real** (sem WebSocket, sem parciais, sem stream de transcrição). Serve para **transcrição em blocos** (chunked): cada bloco é um POST completo, com latência = duração do bloco + tempo de processamento (+ timeout de 60 s por requisição).

## 4. IDs e preços atuais (catálogo público, 13/11/2026)

Preço em US$ por 1M tokens (pricing × 1e6). Contexto em tokens. "SO" = `structured_outputs` em `supported_parameters`.
Todos os Claude 5.5 têm variante `:batch` a 50% do preço (não serve para tempo real).

| ID OpenRouter | Nome | Contexto | Entrada | Saída | Entrada aceita | SO | Observação |
|---|---|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | Claude Haiku 5.5 | 1.000.000 | 0,10 | 0,50 | text,image,file | sim* | criado 07/10/2026. *Bedrock e Claude Platform on AWS sem SO → usar `require_parameters` |
| `anthropic/claude-sonnet-5.5` | Claude Sonnet 5.5 | 1.000.000 | 2,00 | 10,00 | text,image,file | sim* | criado 28/09/2026 |
| `anthropic/claude-opus-5.5` | Claude Opus 5.5 | 1.000.000 | 4,00 | 20,00 | text,image,file | sim* | criado 22/09/2026 |

**5 candidatos pequenos/baratos para tradução**

| ID OpenRouter | Contexto | Entrada | Saída | Áudio na entrada | SO | Observação |
|---|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 1M | 0,10 | 0,50 | não | sim* | melhor custo/qualidade da família Claude; candidato a padrão |
| `openai/gpt-6-luna` | 1.050.000 | 0,10 | 0,50 | não | sim | menor da linha GPT-6 (sucessor de fato do gpt-4o-mini) |
| `google/gemini-3.8-flash` | 1.048.576 | 0,825 | 4,125 | **sim** (áudio US$ 0,825/M) | sim | único do grupo que também transcreve via `input_audio` no chat |
| `deepseek/deepseek-v4-flash` | 1.048.576 | 0,09 | 0,18 | não | sim (parcial) | mais barato; SO varia por provedor, uptime irregular (Fireworks 59% em 1d) |
| `openai/gpt-4o-mini` | 128.000 | 0,15 | 0,60 | não | sim | ainda ativo, sem `expiration_date`; referência legada |

Alternativas também vistas: `openai/gpt-5.4-nano` (0,20/1,25), `qwen/qwen3.8-flash` (0,15/0,47), `google/gemini-3.1-flash-lite` (0,25/1,50, aceita áudio), `mistralai/mistral-small-2603` (0,15/0,60).

**Latência típica:** NÃO CONFIRMADO. O OpenRouter publica `latency_last_30m` / `throughput_last_30m` no endpoint `/models/{slug}/endpoints`, mas sem chave os valores vêm `null`. Medir na Fase 1 com chave real (ou ver a aba "Providers" do modelo no site).

## 5. Rate limits, `usage`, saldo

| Afirmação | Veredito | Evidência |
|---|---|---|
| Rate limits | CONFIRMADO | https://openrouter.ai/docs/api-reference/limits — modelos `:free`: 20 req/min; 50 req/dia (<10 créditos comprados) ou 1000/dia (≥10). Pagos: "no platform-level request cap" (limita só por crédito/orçamento). 429 traz `X-RateLimit-Limit/Remaining/Reset` e às vezes `Retry-After`; respostas de sucesso **não** trazem `X-RateLimit-*`. Saldo negativo → 402. |
| `usage` na resposta com tokens | CONFIRMADO | `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`. |
| `usage` com custo | CONFIRMADO (em créditos) | `usage.cost` = "Cost in credits"; `cost_details.upstream_inference_cost`. A página de usage accounting (https://openrouter.ai/docs/guides/administration/usage-accounting) **não** afirma conversão para USD no chat; na prática 1 crédito = 1 USD, mas a doc só diz "USD" explicitamente no endpoint de STT. Tratar `cost` como USD com essa nota. |
| `GET /api/v1/auth/key` | CONTRADITO (caminho) | A doc atual documenta **`GET https://openrouter.ai/api/v1/key`** (não `/auth/key`). Campos: `limit`, `limit_remaining`, `limit_reset`, `usage`, `usage_daily/weekly/monthly`, `is_free_tier`, `free_model_daily_requests`, `budgets`, `effective_budget`; `rate_limit` deprecated. Funciona com a chave de inferência comum. |
| `GET /api/v1/credits` para saldo | CONFIRMADO, mas **exige management key** | https://openrouter.ai/docs/api/api-reference/credits/get-credits — `data.total_credits`, `data.total_usage`; chave comum recebe 403 "Only management keys can perform this operation". Para a tela de configurações, usar `/key` (limite/restante da própria chave), não `/credits`. |

## 6. Streaming SSE e `usage.include`

| Afirmação | Veredito | Evidência |
|---|---|---|
| SSE com `stream: true` | CONFIRMADO | https://openrouter.ai/docs/api-reference/streaming — chunks no formato OpenAI; linhas de comentário `: OPENROUTER PROCESSING` (ignorar linhas começando com `:`); erro no meio do stream vem como chunk com `error` + `finish_reason: "error"` após o 200; cancelar via abort (para de cobrar só em provedores que suportam). |
| `usage` no fim do stream | CONFIRMADO | Chunk extra antes de `[DONE]` com `usage` e um choice com delta vazio; tratar como frame de contabilidade, não como segundo fim. |
| `usage: { include: true }` | CONTRADITO (obsoleto) | Usage accounting: deprecated; no Chat Completions "ha[s] no effect"; idem `stream_options.include_usage`. Usage vem sempre. Remover da spec. |

---

## Impacto na spec

1. **Fallback de modelo: usar o nativo, não o feito à mão.**
   Mandar `models: [escolhido, reserva1, reserva2]` no corpo; o OpenRouter tenta em ordem
   em erro de contexto, moderação, rate limit ou queda, e devolve em `response.model` qual foi
   usado (gravar esse campo, não o pedido). Fallback entre **provedores** do mesmo modelo já é
   padrão (`provider.allow_fallbacks: true`). O que sobra para o código: (a) timeout do lado
   cliente e uma única nova tentativa em erro de rede/5xx sem corpo; (b) tratar erro no meio do
   stream; (c) 402 (sem saldo) e 401 (chave) não adiantam fallback — mostrar ao usuário.
   Para a tradução estruturada, mandar `provider: { require_parameters: true }` junto com
   `response_format: json_schema` (senão Bedrock/AWS ignoram o schema no Haiku/Sonnet 5.5).
   Opcional: `provider.sort: "latency"` ou `preferred_max_latency` para legenda ao vivo, e
   `provider.data_collection: "deny"`/`zdr: true` se houver exigência de privacidade.

2. **Tela de configurações (seletor de modelo) — campos reais.**
   - Fonte: `GET /api/v1/models/user` com a chave do usuário (já filtra pelas preferências de
     privacidade/guardrails dele); sem chave, cair para `GET /api/v1/models` (público).
   - Filtrar no servidor: `output_modalities=text&supported_parameters=structured_outputs`
     para tradução; `input_modalities=audio` para o modo "LLM com áudio";
     `output_modalities=transcription` para o seletor de STT.
   - Exibir: `name`, `id`, `context_length`, preço = `Number(pricing.prompt)*1e6` e
     `Number(pricing.completion)*1e6` em "US$/1M tokens" (strings; `-1` = variável);
     para STT, `pricing.prompt` é **US$/segundo** → exibir ×60 "US$/min".
     Esconder IDs `:batch` (só assíncrono) e, se quiser, `:free` (20 req/min).
   - Saldo/limite: `GET /api/v1/key` (`limit_remaining`, `usage_daily`); não usar `/credits`
     (exige management key) nem `/auth/key` (caminho não documentado hoje).
   - Cabeçalhos: `HTTP-Referer` + `X-OpenRouter-Title` (aceita `X-Title`).
   - Custo por chamada: ler `usage.cost` da resposta (sempre presente); remover
     `usage.include`.

3. **Adaptador `openrouter-chunked` (transcrição em blocos): viável, mas não é tempo real.**
   - Caminho preferido: `POST /api/v1/audio/transcriptions` (endpoint dedicado, OpenAI-compatível,
     retorna `text` + `usage.seconds`/`cost` em USD, aceita `language`, `keyterms` para
     vocabulário do evento, `verbose_json` com timestamps e `diarize`). Mais barato e mais
     previsível que mandar áudio para um LLM de chat. Modelos bons para começar:
     `openai/whisper-large-v3-turbo` (US$ 0,0002/min), `openai/gpt-4o-mini-transcribe`,
     `deepgram/nova-3`, `elevenlabs/scribe-v2`.
   - Caminho alternativo: chat/completions com `input_audio` (base64, `wav`/`mp3` são os
     seguros) em `google/gemini-3.8-flash` ou `gemini-3.1-flash-lite` — permite transcrever
     **e** traduzir numa chamada só, mas sem timestamps e com custo por token.
   - Limites: multipart 25 MB; timeout de 60 s por requisição no provedor; sem stream de
     resposta. Blocos de 5–15 s de áudio cabem com folga; a latência de legenda fica
     ≈ tamanho do bloco + 1–3 s (não medido — medir na Fase 1). Sem resultados parciais:
     a spec precisa costurar blocos (sobreposição de ~0,5–1 s e deduplicação de bordas) e
     usar `prompt`/`keyterms` para continuidade.
   - **Não pode ser o ASR principal se a spec exige legenda ao vivo de baixa latência**
     (parciais palavra a palavra). Nesse caso o ASR em tempo real fica com um provedor de
     streaming direto (WebSocket), e o OpenRouter fica com tradução (e, no máximo,
     transcrição de fallback/pós-evento em blocos).

4. **Ajustes de texto na spec:** trocar `X-Title` por `X-OpenRouter-Title`; trocar
   `/auth/key` por `/key`; retirar `usage.include` e `route: "fallback"`; registrar que
   Claude não aceita áudio no OpenRouter; registrar que `latency_last_30m` não é obtível sem
   chave.

## Fontes

- https://openrouter.ai/docs/api-reference/overview
- https://openrouter.ai/docs/guides/routing/model-fallbacks
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://openrouter.ai/docs/api-reference/models/get-models
- https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails
- https://openrouter.ai/docs/guides/overview/multimodal/audio
- https://openrouter.ai/docs/guides/overview/multimodal/stt
- https://openrouter.ai/docs/api/api-reference/stt/create-transcription
- https://openrouter.ai/blog/announcements/announcing-audio-apis
- https://openrouter.ai/docs/cookbook/audio/push-to-talk-button.md
- https://openrouter.ai/docs/api-reference/limits
- https://openrouter.ai/docs/guides/administration/usage-accounting
- https://openrouter.ai/docs/api/api-reference/credits/get-credits
- https://openrouter.ai/docs/api-reference/streaming
- https://openrouter.ai/docs/llms.txt
- Catálogo público: https://openrouter.ai/api/v1/models , `?output_modalities=transcription`, `/api/v1/models/{slug}/endpoints` (consultados em 13/11/2026)
