// Pastas do Assistente (contrato 165, pastas-assistente D3 e D5): a varredura das pastas que a pessoa permitiu, o índice
// `PASTAS.md` de cada pergunta, o mapa id → arquivo de cada conversa e os dois canais que mudam a lista.
// - Só leitura: `readdir`, `lstat`, `stat` e `realpath`; nunca abre o conteúdo de um arquivo e nunca grava nas pastas.
// - Link simbólico nunca é seguido (nem de pasta nem de arquivo); oculto, `node_modules`, `__MACOSX`, `Icon\r` e pacotes
//   do macOS ficam de fora; profundidade, quantidade e tempo com teto (`shared/assistant-folders.ts`).
// - O id de um arquivo é um hash do id da pasta e do caminho relativo; só o mapa da conversa (o do último `PASTAS.md` que
//   ela recebeu) resolve um id. Texto do modelo nunca vira caminho.
// - Nada de caminho nem de nome de arquivo no log: só contagens e tempo.
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ASSISTANT_FOLDERS_MAX,
  FOLDER_FILE_MAX_BYTES,
  FOLDER_INDEX_TTL_MS,
  FOLDER_SCAN_DEPTH_MAX,
  FOLDER_SCAN_PER_FOLDER_MAX,
  FOLDER_SCAN_TIME_MS,
  FOLDER_SCAN_TOTAL_MAX,
  FOLDER_SKIPPED_DIRS,
  FOLDER_SKIPPED_SUFFIXES,
  fileKindOf,
  folderLabel,
  folderRefusal,
  foldersReplacedBy,
  renderPastasIndex,
  type AssistantFolder,
  type FolderAddResult,
  type FolderFileEntry,
  type FolderScan,
} from '../../shared/assistant-folders'

/** O id de um arquivo do índice: sha256 de `${folderId}\n${relPath}`, os 16 primeiros caracteres hex. */
export function folderFileId(folderId: string, relPath: string): string {
  return createHash('sha256').update(`${folderId}\n${relPath}`).digest('hex').slice(0, 16)
}

/** O ícone personalizado de pasta do Finder (`Icon\r`). */
const FINDER_ICON = 'Icon\r'

/**
 * Os arquivos de uma pasta permitida, ordenados pelo caminho relativo. Para no limite de arquivos (`truncated`) ou de tempo
 * (`partial`); a pasta que não se lê sai vazia e parcial.
 */
export async function scanFolder(folder: AssistantFolder, opts: { deadline: number; maxEntries: number }): Promise<FolderScan> {
  const entries: FolderFileEntry[] = []
  let skipped = 0
  let truncated = false
  let partial = false
  const late = (): boolean => {
    if (Date.now() <= opts.deadline) return false
    partial = true
    return true
  }
  /** `true`: parar a varredura inteira. */
  const walk = async (dir: string, rel: string, depth: number): Promise<boolean> => {
    if (late()) return true
    const names = await readdir(dir).catch(() => null)
    if (names === null) {
      if (depth === 0) partial = true
      return false
    }
    names.sort()
    for (const name of names) {
      if (late()) return true
      if (name.startsWith('.') || name === FINDER_ICON) continue
      const full = join(dir, name)
      const relPath = rel ? `${rel}/${name}` : name
      const info = await lstat(full).catch(() => null)
      if (!info) continue
      if (info.isSymbolicLink()) {
        skipped++
        continue
      }
      if (info.isDirectory()) {
        if (FOLDER_SKIPPED_DIRS.includes(name) || FOLDER_SKIPPED_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))) continue
        if (depth + 1 > FOLDER_SCAN_DEPTH_MAX) continue
        if (await walk(full, relPath, depth + 1)) return true
        continue
      }
      if (!info.isFile()) continue
      const kind = fileKindOf(name)
      if (!kind || info.size > FOLDER_FILE_MAX_BYTES) {
        skipped++
        continue
      }
      if (entries.length >= opts.maxEntries) {
        truncated = true
        return true
      }
      entries.push({
        id: folderFileId(folder.id, relPath),
        folderId: folder.id,
        relPath,
        name,
        ext: name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
        kind: kind.kind,
        readable: kind.readable,
        size: info.size,
        mtime: info.mtimeMs,
      })
    }
    return false
  }
  // A raiz trocada por um link (ou que não é mais a gravada): nada é varrido.
  const root = await lstat(folder.path).catch(() => null)
  const real = root && !root.isSymbolicLink() ? await realpath(folder.path).catch(() => null) : null
  if (real !== folder.path) return { folderId: folder.id, label: folderLabel(folder.path), path: folder.path, entries, skipped, truncated, partial: true }
  await walk(folder.path, '', 0)
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
  return { folderId: folder.id, label: folderLabel(folder.path), path: folder.path, entries, skipped, truncated, partial }
}

