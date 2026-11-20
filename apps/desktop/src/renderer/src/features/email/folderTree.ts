// Árvore de pastas do email na tela (contrato 55, CA2): a ordem da barra lateral e do seletor "Mover para…", os nomes
// da casa e o breadcrumb ("Clientes › ABF"). Parte da árvore do `scribe:email-folders` (contrato 52), sem DOM: testado
// em test/renderer/email-folder-tree.test.ts.
import { EMAIL_FOLDER_NAME_MAX, EMAIL_INBOX_MAILBOX, EMAIL_PROTECTED_SPECIAL_USE, type EmailFolderError, type EmailFolderNode } from '@shared/email'
import type { EmailRouteFolder } from '@shared/routes'

/** O papel da pasta na tela: as do sistema têm lugar fixo e nome da casa; `folder` é uma pasta da pessoa. */
export type FolderKind = 'inbox' | 'drafts' | 'sent' | 'junk' | 'trash' | 'all' | 'flagged' | 'important' | 'archive' | 'folder'

export interface FolderItem {
  path: string
  /** O nome na tela: o da casa nas do sistema, o do servidor nas outras. */
  label: string
  kind: FolderKind
  specialUse: string | null
  noselect: boolean
  unseen: number | null
  total: number | null
  /** INBOX e pastas especiais: não se renomeiam nem se apagam (contrato 52). */
  protected: boolean
  /** O delimitador do servidor (`/`, `.`), ou `null`. */
  delimiter: string | null
  children: FolderItem[]
}

const KIND_BY_USE: Record<string, FolderKind> = {
  '\\Drafts': 'drafts',
  '\\Sent': 'sent',
  '\\Junk': 'junk',
  '\\Trash': 'trash',
  '\\All': 'all',
  '\\Flagged': 'flagged',
  '\\Important': 'important',
  '\\Archive': 'archive',
}

const HOUSE_NAMES: Partial<Record<FolderKind, string>> = {
  inbox: 'Caixa de Entrada',
  drafts: 'Rascunhos',
  sent: 'Enviados',
  junk: 'Spam',
  trash: 'Lixeira',
  all: 'Todos os e-mails',
  flagged: 'Com estrela',
}

/** As que sobem para a raiz, onde quer que estejam no servidor (no Gmail, os filhos de `[Gmail]`). */
const RISING: readonly FolderKind[] = ['drafts', 'sent', 'junk', 'trash', 'all', 'flagged', 'important']
/** Só no seletor (CA7): no sidebar, escondidas. */
const PICKER_ONLY: readonly FolderKind[] = ['all', 'flagged', 'important']

export function folderKind(node: Pick<EmailFolderNode, 'path' | 'specialUse'>): FolderKind {
  if (node.path.toUpperCase() === EMAIL_INBOX_MAILBOX) return 'inbox'
  return (node.specialUse ? KIND_BY_USE[node.specialUse] : undefined) ?? 'folder'
}

/** O nome da pasta na tela: "Caixa de Entrada", "Rascunhos", "Enviados", "Spam", "Lixeira"… ou o do servidor. */
export function folderLabel(node: Pick<EmailFolderNode, 'path' | 'name' | 'specialUse'>): string {
  return HOUSE_NAMES[folderKind(node)] ?? node.name
}

const compare = (a: FolderItem, b: FolderItem): number => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }) || a.path.localeCompare(b.path)

function toItem(node: EmailFolderNode, children: FolderItem[]): FolderItem {
  const kind = folderKind(node)
  return {
    path: node.path,
    label: folderLabel(node),
    kind,
    specialUse: node.specialUse,
    noselect: node.noselect,
    unseen: node.unseen,
    total: node.total,
    protected: kind === 'inbox' || (node.specialUse !== null && (EMAIL_PROTECTED_SPECIAL_USE as readonly string[]).includes(node.specialUse)),
    delimiter: node.delimiter,
    children,
  }
}

