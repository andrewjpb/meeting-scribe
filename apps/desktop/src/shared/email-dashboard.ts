// Painel de e-mail (contrato 155, D1 e D2): os tipos de `userData/email/dashboard.json`, as chaves, os tetos (D8) e a
// lógica pura da passada e da visão (quem analisar, para onde se pode mover, a montagem dos três cartões, a poda). Sem
// Node e sem Electron: o main e o renderer usam o mesmo arquivo. O esquema zod fica em `email-dashboard-schema.ts` (o
// renderer usa só os tipos e não carrega o zod); quem grava é `main/email/dashboard-store.ts`.
import { isInbox, type EmailFolderNode, type EmailMessage } from './email'
import { semAcento } from './funil-logic'

export const EMAIL_DASHBOARD_FILE = 'dashboard.json'
export const EMAIL_DASHBOARD_VERSION = 1

/** Tetos fixos da passada e da visão (D8, R2 a R6); os testes citam os mesmos números da spec. */
export const DASHBOARD_LIMITS = {
  /** Mensagens dos últimos N dias, pela `date` da mensagem. */
  days: 7,
  perAccount: 60,
  perRun: 150,
  bodyDownloadsPerAccount: 30,
  previewChars: 1500,
  /** Mensagens por chamada ao modelo. */
  perCall: 15,
  callTimeoutMs: 60_000,
  reasonChars: 140,
  replyChars: 1200,
  /** Pastas da conta mandadas ao modelo. */
  folders: 40,
  attentionRows: 15,
  replyRows: 20,
  moveGroups: 10,
  moveRows: 50,
  /** Ignorados e abertos vivem até 365 dias. */
  keepIgnoredDays: 365,
} as const

const DIA_MS = 86_400_000

export type EmailDashboardModel = 'haiku' | 'sonnet'
export type EmailDashboardSuggestionKind = 'reply' | 'move'
/** 0 = o modelo não devolveu. */
export type EmailDashboardImportance = 0 | 1 | 2 | 3 | 4 | 5

export interface EmailDashboardItem {
  accountId: string
  /** O `id` da `EmailMessage` na INBOX (UID ou UIDL). */
  messageKey: string
  /** Message-ID, para sobreviver a troca de UID. */
  messageId: string | null
  analyzedAt: number
  model: EmailDashboardModel
  importance: EmailDashboardImportance
  /** Até 140 caracteres. */
  reason: string
  needsReply: boolean
  /** Até 1.200 caracteres, texto puro. */
  reply: string | null
  /** `folder` = path existente na conta. */
  move: { folder: string; reason: string } | null
}

export interface EmailDashboardLastRun {
  at: number
  model: EmailDashboardModel
  analyzed: number
  costUsd: number | null
  error: string | null
}

export interface EmailDashboardMark {
  key: string
  at: number
}

export interface EmailDashboardStore {
  version: 1
  lastRun: EmailDashboardLastRun | null
  /** Uma entrada por mensagem analisada; chave = `itemKey(accountId, messageKey)`. */
  items: Record<string, EmailDashboardItem>
  /** Chave = `ignoreKey(accountId, messageKey, kind)`. */
  ignored: EmailDashboardMark[]
  /** Respostas já abertas no Composer; chave = `itemKey`. */
  opened: EmailDashboardMark[]
}

export interface EmailDashboardAttentionRow {
  accountId: string
  messageKey: string
  /** Nome do remetente, ou o endereço. */
  from: string
  subject: string
  date: number
  importance: EmailDashboardImportance
  reason: string
  seen: boolean
}

export type EmailDashboardReplyRow = EmailDashboardAttentionRow & { reply: string; opened: boolean }

export interface EmailDashboardMoveGroup {
  accountId: string
  folder: string
  /** O caminho legível da pasta (`label` de `allowedTargetFolders`); "Arquivar" quando ela é a pasta de arquivo da conta (`archiveFolder`). */
  folderName: string
  rows: (EmailDashboardAttentionRow & { moveReason: string })[]
}

export interface EmailDashboardAccountSummary {
  accountId: string
  name: string
  unread: number
  pending: number
  pop3: boolean
}

export interface EmailDashboardView {
  enabled: boolean
  lastRun: EmailDashboardLastRun | null
  running: boolean
  accounts: EmailDashboardAccountSummary[]
  attention: EmailDashboardAttentionRow[]
  replies: EmailDashboardReplyRow[]
  moves: EmailDashboardMoveGroup[]
}

