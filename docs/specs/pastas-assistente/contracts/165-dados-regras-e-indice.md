# Contrato 165 — Pastas do Assistente: tipos, settings, regras de recusa, varredura, índice `PASTAS.md` e canais de adicionar/remover

Feature: pastas-assistente  ·  Wave: 1  ·  Depende de: —  ·  Gate humano: spec aprovada em 23/11/2026

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Worktree `~/Documents/GitHub/meeting-scribe-pastas-assistente`, branch `pastas-assistente`, base `6079fec`, árvore limpa (só `docs/specs/pastas-assistente/` sem commit). `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` verdes antes de começar (rodar da raiz do worktree).
- Nenhuma tela muda neste contrato (telas no 167). Nenhuma ferramenta `lap-ferramenta` nova (166). Nenhuma mudança no texto da instrução de sistema além de `sourceLabel` (166). Nenhum cartão (168). Nada aqui chama modelo.
- Não tocar `features/*`, `preload/`, `main/chat/actions.ts`, `main/email/*`, `main/chat/tools.ts`.

## Contexto mínimo
Feature: o usuário escolhe pastas do Mac que o Assistente pode **ler** (nunca alterar). A cada pergunta, com a fonte `pastas` ligada na conversa, o app grava `PASTAS.md` na pasta da conversa com a árvore dos arquivos (nome, caminho relativo, tipo, tamanho, data, **id**). O main guarda, por conversa, o mapa `id → arquivo` que os contratos 166 e 168 usam para ler e anexar. Este contrato cria tipos, settings, regras puras, varredura, índice, mapa e os dois canais que alteram a lista.

Ler antes, só o necessário: `main/chat/sources.ts` (`writeSources :477`, `attempt`, `writeAtomic`, `isSourceFile`, `SOURCE_FILES`), `main/chat/media-files.ts` (`mediaFileName :27`, `isMediaFile`, `clearMediaFiles`, `MEDIA_READ_LABELS`), `main/chat/corpus.ts` (`SOURCE_DESCRIPTIONS :121`, limpeza em `:481`), `shared/chat.ts:129-155`, `shared/settings-defaults.ts:85-91, 267-273, 341`, `main/settings/schema.ts:166-168`, `main/index.ts` (diálogo `openDirectory` em `~2326-2343`; `scribe:audio-folder-choose` como molde de "só o main grava"; `assistantSources` em `~1600-1645`), `shared/ipc.ts` (`InvokeChannels :139`, `INVOKE :932`, `WHEN_LOCKED :1354`), `main/smoke-fixtures.ts` (`chosenEmailAttachments :262`).

