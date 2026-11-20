---
status: aprovado
feature: assistente-agenda
data: 2026-11-20
semana: 2026-W47
---

# Plan: Assistente — eventos no Calendário, lembretes editáveis, tela sem cabeçalho

Spec `spec.md` (aprovada pelo Andrew em 2026-11-20) · Mockup `mockups/AssistenteAgenda.dc.html` (aprovado) · Branch `assistente-agenda` (worktree `~/Documents/GitHub/meeting-scribe-assistente-agenda`, base 3b973e7 = 0.17.1). Entra no mesmo build local da frente `redes-instagram`; sem release.

## Decisões técnicas
1. **Cartões, não ferramentas.** Tudo passa por `lap-acao` + clique: três tipos novos (`evento`, `lembrete-editar`, `lembrete-apagar`) no mesmo mecanismo do `lembrete` (proposta → `resolve` → cartão → canal → `done`/`failed`). Sem token de clique (igual ao lembrete: o clique no cartão é a confirmação; o canal exige `status === 'proposed'` e `busy`).
2. **Dois canais novos**: `scribe:chat-action-event` e `scribe:chat-action-reminder-change`; `test/assistant.test.ts` atualiza a lista fixa.
3. **Calendário pelo `macCalendar` existente** (`create`, `calendars`, `status`), agenda resolvida por nome → `inviteCalendarId` → padrão gravável; registro próprio `userData/chat-events.json` (zod, atômico) para a fase de editar/apagar eventos.
4. **`automations.updateReminder`** novo no `schedules/service.ts` (mantém `runOnce`/`runOnceAction`, recalcula `nextRunAt`, recusa passado, rejeita tarefa sem `reminder`); `deleteTask` já existe.
5. **Contexto**: ids dos lembretes em `AUTOMACOES.md` e `ESTADO.md`; seção "Agendas do Mac" em `ESTADO.md` (nomes, nunca ids); instrução de sistema e guia atualizados.
6. **Tela**: só remover o `PageHeader` do `ChatScreen`; a linha da conversa (56 px no código) vira o topo.
7. **Smoke**: `fake-lap-calendar.mjs` já simula o helper; o falso do agente (`fake-acp-agent.mjs`) ganha respostas por regex para "aniversário"/"adie o lembrete"/"apague o lembrete".

## Grafo de tarefas
| Wave | Contrato | Entrega |
|---|---|---|
| 1 | **78 — Assistente agenda** | tudo da spec (R1–R5, CA1–CA10) num contrato só: é um domínio pequeno e os arquivos se cruzam (actions, store, ActionCards, canais, smoke) |

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde no worktree.

## Fechamento
Revisor cego → uma devolução → commit pelo agente → merge na main junto com o Instagram → build local → teste conjunto → teste navegado em sessão nova → docs (guia, README, docs/telas) → `_archive/assistente-agenda/`.
