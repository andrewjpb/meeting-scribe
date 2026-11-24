// Pastas do Assistente (contrato 165, pastas-assistente A e B): as pastas do Mac que a pessoa deixa o Assistente ler, só
// leitura. A lista fica em `settings.assistant.folders` e só muda pelos canais do main (o diálogo nativo); a cada pergunta,
// com a fonte "Pastas" ligada, a pasta da conversa recebe o `PASTAS.md` com os arquivos (nome, caminho relativo, tipo,
// tamanho, data e um id). Aqui ficam os tipos, os limites e as regras puras: quais pastas são recusadas, quais arquivos
// entram no índice e o texto do índice. O esquema zod fica em `assistant-folders-schema.ts`, a varredura em
// `main/chat/folders.ts`. Sem Node e sem Electron: roda no main, no renderer e nos testes.

/** Uma pasta permitida: `id` gerado no main (`randomUUID`), `path` já é o `realpath`. */
export interface AssistantFolder {
  id: string
  path: string
  addedAt: string
}

/** Por que uma pasta escolhida não entrou. `limite`: já há `ASSISTANT_FOLDERS_MAX` pastas. */
export type FolderRefusal = 'sensivel' | 'oculta' | 'repetida' | 'inexistente' | 'limite'

/** Resposta de `scribe:assistant-folder-add`. `replaced`: os caminhos das pastas que a nova engloba (saem da lista). */
export interface FolderAddResult {
  added: AssistantFolder[]
  refused: { path: string; reason: FolderRefusal }[]
  replaced: string[]
}

export type FolderFileKind = 'pdf' | 'imagem' | 'word' | 'planilha' | 'texto' | 'anexo'

/** Um arquivo do índice. O `id` é calculado só no main (`folderFileId`) e só ele resolve o arquivo. */
export interface FolderFileEntry {
  /** hash16 (sha256 hex, 16 caracteres) de `${folderId}\n${relPath}`. */
  id: string
  folderId: string
  /** Separador '/', relativo à pasta permitida, sem './'. */
  relPath: string
  name: string
  /** Minúscula, sem ponto. */
  ext: string
  kind: FolderFileKind
  /** `kind !== 'anexo'`. */
  readable: boolean
  size: number
  /** ms. */
  mtime: number
}

/** O que a varredura de uma pasta achou. `skipped`: arquivos de outros tipos, acima do limite ou links simbólicos. */
export interface FolderScan {
  folderId: string
  label: string
  path: string
  entries: FolderFileEntry[]
  skipped: number
  /** Parou no limite de arquivos: há mais do que a lista mostra. */
  truncated: boolean
  /** Parou no limite de tempo (ou a pasta não existe agora): a lista é parcial. */
  partial: boolean
}

export const ASSISTANT_FOLDERS_MAX = 20
export const FOLDER_FILE_MAX_BYTES = 20 * 1024 * 1024
export const FOLDER_SCAN_DEPTH_MAX = 6
export const FOLDER_SCAN_PER_FOLDER_MAX = 2000
export const FOLDER_SCAN_TOTAL_MAX = 5000
export const FOLDER_SCAN_TIME_MS = 5000
export const FOLDER_INDEX_TTL_MS = 30_000

/** Os tipos que o Assistente lê (B4): PDF e imagem pelo Read do CLI, Word pelo `textutil`, planilha pelo leitor próprio, texto direto. */
export const FOLDER_READABLE_EXTS: Readonly<Record<string, FolderFileKind>> = Object.freeze({
  pdf: 'pdf',
  png: 'imagem',
  jpg: 'imagem',
  jpeg: 'imagem',
  gif: 'imagem',
  webp: 'imagem',
  docx: 'word',
  doc: 'word',
  rtf: 'word',
  odt: 'word',
  xlsx: 'planilha',
  csv: 'texto',
  tsv: 'texto',
  txt: 'texto',
  md: 'texto',
  json: 'texto',
})
/** Os tipos que entram no índice só para anexar (o Assistente não lê o conteúdo). */
export const FOLDER_ATTACH_ONLY_EXTS: readonly string[] = Object.freeze(['pptx', 'ppt', 'xls', 'ods', 'odp', 'numbers', 'pages', 'key'])
/** Pastas que a varredura nunca abre. */
export const FOLDER_SKIPPED_DIRS: readonly string[] = Object.freeze(['node_modules', '__MACOSX'])
/** Pacotes do macOS (pastas que o Finder mostra como arquivo): a varredura não entra. */
export const FOLDER_SKIPPED_SUFFIXES: readonly string[] = Object.freeze(['.app', '.photoslibrary', '.bundle', '.framework'])
/** Raízes que nunca podem ser escolhidas (A2). */
export const FOLDER_SENSITIVE_ROOTS: readonly string[] = Object.freeze(['/', '/System', '/Library', '/private', '/etc', '/var', '/usr', '/bin', '/sbin', '/Applications', '/Volumes'])
/** Raízes do sistema em que nem as subpastas podem ser escolhidas. */
const SENSITIVE_TREES: readonly string[] = ['/System', '/Library', '/private', '/etc', '/var', '/usr', '/bin', '/sbin']