## Superfície
- Criar `apps/desktop/src/shared/assistant-folders.ts` (tipos, constantes, funções puras **sem Node**: nada de `crypto`/`fs`).
- Criar `apps/desktop/src/main/chat/folders.ts` (varredura, hash, índice, resolver).
- Alterar `shared/chat.ts`: `'pastas'` em `CHAT_SOURCE_KINDS`, `chatSourcesOf`, `CHAT_SOURCES_OFF_BY_DEFAULT`.
- Alterar `shared/settings-defaults.ts`: `AssistantSettings.folders: AssistantFolder[]` (padrão `[]`; comentário "Contrato 165: só muda pelos canais `scribe:assistant-folder-add/-remove`").
- Alterar `main/settings/schema.ts`: lenient `folders: z.array(assistantFolderSchema).catch([])`; patch estrito **aceita** `folders` opcional (o renderer manda o objeto inteiro) mas o serviço de settings **ignora** o valor recebido e mantém o atual (molde `audioFolder`). Zod `assistantFolderSchema` em `shared/assistant-folders-schema.ts` (ou no próprio schema.ts se for o padrão do arquivo).
- Alterar `shared/settings-index.ts`: entrada "Pastas que o Assistente pode ler" (seção Claude; descrição: "Pastas do Mac que o Assistente lê, só leitura. Pastas ocultas, a pasta pessoal inteira e as do sistema não podem ser escolhidas.").
- Alterar `main/chat/sources.ts`: `PASTAS_FILE = 'PASTAS.md'` em `SOURCE_FILES`; deps `pastas?: { index(chatId: string): Promise<string | null> }`; bloco em `writeSources` (`if (sources.pastas && deps.pastas) attempt('pastas', …)`, grava só quando `index()` devolve texto); `WrittenSources.pastas`; quando a fonte está desligada, `clearMediaFiles(folder, 'Pasta')` junto com a limpeza existente.
- Alterar `main/chat/media-files.ts`: origem `'Pasta'` no tipo de origem de `mediaFileName`/regex de `isMediaFile`/`clearMediaFiles` (nome `Midia - Pasta - <hash16>.<ext>`, ext em `png|jpg|gif|webp|pdf|md`); `MEDIA_READ_LABELS` ganha `'Lendo um arquivo da pasta'`.
- Alterar `main/chat/corpus.ts`: `SOURCE_DESCRIPTIONS['PASTAS.md']` = "Arquivos das pastas que o usuário permitiu; cada linha tem um id para ler ou citar".
- Alterar `main/claude-cli/chat.ts`: só `sourceLabel('pastas') = 'Lendo as pastas'` (e o que o typecheck exigir em mapas exaustivos).
- Alterar `shared/ipc.ts`: `scribe:assistant-folder-add` (`undefined → FolderAddResult`) e `scribe:assistant-folder-remove` (`{ id: string } → { ok: boolean }`) em `InvokeChannels`/`INVOKE`; `WHEN_LOCKED: 'refused'` nos dois.
- Alterar `main/index.ts`: `createFolderIndex(...)` instanciado uma vez; `assistantSources.pastas = { index: (chatId) => folderIndex.markdown(chatId) }`; handlers dos dois canais (diálogo `dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] })` ou `smokeFixtures.chosenAssistantFolders`; gravação pelo serviço de settings; `remove` apaga as cópias `Midia - Pasta - *` em todos os escopos via `corpus`/`clearMediaFiles` e chama `folderIndex.invalidate()`).
- Alterar `main/smoke-fixtures.ts`: `chosenAssistantFolders: string[]` (padrão `[]`) em `SmokeFixtures`/`createSmokeFixtures`.
- Criar `apps/desktop/test/assistant-folders-logic.test.ts`, `apps/desktop/test/assistant-folders-scan.test.ts` (com pasta temporária real), estender o teste de settings (padrão, `.catch`, patch ignora `folders`), `test/chat.test.ts` ou `assistant.test.ts` (fonte nova desligada por padrão; `PASTAS.md` gravado/apagado), teste de `media-files` (origem `Pasta`).

### Tipos (em `shared/assistant-folders.ts`)
```ts
export interface AssistantFolder { id: string; path: string; addedAt: string }   // id = randomUUID (gerado no main), path = realpath
export type FolderRefusal = 'sensivel' | 'oculta' | 'repetida' | 'inexistente' | 'limite'   // limite = já há ASSISTANT_FOLDERS_MAX pastas
export interface FolderAddResult { added: AssistantFolder[]; refused: { path: string; reason: FolderRefusal }[]; replaced: string[] }
export type FolderFileKind = 'pdf' | 'imagem' | 'word' | 'planilha' | 'texto' | 'anexo'
export interface FolderFileEntry {
  id: string            // hash16 (sha256 hex, 16 chars) de `${folderId}\n${relPath}` — calculado no main
  folderId: string
  relPath: string       // separador '/', relativo à pasta permitida, sem './'
  name: string
  ext: string           // minúscula, sem ponto
  kind: FolderFileKind
  readable: boolean     // kind !== 'anexo'
  size: number
  mtime: number         // ms
}
export interface FolderScan { folderId: string; label: string; path: string; entries: FolderFileEntry[]; skipped: number; truncated: boolean; partial: boolean }
export const ASSISTANT_FOLDERS_MAX = 20
export const FOLDER_FILE_MAX_BYTES = 20 * 1024 * 1024
export const FOLDER_SCAN_DEPTH_MAX = 6
export const FOLDER_SCAN_PER_FOLDER_MAX = 2000
export const FOLDER_SCAN_TOTAL_MAX = 5000
export const FOLDER_SCAN_TIME_MS = 5000
export const FOLDER_INDEX_TTL_MS = 30_000
export const FOLDER_READABLE_EXTS: Record<string, FolderFileKind>  // pdf→pdf; png jpg jpeg gif webp→imagem; docx doc rtf odt→word; xlsx→planilha; csv tsv txt md json→texto
export const FOLDER_ATTACH_ONLY_EXTS: readonly string[]            // pptx ppt xls ods odp numbers pages key
export const FOLDER_SKIPPED_DIRS: readonly string[]                // node_modules __MACOSX
export const FOLDER_SKIPPED_SUFFIXES: readonly string[]            // .app .photoslibrary .bundle .framework
export const FOLDER_SENSITIVE_ROOTS: readonly string[]             // '/', '/System', '/Library', '/private', '/etc', '/var', '/usr', '/bin', '/sbin', '/Applications', '/Volumes'
export function fileKindOf(name: string): { kind: FolderFileKind; readable: boolean } | null   // null = fora do índice
export function folderRefusal(realPath: string, ctx: { home: string; userData: string; existing: AssistantFolder[] }): FolderRefusal | null
export function foldersReplacedBy(realPath: string, existing: AssistantFolder[]): AssistantFolder[]   // descendentes que a nova pasta engloba
export function folderLabel(path: string): string          // último segmento
export function shortenHome(path: string, home: string): string   // '~/…'
export function renderPastasIndex(scans: FolderScan[], now: Date, home: string): string
```
Regras de `folderRefusal`, nesta ordem: `inexistente` (decidido pelo chamador antes, via `realpath`/`stat`; a função pura recebe o caminho já real); `sensivel` se `realPath` é exatamente um de `FOLDER_SENSITIVE_ROOTS`, ou é `home`, ou está dentro de `home/Library`, `/System`, `/Library`, `/private`, `/etc`, `/var`, `/usr`, `/bin`, `/sbin`, ou é/está dentro de `userData`; `oculta` se qualquer segmento após a raiz começa com `.`; `repetida` se igual a uma existente ou dentro de uma existente. Ancestral de existentes **não** é recusado (as descendentes são substituídas: `foldersReplacedBy`).

