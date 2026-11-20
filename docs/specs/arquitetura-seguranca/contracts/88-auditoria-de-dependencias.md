# Contrato 88 — Auditoria de dependências nos gates
Feature: arquitetura-seguranca · Wave: 1 · Depende de: — · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa S5 do plan (R9). `scripts/gates.sh` tem 8 passos (typecheck, lint, test, build, smoke, cor literal,
formas, pytest da ponte) e nenhum olha vulnerabilidade conhecida nas dependências npm. Este contrato acrescenta o
passo 9: `pnpm audit` falhando em severidade alta ou crítica, com uma lista de exceções datada no repositório.

Estado conferido em 20/11/2026 (pnpm 11.4.0, `pnpm-lock.yaml` da main `bf9ceba`): `pnpm audit --prod --audit-level
high` → "No known vulnerabilities found"; `pnpm audit` (com dev) → 1 moderada (`minimatch`, GHSA-g3hv-75wg-m249).
Ou seja, o passo novo nasce verde sem exceção.

## Pré-condições
- Main em dia, gates verdes. Acesso à rede no ambiente dos gates (o `pnpm audit` consulta o registro do npm).
- Ler antes: `scripts/gates.sh` (inteiro), `apps/desktop/package.json` (`dependencies` × `devDependencies`: o
  `electron` está em **dev**), `pnpm-workspace.yaml` e `pnpm audit --help`.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `scripts/gates.sh` | passos renumerados `1/9`…`8/9`; passo novo `9/9 dependências (pnpm audit)` no fim (CA1–CA5) |
| `scripts/audit-exceptions.txt` | **novo**: lista de exceções, começa só com o cabeçalho de comentário (CA3) |
| `scripts/audit-check.mjs` | **novo**: lê as exceções, valida datas e monta os `--ignore` (CA3, CA4) |
| `test/audit-check.test.ts` | **novo** (CA6) |

Nada fora disto. `package.json`, `pnpm-lock.yaml` e `pnpm-workspace.yaml` sem diff.

## Critérios de aceite
- **CA1 — O passo.** `step '9/9 dependências (pnpm audit)'` roda, na raiz do repo, `pnpm audit --audit-level high`
  com os `--ignore <GHSA>` vindos do CA3. Saída 0 → segue para "gates ok"; qualquer vulnerabilidade alta ou crítica
  não listada → o passo falha (o `set -e` para o script) e a saída do `pnpm` aparece inteira. Moderada e baixa não
  falham.
- **CA2 — O que é auditado.** O passo cobre as dependências de produção **e o `electron`** (que vai dentro do app, mas
  está em `devDependencies`). Por isso o comando é sem `--prod` (ver Dúvidas, item 1). Os outros 8 passos e a ordem
  deles não mudam; o audit vem por último para uma falha de rede não esconder um erro de código.
- **CA3 — Exceções datadas.** `scripts/audit-exceptions.txt`: uma por linha, `GHSA-xxxx-xxxx-xxxx  AAAA-MM-DD  motivo`
  (ID, data em que a exceção **vence**, texto livre); linha vazia e linha começando com `#` são ignoradas. O cabeçalho
  em comentário explica o formato e que a exceção tem no máximo 90 dias. `audit-check.mjs` imprime os `--ignore` para
  o `gates.sh` (uma linha por argumento).
- **CA4 — Exceção inválida reprova.** `audit-check.mjs` sai com código 1 e mensagem em pt-BR quando: o ID não casa
  `^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$`; a data não é `AAAA-MM-DD` válida; a data já passou (`vencida em
  AAAA-MM-DD: GHSA-…`); a data está a mais de 90 dias de hoje; o motivo está vazio; o mesmo ID aparece duas vezes.
  Exceção vencida não é ignorada em silêncio: o gate para até alguém renovar ou corrigir.
- **CA5 — Sem rede.** Se o `pnpm audit` falhar por erro do registro ou de rede (não por vulnerabilidade), o passo falha
  com `pnpm audit não conseguiu falar com o registro; rode de novo com rede` e código diferente de 0. Não se usa
  `--ignore-registry-errors`. Nenhuma variável de ambiente pula o passo.
- **CA6 — vitest.** `test/audit-check.test.ts` roda o `audit-check.mjs` (`execFile` com `process.execPath` e um
  arquivo de exceções temporário, com a data de "hoje" injetada por `AUDIT_TODAY=AAAA-MM-DD`): arquivo só com
  comentários → saída vazia, código 0; uma exceção válida → `--ignore\nGHSA-…`; cada caso do CA4 → código 1 com a
  mensagem certa; duas válidas → dois pares, na ordem do arquivo.

## Invariantes
- Os passos 1 a 8 de `gates.sh` com os mesmos comandos; só o rótulo `N/8` vira `N/9`.
- `SMOKE_NO_SANDBOX=1` continua só afetando o smoke.
- Nenhuma dependência nova (o `audit-check.mjs` usa só `node:fs`, `node:path` e `node:process`).

## Fora de escopo
- Auditar as dependências Python da ponte do WhatsApp (`services/whatsapp-bridge/requirements*.txt`, `pip-audit`).
- Corrigir vulnerabilidade (`pnpm audit --fix`), atualizar dependência, CI remoto (o repo não tem `.github/`). F1–F7.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos **9 passos**.
- `test/audit-check.test.ts` novo; prova manual registrada no relatório: uma exceção com data passada em
  `audit-exceptions.txt` faz o passo 9 falhar, e tirada a linha ele volta a passar.
- `git diff --stat` só com a Superfície. Sem commit.

## Dúvidas para o coordenador
1. **`--prod` deixa o Electron de fora.** A spec pede `pnpm audit --prod`, mas o `electron` (o runtime que vai no
   `.app`) é `devDependency` em `apps/desktop/package.json`; com `--prod` uma vulnerabilidade do Chromium/Electron
   passaria. O CA2 audita tudo (hoje: só 1 moderada, que não reprova). Alternativa: manter `--prod` e checar o
   Electron à parte. Qual?
2. **Rede obrigatória nos gates (CA5).** Hoje os gates rodam sem rede depois do primeiro `pip install`; com este passo,
   gate sem rede falha. Aceitar, ou permitir pular com um aviso explícito?
