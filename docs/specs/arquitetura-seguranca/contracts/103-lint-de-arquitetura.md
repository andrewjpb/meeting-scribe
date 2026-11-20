# Contrato 103 — Lint de arquitetura: `node:fs` só na camada de armazenamento
Feature: arquitetura-seguranca · Wave: 8 · Depende de: 102 (e, por ele, 93–101) · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa A11 do plan (R12, T8). Depois da onda 3, todo dado do app passa por `src/main/storage/`. Este contrato
trava isso: uma regra no `eslint.config.mjs` reprova acesso ao sistema de arquivos em `src/main/**` fora de
`storage/` e de uma **lista fechada de exceções nomeadas**, cada uma com o motivo. O gate 2 (lint) passa a reprovar
quem voltar a gravar dado por fora.

## Pré-condições
- 93–102 commitados; gates verdes. Rodar `grep -rln "node:fs\|'fs'\|'fs/promises'\|original-fs" src/main` e conferir que
  a saída é **exatamente** `storage/**` + a lista do CA2 + os quatro arquivos que este contrato migra (CA3). Arquivo a
  mais = um contrato anterior não terminou: **parar e relatar**, não acrescentar exceção.
- Ler antes: `eslint.config.mjs` (38 linhas, flat config com `typescript-eslint`), `src/main/storage/*`, e cada arquivo da lista.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `eslint.config.mjs` | bloco novo para `src/main/**/*.ts` com a regra (CA1) e bloco que a desliga só nos arquivos do CA2 |
| `src/main/storage/fs-exceptions.json` | **novo**: `FS_EXCEPTIONS` — a lista do CA2 como dado (`[{ "file", "motivo" }]`), lida pelo `eslint.config.mjs` (`readFileSync` + `JSON.parse`: o config é `.mjs` e não importa `.ts`) e pelo teste |
| `src/main/claude-cli/service.ts`, `src/main/meetings/claude-one-shot.ts`, `src/main/schedules/runner.ts` | o `mkdir` da pasta de trabalho em `userData` passa pela função de pasta do `storage/` (CA3) |
| `src/main/meetings/overview.ts` | o `stat` (cache da busca por inode/data/tamanho) passa pelo `storage/` (CA3) |
| `src/main/storage/files.ts` | `statPath(path)` → `{ ino, mtimeMs, size } \| null` (CA3) |
| `test/architecture-fs.test.ts` | **novo**: CA4, CA5 |

## Critérios de aceite
- **CA1 — A regra.** Em `src/main/**/*.ts`, fora de `src/main/storage/**` e de `FS_EXCEPTIONS`:
  - `no-restricted-imports` com `paths` `node:fs`, `node:fs/promises`, `fs`, `fs/promises`, `original-fs`, mensagem
    `Acesso a disco só por src/main/storage/ (contrato 103). Exceção nova precisa de contrato.`;
  - `no-restricted-syntax` para `ImportExpression` e `CallExpression[callee.name='require']` com esses mesmos nomes
    (o `no-restricted-imports` não pega `import()` dinâmico nem `require`).
  *Teste:* `eslint --stdin --stdin-filename src/main/qualquer/x.ts` com `import { readFile } from 'node:fs/promises'`
  sai com código 1 e a mensagem; o mesmo texto com `--stdin-filename src/main/storage/x.ts` sai 0.
