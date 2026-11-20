# Contrato 93 — Helper único de arquivo: `storage/json-file.ts`
Feature: arquitetura-seguranca · Wave: 1 · Depende de: — · Spec/Plan: `docs/specs/arquitetura-seguranca/spec.md`, `plan.md` (RASCUNHO, aguardam aprovação)

Cria o módulo que os contratos 94 a 102 usam para gravar e ler dado em disco (R11; base de R14 e R15; T4 e T5 do plan). Hoje cada um dos ~19 stores reimplementa tmp + `rename`, fila e arquivo inválido, cada um de um jeito. Este contrato **não migra nenhum store**: só cria o helper, com uma opção para cada variação que existe hoje, de modo que a migração (94–100) troque o código sem mudar um byte em disco (N1, N3). Uniformizar quarentena e `version` é do 101.

## Pré-condições
- `git status` limpo nos caminhos da Superfície; gates verdes na main antes de começar.
- Ler antes, para conferir o catálogo de variações abaixo: `src/main/{agents/store,schedules/store,chat/events-store,email/batches,mcp/store,lock/store}.ts`, `src/main/whatsapp/{service,insights,transcripts}.ts`, `src/main/calendar/service.ts:158-181`, `src/main/google/drive-sync.ts:133-151`, `src/main/meetings/{transcripts,summaries,notes,analyses,store}.ts`, `src/main/chat/{store,corpus,sources}.ts`, `src/main/settings/store.ts:60-125`, `src/main/invites/store.ts:120-140`, `src/main/email/email-store.ts:240-260, 400-420`.

**Catálogo do que varia hoje** (o helper cobre tudo por opção):

