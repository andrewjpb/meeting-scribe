---
feature: email-dashboard
tipo: plan
status: aprovada-2026-11-23
criado: 2026-11-23
contratos: 155–158
---

# Plan: Painel de e-mail

Caminhos relativos a `apps/desktop/src`. Constituição: `~/CLAUDE.md` + `docs/specs/desktop-shell/design.md`.

## Decisões técnicas

- **D1 Store próprio** `userData/email/dashboard.json` em vez de campos na mensagem: o cache de
  mensagens é reescrito a cada poll e tem 200 por conta; a análise precisa sobreviver a isso e
  guardar ignorados. Molde: `main/tarefas/store.ts` (gravação atômica, `ignorados`).
- **D2 Lógica pura em `shared/`** (`shared/email-dashboard.ts`: tipos, chaves, montagem da
  visão, ranking, agrupamento, filtros de pasta) para testar sem Electron e reaproveitar no
  renderer. Molde: `shared/tarefas-sugestoes.ts`.
- **D3 Passada via `runClaudeOneShot`** com `purpose: 'email-dashboard'` novo (ampliar a união
  em `claude-one-shot.ts:36`), prompt em `main/claude-cli/email-dashboard.ts` (molde
  `funnel.ts`), parse por `extractJsonObject`. Nada de ferramentas, nada de ACP de chat.
- **D4 Mover reaproveita os lotes do agente** (`batches.ts` + `undoBatch` de `organize.ts`),
  com `origem: 'painel'` no lote para o `EmailBatchCard`/banner distinguir o texto. Zero código
  novo de MOVE.
- **D5 Composer pré-preenchido por estado de navegação** (`EmailNavigationState.compose`
  ganha `replyTo` e `text`), não por IPC: o `EmailScreen` já sabe montar rascunho e assinatura.
- **D6 Painel é rota da tela Email** (`/email/painel`), não tela nova no nav raiz: herda o
  redirect de "sem conta", a barra lateral e o banner de Desfazer.
- **D7 Agendamento diário** no main por `setInterval` de 15 min que confere `lastRun.at` ≠ dia
  civil local, desbloqueado e online (`net.isOnline()`), reaproveitando o critério de
  `inicioChanged` para o bloqueio. Sem cron, sem timer em renderer.
- **D8 Tetos fixos em constantes exportadas** (`DASHBOARD_LIMITS`) para os testes citarem os
  mesmos números da spec (R2–R5).
- **D9 Fixture do smoke**: `test/fixtures/fake-claude.mjs` ganha a resposta determinística para
  `purpose: 'email-dashboard'` (JSON com importância, resposta e mover para a pasta
  "Newsletters" que o `fake-email.ts` já cria ou passa a criar). Nenhum print depende de
  modelo real.
- **D10 Numeração 155–158** (147–154 reservados por outra sessão). Versão decidida no
  fechamento.

## Grafo de tarefas

| # | Microtarefa | Arquivos que toca | Depende de | Wave |
|---|---|---|---|---|
| 155 | Dados, store, lógica pura, settings | `shared/email-dashboard.ts` (novo), `shared/email-dashboard-schema.ts` (novo), `main/email/dashboard-store.ts` (novo), `shared/settings-defaults.ts`, `shared/routes.ts` (slug `painel`, `compose.replyTo/text`), testes `test/shared/email-dashboard*.test.ts`, `test/main/email-dashboard-store.test.ts` | — | 1 |
| 156 | Passada de IA, serviço, IPC, lotes, agendamento | `main/claude-cli/email-dashboard.ts` (novo), `main/email/dashboard.ts` (novo), `main/meetings/claude-one-shot.ts` (purpose), `main/email/service.ts` (hooks mínimos: `cachedFolders`, `loadBody` exposto), `main/email/batches.ts` (origem), `shared/ipc.ts`, `main/index.ts` (registro, bloqueio, remove-account), `preload`, `test/fixtures/fake-claude.mjs`, testes `test/main/email-dashboard*.test.ts` | 155 | 2 |
| 157 | Tela Painel, EmailNav, Composer pré-preenchido, Configurações | `features/email/PainelEmail.tsx` (novo), `features/email/painelStore.ts` (novo), `features/email/EmailNav.tsx`, `features/email/EmailScreen.tsx`, `app/Sidebar.tsx`, `app/SidebarStack.tsx`, `app/useMainNavigation.ts`, `features/settings/EmailSettingsTab.tsx`, `features/settings/EmailPainelSection.tsx` (novo), testes renderer | 156, mockup aprovado | 3 |
| 158 | Smoke (checks + 14 prints), docs permanentes, design.md, docs/telas | `main/smoke.ts`, `main/email/fake-email.ts` (pasta Newsletters se faltar), `README.md`, `resources/assistente/guia-do-app.md`, `docs/specs/desktop-shell/design.md`, `docs/telas/README.md` | 157 | 4 |

