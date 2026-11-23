---
status: aprovada
feature: whatsapp-agentes
tipo: plan
data: 2026-11-23
semana: 2026-W48
base: a0f683f (0.22.0)
contratos: 138 a 144 (ainda não escritos)
---

# Plan — Agentes de atendimento no WhatsApp

## Decisões técnicas

- D1. **Tipo separado dos agentes das Automações.** O `Agent` atual tem escopo de reuniões,
  funil, tarefas e saídas locais; o de atendimento precisa do oposto (nenhum dado, nenhuma
  ferramenta). Manter separado também preserva o teste que proíbe as Automações de alcançar o
  WhatsApp.
- D2. **Módulo novo `apps/desktop/src/main/whatsapp/atendimento/`** (`store.ts`, `reply.ts`,
  `scheduler.ts`, `service.ts`, `log.ts`). Nada de `main/agents`, `main/schedules` ou
  `main/tray` importa dele.
- D3. **Persistência em JSON** (`userData/whatsapp/atendimento.json`) no padrão das outras
  features: fila, temporário + `rename`, 0600. Histórico em `.jsonl` ao lado.
- D4. **Modelo por `runClaudeOneShot`** com `purpose: 'whatsapp-atendimento'`, sem ferramentas.
  Reaproveita o formato de histórico do `draft.ts`.
- D5. **Segunda prova de envio.** `send-guard.ts` ganha `AgentSendProof`, emitida só por
  `atendimento/service.ts` depois de reler o estado do atendimento. `client.send` aceita
  `SendProof` (clique) ou `AgentSendProof`; qualquer outra coisa é recusada.
- D6. **Agendador puro com relógio injetado** (`scheduler.ts`): atraso, reagendamento, teto,
  horário, limites e pausa testáveis sem esperar tempo real.
- D7. **Gancho único de entrada**: o `onMessage` em `main/index.ts` repassa cada evento ao
  serviço de atendimento, antes do bloqueio de janelas.
- D8. **Rascunho pendente em memória**, um por conversa, entregue ao renderer por evento; o
  envio do rascunho usa o caminho de clique existente, sem código novo de envio.
- D9. **Interface**: agentes e histórico numa aba nova das Automações; opções da conversa num
  painel da `WhatsAppScreen`. Store zustand novo `atendimentoStore.ts`.
- D10. **Notificação de passagem** pelo mesmo mecanismo de `main/whatsapp/notify.ts`.

## Grafo de tarefas

| # | Microtarefa | Arquivos que toca | Depende de | Wave |
|---|---|---|---|---|
| 138 | Tipos, esquema zod, store, histórico, canais IPC e `WHEN_LOCKED` | `shared/atendimento.ts`, `shared/atendimento-schema.ts`, `shared/ipc.ts`, `main/whatsapp/atendimento/store.ts`, `main/whatsapp/atendimento/log.ts`, `preload/index.ts`, testes | — | 1 |
| 139 | Motor de resposta: prompt, leitura da saída, `purpose` novo | `main/whatsapp/atendimento/reply.ts`, `main/meetings/claude-one-shot.ts`, testes | 138 | 2 |
| 140 | Agendador: atraso, reagendamento, horário, limites, pausa | `main/whatsapp/atendimento/scheduler.ts`, testes | 138 | 2 |
| 141 | Serviço de atendimento, `AgentSendProof`, gancho no `onMessage`, notificação, testes de invariante | `main/whatsapp/atendimento/service.ts`, `main/whatsapp/send-guard.ts`, `main/whatsapp/service.ts`, `main/whatsapp/client.ts`, `main/index.ts`, `test/whatsapp.test.ts`, testes novos | 139, 140 | 3 |
| 142 | Interface dos agentes: aba "Atendimento" nas Automações, formulário, "Testar", histórico | `renderer/src/features/atendimento/*`, `features/agents/AutomationsScreen.tsx`, `atendimentoStore.ts` | 141, mockup aprovado | 4 |
| 143 | Interface da conversa: painel "Atendimento", selos, proposta de rascunho, "Pausar todos", aviso de risco | `features/whatsapp/WhatsAppScreen.tsx`, `features/whatsapp/*` novos, `whatsappStore.ts` | 142, mockup aprovado | 5 |
| 144 | Smoke com o serviço falso, prints, README, guia do app e documentação do WhatsApp | `main/smoke.ts`, `main/smoke-fixtures.ts`, `README.md`, `docs/` permanentes | 143 | 6 |

## Waves

- Wave 1: 138.
- Wave 2: 139 e 140 em paralelo (arquivos disjuntos), um worktree por agente.
- Waves 3 a 6: 141, 142, 143 e 144, uma por vez.

## Arquivos quentes

`main/index.ts`, `shared/ipc.ts`, `preload/index.ts`, `main/smoke.ts` e
`features/whatsapp/WhatsAppScreen.tsx` são grandes e mexidos por muitas features: cada um
aparece em uma única tarefa por wave.

## Gates

- Contratos 138 a 140 (sem tela, sem tocar no envio): `pnpm typecheck && pnpm lint && pnpm test`,
  da raiz.
- Contratos 141, 143 e 144: `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`, sempre da raiz
  (8 passos: typecheck, lint, testes, build, smoke e pytest do serviço). O 142 roda os gates
  rápidos e entra no smoke completo do 143.
- Contratos 138 a 141: testes unitários novos listados em cada contrato.
- Contrato 144: checks novos em `smoke.ts` e os prints da spec.

## Fechamento

README e guia do app com a seção "Atendimento no WhatsApp" (em "Experimental"), documentação
do WhatsApp corrigida quanto ao diálogo retirado pelo contrato 33, teste navegado em sessão
nova depois da release, spec movida para `docs/specs/_archive/whatsapp-agentes/`.

## Cobertura

| Requisito | Contrato |
|---|---|
| R12, R14, modelo de dados | 138 |
| R3, R11, N2, N4, N5 | 139 |
| R1, R2, R8, R9, R10, R13 | 140 |
| R4 a R7, N1, N3, N6, N7 | 141 |
| Telas dos agentes, CA16 | 142 |
| Telas da conversa, CA4, CA14 | 143 |
| Verificação end-to-end, prints | 144 |

## Ambiguidades

1. **App bloqueado.** O precedente do e-mail agendado é "app bloqueado não envia". Aqui a
   proposta é o contrário (N7): o atendimento segue com o app bloqueado, porque a função dele
   é responder quando o dono não está. Precisa do ok do Andrew.
2. **"Apresenta-se como assistente" desligado por padrão.** Segue o pedido de "não parecer
   bot"; a regra N4 impede que o agente minta se perguntarem.
3. **Atraso como faixa.** O pedido foi "depois de X minutos"; a faixa de X a Y dá variação
   natural, e X igual a Y vira atraso fixo.
4. **Grupos fora** por falta de resposta e por limitação do serviço (sem menções, sem
   identificador de quem mandou).

## Pendências

- Mockups das telas antes dos contratos 142 e 143.
- Escrever os contratos 138 a 144 depois da aprovação da spec.
