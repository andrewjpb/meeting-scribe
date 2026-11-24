// Painel de e-mail no renderer (contrato 157): a visão que o main monta (`scribe:email-dashboard-get` e o evento
// `scribe:email-dashboard-changed`), o que está aberto na tela (respostas expandidas, "Mostrar mais") e o último lote
// movido pelo Painel, para o Desfazer. Ignorar e Mover tiram a linha na hora; em falha, a visão é relida. Nada é enviado
// nem movido sem o clique da pessoa, e nenhum texto de e-mail vai para o console.
import { create } from 'zustand'
import { emailPath, type EmailNavigationState } from '@shared/routes'
import { ignoreKey, itemKey, type EmailDashboardReplyRow, type EmailDashboardSuggestionKind, type EmailDashboardView } from '@shared/email-dashboard'
import { useEmail } from './emailStore'
import { PAINEL_ERRO_CARREGAR, PAINEL_ERRO_MOVER } from './painelFormat'

/** O lote que o Painel acabou de mover (o banner do Desfazer). */
export interface PainelBatch {
  batchId: string
  moved: number
  folderName: string
  accountId: string
  at: number
}

type Navigate = (to: string, options: { state: EmailNavigationState }) => unknown

interface PainelState {
  view: EmailDashboardView | null
  loading: boolean
  /** Um dos textos fixos de `painelFormat` (nada do e-mail). */
  error: string | null
  /** `itemKey` das respostas abertas por inteiro. */
  expanded: Set<string>
  showAllReplies: boolean
  lastBatch: PainelBatch | null
  load: () => Promise<void>
  run: () => Promise<void>
  ignore: (accountId: string, messageKey: string, kind: EmailDashboardSuggestionKind) => Promise<void>
  openReply: (row: EmailDashboardReplyRow, navigate: Navigate) => void
  applyMove: (accountId: string, folder: string, keys: readonly string[]) => Promise<void>
  undoLast: () => Promise<void>
  /** Ouve `scribe:email-dashboard-changed`; devolve a função que para de ouvir. */
  subscribe: () => () => void
  toggleExpanded: (key: string) => void
  setShowAllReplies: (show: boolean) => void
  clearBatch: () => void
}

/** A visão sem as linhas que saíram (ignoradas ou movidas); grupo vazio sai junto. */
function semLinhas(view: EmailDashboardView, accountId: string, keys: ReadonlySet<string>, kind: EmailDashboardSuggestionKind | 'all'): EmailDashboardView {
  const sai = (row: { accountId: string; messageKey: string }): boolean => row.accountId === accountId && keys.has(row.messageKey)
  return {
    ...view,
    replies: kind === 'move' ? view.replies : view.replies.filter((row) => !sai(row)),
    moves: kind === 'reply' ? view.moves : view.moves.map((group) => ({ ...group, rows: group.rows.filter((row) => !sai(row)) })).filter((group) => group.rows.length > 0),
  }
}

/**
 * Ignorados nesta sessão (`ignoreKey`): toda visão que chega (a resposta de um IPC, o evento, o `load`) sai sem eles. Com
 * dois Ignorar seguidos, a visão devolvida pelo 1º ainda traz a linha do 2º, que reapareceria por um instante. O main já
 * os grava como ignorados, então filtrar sempre é correto; o Ignorar que falha sai do conjunto.
 */
const ignorados = new Set<string>()

function semIgnorados(view: EmailDashboardView): EmailDashboardView {
  if (ignorados.size === 0) return view
  const fica = (kind: EmailDashboardSuggestionKind) => (row: { accountId: string; messageKey: string }): boolean => !ignorados.has(ignoreKey(row.accountId, row.messageKey, kind))
  return {
    ...view,
    replies: view.replies.filter(fica('reply')),
    moves: view.moves.map((group) => ({ ...group, rows: group.rows.filter(fica('move')) })).filter((group) => group.rows.length > 0),
  }
}