- **CA2 — Exceções legítimas** (levantadas no código em 20/11/2026; cada uma lê ou grava **fora** dos dados do app,
  ou é segredo binário que a spec deixa de fora):
  | Arquivo | Motivo |
  |---|---|
  | `src/main/acp/install.ts` | instalação do adaptador ACP (pacote baixado, pasta do agente) |
  | `src/main/whatsapp/install.ts` | instalação do ambiente Python e da ponte do WhatsApp |
  | `src/main/updates/download.ts`, `src/main/updates/service.ts` | atualização: baixa o `.dmg` e apaga o temporário |
  | `src/main/audio-files/service.ts` | áudio: grava a reunião (`.part` + `appendFile`) na pasta escolhida pelo usuário |
  | `src/main/audio-files/download.ts`, `src/main/audio-files/summary-file.ts` | exportação para pasta do usuário ("Baixar…", resumo `.md`) |
  | `src/main/schedules/outputs.ts` | exportação: saída `file` das tarefas em `<pasta das reuniões>/Agentes/` |
  | `src/main/plugins/save.ts` | exportação: "Salvar plugin…" copia a extensão para a pasta escolhida |
  | o arquivo que salva anexo de email (onde 87/102 o deixarem, hoje `index.ts:2246`) | exportação: anexo para Downloads |
  | `src/main/email/attach.ts`, `src/main/whatsapp/attach.ts` | lê o arquivo que o usuário escolheu para anexar |
  | `src/main/google/drive-files.ts` | lê áudio e transcrição da pasta das reuniões para enviar ao Drive |
  | `src/main/acp/agent.ts` | leitura pedida pelo agente, presa à pasta da conversa (`insideFolder`) |
  | `src/main/mcp/cli.ts`, `src/main/mcp/service.ts` | config do Claude CLI (`~/.claude.json`) e conferência do executável |
  | `src/main/mac-calendar/process.ts`, `src/main/mic-watch/process.ts` | localizar o binário auxiliar empacotado |
  | `src/main/protocol.ts` | esquema `scribe://`: serve os arquivos do renderer |
  | `src/main/secrets.ts`, `src/main/accounts/vault.ts` | segredos binários e síncronos (F5: só listados na tela Sistema) |
  | `src/main/branding/service.ts` | **dívida**: logo convertido em `userData/branding/` (binário); migrar quando `storage/` gravar bytes |
  | `src/main/invites/ics-file.ts`, `src/main/invites/service.ts` | **dívida**: `.ics` temporário em `userData/tmp/` para o Calendário abrir |
  | `src/main/smoke.ts`, `src/main/smoke-fixtures.ts`, `src/main/whatsapp/fake-index.ts`, `src/main/whatsapp/install-test.ts` | smoke e teste de instalação: preparam e conferem arquivos por fora, de propósito |
- **CA3 — Quatro migrações pequenas.** `claude-cli/service.ts`, `meetings/claude-one-shot.ts` e `schedules/runner.ts` só
  usam `mkdir` (pasta de trabalho do `claude` em `userData`); `meetings/overview.ts` só usa `stat`. Passam a chamar
  `ensureDir` (93) e um `statPath` novo em `src/main/storage/files.ts` (o arquivo do 100), com teste. Os testes de
  cada um (`claude-cli.test.ts`, `meeting-summary.test.ts`, `automations-runner.test.ts`, `meetings-overview.test.ts`)
  verdes **sem alteração**.
- **CA4 — A lista não apodrece.** `test/architecture-fs.test.ts` percorre `src/main/**/*.ts` e confere: (a) todo arquivo
  que importa `fs` está em `storage/` ou em `FS_EXCEPTIONS`; (b) todo arquivo de `FS_EXCEPTIONS` existe **e** ainda
  importa `fs` (exceção que não precisa mais reprova: tirar da lista); (c) `FS_EXCEPTIONS` não tem repetido nem curinga.
- **CA5 — Lint vale de verdade.** O teste roda o ESLint pela API (`new ESLint({ cwd })`) sobre um arquivo temporário em
  `src/main/__arquitetura__/x.ts` com cada uma das cinco formas (import estático, `import type` de `node:fs` incluído,
  `import()`, `require`, `original-fs`) e espera uma mensagem por forma; apaga o temporário no `afterAll`.
- **CA6 — Gate.** `pnpm --filter @meeting-scribe/desktop lint` verde na main com a regra ligada (`--max-warnings 0` já está no script).

## Invariantes
- Nenhum comportamento muda: CA3 é troca de chamada, sem mudar caminho, modo ou ordem.
- A regra vale para `src/main/**` só; `test/**`, `scripts/**` e o renderer (que já não tem `fs`) ficam como estão.
- Exceção nova só por contrato (a mensagem da regra diz isso) e sempre com motivo em `FS_EXCEPTIONS`.

## Fora de escopo
- Migrar `branding` e o `.ics` temporário (dívidas marcadas, para quando `storage/` tiver gravação de bytes e
  temporário). Regra para `node:child_process` ou rede. F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde.
- `git diff --stat` só com a Superfície. Sem commit pelo implementador.

## Dúvidas para o coordenador
- **`email/export.ts` e `whatsapp/export.ts`** gravam os `.md` da pasta da conversa (arquivos derivados, como
  `chat/sources.ts`). A Superfície do 98 (conferida em 20/11/2026) **não** os inclui: sem um contrato que os migre, este
  reprova na Pré-condição. **Resolvido em 20/11/2026:** o coordenador acrescentou os dois à Superfície do 98 (CA6 dele).
- **Spec R12** fala em exceções para "instalação, atualização, exportação"; o código real pede também leitura de arquivo
  escolhido, binários auxiliares, protocolo, segredos (F5) e smoke. A lista do CA2 tem 28 arquivos; "curta" no sentido
  de fechada e justificada, não de 3 itens.
- `branding` e `.ics`: aceitar como dívida ou exigir a migração antes (precisa de gravação de bytes no `storage/`, que o 100 pode ter criado).
