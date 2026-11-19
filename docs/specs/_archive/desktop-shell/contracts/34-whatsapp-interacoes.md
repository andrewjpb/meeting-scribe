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

## Decisões registradas na implementação (18/11/2026)
- Coluna a mais além das duas do CA1: `sender` (o id de quem mandou). A resposta de verdade cita a mensagem com o `participant` dela e a reação do whatsmeow (`build_reaction`) exige o remetente; o banco não guardava isso. Mensagem de grupo de antes desta versão (sem `sender`): a resposta sai sem citação (com log) e a reação responde 404 (`missing` no app). Conversa a dois não depende dele.
- A citada é refeita do que ficou guardado: texto vira `conversation`; imagem, vídeo e áudio usam a mensagem serializada do contrato 37. O trecho (`reply_preview`) vem do `contextInfo.quotedMessage`; sem ele, da citada guardada no banco.
- Reação não é evento à parte no neonize 0.10.0: chega como `MessageEv` com `reactionMessage` (e no histórico, também em `WebMessageInfo.reactions`). Vira `on_reaction`, nunca mensagem. Autor da sua reação = `me`. Fora de ordem, a mais nova vale.
- SSE: evento próprio `reactions` (`{chatId, messageId, reactions}`, as reações juntas) e `presence` (`{chatId, state, author}`). A expiração de 10 s fica no app (o serviço só repassa).
- `/_fake/incoming` aceita `replyToId`, `reaction: {messageId, emoji}` e `presence`; `/_fake/presences` devolve o "digitando…" enviado. O falso grava `sender` nas mensagens novas (grupo: número fixo) e nas do Atlas.
- O seu "digitando…": "digitando" no primeiro caractere e de novo no máximo a cada 3 s enquanto digita; "parou" depois de 3 s sem digitar, ao limpar o campo, ao enviar e ao sair da conversa. Só o texto digitado (o rascunho do Claude não). O interruptor fica em Contas › WhatsApp, abaixo das notificações; o main relê a configuração a cada pedido.
- Limite conhecido: o "digitando…" dos outros pode não chegar enquanto a conta não estiver marcada como disponível no WhatsApp; o serviço não marca (mudaria o "online" e as notificações do celular).
- Barra de citação some com um anexo na prévia (responder com mídia está fora de escopo); com a correção do 35 ligada, a citação sai do campo no clique, como o texto.

## Adendo da revisão (18/11/2026)

Revisão cega: aprovado com ressalvas, sem bloqueador. As 7 regras de segurança conferidas
(reação com clickToken+SendProof; presença só composing/paused com o interruptor lido a cada
pedido; schemas lenientes; nada sai da máquina; lock recusa os canais novos; só os 6 emojis
viram botão; logout apaga reactions e colunas novas).

Aplicado após a revisão: o limite zod de `replyPreview` subiu para 2× (a bridge corta em
pontos de código Python; com emoji isso pode dar o dobro em UTF-16).

Ressalvas que só uma conta real do WhatsApp confirma (pendências declaradas):
- Autor da reação pode vir como `@lid` ao vivo e `@s.whatsapp.net` no histórico — a mesma
  reação contaria duas vezes na agregação.
- O "digitando…" dos outros pode não chegar sem marcar a conta como disponível
  (`send_presence(AVAILABLE)`), o que mudaria o "online" visto pelos contatos — decisão de
  produto, por ora não fazemos.
- A prévia da citação usa o trecho que o remetente manda (igual ao WhatsApp oficial);
  um remetente pode citar com texto adulterado.
- Mensagens de grupo recebidas antes desta versão não têm `sender`: respondê-las sai sem
  citação e reagir devolve "Não dá para reagir a esta mensagem…".

## Gates (19/11/2026)

Smoke completo verde (83 PNGs, todos os checks ok) após uma rodada de correção do gate:
`data-wa-bubble` no balão (o wrapper novo do MessageItem tinha quebrado o seletor do smoke),
rolagem até a citada sem animação (a janela do smoke não pinta quadros da rolagem suave),
lista de botões esperada em Contas com o interruptor novo, e o passo do smoke devolvendo a
conversa da Ana ao estado respondido. Também: espera de 15 s em selectSettingsTab/openSettingsTab
(flake antiga da aba "geral" com a máquina carregada) e contagem esperada de prints 82→83.
vitest 1375 ok, pytest da bridge 58 ok, typecheck/lint ok.