/** A pasta como a lógica precisa (`EmailFolderNode` serve). */
export type EmailDashboardFolder = Pick<EmailFolderNode, 'path' | 'name'> & { specialUse?: string | null; delimiter?: string | null }

/** Destino de mover: `label` é o caminho legível para a tela ("Clientes / Grupo Orion"). */
export interface EmailDashboardTargetFolder {
  path: string
  name: string
  label: string
}

export const itemKey = (accountId: string, messageKey: string): string => `${accountId}:${messageKey}`
export const ignoreKey = (accountId: string, messageKey: string, kind: EmailDashboardSuggestionKind): string => `${accountId}:${messageKey}:${kind}`

export function emptyDashboardStore(): EmailDashboardStore {
  return { version: EMAIL_DASHBOARD_VERSION, lastRun: null, items: {}, ignored: [], opened: [] }
}

const porDataDesc = (a: { date: number }, b: { date: number }): number => b.date - a.date

/**
 * R2: as mensagens da INBOX dos últimos 7 dias, não enviadas por conta própria e sem item analisado depois da data dela.
 * As mais recentes primeiro; corta 60 por conta e depois 150 no total.
 */
export function selectMessagesToAnalyze(input: {
  now: number
  accounts: readonly { accountId: string; ownAddresses: readonly string[]; inbox: readonly EmailMessage[] }[]
  store: EmailDashboardStore
}): { accountId: string; message: EmailMessage }[] {
  const desde = input.now - DASHBOARD_LIMITS.days * DIA_MS
  const todas: { accountId: string; message: EmailMessage }[] = []
  for (const account of input.accounts) {
    const own = new Set(account.ownAddresses.map((address) => address.toLowerCase()))
    const daConta = account.inbox
      .filter((message) => {
        if (!isInbox(message) || message.date < desde) return false
        if (message.from.some((item) => own.has(item.address.toLowerCase()))) return false
        const item = input.store.items[itemKey(account.accountId, message.id)]
        return !item || item.analyzedAt < message.date
      })
      .sort(porDataDesc)
      .slice(0, DASHBOARD_LIMITS.perAccount)
    for (const message of daConta) todas.push({ accountId: account.accountId, message })
  }
  return todas.sort((a, b) => porDataDesc(a.message, b.message)).slice(0, DASHBOARD_LIMITS.perRun)
}

/** Nomes (sem caixa e sem acento) das pastas que nunca recebem sugestão de mover (R4). */
const PASTAS_FORA = new Set(['enviados', 'sent', 'sent items', 'rascunhos', 'drafts', 'lixeira', 'trash', 'deleted', 'spam', 'junk', 'lixo'])
const USOS_FORA = new Set(['\\Sent', '\\Drafts', '\\Trash', '\\Junk', '\\All'])
const PASTAS_ARQUIVO = new Set(['archive', 'arquivo', 'arquivados', 'arquivadas'])

const nomeNormal = (name: string): string => semAcento(name).trim().toLowerCase()

/**
 * O caminho legível da pasta, com " / " entre os segmentos. Pelo delimitador do `LIST` quando a pasta o traz (`null`:
 * pasta sem hierarquia, o path inteiro); sem a informação, `/` ou `.`, como o `breadcrumb` da tela de email.
 */
export function folderPathLabel(folder: Pick<EmailDashboardFolder, 'path' | 'delimiter'>): string {
  const { path, delimiter } = folder
  const parts = delimiter === null ? [path] : delimiter === undefined ? path.split(/[/.]/) : path.split(delimiter)
  return parts.filter(Boolean).join(' / ') || path
}

