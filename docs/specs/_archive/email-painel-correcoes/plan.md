# Plan — email-painel-correcoes
## Decisões técnicas
- D1 (revista). O servidor e o serviço continuam falando `INBOX` (R1); só a checagem de existência do Desfazer aceita a pasta de entrada da listagem como prova de que `INBOX` existe (R2). Motivo: `moveQueued` só reconhece a entrada por `INBOX`; mandar o caminho localizado quebraria a lista local e a volta pelo Desfazer (bloqueadores da revisão do 173).
- D2. A faixa da pasta reaproveita o caminho dos eventos do Assistente (R3): o lote do Painel passa a constar na lista que `emailStore.ts` consulta (`result.today`/`running`), ou o main emite o evento equivalente ao criar o lote; o `BatchMeta.origem` já diferencia o título.
- D3. Uma wave, um contrato (173). Smoke: o check `dashboardMove` passa a conferir também a faixa na Caixa de Entrada e o cenário com caminho de entrada diferente de `INBOX`.
## Grafo de tarefas
| # | Microtarefa | Arquivos | Depende de | Wave |
|---|---|---|---|---|
| 173 | Desfazer do Painel em toda conta e faixa da pasta | `main/email/dashboard.ts`, `main/email/organize.ts`, `renderer/src/features/email/emailStore.ts` (+ `organizeState.ts`), `main/smoke.ts`, `main/smoke-fixtures.ts`/`fake-email.ts` se preciso, testes | — | 1 |
## Gates
- `pnpm -C apps/desktop typecheck`, `lint`, `test`; `pnpm gates` da raiz (smoke, tela desbloqueada, sem outro smoke).