export interface FolderIndex {
  /** As varreduras das pastas da lista (guardadas por 30 s e pela lista vigente). */
  scans(): Promise<FolderScan[]>
  /** O texto do `PASTAS.md` desta conversa, guardando o mapa id → arquivo dela; `null` sem pasta na lista. */
  markdown(chatId: string): Promise<string | null>
  /** O arquivo de um id, só pelo mapa do último índice desta conversa. */
  resolve(chatId: string, id: string): FolderFileEntry | null
  /** A pasta permitida de um arquivo, pela lista vigente (a pasta removida não resolve mais). */
  folderOf(entry: FolderFileEntry): AssistantFolder | null
  /** A lista mudou: a próxima pergunta varre de novo. Os mapas das conversas ficam até a próxima gravação. */
  invalidate(): void
  /** A conversa fechou ou foi apagada: o mapa dela sai. */
  forget(chatId: string): void
  /** Todas as pastas de conversa saíram (`clearScopes`): os mapas saem. */
  forgetAll(): void
}

export interface FolderIndexDeps {
  /** A lista de `settings.assistant.folders`. */
  settings: () => Promise<readonly AssistantFolder[]>
  home: string
  now?: () => number
  log?: (message: string) => void
}

const listKey = (folders: readonly AssistantFolder[]): string => folders.map((folder) => `${folder.id}\n${folder.path}`).join('\n')

export function createFolderIndex(deps: FolderIndexDeps): FolderIndex {
  const now = deps.now ?? Date.now
  let cache: { key: string; at: number; scans: Promise<FolderScan[]> } | null = null
  let current: readonly AssistantFolder[] | null = null
  let generation = 0
  const byChat = new Map<string, Map<string, FolderFileEntry>>()

  /** Uma varredura de todas as pastas: o teto de arquivos e o de tempo repartidos entre elas, na ordem da lista. */
  async function scanAll(folders: readonly AssistantFolder[]): Promise<FolderScan[]> {
    const started = Date.now()
    const scans: FolderScan[] = []
    let used = 0
    for (const [index, folder] of folders.entries()) {
      const isDirectory = await stat(folder.path)
        .then((info) => info.isDirectory())
        .catch(() => false)
      if (!isDirectory) {
        scans.push({ folderId: folder.id, label: folderLabel(folder.path), path: folder.path, entries: [], skipped: 0, truncated: false, partial: true })
        continue
      }
      const deadline = started + Math.round((FOLDER_SCAN_TIME_MS * (index + 1)) / folders.length)
      const maxEntries = Math.max(0, Math.min(FOLDER_SCAN_PER_FOLDER_MAX, FOLDER_SCAN_TOTAL_MAX - used))
      const scan = await scanFolder(folder, { deadline, maxEntries })
      used += scan.entries.length
      scans.push(scan)
    }
    deps.log?.(`[pastas] ${folders.length} pastas, ${used} arquivos, ${Date.now() - started} ms`)
    return scans
  }

  async function scans(): Promise<FolderScan[]> {
    const folders = await deps.settings()
    current = folders
    const key = listKey(folders)
    if (cache && cache.key === key && now() - cache.at < FOLDER_INDEX_TTL_MS) return cache.scans
    const entry = { key, at: now(), scans: scanAll(folders) }
    cache = entry
    // Varredura que falhou não fica guardada.
    entry.scans.catch(() => {
      if (cache === entry) cache = null
    })
    return entry.scans
  }

  return {
    scans,
    async markdown(chatId) {
      const folders = await deps.settings()
      if (folders.length === 0) {
        current = folders
        byChat.delete(chatId)
        return null
      }
      const list = await scans()
      byChat.set(chatId, new Map(list.flatMap((scan) => scan.entries.map((entry) => [entry.id, entry] as const))))
      return renderPastasIndex(list, new Date(now()), deps.home)
    },
    resolve: (chatId, id) => byChat.get(chatId)?.get(id) ?? null,
    folderOf: (entry) => current?.find((folder) => folder.id === entry.folderId) ?? null,
    invalidate() {
      cache = null
      current = null
      const mine = ++generation
      void deps
        .settings()
        .then((folders) => {
          if (mine === generation) current = folders
        })
        .catch(() => undefined)
    },
    forget: (chatId) => void byChat.delete(chatId),
    forgetAll: () => byChat.clear(),
  }
}