`renderPastasIndex` segue o formato da spec B5: título, linha de resumo com data/hora (`now` formatado `AAAA-MM-DD HH:mm`), contagens; instrução fixa de citação e ferramenta; uma seção `## <label>  (<~/caminho>)  — N arquivos` por pasta, tabela `| id | arquivo | tipo | tamanho | modificado | legível |`, `legível` = `sim` ou `não (só anexo)`, `tipo` = ext; nomes com `|`, crase e quebra de linha escapados/trocados por espaço; linhas finais por pasta "… e N arquivos não listados" quando `truncated`, "N arquivos de outros tipos ou acima de 20 MB" quando `skipped > 0`, "varredura interrompida: lista parcial" quando `partial`. Tamanhos como `1,2 MB`/`240 KB`. Nunca conteúdo de arquivo.

### Varredura e índice (`main/chat/folders.ts`)
- `folderFileId(folderId, relPath): string` (sha256 hex, 16 primeiros).
- `scanFolder(folder: AssistantFolder, opts: { deadline: number; maxEntries: number }): Promise<FolderScan>`: `readdir(withFileTypes)` recursivo até `FOLDER_SCAN_DEPTH_MAX`; **`lstat`, nunca segue symlink** (entrada symlink é ignorada, conta em `skipped`); ignora nome começando com `.`, `FOLDER_SKIPPED_DIRS`, pastas com `FOLDER_SKIPPED_SUFFIXES` e `Icon\r`; arquivo entra se `fileKindOf(name)` ≠ null e `size ≤ FOLDER_FILE_MAX_BYTES`, senão `skipped++`; para em `maxEntries` (`truncated`) ou em `Date.now() > deadline` (`partial`); ordena entradas por `relPath`.
- `createFolderIndex(deps: { settings: () => Promise<AssistantFolder[]>; home: string; now?: () => number })` com:
  - `scans(): Promise<FolderScan[]>` — cache por `FOLDER_INDEX_TTL_MS` e pela lista (ids+paths) vigente; orçamento total `FOLDER_SCAN_TOTAL_MAX` e `FOLDER_SCAN_TIME_MS` repartidos entre as pastas; pasta inexistente no momento gera `FolderScan` vazio com `partial: true`.
  - `markdown(chatId): Promise<string | null>` — `null` se a lista está vazia; senão `renderPastasIndex(...)` e guarda `Map<id, FolderFileEntry>` em `byChat.set(chatId, …)`.
  - `resolve(chatId, id): FolderFileEntry | null` e `folderOf(entry): AssistantFolder | null` (pela lista vigente).
  - `invalidate()` (limpa cache; mantém `byChat` até a próxima gravação) e `forget(chatId)` (chamado quando a conversa é apagada: ligar em `dropScope`/`clearScopes` ou onde `clearMediaFiles` é chamado por escopo).
