# Contrato 94 — Migrar os stores pequenos para o helper
Feature: arquitetura-seguranca · Wave: 2 · Depende de: 93 · Spec/Plan: `docs/specs/arquitetura-seguranca/spec.md`, `plan.md` (RASCUNHO, aguardam aprovação)

Troca a gravação e a leitura de cinco stores pelo helper do 93 (R11): `agents.json`, `schedules.json` + `schedule-runs/<id>.json`, `chat-events.json`, `email/batches.json` e os dois arquivos do MCP. Nenhuma interface pública muda, nenhum byte em disco muda, e cada store mantém o seu jeito de tratar arquivo inválido até o 101 (N1, N2, N3, T5).

## Pré-condições
- Commit do 93 na branch; `src/main/storage/json-file.ts` exporta os nomes do CA1 do 93 (`createJsonFile`, `createJsonDir`, `serialQueue`, `zodParse`, `stringifyJson`, `quarantineTargets`).
- Conferir se o 87 (S4, pastas `0700` em `agents/store.ts:49` e `schedules/store.ts:100`) já entrou: o `mkdir` desta migração repete **o que estiver no HEAD** (com ou sem `mode: 0o700`). Se o 87 estiver em andamento ao mesmo tempo, parar e avisar (arquivos em comum).
- Ler antes: os cinco arquivos da Superfície, o contrato 93, e os testes das Invariantes.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/agents/store.ts` | `createJsonFile` (CA1); sai o `serial`, o `write` e o `load` locais |
| `src/main/schedules/store.ts` | `createJsonFile` para `schedules.json` (CA2) e `createJsonDir` para `schedule-runs/` (CA3); saem `serialQueue` e `atomicWrite` locais |
| `src/main/chat/events-store.ts` | `createJsonFile` com quarentena `.bad` (CA4); saem `serial`, `setAside` e `save` locais |
| `src/main/email/batches.ts` | `createJsonFile` (CA5) |
| `src/main/mcp/store.ts` | dois `createJsonFile` numa fila só (CA6); sai `writeAtomic` e `readJson` locais |

Nenhum outro arquivo: nada em `index.ts`, nos serviços que usam esses stores, nos testes ou no `smoke.ts`.

## Critérios de aceite
Âncora de formato: para cada store, um arquivo gravado **antes** (no HEAD do 93) e **depois** com a mesma sequência de chamadas e relógio fixo tem os mesmos bytes (`cmp`), conferido à mão pelo implementador e pelos testes existentes listados nas Invariantes. Âncora de código: `grep`.

- **CA1 — `agents.json`.** `indent: 2`, `version: AGENTS_VERSION`, `serialize: (agents) => ({ version: AGENTS_VERSION, agents })`; `parse` faz o que o `load` faz hoje (envelope por `fileSchema`; cada agente por `agentSchema`, inválido ou id repetido fica de fora); `cache: true`; `defaults` = os 3 `EXAMPLE_AGENTS` com `newId()` e `stamp()`, `seedOnMissing: true` (o arquivo nasce na primeira leitura, como hoje); `fallback: () => []`; quarentena `keep`; `onInvalid` escreve o mesmo `console.warn('[agents] … inválido; a lista fica vazia até o próximo salvar')`; `write.mkdir` igual ao `mkdir(dir, …)` do HEAD. `save` e `remove` usam `run` (validação, nome único e limite na mesma vez da fila).
- **CA2 — `schedules.json`.** `indent: 2`, `version: SCHEDULES_VERSION`, `serialize` com as seis chaves na ordem de hoje (`version, tasks, paused, pauseReason, limitReleasedOn, meetingRuns` cortado em `MEETING_RUNS_MAX`); `cache: true`; `defaults` e `fallback` = estado vazio; `onInvalid` avisa **só** com `reason !== 'json'` (hoje JSON quebrado é silencioso e esquema errado avisa); `mutate` = `update`, devolvendo cópia (`copy`) como hoje.
- **CA3 — `schedule-runs/<id>.json`.** `createJsonDir` com `pathOf` = regra de `automationIdSchema` (id inválido → `null`; `save` continua lançando `'id de execução inválido'`), `idOf` = nome `<id>.json` com id válido, `parse` = `parseRun` + `run.id === id`, `indent: 2`, sem `version` (o arquivo não tem), `write.mkdir: { mode: 0o700 }`. O índice em memória fica no store e é montado por `entries()` + `read`; o corte acima de `max` usa `remove`. Arquivo ilegível continua fora da lista e intocado.
- **CA4 — `chat-events.json`.** `indent: 0`, `version: 1`, `serialize: (events) => ({ version: 1, events: events.slice(-CHAT_EVENTS_MAX) })`, `cache: false`, `defaults`/`fallback` `[]`, quarentena `{ kind: 'rename', target: quarantineTargets.badMs('chat-events'), when: 'on-read', chmod: true, renameError: 'ignore' }` com `now` do store, `onInvalid` com a mesma frase de log de hoje, `write.mkdir: { mode: 0o700 }`. Nome em disco: `chat-events.<ms>.bad`, `0600`, conteúdo intacto (o teste `chat-events-store.test.ts` "arquivo ilegível ou de outra versão" passa sem mudança).
- **CA5 — `email/batches.json`.** `indent: 0`, `version: 1`, `serialize` com `folders` só quando não vazio (como hoje), `cache: false`, inválido vale `{ batches: [], folders: {} }` sem aviso, quarentena `keep`, `write.mkdir: { mode: 0o700 }`. `mutate` e `addFolderCreated` usam `run`: o `write` que hoje relê `folders` lê dentro da mesma vez da fila.
- **CA6 — MCP.** `const queue = serialQueue()` compartilhada por `mcp-servers.json` e `mcp-cli-enabled.json` (hoje uma fila só para os dois); ambos `indent: 2`, `version: 1`, `cache: false`, inválido vale vazio, quarentena `keep`, `write.mkdir: { mode: 0o700 }`. `toFile`/`fromFile` continuam no store (cifra com `safeStorage` antes do `serialize`; `EncryptionUnavailableError` continua sendo lançado de dentro do `run`, sem gravar nada).
- **CA7 — Nenhuma cópia local.** `grep -nE "from 'node:fs|writeFile|rename\(|function (writeAtomic|atomicWrite|serialQueue)|queue\.then" src/main/{agents/store,schedules/store,chat/events-store,email/batches,mcp/store}.ts` vazio.
- **CA8 — Modos.** Depois de uma gravação de cada store: arquivo `0600`; `schedule-runs/`, `email/` e a pasta do `chat-events` criadas `0700` (o `mkdir` que hoje tem modo); `agents.json` e `schedules.json` na pasta com o modo de hoje.
- **CA9 — Concorrência preservada.** 20 `agents.save` simultâneos com nomes diferentes deixam 20 agentes novos em `agents.json` (além dos 3 exemplos); 20 `chatEvents.add` simultâneos deixam 20 linhas; 20 `mcp.save` de servidores diferentes deixam 20. Conferido por um script descartável do implementador, fora do repo, com a saída colada no relatório (sem arquivo de teste novo, ver Gates).

## Invariantes
- Testes verdes **sem alteração** (N3): `test/assistant.test.ts`, `test/automations-service.test.ts`, `test/email-automations.test.ts` (agents, schedules, runs), `test/chat-events-store.test.ts`, `test/email-organize.test.ts` (batches, incluindo o `0600` da linha 533), `test/mcp.test.ts`, `test/conectores.test.ts`, `test/conectores-tela.test.ts`, `test/conectores-live.test.ts`.
- Smoke sem alteração: ele só **lê** estes arquivos direto do disco (`AGENTS_FILE` em `smoke.ts:6913, 7604`; `SCHEDULES_FILE` e `SCHEDULE_RUNS_DIR` em `smoke.ts:7490-7510`; `CHAT_EVENTS_FILE` em `smoke.ts:6708`; `MCP_*_FILE` em `smoke.ts:7132, 7144`) e confere `mode === '600'` de `agents.json` e `schedules.json`. Nenhum desses arquivos é gravado pelo smoke, então a cópia em memória de agents e schedules continua segura.
- As constantes exportadas (`AGENTS_FILE`, `AGENTS_VERSION`, `SCHEDULES_FILE`, `SCHEDULE_RUNS_DIR`, `SCHEDULES_VERSION`, `MEETING_RUNS_MAX`, `CHAT_EVENTS_FILE`, `CHAT_EVENTS_MAX`, `EMAIL_BATCHES_FILE`, `MCP_SERVERS_FILE`, `MCP_CLI_ENABLED_FILE`, `pruneBatches`) e as interfaces (`AgentsStore`, `SchedulesStore`, `RunsStore`, `ChatEventsStore`, `EmailBatchStore`, `McpStore`) ficam iguais.
- Quarentena de cada store, preservada até o 101: agents, schedules, runs, batches e MCP **não renomeiam** (o arquivo fica e o próximo save sobrescreve; runs ilegível fica de fora); chat-events renomeia para `chat-events.<ms>.bad`.
- Nenhum segredo nem conteúdo de arquivo vai para log.

## Fora de escopo
- Quarentena `.corrupt-<timestamp>` e `version` uniformes (101); `version` nos runs (101, R15); pastas `0700` onde hoje não há modo (87); `dataDir` e onde os stores são criados (102).

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde (8 passos; 9 se o 88 já entrou).
- `git diff --stat` só com os cinco arquivos da Superfície. Nenhum teste novo nem alterado: a conferência de bytes (`cmp`) e a de concorrência do CA9 vão no relatório, feitas num script fora do repo.
- Sem commit: quem coordena commita pelo agente de commits.
