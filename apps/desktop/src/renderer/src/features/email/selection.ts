// Seleção múltipla da lista de email (contrato 55, CA4), como no Outlook: o clique simples abre (e seleciona só ela),
// ⌘ clique liga e desliga uma, ⇧ clique escolhe o intervalo desde a âncora, Esc limpa e trocar de pasta também. Sem DOM:
// testado em test/renderer/email-selection.test.ts.

export interface EmailSelection {
  /** As escolhidas, na ordem da lista. */
  ids: string[]
  /** De onde o ⇧ clique conta o intervalo (a última clicada sem ⇧). */
  anchor: string | null
}

export const EMPTY_SELECTION: EmailSelection = Object.freeze({ ids: [], anchor: null }) as EmailSelection

export type SelectionAction =
  | { type: 'click'; id: string; meta?: boolean; shift?: boolean }
  | { type: 'clear' }
  /** Outra pasta aberta: a seleção some. */
  | { type: 'folder' }
  /** A lista mudou (mensagens movidas, apagadas ou relidas): as que saíram deixam a seleção. */
  | { type: 'prune' }

/** `order`: os ids da lista, na ordem da tela. */
export function selectionReducer(current: EmailSelection, action: SelectionAction, order: readonly string[]): EmailSelection {
  const inOrder = (ids: Iterable<string>): string[] => {
    const set = new Set(ids)
    return order.filter((id) => set.has(id))
  }
  switch (action.type) {
    case 'clear':
    case 'folder':
      return EMPTY_SELECTION
    case 'prune': {
      const ids = inOrder(current.ids)
      const anchor = current.anchor !== null && order.includes(current.anchor) ? current.anchor : (ids[0] ?? null)
      return ids.length === current.ids.length && anchor === current.anchor ? current : { ids, anchor }
    }
    case 'click': {
      const { id } = action
      if (!order.includes(id)) return current
      if (action.shift) {
        const anchor = current.anchor !== null && order.includes(current.anchor) ? current.anchor : id
        const from = order.indexOf(anchor)
        const to = order.indexOf(id)
        return { ids: order.slice(Math.min(from, to), Math.max(from, to) + 1), anchor }
      }
      if (action.meta) {
        const ids = current.ids.includes(id) ? current.ids.filter((item) => item !== id) : inOrder([...current.ids, id])
        return { ids, anchor: id }
      }
      return { ids: [id], anchor: id }
    }
  }
}

/** Com 2 ou mais, a lista entra no modo de seleção (caixas no lugar do avatar) e a leitura vira o resumo. */
export const isMultiSelection = (selection: EmailSelection): boolean => selection.ids.length >= 2

/** "3 selecionadas". */
export function selectedLabel(count: number): string {
  return count === 1 ? '1 selecionada' : `${count} selecionadas`
}

/** "1 mensagem" / "3 mensagens". */
export function messagesLabel(count: number): string {
  return count === 1 ? '1 mensagem' : `${count} mensagens`
}
