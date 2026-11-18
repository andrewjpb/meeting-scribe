# Contrato 34 — WhatsApp: responder mensagem específica, reações e "digitando…"
Feature: desktop-shell · Wave: 34 · Depende de: 32/37 · Pedido do Andrew (18/11/2026 16:40; lote aprovado 19/11)

## Pré-condições (conferir linhas na implementação; a base é a árvore pós-38)
- Bridge: SQLite com PK (chat_id,id) e `media_proto` (37); `from_event`/`from_history` no `backend_neonize.py` têm o `waE2E.Message` à mão (contextInfo com `stanzaId`/participante da mensagem citada; reações chegam como evento próprio do whatsmeow; presença de conversa = ChatPresence composing/paused). Conferir as APIs exatas no neonize instalado (`client.py`): enviar reação, enviar reply (ExtendedTextMessage com contextInfo), SendChatPresence, e os eventos de reação/presença.
- Envio: clickToken + send-guard (prova única). SSE `/events` → `scribe:whatsapp-message`/`-chats-changed`.
- UI: `WhatsAppScreen.tsx` (balões, MessageMedia do 37, pending do 36), composer com envio direto (33) e correção (35).

## Critérios de aceite
### CA1 — Responder mensagem específica
- Bridge: colunas novas `reply_to_id TEXT` e `reply_preview TEXT` (≤120, texto ou rótulo de mídia) preenchidas no from_event/from_history a partir do contextInfo; expostas na listagem/SSE. `POST /chats/<id>/send` aceita `replyToId` opcional: o neonize envia como resposta de verdade (contextInfo citando a mensagem); id inexistente → envia sem citação (log).
- App: botão "Responder" no balão (hover/menu, `data-wa-reply`) → barra de citação acima do composer (nome + trecho, X cancela; Esc também); o envio normal (mesma prova de clique; correção do 35 continua valendo no texto) leva `replyToId`. Balões com `reply_preview` mostram o bloco de citação em cima do texto (clicar rola até a mensagem citada se estiver carregada).

### CA2 — Reações
- Bridge: tabela nova `reactions (chat_id, msg_id, author, emoji, at)` com upsert/remoção pelos eventos do whatsmeow; listagem agrega por mensagem (`reactions: [{emoji, count, mine}]`); SSE emite atualização (`message-updated` ou evento próprio). `POST /chats/<id>/messages/<msg>/react {emoji}` envia a reação (emoji vazio remove a própria).
- App: canal `scribe:whatsapp-react {clickToken, chatId, messageId, emoji}` — reagir é ENVIO: passa pelo send-guard (prova própria; o preload ganha o caminho de clique para reação). UI: chips de reação sob o balão (emoji + contagem, `mine` destacado); botão de reagir no hover do balão com 6 emojis fixos (👍 ❤️ 😂 😮 😢 🙏) + remover a própria tocando de novo. WHEN_LOCKED 'refused'.

### CA3 — "digitando…"
- Bridge: evento de presença da conversa no SSE (`{chatId, state:'composing'|'paused'}`), com expiração local de 10s sem novo evento. App: no cabeçalho da conversa aberta e na linha da lista, "digitando…" em `text-12 text-accent` enquanto compondo (grupo: "Fulano está digitando…" se o autor vier).
- Sentido inverso (a outra pessoa ver VOCÊ digitando): interruptor `whatsappTypingSignal` padrão **false** (4 lugares + índice, aba Claude ou Contas junto do WhatsApp): ligado, o app manda composing/paused ao digitar no composer (debounce 3s, paused ao limpar/enviar) via rota do bridge. Desligado, nada é emitido. Mandar presença NÃO é mensagem: não passa pelo send-guard, mas só existe com o interruptor ligado (consentimento).

### CA4 — Segurança/invariantes
- Reação e resposta só com clique+prova; presença própria só com interruptor. Emojis validados (lista fixa no envio; recebidos sanitizados como texto). Nada novo de rede fora do bridge. `prova/` não muda; contratos 01–39 passam.

### CA5 — Testes e smoke
- pytest: colunas novas migram, reply com contextInfo, reactions upsert/remoção/agregação, rota react, presença no SSE; fake: `/_fake/incoming` aceita reply/reaction/presence. Vitest: canais novos no lock-ipc, guard da reação, barra de citação (lógica pura), chips, expiração do digitando, interruptor. Smoke: responder uma mensagem (citação no balão enviado), reagir 👍 (chip aparece; fake confirma), "digitando…" aparece e expira; print do balão com citação+reação.

## Fora de escopo
- Reagir com emoji livre (só os 6); responder com mídia; citação de mensagem antiga não carregada além do rolar; recibos de leitura.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- WhatsApp: responder com citação, reações nos balões, "digitando…" ao vivo; interruptor do sinal de digitação.
