# Contrato 74 — Mensagens

Feature `redes-instagram` · Wave 3 · Depende de: 72 · Spec `../spec.md` (R6, R10; CA11) · Mockup artboards 06, 06b, 06c · Densidade: 79. **Você não commita.** Mesmas regras de paralelismo do 73: arquivos próprios `main/redes/messages.ts`, `features/redes/MessagesSection.tsx` (+ `Messages*`), `test/redes-messages*.test.ts`; nos compartilhados, só blocos `// 74: mensagens`.

## Superfície
- `shared/redes.ts`: `RedesConversation { id; participantId; participantName; participantUsername; updatedAt; lastMessage: string | null; unread: boolean; lastInboundAt: string | null; accessDenied?: never }`, `RedesMessage { id; conversationId; fromId; fromMe: boolean; text: string | null; attachments: { kind: 'imagem'|'video'|'audio'|'arquivo'|'outro'; url: string | null }[]; createdAt }`, `RedesMessagesState { conversations: RedesConversation[]; messages: Record<convId, RedesMessage[]>; access: 'ok' | 'denied' | 'unknown'; accessError: string | null; unread: number; updatedAt: string | null }`; `MESSAGE_TEXT_MAX_BYTES = 1000`, `MESSAGE_WINDOW_MS = 24 h`.
- `instagram-client.ts`: `conversations(token)` (`GET /me/conversations?platform=instagram&fields=id,updated_time,participants`), `conversationMessages(token, convId)` (`GET /{conv}?fields=messages{id,created_time,from,to,message,attachments}`; só as 20 mais recentes têm detalhe: as demais aparecem como "mensagem antiga"), `sendMessage(token, igUserId, recipientId, text)` (`POST /{ig}/messages` `{recipient:{id}, message:{text}}`). Erro de permissão (códigos 10/200/230 ou mensagem de acesso) → `access: 'denied'` com o texto da Meta resumido.
- `main/redes/messages.ts`: `syncMessages` (conversas com `updated_time` novo → mensagens; mescla; `unread` = conversa cuja última mensagem é do contato e ainda não aberta; `lastInboundAt` para a janela) e `markConversationRead`.
- `service.ts`: polling junto com os comentários (mesmo timer), `messagesState`, `sendMessage` (rejeita texto > 1000 bytes; se `now - lastInboundAt > 24 h`, envia mesmo assim e, se a Meta recusar, devolve "O Instagram recusou: fora da janela de 24 h"), `markConversationRead`; evento `scribe:redes-messages`; `unread` para o badge.
- IPC (`refused`): `scribe:redes-messages {accountId}`, `scribe:redes-messages-refresh`, `scribe:redes-message-send {accountId, conversationId, text}`, `scribe:redes-conversation-read {accountId, conversationId}`. Enviar mensagem passa pelo token de clique do preload (`redesMessageSend`), como o email.
- Tela (`MessagesSection.tsx`, artboards 06/06b/06c, densidade 79): duas colunas (lista 280 px: nome/@, última mensagem em 1 linha, hora, ponto de não lida; conversa: balões com hora, recebidos à esquerda, enviados à direita no padrão do WhatsApp do app, anexos como link "Imagem"/"Vídeo" abrindo no navegador pelo canal de URL externa), campo de resposta (textarea 2 linhas, contador de bytes, Enter envia/⇧Enter quebra), `Note` amarela "Fora da janela de 24 h: o Instagram pode recusar" quando `lastInboundAt` > 24 h; `access: 'denied'` → tela inteira vira `Note` "O Instagram não liberou o acesso às mensagens desta conta" + passos (Instagram › Configurações › Mensagens › Ferramentas conectadas › Permitir acesso; conta de teste precisa de papel no app da Meta) + botão "Tentar de novo"; `EmptyState` sem conversas.
- Ganchos: `[data-redes-conversation="<id>"]`, `[data-redes-conversation-unread]`, `[data-redes-message="<id>"]`, `[data-redes-message-input]`, `[data-redes-message-send]`, `[data-redes-window-note]`, `[data-redes-messages-denied]`, `[data-redes-messages-retry]`.
- `fake-instagram.ts`: conversas/mensagens em memória, `addInbound(convId, text, at)`, `setMessagingAccess(false)` para simular recusa, envio registrando o texto.
- Smoke (`redesUiChecks` += `messagesList`, `messageSend`, `messageWindowNote`, `messagesDenied`, `messagesUnreadBadge`): lista e conversa; enviar por clique real → balão à direita e `calls` com o texto; conversa com `lastInboundAt` de 25 h atrás → `Note`; acesso negado → tela de aviso e badge zerado; mensagem nova → não lida e badge. Prints `both('redes-mensagens')`, `both('redes-mensagens-janela')`, `both('redes-mensagens-sem-acesso')`; `expectedShots += 6`.
- Testes: `redes-messages.test.ts` (mescla, não lida, janela de 24 h, bytes UTF-8, detecção de acesso negado).

## Critérios de aceite
CA11; texto de terceiros plano; nada enviado sem clique; pt-BR; tokens.

## Fora de escopo
Enviar mídia, reações, grupos, mensagens de anúncio, human agent tag.

## Gates / Relatório
Idem 73.

## Aviso do revisor do 71 (obrigatório)
`main/redes/store.ts` grava o `instagram-<id>.json` por `writeFileOf`, que serializa só `version`, `account` e `publications`. Ao acrescentar os seus campos (comentários/mensagens/métricas em cache) nesse arquivo, inclua-os no `writeFileOf` e no schema, senão cada gravação da fila apaga os seus dados (e vice-versa). Prefira um arquivo próprio por domínio (`instagram-<id>.comments.json`, `.messages.json`, `.metrics.json`) com a mesma fila de escrita por conta, para os três contratos não disputarem o mesmo arquivo.