| Variação | Onde aparece |
|---|---|
| Arquivo inválido: fica onde está, vale vazio, o próximo save sobrescreve | agents, schedules, batches, mcp, lock, `links.json`, `aceite.json`, insights, transcrições do WhatsApp, calendar-cache, drive-queue, summaries, notes, analyses, chats |
| Renomeia na leitura para `<arquivo>.corrupt-<ISO com : e . trocados por ->` | `meetings/<id>.json`, `meetings.json` (este lança se o `rename` falhar) |
| Renomeia **só no próximo save** para `.corrupt-<ISO>` | `settings.json` |
| Renomeia para `<arquivo>.invalid` (sobrescreve o anterior) + `chmod 0600` | `invites.json` |
| Renomeia para `<radical>.<ms>.bad` + `chmod 0600` | `chat-events.json` |
| Cópia em memória (com ou sem `forget()`) × lê o disco a cada vez | agents, schedules, transcrições do WhatsApp × os demais |
| Arquivo único × um arquivo por id numa pasta | os demais × `schedule-runs/`, `meetings/<id>*.json`, `chats/` |
| Indentação 2 × JSON compacto (sempre com `\n` no fim) | agents, schedules, mcp, lock, links, aceite, drive, meetings/*, chats × chat-events, batches, insights, transcrições WA, calendar |
| Com campo `version` × sem (`links.json` é um `Record` puro) | — × links, aceite, insights, transcrições WA, runs, chats |
| Ausente: vale o padrão × grava o padrão (os 3 agentes de exemplo) | os demais × agents |
| Erro de leitura que não é ENOENT: vale ausente × lança | os demais × `meetings/<id>.json`, `meetings.json` |
| `mkdir`: nenhum × `recursive` sem modo × `0o700` × `0o700` + `chmod` | lock, calendar, drive × agents, schedules, meetings/* × runs, batches, mcp, chat-events, insights, transcrições WA × chats, corpus |
| `mode: 0o600` só na criação × `chmod` no temporário × `chmod` depois do `rename`; remove o tmp na falha ou não | agents, schedules, meetings/* × lock, mcp, chat-events × batches, WhatsApp, sources, organize; mcp, chat-events, calendar, drive limpam o tmp |
| Fila por store (uma para todos os ids, ou uma para dois arquivos) | meetings/*, runs, chats; mcp (2 arquivos) |
| Gravar só se o texto mudou (o inode fica) | `chat/sources.ts`, índice das pastas de escopo do corpus |
| Cópia em memória que precisa ver o que o smoke grava por fora | `meetings.json` (contrato 99), a lista de `chats/` (contrato 98) |

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/storage/json-file.ts` | **novo**: a API do CA1. Só `node:fs/promises`, `node:path`, `node:crypto`; sem Electron, sem zod obrigatório |
| `test/storage-json-file.test.ts` | **novo**: `describe('storage/json-file')`, um `it` por CA2–CA14, em pasta de `mkdtempSync` |

Nenhum outro arquivo. Nenhum store importa o helper neste contrato.

## Critérios de aceite
Âncora: `test/storage-json-file.test.ts`. "Bytes em disco" = `readFileSync(path)` comparado com `Buffer.from(esperado)`.

- **CA1 — API pública, exatamente estes nomes** (os contratos 94–102 citam por eles):
  ```ts
  export type SerialQueue = <R>(task: () => Promise<R>) => Promise<R>
  /** Roda uma tarefa depois da anterior terminar (bem ou mal), como `queue.then(task, task)` dos stores de hoje. */
  export function serialQueue(): SerialQueue

  export interface MkdirOptions { mode?: number; chmod?: boolean } // `{}` = recursive sem modo
  export interface WriteAtomicOptions {
    mode?: number                         // modo do temporário na criação; padrão 0o600
    chmod?: 'temp' | 'file' | 'none'      // chmod(mode) antes do rename, depois dele, ou nenhum; padrão 'temp'
    mkdir?: false | MkdirOptions          // pasta-mãe; padrão false (não cria)
    cleanupTemp?: boolean                 // apaga o temporário se algo falhar; padrão true
    skipIfUnchanged?: boolean             // conteúdo igual ao do disco: não grava, o inode fica; padrão false
  }
  /** Temporário `<path>.tmp-<pid>-<uuid>` + rename. Sempre arquivo novo (inode novo), salvo 'unchanged'. */
  export function writeAtomic(path: string, data: string | Uint8Array, options?: WriteAtomicOptions): Promise<'written' | 'unchanged'>
  /** `${JSON.stringify(value, null, indent || undefined)}\n` */
  export function stringifyJson(value: unknown, indent: 0 | 2): string
  /** mkdir recursive com `mode` e, se pedido, chmod (pasta que já existia com outra permissão). */
  export function ensureDir(path: string, options?: MkdirOptions): Promise<void>

  export type ParseOutcome<T> = { ok: true; value: T } | { ok: false }
  export function zodParse<T>(schema: { safeParse(raw: unknown): { success: true; data: T } | { success: false } }): (raw: unknown) => ParseOutcome<T>
  export type InvalidReason = 'json' | 'shape' | 'version'
  export interface InvalidEvent { path: string; reason: InvalidReason; quarantinedAs: string | null }
  export type QuarantinePolicy =
    | { kind: 'keep' } // não mexe no arquivo; vale o fallback; o próximo write sobrescreve
    | { kind: 'rename'; target: (path: string, now: number) => string; when: 'on-read' | 'before-next-write'; chmod?: boolean; renameError?: 'ignore' | 'throw' }
  export const quarantineTargets: {
    corruptIso: (path: string, now: number) => string     // `${path}.corrupt-${new Date(now).toISOString().replace(/[:.]/g, '-')}`
    invalid: (path: string) => string                      // `${path}.invalid`
    badMs: (stem: string) => (path: string, now: number) => string // join(dirname(path), `${stem}.${now}.bad`)
  }

  interface CommonOptions<T> {
    serialize: (value: T) => unknown      // o objeto inteiro como vai ao disco (o helper não injeta campo)
    indent: 0 | 2
    readErrors?: 'missing' | 'throw'      // erro de leitura que não é ENOENT; padrão 'missing'
    version?: number                      // com ele, `raw.version` é conferido antes do parse
    migrations?: Readonly<Record<number, (data: unknown) => unknown>> // de N para N+1
    quarantine?: QuarantinePolicy         // padrão { kind: 'keep' }
    onInvalid?: (event: InvalidEvent) => void
    queue?: SerialQueue                   // fila compartilhada; padrão: uma nova por instância
    write?: Omit<WriteAtomicOptions, 'skipIfUnchanged'>
    now?: () => number
  }
  export interface JsonFileOptions<T> extends CommonOptions<T> {
    path: string
    parse: (raw: unknown) => ParseOutcome<T>
    defaults: () => T                     // arquivo ausente
    fallback?: () => T                    // arquivo inválido; padrão `defaults`
    seedOnMissing?: boolean               // ausente: grava `defaults()` na mesma vez da fila
    cache?: boolean | 'stat'              // padrão false; 'stat': a cópia vale enquanto ino, mtimeMs e size não mudam
  }
  export interface JsonFileIo<T> { read(): Promise<T>; write(value: T): Promise<void>; remove(): Promise<void> }
  export interface JsonFile<T> extends JsonFileIo<T> {
    readonly path: string
    run<R>(task: (io: JsonFileIo<T>) => Promise<R>): Promise<R> // uma vez da fila; `io` não reenfileira
    update(fn: (current: T) => T | Promise<T>): Promise<T>
    forget(): void                        // descarta a cópia em memória
    idle(): Promise<void>                 // resolve quando o que já estava na fila terminou
  }
  export function createJsonFile<T>(options: JsonFileOptions<T>): JsonFile<T>

  export interface JsonDirOptions<T> extends CommonOptions<T> {
    dir: string
    pathOf: (id: string) => string | null  // id que não vira caminho: null
    idOf: (fileName: string) => string | null
    parse: (raw: unknown, id: string) => ParseOutcome<T>
  }
  export interface JsonDirEntry { id: string; path: string; ino: number; mtimeMs: number; size: number }
  export interface JsonDirIo<T> { read(id: string): Promise<T | null>; write(id: string, value: T): Promise<void>; remove(id: string): Promise<boolean> }
  export interface JsonDir<T> extends JsonDirIo<T> {
    run<R>(task: (io: JsonDirIo<T>) => Promise<R>): Promise<R>
    update(id: string, fn: (current: T | null) => T | null | Promise<T | null>): Promise<T | null> // null: nada gravado
    entries(): Promise<JsonDirEntry[]>    // readdir + stat, só os nomes com idOf ≠ null; pasta ausente = []
    idle(): Promise<void>
  }
  export function createJsonDir<T>(options: JsonDirOptions<T>): JsonDir<T>
  ```
- **CA2 — `writeAtomic`, sucesso.** Os bytes em disco são exatamente `data` (texto e `Uint8Array`); modo `0600`; devolve `'written'`; nenhum `*.tmp-*` na pasta depois. Duas gravações seguidas do mesmo caminho dão dois inodes diferentes.
- **CA3 — `writeAtomic`, falha.** Com o destino sendo uma pasta (o `rename` falha): rejeita, e com `cleanupTemp` padrão não sobra `*.tmp-*`; com `cleanupTemp: false`, sobra um. Com `mkdir: false` e pasta-mãe ausente: rejeita com `ENOENT`.
- **CA4 — Modo e `chmod`.** Com `process.umask(0o077)` no teste e `mode: 0o640`: `chmod: 'temp'` e `'file'` dão `0640`; `'none'` dá `0600` (`0640 & ~0077`). Restaurar a umask no `afterEach`.
- **CA5 — `mkdir` / `ensureDir`.** `{}` cria a cadeia; `{ mode: 0o700 }` cria `0700`; `{ mode: 0o700, chmod: true }` numa pasta que já existia `0755` deixa `0700`; sem `chmod`, a existente fica `0755`.
- **CA6 — `skipIfUnchanged`.** Mesmo texto: `'unchanged'`, o inode e o `mtimeMs` não mudam. Texto diferente: `'written'`, inode novo. Sem a opção, texto igual também grava (inode novo): é isso que faz o corpus refazer os links físicos (contrato 98).
- **CA7 — `serialQueue`.** 20 tarefas com atrasos aleatórios terminam na ordem de chegada; uma que rejeita não impede a seguinte; cada chamada devolve o valor da própria tarefa.
- **CA8 — `stringifyJson`.** Para um objeto com acentos e lista aninhada, `stringifyJson(v, 2) === \`${JSON.stringify(v, null, 2)}\n\`` e `stringifyJson(v, 0) === \`${JSON.stringify(v)}\n\``.
- **CA9 — Ausente.** `read()` devolve `defaults()` e não cria arquivo; com `seedOnMissing`, grava `stringifyJson(serialize(defaults()), indent)` e as leituras seguintes leem o gravado. Pasta no lugar do arquivo (`EISDIR`): `readErrors: 'missing'` → `defaults()`; `'throw'` → rejeita.
- **CA10 — Inválido e quarentena.** JSON quebrado → `onInvalid({ reason: 'json' })`; `parse` com `ok: false` → `'shape'`; com `version: 2` e arquivo `version: 7` → `'version'`; em todos `read()` devolve `fallback()`. `keep`: os bytes do arquivo não mudam e `quarantinedAs: null`; o próximo `write` sobrescreve. `rename` + `on-read` com cada um dos três `quarantineTargets` (relógio fixo em `1000`): nomes exatos `x.json.corrupt-1970-01-01T00-00-01-000Z`, `x.json.invalid`, `x.1000.bad`, conteúdo intacto, `0600` quando `chmod: true`, e `quarantinedAs` com o caminho. `renameError: 'throw'` (rename impossível) rejeita; `'ignore'` devolve o fallback. `before-next-write`: depois do `read()` o arquivo continua lá; no primeiro `write` vira `.corrupt-<ISO>` e então o novo é gravado; o segundo `write` não renomeia de novo.
- **CA11 — `version` e migrações (R15).** `version: 3`, `migrations: { 1: a, 2: b }`: arquivo `version: 1` → `read()` devolve `parse(b(a(raw)))` e o arquivo passa a ter os bytes de `serialize` do valor migrado, na mesma vez da fila; `version: 3` não passa por migração nem regrava; `version: 4` ou cadeia incompleta (`{ 2: b }` com arquivo v1) → inválido `'version'`. Sem `version` nas opções, o campo não é olhado.
- **CA12 — Cópia em memória.** `cache: true`: alterar o arquivo por fora depois da primeira leitura não muda o `read()` até `forget()`; o inválido também fica em memória (o fallback); `write` que falha não troca a cópia. `cache: false`: cada `read()` vê a alteração de fora. `cache: 'stat'`: cada `read()` faz um `stat`; arquivo trocado por fora (inode novo) ou com outro `mtimeMs`/`size` é relido, e o mesmo arquivo reescrito no lugar com o mesmo tamanho e o `mtimeMs` restaurado por `utimesSync` **não** é relido (é a prova de que não leu de novo); arquivo apagado por fora vale ausente.
- **CA13 — Fila e `run`.** 50 `update((n) => n + 1)` simultâneos a partir de `0` deixam `50` em disco. Dentro de `run`, `io.read()` vê o `io.write()` anterior da mesma tarefa e nada de outra chamada entra no meio. Dois `createJsonFile` com o mesmo `queue` executam em sequência. `idle()` resolve só depois de um `write` já enfileirado gravar.
- **CA14 — `createJsonDir`.** `pathOf` `null` → `read` devolve `null` e `write` rejeita; ausente → `null`; `parse` recebe o `id`; `remove` devolve `true` se havia arquivo, `false` se não; `entries()` lista só os nomes aceitos por `idOf` (um `a.json.tmp-1-x` e um `b.summary.json` não entram quando o `idOf` não os aceita), com `ino`, `mtimeMs` e `size` do `stat`; pasta ausente → `[]`. Quarentena e `onInvalid` valem por arquivo.