/** R4: as pastas para onde o modelo pode sugerir mover, até 40, pelo path. */
export function allowedTargetFolders(folders: readonly EmailDashboardFolder[]): EmailDashboardTargetFolder[] {
  return folders
    .filter((folder) => folder.path.toUpperCase() !== 'INBOX' && !USOS_FORA.has(folder.specialUse ?? '') && !PASTAS_FORA.has(nomeNormal(folder.name)))
    .map((folder) => ({ path: folder.path, name: folder.name, label: folderPathLabel(folder) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { sensitivity: 'base' }) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, DASHBOARD_LIMITS.folders)
}

/** A pasta do "Arquivar": a de uso `\Archive`; senão a chamada Archive, Arquivo, Arquivados ou Arquivadas; senão nenhuma. */
export function archiveFolder(folders: readonly EmailDashboardFolder[]): { path: string; name: string } | null {
  const found = folders.find((folder) => folder.specialUse === '\\Archive') ?? folders.find((folder) => PASTAS_ARQUIVO.has(nomeNormal(folder.name)))
  return found ? { path: found.path, name: found.name } : null
}

function remetente(message: EmailMessage): string {
  const first = message.from[0]
  return first ? first.name?.trim() || first.address : ''
}

function linha(accountId: string, message: EmailMessage, importance: EmailDashboardImportance, reason: string): EmailDashboardAttentionRow {
  return { accountId, messageKey: message.id, from: remetente(message), subject: message.subject, date: message.date, importance, reason, seen: message.seen }
}

const porImportancia = (a: EmailDashboardAttentionRow, b: EmailDashboardAttentionRow): number => b.importance - a.importance || b.date - a.date

/**
 * A visão do painel ("Visão para o renderer" da spec). Só entram mensagens ainda na INBOX em cache. Desligado, a atenção
 * vem da heurística (não lidas pendentes, sem motivo) e respostas e mover vêm vazios.
 */
export function buildDashboardView(input: {
  enabled: boolean
  running: boolean
  store: EmailDashboardStore
  accounts: readonly {
    accountId: string
    name: string
    pop3: boolean
    ownAddresses: readonly string[]
    inbox: readonly EmailMessage[]
    /** `messageKey`s pendentes pela heurística (`isPending`). */
    pending: ReadonlySet<string>
    folders: readonly EmailDashboardFolder[]
  }[]
}): EmailDashboardView {
  const { store } = input
  const accounts = input.accounts.map((account) => ({
    accountId: account.accountId,
    name: account.name,
    unread: account.inbox.filter((message) => isInbox(message) && !message.seen).length,
    pending: account.pending.size,
    pop3: account.pop3,
  }))
  const view: EmailDashboardView = { enabled: input.enabled, lastRun: store.lastRun, running: input.running, accounts, attention: [], replies: [], moves: [] }

  if (!input.enabled) {
    const attention: EmailDashboardAttentionRow[] = []
    for (const account of input.accounts) {
      for (const message of account.inbox) {
        if (isInbox(message) && !message.seen && account.pending.has(message.id)) attention.push(linha(account.accountId, message, 0, ''))
      }
    }
    view.attention = attention.sort(porDataDesc).slice(0, DASHBOARD_LIMITS.attentionRows)
    return view
  }

  const ignored = new Set(store.ignored.map((mark) => mark.key))
  const opened = new Set(store.opened.map((mark) => mark.key))
  const attention: EmailDashboardAttentionRow[] = []
  const replies: EmailDashboardReplyRow[] = []
  const grupos = new Map<string, EmailDashboardMoveGroup>()

  for (const account of input.accounts) {
    const destinos = new Map(allowedTargetFolders(account.folders).map((folder) => [folder.path, folder.label]))
    const arquivo = archiveFolder(account.folders)
    for (const message of account.inbox) {
      if (!isInbox(message)) continue
      const key = itemKey(account.accountId, message.id)
      const item = store.items[key]
      if (!item) continue
      const row = linha(account.accountId, message, item.importance, item.reason)
      if (item.importance > 0) attention.push(row)
      if (
        item.needsReply &&
        item.reply &&
        account.pending.has(message.id) &&
        !message.answered &&
        !ignored.has(ignoreKey(account.accountId, message.id, 'reply'))
      ) {
        replies.push({ ...row, reply: item.reply, opened: opened.has(key) })
      }
      const move = item.move
      if (!move || account.pop3 || ignored.has(ignoreKey(account.accountId, message.id, 'move'))) continue
      const folderName = destinos.get(move.folder)
      if (folderName === undefined) continue
      const grupoKey = itemKey(account.accountId, move.folder)
      let grupo = grupos.get(grupoKey)
      if (!grupo) {
        grupo = { accountId: account.accountId, folder: move.folder, folderName: arquivo?.path === move.folder ? 'Arquivar' : folderName, rows: [] }
        grupos.set(grupoKey, grupo)
      }
      grupo.rows.push({ ...row, moveReason: move.reason })
    }
  }

  view.attention = attention.sort(porImportancia).slice(0, DASHBOARD_LIMITS.attentionRows)
  view.replies = replies.sort(porImportancia).slice(0, DASHBOARD_LIMITS.replyRows)
  // Os maiores grupos primeiro; no teto de linhas, o último grupo que cabe entra cortado.
  let restam: number = DASHBOARD_LIMITS.moveRows
  for (const grupo of [...grupos.values()].sort((a, b) => b.rows.length - a.rows.length || a.folderName.localeCompare(b.folderName, 'pt-BR')).slice(0, DASHBOARD_LIMITS.moveGroups)) {
    if (restam <= 0) break
    const rows = grupo.rows.sort(porImportancia).slice(0, restam)
    restam -= rows.length
    view.moves.push({ ...grupo, rows })
  }
  return view
}

/** Tira os itens que saíram da INBOX e os ignorados e abertos com mais de 365 dias; devolve uma cópia. */
export function pruneStore(store: EmailDashboardStore, input: { now: number; liveKeys: ReadonlySet<string> }): EmailDashboardStore {
  const desde = input.now - DASHBOARD_LIMITS.keepIgnoredDays * DIA_MS
  const copia = structuredClone(store)
  return {
    ...copia,
    items: Object.fromEntries(Object.entries(copia.items).filter(([key]) => input.liveKeys.has(key))),
    ignored: copia.ignored.filter((mark) => mark.at >= desde),
    opened: copia.opened.filter((mark) => mark.at >= desde),
  }
}

/** R19: marca a sugestão como ignorada (uma vez por chave); devolve uma cópia. */
export function withIgnored(store: EmailDashboardStore, accountId: string, messageKey: string, kind: EmailDashboardSuggestionKind, now: number): EmailDashboardStore {
  const copia = structuredClone(store)
  const key = ignoreKey(accountId, messageKey, kind)
  if (!copia.ignored.some((mark) => mark.key === key)) copia.ignored.push({ key, at: now })
  return copia
}

/** A resposta sugerida já foi aberta no Composer (uma vez por chave); devolve uma cópia. */
export function withOpened(store: EmailDashboardStore, accountId: string, messageKey: string, now: number): EmailDashboardStore {
  const copia = structuredClone(store)
  const key = itemKey(accountId, messageKey)
  if (!copia.opened.some((mark) => mark.key === key)) copia.opened.push({ key, at: now })
  return copia
}

/**
 * Corta em `max` unidades UTF-16 (a mesma medida do `.max` do esquema) sem partir um par substituto: se o corte cai
 * depois de uma metade alta, ela sai também.
 */
function cortar(text: string, max: number): string {
  if (text.length <= max) return text
  const code = text.charCodeAt(max - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max)
}

const objeto = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * R6: o que o modelo devolveu para uma mensagem, dentro dos limites. Sem `importance` inteira de 1 a 5, o item inteiro
 * é descartado (`null`); `reply` só fica com `needsReply`; `move` sem pasta vira `null`.
 */
export function clampModelItem(raw: unknown): Pick<EmailDashboardItem, 'importance' | 'reason' | 'needsReply' | 'reply' | 'move'> | null {
  if (!objeto(raw)) return null
  const importance = raw['importance']
  if (typeof importance !== 'number' || !Number.isInteger(importance) || importance < 1 || importance > 5) return null
  const reason = typeof raw['reason'] === 'string' ? cortar(raw['reason'].trim(), DASHBOARD_LIMITS.reasonChars) : ''
  const needsReply = raw['needsReply'] === true
  const rawReply = raw['reply']
  const reply = needsReply && typeof rawReply === 'string' && rawReply.trim() ? cortar(rawReply.trim(), DASHBOARD_LIMITS.replyChars) : null
  const rawMove = raw['move']
  let move: EmailDashboardItem['move'] = null
  if (objeto(rawMove) && typeof rawMove['folder'] === 'string' && rawMove['folder'].trim()) {
    move = { folder: rawMove['folder'], reason: typeof rawMove['reason'] === 'string' ? cortar(rawMove['reason'].trim(), DASHBOARD_LIMITS.reasonChars) : '' }
  }
  return { importance: importance as EmailDashboardImportance, reason, needsReply, reply, move }
}
