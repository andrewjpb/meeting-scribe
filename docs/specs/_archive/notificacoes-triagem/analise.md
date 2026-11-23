# Análise — notificacoes-triagem

Data: 2026-11-23 · Base: `6afc661` (0.23.1) · Levantamento por agente Explore (Opus).

## Pedido
Andrew: "precisamos no sidebar um local de notificação, e cada email recebido e não lido e cada mensagem do WhatsApp não lida fica ali, quero poder organizar o WhatsApp por msg não lidas, urgentes e de cunho pessoal e profissional, será que tem como fazer isso com IA, cada WhatsApp que chega notificação, aciona a IA e ela move para uma aba específica dependendo do contexto". Depois: "tem como fazer isso com agente específico? daí tudo fica com agentes e não fica regra solta (...) e quero sempre poder fazer tudo pelo assistente".

## O que já existe e será reaproveitado
- **Não lidos de email** já chegam ao renderer: `features/email/emailStore.ts` guarda `folders['<conta>:inbox']` e o badge da barra soma `!seen` (`totalUnread`). O main tem `emailService.naoLidosEmCache()`. Nada em `main/email/*` nem `EmailScreen` precisa mudar (sessão do Painel de e-mail trabalha ali).
- **Não lidas do WhatsApp**: `WhatsAppChat.unread` (da ponte, zerado ao abrir a conversa). `whatsappBadgeCount()` em `main/index.ts` já define a regra do Dock.
- **Ponto de disparo**: `onMessage` do WhatsApp em `main/index.ts:1324` (broadcast → `inicioChanged` → atendimento → notificação macOS → badge). A triagem entra ao lado do atendimento, roda também com o app bloqueado.
- **Passada barata de IA**: `runClaudeOneShot` (`main/meetings/claude-one-shot.ts`) com `purpose` fechado; `main/whatsapp/atendimento/reply.ts` e `main/funil/extract.ts` são o molde (Haiku, timeout curto, parse zod, mensagens escapadas em `<conversa>`).
- **Agentes das Automações**: `Agent` em `shared/automations.ts` (instruções, modelo, permissões `web|funil|tarefas`, pausa pela tarefa); gatilho por evento já existe como `Schedule {kind:'after-meeting'}` disparado por `automations.meetingEnded()`; execuções em `schedule-runs/` (`AutomationRun`, últimas 500) e aba Execuções. Modelos prontos: `EXAMPLE_AGENTS` (semeados só na primeira vez).
- **Cartões do Assistente**: bloco `lap-acao` validado em `main/chat/actions.ts`, clique em `features/chat/ActionCards.tsx`, canal `scribe:chat-action-<x>`; contrato 153 (ainda sem código) define o cartão que cria agente de atendimento. Fonte do WhatsApp: `main/whatsapp/export.ts` (`overviewLine` com "pendente de resposta").
- **Contato do funil**: `contatoLigado()` só no renderer (`features/funil/ContactLink.tsx`); `telefoneDoChat`, `mesmoTelefone` em `shared/`.
- **Store em userData**: molde `main/whatsapp/atendimento/store.ts` (fila serial, tmp+rename 0600, zod, `.corrupt-`). `insights.json` e `transcripts.json` são apagados no logout/remover (`service.ts:654`).
- **Design**: sem flyout, sem modal, dois níveis na barra; `Segmented` (28 px) e `Tabs` (32 px) existem em `design/`.

## Riscos e decisões
1. **Executar o runner ACP a cada mensagem é inviável** (limite de 50/dia, 2 simultâneas, caro). Decisão: a triagem usa o *agente* (instruções, modelo, pausa, Execuções) mas executa por `runClaudeOneShot`, com fila e debounce próprios e teto diário próprio, fora do limite de 50.
2. **Permissão "ler WhatsApp"** não existe para agentes. Decisão: o gatilho "quando chega mensagem do WhatsApp" é a permissão: a tarefa dá ao agente a leitura da conversa que recebeu a mensagem, e só dela. Permissão geral "Pode ler o WhatsApp" para outros gatilhos fica fora de escopo.
3. **Flyout na barra não existe no design.** Decisão: Notificações é um item plano da raiz (como Início e Tarefas) com badge e tela própria.
4. **Marcar WhatsApp como lida sem abrir** não existe na ponte. Decisão: no centro de notificações, a linha de WhatsApp abre a conversa; email tem "Marcar como lida" (canal `scribe:email-mark-read` existente).
5. **Semente de modelos prontos** só roda na primeira vez. Decisão: botão "Criar agente de triagem" no estado vazio das abas e cartão do Assistente criam agente + tarefa a partir do modelo.
6. **Runs em excesso** (500 guardadas). Decisão: um `AutomationRun` por classificação, com `prompt` curto (sem mensagens) e resposta "Etiqueta: … · Motivo: …"; teto de 300 triagens por dia.
7. **Numeração**: contratos 159–164 (155–158 com o Painel de e-mail; 152 reservado à ia-midia; 153 do cartão de atendimento).