- Nenhuma leitura de conteúdo de arquivo neste módulo. Nenhum `devLog` com caminho ou nome de arquivo (só contagens e `ms`).

### Canais (`main/index.ts`)
- `scribe:assistant-folder-add`: pastas escolhidas = `smokeFixtures?.chosenAssistantFolders ?? (await dialog.showOpenDialog(win, {properties:['openDirectory','multiSelections','createDirectory']})).filePaths`; para cada uma: `realpath` + `stat.isDirectory()` (falha → `inexistente`), `folderRefusal(...)`; aceitas entram com `id: randomUUID()`, `addedAt: new Date().toISOString()`, substituindo `foldersReplacedBy`; teto `ASSISTANT_FOLDERS_MAX`: ao atingi-lo, as restantes voltam em `refused` com `reason: 'limite'`. Grava via serviço de settings; `folderIndex.invalidate()`.
- `scribe:assistant-folder-remove` `{id}`: remove; `invalidate()`; apaga `Midia - Pasta - *` de todos os escopos (função do `corpus` que percorre `chat-scope/*` chamando `clearMediaFiles(folder, 'Pasta')`); `{ok: true}`; id desconhecido → `{ok: false}`.
- Ambos `WHEN_LOCKED: 'refused'`; `handle()` padrão (origem confiável).

