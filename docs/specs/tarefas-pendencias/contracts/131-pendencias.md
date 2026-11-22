# Contrato 131 — Fechar as pendências das Tarefas
Feature: tarefas-pendencias  ·  Wave: única  ·  Depende de: 0.21.0 (`main 71789f0`)

## Pré-condições
- Branch `tarefas-pendencias` a partir de `71789f0`; `pnpm gates` verde na base.
- Constituição: `CLAUDE.md` do repo e `docs/specs/desktop-shell/design.md`.

## Superfície
- `apps/desktop/src/shared/{tarefas,tarefas-schema,tarefas-logic,tarefas-sugestoes}.ts`; `main/tarefas/service.ts` (origem
  `analise` ao adicionar sugestão); `main/index.ts` (`lembretesFuturos`); `main/schedules/service.ts`; `features/schedules/SchedulesTab.tsx`;
  `features/funil/{funilFormat.ts,OportunidadeScreen.tsx}`; `features/tarefas/{tarefasFormat.ts,TarefaLinha.tsx,SugestoesTarefas.tsx,TarefaDetalhe.tsx}`
  (origem `analise`, "Abrir reunião"); `features/email/ReadingPane.tsx` e `features/funil/ContactLink.tsx` (R5);
  `shared/routes.ts` (`TarefasNavigationState.agrupar`) e `features/tarefas/TarefasScreen.tsx` (ler o state);
  `main/smoke.ts` e `main/smoke-fixtures.ts` (checks dos CA; sem print novo; `expectedShots` não muda); testes.

## Critérios de aceite
Os CA1–CA6 da spec, cada um com a asserção ali descrita (Dado/Quando/Então implícito). Detalhes do smoke só com números e
booleanos.

## Invariantes
- Nenhum canal IPC novo; schema de `tarefas.json` só ganha o caso `analise` (arquivos antigos continuam válidos).
- Migração (`main/tarefas/migracao.ts`) e leitura de `ScheduledTask.reminder` legado não mudam.
- Só tokens de `tokens.css`; raio ≤ 6 px; sem sombra; sem pílula; sem modal; linhas 44/28 px.
- Os demais prints e checks do smoke continuam iguais.

## Fora de escopo
Tudo que não está nos R1–R5.

## Gates
- `pnpm gates` da raiz, verde por inteiro (tela do Mac acesa para o smoke).
- Testes novos: CA1 (sugestões/`jaVirou`), CA3 (`lembretesFuturos`), ajuste dos testes que perdem código morto (R2).