/** O tipo de um arquivo pela extensão; `null` = fora do índice (sem extensão ou de outro tipo). */
export function fileKindOf(name: string): { kind: FolderFileKind; readable: boolean } | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  const ext = name.slice(dot + 1).toLowerCase()
  const kind = Object.hasOwn(FOLDER_READABLE_EXTS, ext) ? FOLDER_READABLE_EXTS[ext] : undefined
  if (kind) return { kind, readable: true }
  if (FOLDER_ATTACH_ONLY_EXTS.includes(ext)) return { kind: 'anexo', readable: false }
  return null
}

/** `child` é `parent` ou está dentro dele (por segmento: `/a/bc` não está dentro de `/a/b`). */
function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true
  return child.startsWith(parent.endsWith('/') ? parent : `${parent}/`)
}

/**
 * Por que a pasta não pode ser escolhida, ou `null`. `realPath` já é o `realpath` (a pasta que não existe é decidida antes,
 * pelo chamador). Na ordem: `sensivel` (as raízes do sistema, a pasta pessoal inteira e as que a contêm, `~/Library` e a
 * pasta de dados do app, com o que tem dentro e as que a contêm), `oculta` (um segmento começando com ponto), `repetida`
 * (já está na lista ou dentro de uma da lista). A pasta que engloba outras da lista não é recusada: as de dentro saem
 * (`foldersReplacedBy`). `smokeRoot`: só o smoke passa; dentro dele, só a etapa `sensivel` é pulada.
 */
export function folderRefusal(realPath: string, ctx: { home: string; userData: string; existing: readonly AssistantFolder[]; smokeRoot?: string }): FolderRefusal | null {
  if (!(ctx.smokeRoot && isWithin(realPath, ctx.smokeRoot))) {
    if (FOLDER_SENSITIVE_ROOTS.includes(realPath) || isWithin(ctx.home, realPath)) return 'sensivel'
    if (isWithin(realPath, `${ctx.home}/Library`) || isWithin(realPath, ctx.userData) || isWithin(ctx.userData, realPath)) return 'sensivel'
    if (SENSITIVE_TREES.some((root) => isWithin(realPath, root))) return 'sensivel'
  }
  if (realPath.split('/').some((segment) => segment.startsWith('.'))) return 'oculta'
  if (ctx.existing.some((folder) => isWithin(realPath, folder.path))) return 'repetida'
  return null
}

/** As pastas da lista que a nova engloba (as de dentro dela, nunca ela mesma). */
export function foldersReplacedBy(realPath: string, existing: readonly AssistantFolder[]): AssistantFolder[] {
  return existing.filter((folder) => folder.path !== realPath && isWithin(folder.path, realPath))
}

/** O nome da pasta: o último segmento do caminho. */
export function folderLabel(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? '/'
}

/** O caminho com a pasta pessoal abreviada: `~/Documents/…`. */
export function shortenHome(path: string, home: string): string {
  if (!home || home === '/') return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

const two = (value: number): string => String(value).padStart(2, '0')
const dateText = (date: Date): string => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`

/** Tamanho legível: "240 KB", "1,2 MB". */
function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

/** Uma célula numa linha: sem `|`, sem crase e sem quebra de linha ou outro caractere de controle. */
function cell(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0)
      return char === '|' || char === '`' || code < 0x20 || code === 0x7f ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

const files = (count: number): string => (count === 1 ? '1 arquivo' : `${count} arquivos`)

/**
 * O `PASTAS.md` (B5): o resumo, a instrução de citação e, por pasta, a tabela dos arquivos com o id. Nunca conteúdo de
 * arquivo. Os nomes vêm do disco: uma linha cada, sem `|` nem crase.
 */
export function renderPastasIndex(scans: readonly FolderScan[], now: Date, home: string): string {
  const listed = scans.reduce((total, scan) => total + scan.entries.length, 0)
  const incomplete = scans.some((scan) => scan.truncated || scan.partial)
  const lines = [
    '# Pastas permitidas',
    `Atualizado em ${dateText(now)} ${two(now.getHours())}:${two(now.getMinutes())}. ${scans.length === 1 ? '1 pasta' : `${scans.length} pastas`}, ${files(listed)} listados${incomplete ? ' (lista incompleta)' : ''}.`,
    'Cite um arquivo como [Pasta · <Pasta>/<caminho>](pasta:<id>). Para ler, use a ferramenta ler_arquivo_pasta com o id.',
    '',
  ]
  for (const scan of scans) {
    lines.push(`## ${cell(scan.label)}  (${cell(shortenHome(scan.path, home))})  — ${files(scan.entries.length)}`)
    if (scan.entries.length > 0) {
      lines.push('| id | arquivo | tipo | tamanho | modificado | legível |')
      for (const entry of scan.entries) lines.push(`| ${entry.id} | ${cell(entry.relPath)} | ${cell(entry.ext)} | ${sizeLabel(entry.size)} | ${dateText(new Date(entry.mtime))} | ${entry.readable ? 'sim' : 'não (só anexo)'} |`)
    } else lines.push('Nenhum arquivo listado.')
    if (scan.truncated) lines.push('… e outros arquivos não listados (limite de arquivos atingido).')
    if (scan.skipped > 0) lines.push(`${files(scan.skipped)} de outros tipos ou acima de 20 MB.`)
    if (scan.partial) lines.push('varredura interrompida: lista parcial.')
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