/**
 * As pastas do sistema saem de onde estão (sobem para a raiz) e o resto fica em árvore, em ordem alfabética em cada
 * nível. Um nó `\Noselect` que ficou sem filhos (o `[Gmail]`, depois que os dele subiram) sai.
 */
function split(nodes: readonly EmailFolderNode[]): { system: FolderItem[]; rest: FolderItem[] } {
  const system: FolderItem[] = []
  const walk = (list: readonly EmailFolderNode[]): FolderItem[] => {
    const out: FolderItem[] = []
    for (const node of list) {
      const children = walk(node.children)
      const item = toItem(node, children)
      if (RISING.includes(item.kind) || item.kind === 'inbox') system.push(item)
      else if (!(item.noselect && children.length === 0)) out.push(item)
    }
    return out.sort(compare)
  }
  const rest = walk(nodes)
  return { system, rest }
}

function ordered(nodes: readonly EmailFolderNode[], withPickerOnly: boolean): FolderItem[] {
  const { system, rest } = split(nodes)
  const pick = (kind: FolderKind): FolderItem[] => system.filter((item) => item.kind === kind)
  return [
    ...pick('inbox'),
    ...pick('drafts'),
    ...pick('sent'),
    ...rest,
    ...(withPickerOnly ? [...pick('all'), ...pick('flagged'), ...pick('important')] : []),
    ...pick('junk'),
    ...pick('trash'),
  ]
}

/**
 * A árvore da barra lateral (D1): Caixa de Entrada, Rascunhos e Enviados no topo; as pastas da pessoa em ordem
 * alfabética (também dentro de cada subpasta); Spam e Lixeira no fim. "Todos os e-mails", "Com estrela" e `\Important`
 * ficam de fora (só no seletor); `\Archive` entra na ordem alfabética, com o nome do servidor.
 */
export function sidebarTree(nodes: readonly EmailFolderNode[]): FolderItem[] {
  return ordered(nodes, false).filter((item) => !PICKER_ONLY.includes(item.kind))
}

/** A árvore do seletor "Mover para…" (CA7): a da barra lateral mais "Todos os e-mails" e "Com estrela". */
export function pickerTree(nodes: readonly EmailFolderNode[]): FolderItem[] {
  return ordered(nodes, true)
}

/** Todas as pastas de uma árvore, em ordem (pais antes dos filhos), com o nível. */
export function flattenTree(items: readonly FolderItem[], depth = 0): { item: FolderItem; depth: number }[] {
  return items.flatMap((item) => [{ item, depth }, ...flattenTree(item.children, depth + 1)])
}

/** A pasta pelo path, em qualquer nível. */
export function findFolder(items: readonly FolderItem[], path: string): FolderItem | null {
  for (const item of items) {
    if (item.path === path) return item
    const inner = findFolder(item.children, path)
    if (inner) return inner
  }
  return null
}

/**
 * O caminho da pasta na tela: "Clientes › ABF". As do sistema, só o nome da casa ("Lixeira", não "[Gmail] › Lixeira").
 * Pasta que não está na árvore: o path com "›" no lugar do delimitador.
 */
export function breadcrumb(path: string, nodes: readonly EmailFolderNode[]): string {
  const trail = (list: readonly EmailFolderNode[], parents: EmailFolderNode[]): EmailFolderNode[] | null => {
    for (const node of list) {
      if (node.path === path) return [...parents, node]
      const inner = trail(node.children, [...parents, node])
      if (inner) return inner
    }
    return null
  }
  const found = trail(nodes, [])
  if (!found) return path.toUpperCase() === EMAIL_INBOX_MAILBOX ? 'Caixa de Entrada' : path.split(/[/.]/).filter(Boolean).join(' › ') || path
  const last = found.at(-1) as EmailFolderNode
  if (RISING.includes(folderKind(last))) return folderLabel(last)
  // Os pais que não aparecem na barra lateral (o `[Gmail]` `\Noselect` que ficou vazio) não entram.
  const visible = pickerTree(nodes)
  return found
    .filter((node, index) => index === found.length - 1 || findFolder(visible, node.path) !== null)
    .map(folderLabel)
    .join(' › ')
}