## Invariantes
- Nenhum store, serviço ou `index.ts` muda: `git diff --stat` só com os dois arquivos novos. Os testes existentes passam sem alteração.
- `grep -nE "from 'electron'|Sync\(" src/main/storage/json-file.ts` vazio (nada síncrono, nada de Electron).
- O helper nunca grava no lugar (sempre temporário + `rename`, salvo `'unchanged'`) e o temporário segue o formato `<arquivo>.tmp-<pid>-<uuid>` (o limpador de `email-store.ts:415` procura `.tmp-`).
- Nenhum conteúdo de arquivo vai para log: o helper não loga nada, só chama `onInvalid` com caminho e motivo.

## Fora de escopo
- Migrar qualquer store (94–100); nomes de quarentena e `version` uniformes (101); `dataDir` e composition root (102); lint de `node:fs` (103); o que a tela Sistema vai ler do helper (104).

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde (8 passos; 9 se o 88 já entrou).
- `test/storage-json-file.test.ts` novo, todo em pasta temporária.
- Sem commit: quem coordena commita pelo agente de commits.

## Decisões deste contrato (para o Andrew conferir)
- **E1 — `chmod` e `cleanupTemp` têm opção, mas a migração usa o padrão.** O resultado de uma gravação bem-sucedida é o mesmo (arquivo `0600`) com `mode` só na criação ou com `chmod`; a diferença só aparece depois de uma falha (tmp que sobra). Por isso os contratos 94–98 usam `chmod: 'temp'` e `cleanupTemp: true` em todos os stores, como R11 pede, e preservam o que é observável: indentação, `version`, quarentena, cópia em memória, padrão de ausente e modo da pasta.
- **E2 — O helper não injeta campo.** `serialize` devolve o objeto inteiro (com `version` quando o store tem). Assim `links.json` continua um `Record` puro e nenhum arquivo ganha campo novo antes do 101.
- **E3 — A fila padrão é por instância.** Para manter "uma fila por store" de hoje (todas as reuniões numa fila, os dois arquivos do MCP numa fila), o store passa o mesmo `queue` ou usa um `createJsonDir`. "Fila por arquivo" (R11) fica possível, sem ser obrigatória.
