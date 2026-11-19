# Contrato 37 — Mídia do WhatsApp por clique (ouvir, ver, assistir e transcrever)
Feature: desktop-shell · Wave: 37 · Depende de: 32 · Pedido do Andrew (18/11/2026 16:00: "clicar em download para ouvir, não precisa baixar tudo, só quando eu clicar; pode fazer para imagens também e vídeo?"; transcrição de áudio por clique aprovada 15:58)

## Pré-condições (fatos conferidos em 18/11/2026; caminhos relativos a apps/desktop salvo services/)
- CSP: `src/main/security.ts:66-96` — `default-src 'self'`, `img-src 'self' data:`, SEM `media-src` (hoje `<audio>/<video>` com blob são bloqueados). O esquema `scribe://` (`src/main/protocol.ts`) só serve os estáticos do renderer em produção (`index.ts:1462`, `if (!isDev)`), sem Range — NÃO usar para a mídia; o caminho é **blob no renderer** (bytes via invoke → `URL.createObjectURL`), que exige `media-src blob:` e `img-src … blob:` na CSP (dev e prod).
- Player: NÃO existe nenhum `<audio>/<video>` no app (o .m4a da reunião abre fora, via shell). O player do balão nasce neste contrato.
- AssemblyAI: chave cifrada via `src/main/secrets.ts` (`getApiKey()`, só o main); rede do main via `fetchImpl`/`net.fetch` (`index.ts:527-530`); `FetchInit` (`src/main/assemblyai/gateway.ts:22-29`) só aceita `body?: string` — ampliar para binário; NENHUM uso atual de `/v2/upload`+`/v2/transcript` (padrão a copiar: `createTokenClient({fetch, getApiKey})`, erros tipo `GatewayError`); fixtures AssemblyAI em `test/fixtures/assemblyai/` + `smokeFixtures.fetch`.
- Bridge: `media_of()` só extrai `{kind,mime,size,name}` (`backend_neonize.py:95-118`); SQLite NÃO guarda o proto (`bridge_store.py:53-66`, PK `(chat_id,id)`); neonize 0.10.0 tem `download_any(message)` (client.py:2184, exige o `waE2E.Message` — serializar com `SerializeToString()` e reconstruir com `FromString`) e `DownloadError`; `directPath` antigo pode expirar; sem busca de mensagem por id. Pontos de captura do proto: `from_event`/`from_history` (`backend_neonize.py:388-444`). Modelo de cache/validação: a foto do 32 (`_photo_file` sha256, tmp+replace, 600/700, lock; anti-redirect `fetch_photo`). O servidor só tem `send_json` (`server.py:152-159`) — resposta binária é nova. Cliente do main `client.ts:call()` só aceita JSON, `RESPONSE_MAX = 8 MB` — leitor binário novo com limite próprio.
- Renderer: chip estático `data-whatsapp-media` no `MessageItem` (`WhatsAppScreen.tsx:113-145`, `MEDIA_ICONS` :100-107); `WhatsAppMedia {kind,mime,size,name}` (`src/shared/whatsapp.ts:58-64`); `WhatsAppMessage` já tem `id`+`chatId` (a PK do download).
- Fake: `solid_png` existe (`backend_fake.py:30-38`); `incoming` só manda texto; nenhum binário de áudio nos fixtures (gerar WAV PCM curto em código, como o PNG).
- Privacidade (lição do 32): caches derivados de mensagem entram no `removeBridge`/logout.

## Critérios de aceite
### CA1 — Bridge: chaves de mídia e download por clique
- Migração do SQLite: coluna nova `media_proto BLOB` (nullable); `from_event`/`from_history` gravam o `waE2E.Message` serializado QUANDO a mensagem tem mídia de tipo image/video/audio (sticker/document ficam fora); mensagens antigas ficam `NULL`. `_add_message`/SELECTs ajustados; a listagem passa a expor `downloadable` (proto presente) e, para áudio, `seconds` se o audioMessage trouxer.
- Rota nova `GET /chats/<chat_id>/messages/<msg_id>/media`: valida ids; sem proto → 404; reconstrói o Message e chama `download_any`; resposta BINÁRIA com `Content-Type` (mime guardado) e `Content-Length`; limite `MEDIA_MAX = 64 MB` (maior → 413); `DownloadError`/directPath expirado → 410 (o app mostra "não disponível mais"). Cache em disco `media/` no padrão da foto (sha256 de chat+msg, atômico, 0600/0700, TTL 7 dias, lock). Backend fake: serve PNG (imagem), WAV PCM curto gerado em código (áudio) e uns bytes rotulados `video/mp4` (vídeo — ninguém dá play no fake); `incoming` do `/_fake/` aceita `type`/`media` para os testes.
- Testes python: rota (ok, sem proto, oversize, expirado), migração carrega banco antigo, cache.