## Critérios de aceite
- CA1: `fileKindOf('Contrato.PDF')` → `{kind:'pdf', readable:true}`; `'a.docx'`→word; `'a.xlsx'`→planilha; `'a.csv'`/`'a.md'`→texto; `'a.pptx'`→`{kind:'anexo', readable:false}`; `'a.zip'`, `'a.mp4'`, `'sem-extensao'` → `null`.
- CA2: `folderRefusal` com `home='/Users/x'`, `userData='/Users/x/Library/Application Support/App'`: `'/Users/x'`→`sensivel`; `'/Users/x/Library/Mail'`→`sensivel`; `'/'`→`sensivel`; `'/Volumes'`→`sensivel`; `'/Volumes/Disco/Docs'`→`null`; `'/Users/x/.ssh'`→`oculta`; `'/Users/x/Docs/.git/x'`→`oculta`; `userData`→`sensivel`; `'/Users/x/Docs'` com existente `'/Users/x/Docs'`→`repetida`; `'/Users/x/Docs/Sub'` com existente `'/Users/x/Docs'`→`repetida`; `'/Users/x'`-descendente `'/Users/x/Docs'` com existente `'/Users/x/Docs/Sub'`→`null` e `foldersReplacedBy` devolve `[Sub]`; `'/Users/x/Documents'`→`null`.
- CA3: `scanFolder` numa pasta temporária com: `a/b/c/d/e/f/g/fundo.txt` (profundidade 7 → fora), `Contratos/c1.pdf`, `Planilhas/p.xlsx`, `.oculto/s.txt` (fora), `link -> /etc` (symlink, fora, `skipped+1`), `grande.bin` 21 MB esparso (fora, `skipped+1`), `video.mp4` (fora, `skipped+1`), `Apresentacoes/i.pptx` (entra, `readable:false`) → `entries` tem exatamente 3 (`Contratos/c1.pdf`, `Planilhas/p.xlsx`, `Apresentacoes/i.pptx`) ordenadas por `relPath`, `skipped === 3` (symlink, grande, mp4; o oculto e o fundo não contam), `truncated:false`, `partial:false`. Com `maxEntries: 2` → 2 entradas e `truncated:true`. Com `deadline: Date.now() - 1` → `partial:true`.
- CA4: `folderFileId('f1','Contratos/c1.pdf')` tem 16 hex e é estável; muda com `relPath` ou `folderId` diferente.
- CA5: `renderPastasIndex` com 2 scans produz texto com `# Pastas permitidas`, 2 seções `## `, uma linha de tabela por entrada com `| <id> | <relPath> | <ext> | <tamanho> | <AAAA-MM-DD> | sim|não (só anexo) |`, `~/` no caminho da pasta, e as linhas de rodapé quando `truncated`/`skipped`/`partial`; um nome com `|` e crase sai sem `|` e sem crase; nenhuma quebra de linha dentro de célula.
- CA6: `createFolderIndex`: `markdown('c1')` com lista vazia → `null` e `resolve('c1', qualquer)` → `null`; com 1 pasta → texto e `resolve('c1', idDeC1)` → a entrada; `resolve('c2', idDeC1)` → `null` (outra conversa ainda não gravou); segunda chamada em < 30 s não varre de novo (contar chamadas a `readdir` por `vi.spyOn` ou injetar `now`); `invalidate()` força nova varredura; `forget('c1')` zera o `resolve`.
- CA7: `writeSources` com `sources.pastas: true` e `deps.pastas.index` devolvendo texto grava `PASTAS.md` (0600) e o lista em `WrittenSources`; com `index` devolvendo `null` não grava; com `sources.pastas: false` apaga `PASTAS.md` e `Midia - Pasta - *.md` existentes e mantém `Midia - Email - *.md`. `chatSourcesOf({})` tem `pastas: false`; `isSourceFile('PASTAS.md') === true`.
- CA8: `mediaFileName('Pasta', hash, 'pdf') === 'Midia - Pasta - <hash>.pdf'`; `isMediaFile` reconhece; `clearMediaFiles(folder, 'Pasta')` apaga só os de `Pasta`; o regex de reunião em `corpus.ts:336` **não** casa com `Midia - Pasta - <hash>.md` (teste direto na função que decide se um `.md` é reunião, ou na limpeza de `refreshScope` com um arquivo desses presente: ele sobrevive).
- CA9: settings: `(await get()).assistant.folders` é `[]` por padrão; `settings.json` com `assistant: {media: true}` sem `folders` → `[]`; patch do renderer `{assistant: {media: false, folders: [{id:'x', path:'/tmp', addedAt:'…'}]}}` → `media` muda e `folders` continua o atual (vazio); entrada no `settings-index` presente (teste existente do índice verde).
- CA10: Canal `scribe:assistant-folder-add` com `smokeFixtures.chosenAssistantFolders = [home, join(tmp,'Docs'), join(tmp,'Docs','Sub')]` (as duas últimas criadas) → `added` tem 1 (`Docs`), `refused` tem `[{home,'sensivel'}, {Sub,'repetida'}]`; segunda chamada com `[join(tmp,'Docs')]` → `refused` `repetida`; `scribe:assistant-folder-remove {id}` → `{ok:true}` e lista vazia; id falso → `{ok:false}`. `WHEN_LOCKED` dos dois canais é `'refused'` (teste existente que valida a tabela continua verde). Esse CA pode ser provado por teste do handler isolado (função exportada de um módulo pequeno chamada pelo `index.ts`) em vez de subir o Electron.
- CA11: `devLog`/`log` deste contrato não recebem caminho, nome de arquivo nem conteúdo (grep no diff por `devLog(` e `log(` nos arquivos novos: só contagens/ms/booleanos).

## Invariantes
- Nenhum arquivo fora da Superfície muda; `git diff --stat` não mostra `features/`, `preload/`, `actions.ts`, `main/email/`, `tools.ts`.
- Nenhuma escrita dentro das pastas permitidas (o módulo só faz `readdir`/`lstat`/`realpath`).
- Fontes existentes inalteradas (`chat.test.ts`/`assistant.test.ts` verdes sem edição além dos acréscimos).
- O CLI continua com `--restricted` e sem `--add-dir` (`chatArgs` intocado).

## Fora de escopo desta tarefa
- Ferramenta `ler_arquivo_pasta`, extração de Word/planilha, instrução de sistema, citação clicável (166). Telas (167). Cartão com anexos e Composer (168). Smoke e docs (169).

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` da raiz do worktree. Smoke não é exigido.
- Testes novos: `assistant-folders-logic.test.ts` (CA1, CA2, CA4, CA5), `assistant-folders-scan.test.ts` (CA3, CA6, CA10), acréscimos em settings (CA9), `chat`/`assistant` (CA7), `media-files` (CA8).

## Relatório esperado do implementador
≤ 40 linhas: arquivos criados/alterados, contagem de testes, onde o typecheck exigiu ramo novo (lista exata), dúvidas resolvidas sozinho, nada de conteúdo real.
