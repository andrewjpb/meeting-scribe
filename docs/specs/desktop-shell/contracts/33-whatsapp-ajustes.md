# Contrato 33 — Ajustes do WhatsApp (header, aviso, Detalhes por largura, envio sem diálogo)
Feature: desktop-shell · Wave: 33 · Depende de: 32 · Pedido do Andrew (18/11/2026 15:12, com prints da tela real)

## Pré-condições (da árvore na main, 242be5a)
- Tela: `apps/desktop/src/renderer/src/features/whatsapp/WhatsAppScreen.tsx` — `PageHeader` "WhatsApp" + subtítulo "As suas conversas…" + `Note` de aviso ("cliente não oficial… bloquear o seu número") no topo (:368-373 na versão do contrato 32); painel `DetailsPanel` com estado `detailsOpen` no componente; o aviso de risco TAMBÉM existe no fluxo de parear (RiskPanel/QR — conferir o texto de lá).
- Envio: renderer `sendNow` → preload `whatsappSend` (clickToken) → main `send-guard` (token de uso único) → diálogo nativo `confirmWhatsAppSend` (`src/main/index.ts:1095-1110`, texto via `sendDialogText` em `src/main/whatsapp/service.ts:103`) → bridge POST. Fixtures do smoke: `whatsappSendDialogs`/`whatsappSendChoice` (`smoke-fixtures.ts:182-183`); checks `send` (e vizinhos) em `whatsappChecks` (`src/main/smoke.ts`); testes do diálogo em `test/whatsapp.test.ts`.

## Critérios de aceite
### CA1 — Topo da tela limpo
- Somem da tela do WhatsApp: o `PageHeader` "WhatsApp", o subtítulo e o `Note` de aviso permanente. As 3 colunas passam a começar no topo da área útil (como Reuniões não: como o mockup — colunas cheias). O aviso do cliente não oficial continua existindo APENAS no fluxo de parear (antes do QR); se lá o texto não estiver completo ("pode bloquear o seu número. Use por sua conta e risco."), completar lá. A frase "Nenhuma mensagem sai sem o seu clique em Enviar" pode viver como `title`/texto discreto perto do botão Enviar, não como banner.

### CA2 — Detalhes abrem conforme a largura
- Ao abrir a tela/conversa: painel Detalhes começa ABERTO quando a janela tem ≥1280px de largura, FECHADO abaixo disso. O usuário pode abrir/fechar à vontade depois (o botão continua); a escolha manual vale enquanto a tela está montada (não persiste). Redimensionar a janela não fecha/abre sozinho depois da primeira decisão.

### CA3 — Envio sem diálogo de confirmação
- Clique em "Enviar" (ou ⌘↵) envia direto: o diálogo nativo `confirmWhatsAppSend` é REMOVIDO do fluxo. Ficam: o gesto do usuário (botão/atalho), o clickToken do preload e o send-guard de uso único no main — ou seja, continua impossível enviar sem clique do usuário, e a IA continua sem caminho de envio (o teste "nenhum caminho fora do clique" se mantém e é ajustado para o fluxo sem diálogo). Registrar no código (comentário curto no send-guard) que o diálogo foi removido a pedido do dono em 18/11/2026.
- Limpar o que era só do diálogo: `confirmWhatsAppSend`, `sendDialogText`, fixtures `whatsappSendDialogs`/`whatsappSendChoice` e os checks/testes que esperavam o diálogo (o check `send` do smoke passa a conferir que o envio chega ao bridge SEM diálogo).

### CA4 — Gates
- `pnpm typecheck && pnpm lint`, vitest completo, smoke completo (com `caffeinate -disu` se preciso) — tudo verde. Os PNGs da tela do WhatsApp mudam (topo limpo): conferir visualmente claro e escuro.

## Fora de escopo
- Qualquer outra mudança no WhatsApp; o RiskPanel/consentimento inicial continua obrigatório.

## Telas de impacto no usuário
- WhatsApp: sem banner nem título no topo (mais espaço útil); Detalhes já abertos em monitor largo; envio em um clique só.
