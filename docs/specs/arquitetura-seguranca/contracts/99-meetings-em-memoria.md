# Contrato 99 — `meetings.json` no helper, com cópia em memória
Feature: arquitetura-seguranca · Wave: 4 · Depende de: 93, 97 · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa A7 do plan (R11, R17). Hoje `src/main/meetings/store.ts` lê, valida e regrava o `meetings.json`
inteiro em **toda** operação, inclusive nas de leitura (`list`, `get`, `folders`), e o `write()` relê o arquivo
só para pegar as pastas (`store.ts:166-168`): um `rename` são duas leituras e uma gravação do arquivo inteiro.
Este contrato troca a gravação própria (`serial`, `load`, `save`, linhas 128-169) pela API do contrato 93 e
põe uma cópia em memória na frente, **sem mudar** a interface `MeetingsStore`, o formato em disco nem o nome
de quarentena (N1, N3, T5).

## Pré-condições
- Contratos 93 (helper `src/main/storage/json-file.ts`) e 97 (sub-stores de reunião) commitados na main;
  `git status` limpo nos arquivos da Superfície; gates verdes antes da primeira linha.
- Ler antes: `src/main/meetings/store.ts` (inteiro), `src/main/storage/json-file.ts` e o contrato 93 (CA1: `createJsonFile`,
  `zodParse`, `quarantineTargets`, `cache: 'stat'`, `readErrors`, `onInvalid`; CA12: a cópia validada por `stat`), `test/meetings-store.test.ts`, `test/meetings-folders.test.ts`, e no smoke:
  `seedMeetings` (`src/main/smoke.ts:1033`), `seedListMeetings` (`:1087`), `detailLoadFailure` (`:3167`) e o
  `rmSync` do `meetings.json` (`:11539`).