/** A pasta na rota da tela: a Caixa de Entrada e os Enviados têm caminho próprio (contrato 43); as outras, o path. */
export function routeFolder(item: Pick<FolderItem, 'kind' | 'path'>): EmailRouteFolder {
  return item.kind === 'inbox' ? 'inbox' : item.kind === 'sent' ? 'sent' : { path: item.path }
}

/** O nome de pasta como o contrato 52 aceita (1 a 100, sem o delimitador, sem quebra de linha); `null` quando serve. */
export function folderNameError(name: string, delimiter: string | null): string | null {
  const value = name.trim()
  if (!value) return 'Escreva o nome da pasta.'
  if (value.length > EMAIL_FOLDER_NAME_MAX) return `O nome passa de ${EMAIL_FOLDER_NAME_MAX} caracteres.`
  if (/[\r\n]/.test(value)) return 'O nome fica numa linha só.'
  if (delimiter && value.includes(delimiter)) return `O nome não pode ter “${delimiter}”.`
  return null
}

/** A recusa do main ao criar, renomear ou apagar pasta, em frase. */
export function folderErrorText(error: EmailFolderError): string {
  switch (error) {
    case 'invalid':
      return 'Esse nome não serve aqui (talvez já exista uma pasta com ele).'
    case 'unavailable':
      return 'Sem conexão com o servidor. Nada mudou.'
    case 'server':
      return 'O servidor recusou. Nada mudou.'
    case 'protected':
      return 'Pasta do sistema: não se renomeia nem se apaga.'
    case 'missing':
      return 'A pasta não existe mais nesta conta.'
    case 'pop3':
      return 'Conta POP3 não tem pastas no servidor.'
    case 'unsupported':
      return 'Este servidor não deixa fazer isso.'
  }
}

/**
 * Apagar pasta (CA9, D11): a confirmação de agora. Sem `contents`, a pergunta curta, e o clique manda o pedido SEM
 * `force`; com o `contents` que o contrato 52 devolveu (o real do servidor, não o total da árvore guardada), a pergunta
 * longa e o aviso, e só esse segundo clique manda `force`.
 */
export function deleteConfirmation(label: string, contents: { messages: number; folders: number } | null): { question: string; warning: string | null; button: string; force: boolean } {
  if (!contents || (contents.messages === 0 && contents.folders === 0)) return { question: `Apagar a pasta “${label}”?`, warning: null, button: 'Apagar pasta', force: false }
  const parts = [contents.messages > 0 ? (contents.messages === 1 ? 'a mensagem' : `as ${contents.messages} mensagens`) : null, contents.folders > 0 ? (contents.folders === 1 ? 'a subpasta' : `as ${contents.folders} subpastas`) : null].filter(Boolean)
  return {
    question: `Apagar a pasta “${label}” e ${parts.join(' e ')} dela?`,
    warning: 'As mensagens são apagadas no servidor, sem passar pela Lixeira. Para guardar, mova antes para outra pasta.',
    button: 'Apagar pasta e mensagens',
    force: true,
  }
}

/** O passo seguinte depois da resposta do apagar: feito, a confirmação longa com o conteúdo real, ou a frase do erro. */
export function deleteNextStep(result: { ok: true } | { ok: false; error: EmailFolderError; contents?: { messages: number; folders: number } | undefined }, forced: boolean): { kind: 'done' } | { kind: 'confirm'; contents: { messages: number; folders: number } } | { kind: 'error'; text: string } {
  if (result.ok) return { kind: 'done' }
  if (!forced && result.error === 'invalid' && result.contents) return { kind: 'confirm', contents: result.contents }
  return { kind: 'error', text: folderErrorText(result.error) }
}
