# Plan — notificacoes-triagem-correcoes (0.25.1)

Base: `8b55751` · Spec: `spec.md` · Contrato único: 171 · Branch: main (árvore principal; a frente `pastas-assistente` está em worktree próprio e toca `main/chat/*`, `features/chat/ActionCards.tsx`, `ChatMessages.tsx` — ver decisão 4).

## Decisões técnicas
1. **Um contrato só** — são 11 pontos pequenos e localizados (1–15 linhas cada) em arquivos já conhecidos; dividir em waves custaria mais coordenação que código. Gate completo uma vez, ao fim.
2. **Defesa no main para "Rodar agora"** — além de esconder o botão, `startTask` recusa `whatsapp-message`: o renderer não é a única porta (IPC, rerun).
3. **`trigger` continua `'whatsapp'` nas manuais** — o teto diário (`hojeTrigger('whatsapp')`) e a aba Execuções dependem dele; a distinção vai no `prompt` ("· Triar agora").
4. **Risco de conflito com `pastas-assistente`** — C9 toca `features/chat/ChatMessages.tsx` (`AssistantHeader` ganha `author?`). A frente de pastas também toca esse arquivo (prop `chatId`). Mudança de 3 linhas, em função diferente; quem fizer o merge depois resolve à mão. Se a frente de pastas já tiver mesclado quando o 171 começar, melhor ainda.
5. **`cortarMotivo` em `shared/triagem.ts`** — um ponto de corte para os dois usos; teste ajustado de `toHaveLength(160)` para `≤160` e terminando em "…".
6. **Evento `scribe:triagem-done`** em vez de adivinhar pelo `triagem-changed` (que não dispara em falha/timeout/sem mudança).
7. **Sem mockup novo** — nenhuma tela nova; textos e visibilidade dentro de telas aprovadas na 0.24.0.

## Grafo de tarefas
| # | Microtarefa | Arquivos que toca | Depende de | Wave |
|---|---|---|---|---|
| 171 | C1–C11 (ver contrato) + checks do smoke + docs | `renderer/src/features/whatsapp/{WhatsAppScreen,EtiquetaBar}.tsx`, `triagemStore.ts`, `features/notificacoes/NotificacaoRow.tsx`, `features/schedules/{SchedulesTab,RunsTab,TaskForm}.tsx`, `features/agents/parts.tsx`, `features/chat/ChatMessages.tsx`, `main/whatsapp/triagem/{service,classify}.ts`, `main/schedules/service.ts`, `shared/{triagem,ipc,automations}.ts` (modelo pronto), `main/smoke.ts`, `test/*`, `README.md`/guia do app (se algum texto citado mudar) | — | 1 |

## Gates
- Por contrato: `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test`.
- Gate completo `pnpm gates` (coordenador, ~25 min, tela desbloqueada) antes da versão 0.25.1; auditoria dos prints afetados; `pack.sh`; teste navegado curto em sessão nova; arquivamento em `docs/specs/_archive/notificacoes-triagem-correcoes/`.
