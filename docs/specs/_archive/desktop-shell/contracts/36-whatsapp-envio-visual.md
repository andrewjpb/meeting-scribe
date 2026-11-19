# Contrato 36 — Balão otimista com animação da correção (WhatsApp)
Feature: desktop-shell · Wave: 36 · Depende de: 35 · Pedido do Andrew (18/11/2026 15:55: "quando eu clicar em enviar, vai p conversa e mostra com alguma animacao simples que a ia esta mudando o texto")

## Pré-condições (árvore na main, ef560aa)
- Renderer: `features/whatsapp/WhatsAppScreen.tsx` — `sendNow` limpa o campo? (conferir), chama `whatsappSend` e o balão só aparece quando o eco da mensagem volta do bridge (SSE → `scribe:whatsapp-message` → `whatsappStore.receiveMany`); erros via `whatsappErrorText` (`format.ts`). O invoke devolve `{ok:true, id}` (id da mensagem no WhatsApp) ou `{ok:false, error}`.
- Correção (35): com `whatsappAutoCorrect` ligado, o invoke demora ~1–3s (haiku) e o eco chega com o TEXTO CORRIGIDO. A configuração está no settings store do renderer (`useSettings`/equivalente — conferir como a tela lê interruptores).
- Animações: padrão do 30b em `design/base.css` (CSS puro, 150–350ms, `prefers-reduced-motion` desliga tudo). Gates: sem sombra/pílula; cores só por token.
- Smoke: `whatsappChecks` → checks `send` (interruptor desligado) e `correct` (ligado, fixture devolve "Oi, tudo bem?").

## Critérios de aceite
### CA1 — Balão otimista
- No clique em Enviar (ou ⌘↵) com `whatsappAutoCorrect` LIGADO: o campo limpa na hora e um balão temporário entra na conversa, no estilo dos balões seus (`bg-accent`), com o texto ORIGINAL + um estado visual "corrigindo": brilho/shimmer suave no balão (CSS, loop discreto) e uma linha mínima com o ícone Sparkles + "A IA está ajustando o texto…" (`text-12`, dentro/embaixo do balão). Marcar `data-wa-pending`. Dark ok. `prefers-reduced-motion`: sem shimmer, só a linha de texto.
- Com o interruptor DESLIGADO, nada muda (fluxo atual).

### CA2 — Reconciliação
- O balão temporário é trocado pela mensagem real: quando o invoke resolve `{ok:true,id}` e o eco com esse `id` chega pelo SSE (qualquer ordem), o temporário sai e o real fica — com uma transição curta de troca do texto (fade ≤300ms; nada pisca seco). Nunca ficam os dois; nunca some sem substituto enquanto o envio está vivo. Se o eco demorar (>10s após o ok), o temporário vira a versão "enviada" com o texto corrigido? NÃO — sem inventar: ele permanece como está, sem shimmer, com a linha trocada para "Enviada" (o eco traz o oficial quando vier).
- Falha (`{ok:false}` ou exceção): o balão temporário sai, o TEXTO VOLTA ao campo de escrita e o erro aparece como hoje (`whatsappErrorText`). Trocar de conversa com um temporário vivo: ele continua existindo na conversa de origem (estado por chatId), não vaza para a outra.

### CA3 — Testes e smoke
- Vitest (renderer): a lógica pura do temporário (criar no clique com flag; trocar pelo eco com o id; falha devolve o texto ao campo; estado por chatId) — extrair para função/estado testável no store.
- Smoke: no check `correct` existente, após o clique: `[data-wa-pending]` presente com o texto original e a linha "ajustando"; após o eco, o temporário some e o balão real mostra "Oi, tudo bem?"; no check `send` (flag desligada), `[data-wa-pending]` NUNCA aparece.

## Fora de escopo
- Otimismo com a flag desligada; fila de múltiplos envios otimistas simultâneos na mesma conversa (um por vez: enviar de novo antes do eco é permitido, cada um com seu id, mas sem garantias de ordem visual além da chegada dos ecos); reenvio automático.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- WhatsApp: ao enviar com a correção ligada, o balão aparece na hora com a animação da IA ajustando e troca para o texto corrigido.