### Waves

Quatro waves sequenciais de um contrato cada: todas tocam arquivos quentes compartilhados
(`routes.ts`, `ipc.ts`, `index.ts`, `smoke.ts`) e a outra sessão também mexe neles; não há
ganho em paralelizar. Um implementador por vez, na árvore do worktree `email-dashboard`.

### Artboards do mockup (gate humano antes do 157)

`mockups/EmailPainel.dc.html`: A Painel cheio, B vazio, C IA desligada, D resposta expandida,
E Composer pré-preenchido, F Config Email › Painel, G Painel com banner de Desfazer. Render em
Chrome headless 1120×740 escala 2 para `mockups/png/`.

## Gates

- Rápidos (155, 156, 157 durante o desenvolvimento): `pnpm -C apps/desktop typecheck`,
  `pnpm -C apps/desktop lint`, `pnpm -C apps/desktop test`.
- Completo (fim de 157 e no 158): `pnpm gates` **da raiz** (inclui build e smoke; smoke exige
  tela desbloqueada; não rodar enquanto outro smoke estiver ativo: `pgrep -fl smoke`).
- Teste estático obrigatório no 156: nenhuma string de log/`detail` recebe `subject`, `from`,
  `preview` ou `reply`.

## Fechamento

1. Auditoria dos 14 prints (molde `docs/specs/_archive/funil-vendas/auditoria-prints.md`).
2. Docs: README (seção Email, inclusive o que já estava defasado: pastas, regras, assinatura,
   Configurações › Email), `guia-do-app.md` (Email › Painel; Configurações › Email › Painel),
   `design.md` (seção "Email › Painel"), `docs/telas/README.md` (artboards novos).
3. Juntar a main (prováveis conflitos com `ia-midia`/`inicio-atualizar` em `index.ts`,
   `ipc.ts`, `smoke.ts`, `settings-defaults.ts`), gates completos de novo.
4. Versão: a próxima livre na hora (`release.sh <versão>` na cópia principal, main, árvore
   limpa). Push e release só com ok explícito do Andrew.
5. Arquivar `docs/specs/email-dashboard/` em `docs/specs/_archive/`; cofre com `status:
   arquivado`; prompt de teste navegado para uma sessão nova.

## Worktree

`~/Documents/GitHub/meeting-scribe-email-dashboard`, branch `email-dashboard`, base `47ad5c1`.
Nada é gravado em `apps/desktop/out/` além do próprio smoke.

## Ambiguidades da spec resolvidas aqui

- "Arquivar": pasta com uso especial `\Archive` quando o servidor informa; senão, pasta
  chamada `Archive`/`Arquivo`/`Arquivados` se existir; senão não há "Arquivar", só "Mover para".
- "Últimos 7 dias" conta pela `date` da mensagem, não pela chegada.
- Idioma da resposta: o do e-mail recebido; o prompt diz isso e pede português do Brasil em
  caso de dúvida.

## Pendências (fora deste plan)

- Marcar importância no `EMAILS.md` do Assistente.
- Spec `email-organizacao` implementada e não arquivada (arquivar noutra frente).
- README defasado sobre email: corrigido no 158 só no que toca esta frente e no que já estava
  errado (pastas, regras, assinatura, caminho das Configurações).