/** Só para os testes. */
export function resetPainelIgnorados(): void {
  ignorados.clear()
}

export const usePainel = create<PainelState>()((set, get) => ({
  view: null,
  loading: false,
  error: null,
  expanded: new Set(),
  showAllReplies: false,
  lastBatch: null,

  load: async () => {
    set({ loading: true })
    try {
      const view = semIgnorados(await window.__scribeApi.emailDashboardGet())
      set({ view, loading: false, error: get().error === PAINEL_ERRO_CARREGAR ? null : get().error })
    } catch {
      set({ loading: false, error: PAINEL_ERRO_CARREGAR })
    }
  },

  run: async () => {
    try {
      const result = await window.__scribeApi.emailDashboardRun()
      // A visão nova chega pelo evento (inclusive no início da passada); aqui só o botão passa a "Analisando…".
      if (result.running) set((state) => (state.view ? { view: { ...state.view, running: true } } : {}))
    } catch {
      // Bloqueado: o botão continua como estava.
    }
  },

  ignore: async (accountId, messageKey, kind) => {
    const chave = ignoreKey(accountId, messageKey, kind)
    ignorados.add(chave)
    const { view } = get()
    if (view) set({ view: semLinhas(view, accountId, new Set([messageKey]), kind) })
    try {
      set({ view: semIgnorados(await window.__scribeApi.emailDashboardIgnore({ accountId, messageKey, kind })) })
    } catch {
      // Não gravou: a linha volta com a visão relida.
      ignorados.delete(chave)
      void get().load()
    }
  },

  openReply: (row, navigate) => {
    const key = itemKey(row.accountId, row.messageKey)
    set((state) => (state.view ? { view: { ...state.view, replies: state.view.replies.map((item) => (itemKey(item.accountId, item.messageKey) === key ? { ...item, opened: true } : item)) } } : {}))
    window.__scribeApi.emailDashboardOpened({ accountId: row.accountId, messageKey: row.messageKey }).then(
      (view) => set({ view: semIgnorados(view) }),
      () => undefined,
    )
    // D5: o Composer abre pelo estado da navegação, só com o rascunho preenchido; o Enviar continua com a pessoa.
    const state: EmailNavigationState = { compose: { replyTo: { messageKey: row.messageKey, mailbox: 'INBOX' }, text: row.reply } }
    void navigate(emailPath(row.accountId, 'inbox'), { state })
  },

  applyMove: async (accountId, folder, keys) => {
    const { view } = get()
    const group = view?.moves.find((item) => item.accountId === accountId && item.folder === folder)
    const folderName = group?.folderName ?? folder
    if (view) set({ view: semLinhas(view, accountId, new Set(keys), 'move'), error: null })
    try {
      const result = await window.__scribeApi.emailDashboardApplyMove({ accountId, folder, messageKeys: [...keys] })
      set({ lastBatch: { batchId: result.batchId, moved: result.moved, folderName, accountId, at: Date.now() } })
    } catch {
      set({ error: PAINEL_ERRO_MOVER })
      void get().load()
    }
  },

  undoLast: async () => {
    const batch = get().lastBatch
    if (!batch) return
    // O Desfazer de sempre (`scribe:email-batch-undo`), com a frase do resultado na própria faixa.
    await useEmail.getState().undoFromBanner(batch.batchId, 'a Caixa de Entrada')
    await get().load()
  },

  subscribe: () => window.__scribeApi.onEmailDashboardChanged((view) => set({ view: semIgnorados(view) })),

  toggleExpanded: (key) =>
    set((state) => {
      const expanded = new Set(state.expanded)
      if (expanded.has(key)) expanded.delete(key)
      else expanded.add(key)
      return { expanded }
    }),

  setShowAllReplies: (showAllReplies) => set({ showAllReplies }),

  clearBatch: () => {
    const batch = get().lastBatch
    if (batch) useEmail.getState().dismissBanner(batch.batchId)
    set({ lastBatch: null })
  },
}))
