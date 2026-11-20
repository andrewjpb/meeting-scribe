// Para onde uma mensagem pode ir (contrato 55, CA5 a CA8 e CA10): os alvos de soltura da barra lateral, o submenu
// "Mover para ›" do clique direito, as pastas recentes do menu "Mais", os lotes de 500 do mover e a frase de cada erro
// do contrato 52. Sem DOM: testado em test/renderer/email-move-targets.test.ts.
import { EMAIL_MOVE_MAX, type EmailFolderError } from '@shared/email'
import { flattenTree, type FolderItem } from './folderTree'

/** Pastas recentes do "Mais", por conta. */
export const RECENT_FOLDERS_MAX = 3

/** O que está sendo arrastado: de que conta e de que pasta. */
export interface DragSource {
  accountId: string
  fromPath: string
  /** Conta POP3: sem pastas no servidor, nada se move. */
  pop3: boolean
}

/**
 * Uma pasta da barra lateral aceita a soltura (CA5): da mesma conta, que não é a atual, nem `\Noselect`, nem
 * Rascunhos; numa conta POP3, nenhuma.
 */
export function canDrop(source: DragSource, target: { accountId: string; item: Pick<FolderItem, 'path' | 'kind' | 'noselect'> }): boolean {
  if (source.pop3 || target.accountId !== source.accountId) return false
  const { item } = target
  return !item.noselect && item.kind !== 'drafts' && item.path !== source.fromPath
}

/** A etiqueta da soltura: "Mover 3 mensagens para ABF" (singular para 1). */
export function dropLabel(count: number, target: string): string {
  return `Mover ${count === 1 ? '1 mensagem' : `${count} mensagens`} para ${target}`
}

/**
 * O submenu "Mover para ›" do clique direito (CA8, tela 04): as pastas da barra lateral, com o nível, fora Rascunhos,
 * Enviados e Lixeira; a atual (e as `\Noselect`) aparecem desligadas.
 */
export function submenuTargets(sidebar: readonly FolderItem[], currentPath: string): { item: FolderItem; depth: number; disabled: boolean }[] {
  return flattenTree(sidebar)
    .filter(({ item }) => item.kind !== 'drafts' && item.kind !== 'sent' && item.kind !== 'trash')
    .map(({ item, depth }) => ({ item, depth, disabled: item.path === currentPath || item.noselect }))
}

/** A pasta (ou uma subpasta dela). */
const within = (path: string, parent: string, delimiter: string | null): boolean => path === parent || (delimiter !== null && path.startsWith(`${parent}${delimiter}`))

/** Depois de mover para `path`: ela na frente, sem repetir, até 3. */
export function pushRecent(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((item) => item !== path)].slice(0, RECENT_FOLDERS_MAX)
}

/** Renomeada pelo app: a pasta (e as subpastas dela) com o path novo. */
export function renameRecent(list: readonly string[], from: string, to: string, delimiter: string | null): string[] {
  return [...new Set(list.map((item) => (within(item, from, delimiter) ? `${to}${item.slice(from.length)}` : item)))]
}

/** Apagada pelo app: a pasta e as subpastas saem. */
export function dropRecent(list: readonly string[], path: string, delimiter: string | null): string[] {
  return list.filter((item) => !within(item, path, delimiter))
}

/** As recentes de uma conta que existem na árvore, fora a pasta atual (o menu "Mais", CA6). */
export function recentTargets(list: readonly string[] | undefined, sidebar: readonly FolderItem[], currentPath: string): FolderItem[] {
  const all = flattenTree(sidebar).map(({ item }) => item)
  return (list ?? []).flatMap((path) => {
    const item = all.find((folder) => folder.path === path)
    return item && path !== currentPath && !item.noselect ? [item] : []
  })
}

/** Os UIDs em lotes de até 500 (o teto do `scribe:email-move`). */
export function moveChunks(uids: readonly number[], size = EMAIL_MOVE_MAX): number[][] {
  const out: number[][] = []
  for (let at = 0; at < uids.length; at += size) out.push(uids.slice(at, at + size))
  return out
}

/** A frase de um erro do mover (CA10), numa nota acima da lista. `protected` e `pop3` não chegam: a tela não oferece. */
export function moveErrorText(error: EmailFolderError, moved = 0, total = 0): string {
  const base: Record<EmailFolderError, string> = {
    unavailable: 'Sem conexão com o servidor. Nada foi movido.',
    server: 'O servidor recusou. Nada foi movido.',
    invalid: 'A pasta mudou no servidor. Atualize e tente de novo.',
    unsupported: 'Este servidor não move sem risco de apagar outras mensagens.',
    missing: 'A pasta não existe mais nesta conta. Nada foi movido.',
    protected: 'Esta pasta é do sistema. Nada foi movido.',
    pop3: 'Conta POP3 não tem pastas no servidor. Nada foi movido.',
  }
  // Lote de 500 que falhou no meio: as de antes foram.
  if (moved > 0) return `${moved} de ${total} mensagens foram movidas; as outras ficaram. ${base[error].replace(' Nada foi movido.', '')}`.trim()
  return base[error]
}