### CA2 — Main: canal e transcrição de arquivo
- `client.ts`: leitor binário novo (`callBinary`, limite 64 MB, Content-Type conferido contra prefixos `audio/|image/|video/`). Canal `scribe:whatsapp-media {chatId, messageId}` → `{ok:true, mime, bytes}` (Buffer/ArrayBuffer pela IPC) | `{ok:false, error:'too-big'|'gone'|'unavailable'}`; WHEN_LOCKED `'refused'`; dedupe de pedidos iguais em voo; SEM cache de bytes no main (o disco do bridge já guarda; o renderer guarda o blob da sessão).
- Transcrição: canal `scribe:whatsapp-transcribe {chatId, messageId}` → `{ok:true, text}|{ok:false, error}`; WHEN_LOCKED `'refused'`. No main: baixa (mesmo caminho acima), `POST https://api.assemblyai.com/v2/upload` (body binário — ampliar `FetchInit`; `authorization` com a `getApiKey()`; `redirect:'error'`), `POST /v2/transcript` (`language_detection: true`), poll `GET /v2/transcript/<id>` a cada 2s até `completed|error`, timeout total 120s. Texto (≤20k chars, cortar) cacheado em `userData/whatsapp/transcripts.json` (atômico, zod na leitura, corrompido descartado) — e o arquivo ENTRA no `removeBridge` e no logout (como o insights.json). Erros nunca derrubam nada: viram `{ok:false}` com rótulo claro.

### CA3 — Renderer: chip vira download, depois mídia
- Chip de mídia (image/video/audio) com `downloadable`: vira botão "Baixar" (ícone Download + rótulo/tamanho atuais, `data-wa-download`); clique → estado baixando (spinner discreto) → bytes viram blob (`URL.createObjectURL`, revogado ao trocar de conversa/desmontar; cache por messageId na sessão):
  - **áudio**: player próprio no balão (`data-wa-audio`): play/pause, barra de progresso clicável, tempo decorrido/total, velocidade 1x→1.5x→2x; estilo tokens, dark ok; + botão "Transcrever" (`data-wa-transcribe`) → estado "transcrevendo…" → texto aparece sob o balão (`text-13`, citável), cacheado (não re-transcreve; cache também consultado ANTES de mostrar o botão). Descrição curta no title: "O áudio é enviado à AssemblyAI para transcrever".
  - **imagem**: aparece inline no balão (`max-h-[320px]`, `object-contain`, raio do painel), clique na imagem abre em tamanho natural numa sobreposição simples (Esc fecha).
  - **vídeo**: `<video controls>` inline (`max-h-[320px]`), controles nativos.
- `downloadable:false` (mensagem antiga/sem proto ou documento/sticker): chip atual permanece, com title "Disponível só para mensagens recebidas a partir desta versão" quando for mídia suportada antiga. Erros: 'gone' → "Este arquivo não está mais disponível no WhatsApp"; 'too-big' → "Arquivo grande demais". CSP: `media-src 'self' blob:` e `img-src 'self' data: blob:` (dev e prod) — NADA além disso muda na CSP.

### CA4 — Segurança e invariantes
- Download e transcrição só por clique; NENHUM download automático. A transcrição envia o áudio só à AssemblyAI (`api.assemblyai.com`, chave existente) — único destino novo, documentado. Bytes tratados como dado opaco (nunca HTML); blob nunca vira `src` de script. Envio de mensagens intocado. `prova/` não muda. Contratos 01–36 continuam passando.

### CA5 — Testes e smoke
- Vitest: canal de mídia (ok/too-big/gone, dedupe), transcrição (upload+poll com fetch falso, timeout, cache, corte de 20k), lock-ipc, lógica pura do player (formatação de tempo, ciclo de velocidade), revogação de blobs. Python: CA1.
- Smoke: no `whatsappChecks`, seed do fake ganha um áudio e uma imagem `downloadable`; clique no "Baixar" da imagem → `<img>` com blob aparece; clique no do áudio → `[data-wa-audio]` presente; "Transcrever" com `smokeFixtures.fetch` servindo upload+transcript falsos → texto sob o balão; mensagem antiga (sem proto) continua chip estático. Print novo do balão com player (claro). `externalRequests` do smoke continua vazio (fetch falso).

## Fora de escopo
- Documentos e stickers; download automático; enviar mídia; salvar a mídia em pasta do usuário; Range/streaming (blob cobre o seek); miniatura antes do download; retry de mídia expirada.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- WhatsApp: chips de áudio/imagem/vídeo viram "Baixar"; áudio com player e "Transcrever"; imagem e vídeo no balão.