- **Achado que decide o desenho:** o smoke grava e apaga `meetings.json` **por fora, com o app aberto** (as
  três funções acima rodam depois de o store já ter lido o arquivo, `smoke.ts:11379-11385`), e o
  `detailLoadFailure` troca o arquivo por uma pasta e espera a leitura **falhar** (EISDIR). Uma cópia em memória
  que nunca olha o disco quebraria esses passos, e N3 proíbe mudar o smoke. Por isso a cópia é **validada por
  `stat`**: cada operação faz um `stat` barato e só relê quando o arquivo mudou por fora.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/meetings/store.ts` | `createFileMeetingsStore` passa a usar a API do 93 (CA1) e a cópia em memória (CA2–CA6); esquemas, `MEETINGS_FILE`, os `*Schema` exportados e a interface `MeetingsStore` sem mudança |
| `test/meetings-store-cache.test.ts` | **novo**: CA7 |

Nenhum outro arquivo. `test/meetings-store.test.ts`, `test/meetings-folders.test.ts`, `test/meeting-notes.test.ts`,
`test/email-assistant.test.ts` e `src/main/smoke.ts` ficam **sem diff** (N3). `src/main/index.ts:930` continua
chamando `createFileMeetingsStore({ dir: userData })` igual.

## Critérios de aceite
Âncoras: `test/meetings-store-cache.test.ts` (`describe('meetings.json em memória')`), os dois testes de store
existentes e o smoke inteiro.

- **CA1 — Gravação pelo helper.** `store.ts` não importa mais `node:fs` nem `node:fs/promises`; o arquivo é um
  `createJsonFile` do 93 com: `path: join(dir, MEETINGS_FILE)`, `indent: 2`, `version: 1`, `parse: zodParse(fileSchema)`,
  `defaults`/`fallback` = `{ meetings: [], folders: [] }`, `serialize` que omite `folders` quando vazio (`store.ts:163`),
  `readErrors: 'throw'` (hoje só ENOENT vale ausente, `store.ts:135-139`), `quarantine: { kind: 'rename', target:
  quarantineTargets.corruptIso, when: 'on-read', renameError: 'throw' }` (hoje o `rename` sem `.catch`, `:157`),
  `cache: 'stat'` e `now` injetado; o aviso `console.warn` de hoje sai pelo `onInvalid` com o mesmo texto. Toda operação
  passa por `run`/`update` (a fila do 93). *Teste:* `grep -n "node:fs" src/main/meetings/store.ts` vazio; o teste de
  quarentena `meetings-store.test.ts:107-119` passa sem mudança.
- **CA2 — Uma leitura, muitas operações.** Dado um `meetings.json` válido com 3 reuniões e 1 pasta, quando o
  teste chama, em sequência, `list`, `get`, `folders`, `rename`, `move`, `setFiles`, `list` (7 operações), então
  o arquivo é **lido do disco uma vez só** e **gravado três vezes** (uma por operação que muda). *Asserção:* o
  teste conta leituras e gravações por um espião na camada do 93 (o 93 expõe ou aceita a injeção do sistema de
  arquivos; se não expuser, `vi.spyOn` no módulo `node:fs/promises` importado **por `storage/`**) e espera
  `reads === 1`, `writes === 3`; mais nenhum `readFile` do `meetings.json` vindo de `meetings/store.ts`.
- **CA3 — Mudança por fora é vista.** É o `cache: 'stat'` do 93 (CA12 dele): cada operação faz um `stat`; `ino`,
  `size` ou `mtimeMs` diferentes do último visto (o da leitura ou o da própria gravação) → relê.
  Dado o store já aquecido, quando o teste regrava `meetings.json` por fora com uma reunião a mais (como o
  `seedListMeetings`), então o `list()` seguinte traz a reunião nova (*asserção:* `toHaveLength(4)` e
  `reads === 2`). Arquivo apagado por fora → `list()` volta `[]` e a cópia esvazia (o `rmSync` do smoke).
- **CA4 — Leitura que falha não é mascarada.** Dado o store aquecido, quando o `meetings.json` vira uma pasta
  (como o `detailLoadFailure`), então `get(id)` **rejeita** (EISDIR propagado pelo helper, não `null` e não a
  cópia antiga) e nada é renomeado para quarentena; quando o arquivo volta, o `get` seguinte devolve a reunião.
  *Asserção:* `await expect(store.get('a')).rejects.toThrow()` e depois `.resolves.toMatchObject({ id: 'a' })`.
- **CA5 — Falha de gravação não deixa a cópia adiantada.** Cada operação que muda calcula o próximo estado
  numa cópia (`structuredClone` ou objetos novos) e **só troca a cópia em memória depois** de a gravação do
  helper resolver. Dado o store aquecido com a reunião `a` de título "Antes", quando a gravação falha
  (espião do CA2 faz o `rename` rejeitar uma vez), então `rename('a', 'Depois')` rejeita, `get('a')` devolve
  "Antes", o arquivo no disco continua com "Antes" e nenhum `meetings.json.tmp-*` sobra na pasta. A operação
  seguinte (sem falha) grava normalmente. O mesmo vale para `create` (a reunião não aparece no `list`),
  `remove`, `createFolder` e `deleteFolder` (as reuniões continuam com o `folderId`).
- **CA6 — Ninguém de fora segura a cópia.** `list`, `get`, `folders` e o retorno de `create`/`rename`/`move`/
  `setFiles`/`createFolder`/`renameFolder` devolvem objetos que, mudados por quem chamou, não mudam a cópia.
  *Teste:* `(await store.list())[0].title = 'x'` e o `get` seguinte devolve o título original. `list` continua
  ordenado por `startedAt` decrescente (`byStartedAtDesc`), sem ordenar a cópia no lugar.
- **CA7 — Testes novos** (`test/meetings-store-cache.test.ts`, pasta temporária, relógio fixo): um caso por CA2–CA6,
  mais: (a) 50 `create` disparados juntos → 50 reuniões no arquivo e na cópia, ids únicos, uma gravação por
  `create` (fila do 93); (b) arquivo corrompido com o store aquecido e mudado por fora → quarentena com o nome do
  CA1 e lista vazia, como hoje; (c) `version: 2` no disco → quarentena (nenhuma migração nova neste contrato).

## Invariantes
- Interface `MeetingsStore` e tipos de `src/shared/meetings.ts` sem diff (`git diff --stat` só com a Superfície).
- Formato em disco idêntico ao de 0.18.0: um `meetings.json` gravado antes abre igual, e um gravado depois abre
  na 0.18.0 (N1, T5). Âncora: os testes existentes sem alteração.
- Nenhuma operação devolve dado que não esteja no disco: a cópia nunca está à frente do arquivo (CA5) e nunca
  atrás de uma mudança detectável por `stat` (CA3).
- Nada de título de reunião em log (o aviso de quarentena continua só com o nome do arquivo).

## Fora de escopo
- Índice da busca (`meetings/overview.ts`, que já tem cache próprio por inode/data/tamanho) e os sub-stores
  (transcrição, resumo, notas, análises: contrato 97).
- Observar o arquivo com `fs.watch` (o `stat` por operação basta e não deixa processo pendurado).
- Mudar o formato ou acrescentar `version` nova (contrato 101). F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos (9 depois do 88).
- `test/meetings-store.test.ts` e `test/meetings-folders.test.ts` verdes **sem alteração**; smoke sem diff.
- `git diff --stat` só com a Superfície. Sem commit: quem coordena commita pelo agente de commits.

## Dúvidas para o coordenador
- **Contagem de leituras (CA2).** O 93 não expõe contador de leituras; o teste espia o `readFile` do módulo
  `node:fs/promises` importado por `storage/json-file.ts` (`vi.mock` com passagem). Se o revisor preferir, a prova
  pode ser a do CA12 do 93 (reescrever no lugar com `utimesSync` e conferir que não releu).
- **Cópia validada por `stat`, não cópia pura.** Já está previsto no 93 (`cache: 'stat'`, catálogo "cópia em memória
  que precisa ver o que o smoke grava por fora"); registrado aqui porque a spec fala só em "cópia em memória".
