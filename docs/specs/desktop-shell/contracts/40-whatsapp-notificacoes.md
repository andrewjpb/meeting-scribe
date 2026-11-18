# Contrato 40 — Notificações do WhatsApp como app da LAP
Feature: desktop-shell · Wave: 40 · Depende de: 32 · Pedido do Andrew (18/11/2026 17:20; lote aprovado 19/11)

## Pré-condições (conferir na implementação)
- O main já recebe cada mensagem (SSE → broadcast `scribe:whatsapp-message`) e já usa notificações nativas do macOS (avisos de agenda do contrato 12 — seguir o padrão de `Notification` de lá, inclusive o clique). `scribe:open-whatsapp` existe para abrir a tela; conferir se aceita conversa-alvo (senão, criar o parâmetro). Fotos de contato: data URL no main (32) — `Notification.icon` NÃO funciona no macOS (mostra o ícone do app); tentar e aceitar o fallback.

## Critérios de aceite
- CA1 — Com o app aberto (inclusive minimizado/atrás): mensagem recebida (nunca `fromMe`) gera notificação nativa: título = nome do contato (grupo: "Autor · Grupo"), corpo = texto (≤140) ou rótulo de mídia ("🖼 Imagem", "🎤 Áudio", "🎬 Vídeo", "📎 Documento"); clique abre o app na conversa. NÃO notificar quando a janela está em FOCO com aquela conversa aberta. Agrupar rajadas: ≥3 mensagens do mesmo chat em 5s viram uma ("3 mensagens de Fulano"). Conteúdo nunca sai da máquina (notificação local).
- CA2 — Interruptor `whatsappNotifications` padrão **true** + sub-opção "Só pessoas (sem grupos)" (`whatsappNotifyGroups` padrão true) — 4 lugares + índice, junto das opções do WhatsApp. Desligado, nada é emitido. Com o app bloqueado (contrato 22), notificar SEM o texto (só "Mensagem de Fulano") — decisão de privacidade; registrar no contrato.
- CA3 — Testes: regras puras (foco+conversa aberta não notifica; fromMe não; grupos conforme opção; agrupamento; corpo bloqueado sem texto) com Notification injetável; lock-ipc se houver canal novo (preferir tudo no main, sem canal — o renderer só informa a conversa aberta/foco por evento existente ou um canal leve 'refused'). Smoke: com Notification falsa registrando chamadas, `/_fake/incoming` → 1 notificação com título/corpo certos; com a conversa aberta e foco → zero; clique → rota na conversa.

## Fora de escopo
- Responder direto da notificação; sons custom; badge no Dock com contagem (se barato, pode: `app.setBadgeCount` com não-lidas — opcional declarado).

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Notificações nativas do macOS com nome e mensagem; opções em Configurações.