/** O que os canais de adicionar e remover pasta usam (o `index.ts` liga ao diálogo, às configurações e ao acervo). */
export interface FolderChannelDeps {
  /** As pastas escolhidas no diálogo nativo (ou na fixture do smoke); vazio = cancelado. */
  choose(): Promise<readonly string[]>
  /** Grava a lista nova, calculada a partir da gravada agora (`SettingsStore.updateAssistantFolders`). */
  update(change: (current: readonly AssistantFolder[]) => AssistantFolder[]): Promise<unknown>
  /** A pasta pessoal e a de dados do app (as duas pelo `realpath`) e, só no smoke, a raiz das pastas sintéticas. */
  context(): Promise<{ home: string; userData: string; smokeRoot?: string }>
  /** A lista mudou (`FolderIndex.invalidate`). */
  invalidate(): void
  /** Apaga as cópias `Midia - Pasta - *` de todas as conversas (`ChatCorpus.dropMedia('Pasta')`). */
  dropMedia(): Promise<unknown>
  newId?: () => string
  now?: () => Date
}

/** O `realpath` de uma pasta que existe e é pasta; `null` senão. */
async function realFolder(path: string): Promise<string | null> {
  try {
    const real = await realpath(path)
    return (await stat(real)).isDirectory() ? real : null
  } catch {
    return null
  }
}

/**
 * `scribe:assistant-folder-add`: cada pasta escolhida passa pelas regras (A2), na ordem; as aceitas entram com o
 * `realpath` e tiram da lista as que elas englobam; passando de `ASSISTANT_FOLDERS_MAX`, as que sobram voltam como `limite`.
 */
export async function addAssistantFolders(deps: FolderChannelDeps): Promise<FolderAddResult> {
  const result: FolderAddResult = { added: [], refused: [], replaced: [] }
  const chosen = await deps.choose()
  if (chosen.length === 0) return result
  const resolved = await Promise.all(chosen.map(async (path) => ({ path, real: await realFolder(path) })))
  const context = await deps.context()
  const newId = deps.newId ?? randomUUID
  const stamp = (deps.now ?? (() => new Date()))().toISOString()
  await deps.update((current) => {
    // Recalculado a cada gravação: a fila pode repetir a conta com outra lista.
    result.added = []
    result.refused = []
    result.replaced = []
    let next = [...current]
    for (const { path, real } of resolved) {
      if (real === null) {
        result.refused.push({ path, reason: 'inexistente' })
        continue
      }
      const reason = folderRefusal(real, { ...context, existing: next })
      if (reason) {
        result.refused.push({ path, reason })
        continue
      }
      const replaced = foldersReplacedBy(real, next)
      if (next.length - replaced.length >= ASSISTANT_FOLDERS_MAX) {
        result.refused.push({ path, reason: 'limite' })
        continue
      }
      const folder: AssistantFolder = { id: newId(), path: real, addedAt: stamp }
      next = [...next.filter((item) => !replaced.includes(item)), folder]
      result.added = result.added.filter((item) => !replaced.includes(item))
      result.added.push(folder)
      result.replaced.push(...replaced.filter((item) => current.includes(item)).map((item) => item.path))
    }
    return result.added.length > 0 || result.replaced.length > 0 ? next : (current as AssistantFolder[])
  })
  if (result.added.length > 0) deps.invalidate()
  return result
}

/** `scribe:assistant-folder-remove`: tira a pasta da lista, invalida o índice e apaga as cópias lidas das pastas. */
export async function removeAssistantFolder(deps: Pick<FolderChannelDeps, 'update' | 'invalidate' | 'dropMedia'>, request: unknown): Promise<{ ok: boolean }> {
  const id = typeof request === 'object' && request !== null && typeof (request as { id?: unknown }).id === 'string' ? (request as { id: string }).id : null
  if (id === null) return { ok: false }
  let found = false
  await deps.update((current) => {
    found = current.some((folder) => folder.id === id)
    return found ? current.filter((folder) => folder.id !== id) : (current as AssistantFolder[])
  })
  if (!found) return { ok: false }
  deps.invalidate()
  await deps.dropMedia()
  return { ok: true }
}
