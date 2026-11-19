# Contrato 39 — Enviar imagem e vídeo pelo WhatsApp (arrastar e soltar)
Feature: desktop-shell · Wave: 39 · Depende de: 37 · Pedido do Andrew (18/11/2026 16:55: "quero poder enviar imagem e video pelo painel tambem, com arrasta e solta")

## Pré-condições (da árvore com o 37 aplicado; confirmar linhas na implementação)
- Envio de texto: renderer `sendNow` → preload clickToken (`src/preload/index.ts:36-40`) → `scribe:whatsapp-send` → main `service.send` (zod, `guard.consume` → `SendProof`, correção do 35 opcional) → bridge `POST /chats/<id>/send` (`server.py`). O guarda (`send-guard.ts`) é por janela, uso único, 10s; a prova só nasce do consume.
- Bridge (37): já tem resposta binária, cache `media/`, limites, `backend_fake` com controles `/_fake/*`; neonize 0.10.0 tem envio de mídia (`send_image`/`send_video` ou upload + message build — conferir API exata no client.py instalado em `~/Library/Application Support/Meeting Scribe/whatsapp/venv/.../neonize/client.py`).
- `client.ts` (main): `call` JSON + `callBinary` (37); não há POST binário — criar.
- Composer do WhatsApp: `WhatsAppScreen.tsx` (textarea + Rascunho + Enviar; contrato 36 adicionou o balão otimista — o envio de mídia NÃO usa o fluxo otimista nem a correção do 35: legenda vai como está).
- CSP: `img-src 'self' data: blob:` e `media-src 'self' blob:` (37) — a prévia local usa blob dos bytes do arquivo.

## Critérios de aceite
### CA1 — Soltar/escolher vira prévia, nunca envio
- Arrastar arquivo(s) sobre a conversa aberta: overlay discreto "Solte para anexar"; ao soltar, UM arquivo por vez (o primeiro válido) vira um cartão de prévia acima do composer (`data-wa-attach`): miniatura (imagem) ou primeiro frame/badge de vídeo, nome, tamanho, campo de legenda (o próprio textarea atual vira a legenda), botão X para descartar. Também um botão clipe no composer (`data-wa-attach-pick`) abrindo o seletor nativo (via main, `dialog.showOpenDialog` com filtros).
- Aceitos: imagem `image/jpeg|png|webp|gif` ≤16 MB; vídeo `video/mp4|quicktime` ≤64 MB — validados por MAGIC BYTES no main (extensão/mime do renderer é dica, não prova). Recusa com mensagem clara (tipo/tamanho). Soltar fora de conversa aberta: nada acontece.
- NADA é enviado no drop. Esc ou X descarta. Trocar de conversa descarta a prévia (com o arquivo, sem enviar).

### CA2 — Envio com a mesma prova de clique
- Clique em Enviar com anexo: preload gera o clickToken (mesmo caminho), canal novo `scribe:whatsapp-send-media {clickToken, chatId, name, mime, bytes, caption?}` (WHEN_LOCKED `'refused'`): main revalida magic bytes/limites, consome o token (`guard.consume` — mesma prova, nada de caminho paralelo), e chama o bridge `POST /chats/<id>/send-media` (corpo binário + headers `X-Media-Mime`/`X-Media-Name`/`X-Caption` ou multipart — escolher o mais simples no http.server) → neonize faz upload e envia como imagem/vídeo com a legenda. Resposta `{ok:true,id}|{ok:false,error}`; erros mapeados (too-big/invalid/failed). A correção do 35 NÃO roda na legenda (fora de escopo).
- O eco SSE da mensagem enviada chega como mídia `fromMe` com `downloadable` (o 37 já guarda o proto no from_event) — o balão aparece pelo fluxo normal e dá para baixar/ver. Durante o envio: botão com estado enviando; falha → prévia permanece para tentar de novo.
- O teste "nenhum caminho fora do clique" cobre o canal novo (sem token → recusa; token de outra janela/vencido → recusa; IA sem acesso — módulos de insights/correção/notas não importam o canal).

### CA3 — Bridge
- Rota `POST /chats/<id>/send-media`: valida id, mime declarado × magic bytes, limites (16/64 MB), corpo até o Content-Length; neonize envia (imagem com caption; vídeo com caption); erros → 400/413/502 com rótulo. `backend_fake`: aceita o POST, registra em `sent` (tipo+nome+tamanho) e emite o eco SSE como mensagem de mídia `fromMe` downloadable (reusando o WAV/PNG do 37 como bytes do eco). Testes python: ok imagem, ok vídeo, mime mentiroso recusado, oversize 413.

### CA4 — Segurança e invariantes
- Envio só por clique com a prova; arrastar/colar nunca dispara rede. Bytes do usuário tratados como opacos (magic bytes só para aceitar/recusar). Nenhum destino novo (tudo 127.0.0.1 → WhatsApp). Limpeza: prévia vive só em memória do renderer. `prova/` não muda. Contratos 01–38 continuam passando.

### CA5 — Testes e smoke
- Vitest: validação de magic bytes (jpeg/png/webp/gif/mp4/mov, mentiroso recusado), limites, canal novo no lock-ipc, guarda (sem token/out-of-window), lógica pura da prévia (aceitar primeiro válido, descartar na troca de conversa).
- Smoke: no `whatsappChecks`, montar a prévia programaticamente (DataTransfer sintético ou chamada direta da action com bytes do fixture PNG), legenda "olha isso", clique em Enviar → o fake registra o envio de mídia e o eco aparece como balão de mídia `fromMe`; sem clique, nada enviado. Print `whatsapp-anexo-light` com a prévia montada.

## Fora de escopo
- Documentos/áudio/sticker no envio; múltiplos arquivos de uma vez; colar do clipboard; compressão/conversão; correção da legenda pela IA; editar imagem; enviar pela aba da reunião.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- WhatsApp: arrastar e soltar (ou clipe) → prévia com legenda → Enviar; o enviado vira balão de mídia normal.
