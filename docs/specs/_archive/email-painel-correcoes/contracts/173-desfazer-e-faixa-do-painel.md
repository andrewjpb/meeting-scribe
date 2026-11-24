# Contrato 173 — Desfazer do Painel em toda conta e faixa da Caixa de Entrada
Feature: email-painel-correcoes · Wave: 1 · Depende de: — · Spec: `docs/specs/email-painel-correcoes/spec.md` (R1–R5)

Caminhos relativos a `apps/desktop/src`. Constituição: `~/CLAUDE.md`, `docs/specs/desktop-shell/design.md`. Contexto do Painel: `docs/specs/_archive/email-dashboard/` (spec, contratos 156, 157, 170).

## Pré-condições
- Branch `email-dashboard` no worktree, HEAD com "versão 0.25.0" (ou posterior) já incluído.
- Nenhum outro smoke rodando antes do `pnpm gates`: `while pgrep -fl 'node .*scripts/smoke\.mjs|electron.*--smoke' | grep -v '/bin/zsh -c' | grep -q .; do sleep 30; done` (não use `pgrep -f gates.sh`: casa com a própria linha de comando).

## Superfície
- `main/email/dashboard.ts` — `applyMove` (~linhas 350–385): `moveMessages(accountId, 'INBOX', …)` e `fromPath: 'INBOX'`; o serviço já expõe `foldersInCache(accountId)` (pastas com `path`, `name`, `specialUse`).
- `main/email/organize.ts` — `undo` (~linha 857): `exists(item.fromPath)` → `origin-missing`.
- `renderer/src/features/email/emailStore.ts` (~linhas 184, 422, 437): a faixa da pasta vem de `batches[batchId]` preenchido a partir de `result.today`/`running` dos eventos de organização; `organizeState.ts` já tem `BatchMeta.origem` e o título "O Painel moveu…".
- `main/smoke.ts` — check `dashboardMove` (grupo `email`); `main/smoke-fixtures.ts` / `main/email/fake-email.ts` se for preciso uma conta ou pasta de entrada com caminho diferente de `INBOX`.
- Testes: `test/main/email-dashboard.test.ts`, `test/main/email-organize*.test.ts` (ou o que cobre `undo`), `test/renderer/email-store*.test.ts` / `email-organize-state.test.ts`.

## Critérios de aceite
- **CA1 (revisto) — origem canônica no lote.** Dado qualquer conta (listagem com `INBOX`, listagem só com `{ path: 'Caixa de entrada', specialUse: '\Inbox' }`, ou sem pasta de entrada), quando `applyMove` move mensagens, então `moveMessages` é chamado com `fromPath === 'INBOX'` e cada item do lote tem `fromPath === 'INBOX'`. Nunca o caminho localizado. Teste de unidade com os três casos (o caso Zoho é o que importa).
- **CA2 (revisto) — `INBOX` existe se há pasta de entrada.** Dado um lote com `fromPath: 'INBOX'` e uma listagem sem `INBOX` mas com uma pasta de `specialUse` de entrada, quando o Desfazer roda, então nenhum item falha com `origin-missing`, e a volta (`moveMessages`/`locateMessages` e tudo o que o serviço recebe) usa **`'INBOX'`** como caminho de origem, nunca `'Caixa de entrada'`, para que `moveQueued` (`service.ts` ~1407–1443) reconheça a entrada, atualize a lista local e marque as mensagens como movidas de volta (não como e-mail novo). Lote com `fromPath` de pasta realmente apagada continua `origin-missing`. Testes: os dois casos no `undo`, mais um que afirma o `fromPath` recebido pelo serviço na volta (`'INBOX'`). `service.ts` não muda.
- **CA3 — faixa na Caixa de Entrada.** (Com o lote em `INBOX`, o filtro da faixa que já existia basta; a extensão `bannerInFolder`/`folderPhrase(inboxPath)` só fica se ainda for necessária para algum caso real, senão é removida para manter o diff mínimo.) Dado um lote criado pelo Painel, quando o usuário abre a Caixa de Entrada da conta, então a faixa do topo mostra "O Painel moveu 3 mensagens" (ou "1 mensagem") com hora e Desfazer, e a Caixa de Entrada do Assistente não muda de comportamento. O Painel continua mostrando a sua própria faixa; não há duas faixas na mesma tela. Teste de renderer no store ou no `organizeState` conforme o caminho escolhido (D2 do plan), e no smoke: `dashboardMove` ganha `inboxBanner=true|false` (clicar em Caixa de Entrada depois do Mover todos, antes do Desfazer, e conferir o título da faixa pelo `data-*`; depois voltar ao Painel e desfazer como hoje).
- **CA4 — Desfazer pela faixa da pasta.** Dado a faixa do CA3, quando o usuário clica em Desfazer nela, então as mensagens voltam e a faixa diz "Desfeito", igual ao Assistente. Coberto pelo teste existente do Desfazer da faixa se o caminho for o mesmo; se não, acrescentar.
- **CA5 — gate completo.** `pnpm gates` da raiz verde; `report.json` sem `failures`; os 8 checks `dashboard*` ok, com `inboxBanner=true` no `dashboardMove`; `apps/desktop/out/` só com `main`, `preload`, `renderer`, `smoke`. Os 14 prints do Painel continuam existindo (sem print novo).

## Invariantes
- `main/email/service.ts` não muda; o servidor IMAP e o serviço só recebem `INBOX` como caminho da entrada.
- R36: `detail` só `chave=valor` numérico/booleano; nenhum e-mail em log.
- Nenhum canal IPC novo, nenhum token/raio/tamanho novo, nenhum texto aprovado do mockup alterado.
- O lote do Assistente (`organize.ts`, `item.origin.path`) não muda de formato; o Desfazer dele continua igual.

## Fora de escopo
- Os achados baixos do teste (F1 da spec). Qualquer mudança no Assistente ou nas regras.

## Gates
- `pnpm -C apps/desktop typecheck`, `lint`, `test`; `pnpm gates` da raiz (smoke; tela desbloqueada). Relatório: arquivos tocados, CA1–CA5 com evidência, decisões (especialmente a do D2), o que não foi feito, bugs vistos fora do escopo.
