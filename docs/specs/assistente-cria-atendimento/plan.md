---
status: aprovada
feature: assistente-cria-atendimento
tipo: plan
data: 2026-11-23
semana: 2026-W48
---

# Plan — O Assistente cria agentes de atendimento

## Decisões técnicas
- D1. Tipo de cartão novo `atendimento-agente-criar` no mecanismo `lap-acao` existente; modelo de ponta a ponta: o cartão `instagram-rascunho` (texto longo editável, grava no clique, link para a tela) com a estrutura de `campos` revalidados de `tarefa-criar`.
- D2. Canal novo `scribe:chat-action-atendimento` (fora do prefixo `scribe:atendimento-`, sem "send" no nome), `refused` com o app bloqueado. Não reutiliza `scribe:atendimento-agent-save`: o cartão grava o próprio estado na conversa e revalida o que guardou.
- D3. No clique: `saveAgent` → grava `agentId` no cartão → `saveBinding({ chatId, agentId, mode: 'draft' })` com os padrões do esquema. O modo é constante no main.
- D4. Fonte: seção "Atendimento no WhatsApp" em `AUTOMACOES.md` (ou `ESTADO.md`, o que o código tornar mais simples), montada do store do main, sem regras dos agentes.
- D5. Para as telas refletirem: evento novo ou existente que faça o renderer reler o estado do atendimento (`useAtendimento.load()`); se precisar de evento novo, é só main → renderer, com o app desbloqueado.
- D6. `AUTOMATIONS_TABS` ganha `'atendimento'` (o cartão `abrir` e o link pós-clique usam).

## Grafo de tarefas
| # | Microtarefa | Arquivos principais | Depende de | Wave |
|---|---|---|---|---|
| 153 | Tipo do cartão, validação, resolve, clique, canal, persistência, instrução, fonte, aviso às telas | `shared/assistant.ts`, `shared/ipc.ts`, `main/chat/{actions,store,sources}.ts`, `main/claude-cli/chat.ts`, `main/index.ts`, testes | contrato 149 commitado (mesmos arquivos) | 1 |
| 154 | Cartão no chat, store do chat, releitura das telas, smoke, guia | `renderer/features/chat/*`, `features/atendimento/atendimentoStore.ts`, `main/smoke.ts`, `fake-claude.mjs`, guia | 153, mockup aprovado | 2 |

## Gates
153: `pnpm typecheck && pnpm lint && pnpm test`. 154: `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`.

## Fechamento
Guia do app, auditoria do print novo, spec para `docs/specs/_archive/assistente-cria-atendimento/`.
