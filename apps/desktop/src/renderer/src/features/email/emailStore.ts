// Email no renderer (contrato 43): as contas com o estado, a Caixa de Entrada e os Enviados de cada uma (do cache do
// main), os corpos pedidos (para a leitura e para a prévia de uma linha da lista) e o rascunho do composer. Nada de
// senha chega aqui. O envio passa por `__scribeApi.emailSend`, que só funciona no clique da pessoa.
//
// As Caixas de Entrada de todas as contas são lidas ao abrir o app: a barra lateral mostra as não lidas de cada uma.
// Os corpos da prévia são pedidos só para as linhas que aparecem na tela, no máximo 3 ao mesmo tempo (no IMAP, o main
// baixa a mensagem sem marcá-la como lida).
import { useEffect } from 'react'
import { create } from 'zustand'
import { isInbox, type EmailAccountStatus, type EmailBody, type EmailFolder, type EmailMessage } from '@shared/email'
import type { ComposeDraft } from './format'

/** `carregando`, o corpo, ou a falha (a leitura diz "não foi possível abrir"). */
export type BodyState = 'loading' | 'error' | EmailBody

interface EmailState {
  accounts: EmailAccountStatus[] | null
  loadFailed: boolean
  /** Por `pastaKey(conta, pasta)`, da mais nova para a mais antiga; ausente: ainda não leu. */
  folders: Record<string, EmailMessage[]>
  /** Por `bodyKey(conta, id)`. */
  bodies: Record<string, BodyState>
  /** O rascunho aberto (um por vez) e se o composer está à vista no lugar da leitura. */
  draft: ComposeDraft | null
  composing: boolean
  load: () => Promise<void>
  loadFolder: (accountId: string, folder: EmailFolder) => Promise<void>
  /** Pede o corpo, se ainda não pediu (`again` tenta de novo o que falhou). Nunca espera. */
  requestBody: (accountId: string, id: string, again?: boolean) => void
  /** O corpo já lido ou pedido agora, esperando a resposta (Responder e Encaminhar citam a mensagem inteira). */
  loadBody: (accountId: string, id: string) => Promise<EmailBody | null>
  /** "Marcar como (não) lida": a lista muda na hora e volta se o servidor recusar. */
  markRead: (accountId: string, id: string, seen: boolean) => Promise<boolean>
  remove: (accountId: string, id: string) => Promise<boolean>
  receive: (message: EmailMessage) => void
  openDraft: (draft: ComposeDraft) => void
  updateDraft: (patch: Partial<ComposeDraft>) => void
  /** O composer sai da frente; com `discard`, o rascunho some. */
  closeDraft: (discard: boolean) => void
  showDraft: () => void
}

export const folderKey = (accountId: string, folder: EmailFolder): string => `${accountId}:${folder}`
export const bodyKey = (accountId: string, id: string): string => `${accountId}\n${id}`

/** Corpos pedidos ao mesmo tempo e o teto do que fica guardado na memória da tela. */
const BODY_PARALLEL = 3
const BODIES_MAX = 400
const bodyQueue: { accountId: string; id: string }[] = []
let bodyRunning = 0

const byDate = (a: EmailMessage, b: EmailMessage): number => b.date - a.date || b.id.localeCompare(a.id)

export const useEmail = create<EmailState>()((set, get) => ({
  accounts: null,
  loadFailed: false,
  folders: {},
  bodies: {},
  draft: null,
  composing: false,

  load: async () => {
    try {
      const accounts = await window.__scribeApi.invoke('scribe:email-accounts')
      set({ accounts, loadFailed: false })
      await Promise.all(accounts.map((status) => get().loadFolder(status.account.id, 'inbox')))
    } catch {
      set({ loadFailed: true })
    }
  },

  loadFolder: async (accountId, folder) => {
    try {
      const messages = await window.__scribeApi.invoke('scribe:email-messages', { accountId, folder })
      set((state) => ({ folders: { ...state.folders, [folderKey(accountId, folder)]: [...messages].sort(byDate) } }))
    } catch {
      // Bloqueado ou a conta saiu: a lista fica como estava.
    }
  },

  requestBody: (accountId, id, again = false) => {
    const key = bodyKey(accountId, id)
    const known = get().bodies[key]
    if (known !== undefined && !(again && known === 'error')) return
    set((state) => ({ bodies: { ...state.bodies, [key]: 'loading' } }))
    bodyQueue.push({ accountId, id })
    const next = (): void => {
      while (bodyRunning < BODY_PARALLEL && bodyQueue.length) {
        const item = bodyQueue.shift() as { accountId: string; id: string }
        bodyRunning++
        void window.__scribeApi
          .invoke('scribe:email-get-body', item)
          .then(
            (result) => (result.ok ? result.body : 'error'),
            (): BodyState => 'error',
          )
          .then((body) =>
            set((state) => {
              // Passou do teto: os mais antigos saem (voltam a ser pedidos se aparecerem de novo).
              const entries = Object.entries({ ...state.bodies, [bodyKey(item.accountId, item.id)]: body })
              return { bodies: Object.fromEntries(entries.slice(Math.max(0, entries.length - BODIES_MAX))) }
            }),
          )
          .finally(() => {
            bodyRunning--
            next()
          })
      }
    }
    next()
  },

  loadBody: async (accountId, id) => {
    const key = bodyKey(accountId, id)
    const known = get().bodies[key]
    if (known && known !== 'loading' && known !== 'error') return known
    try {
      const result = await window.__scribeApi.invoke('scribe:email-get-body', { accountId, id })
      if (!result.ok) return null
      set((state) => ({ bodies: { ...state.bodies, [key]: result.body } }))
      return result.body
    } catch {
      return null
    }
  },

  markRead: async (accountId, id, seen) => {
    const flip = (value: boolean): void =>
      set((state) => {
        const folders = { ...state.folders }
        for (const folder of ['inbox', 'sent'] as const) {
          const key = folderKey(accountId, folder)
          const list = folders[key]
          if (list) folders[key] = list.map((message) => (message.id === id ? { ...message, seen: value } : message))
        }
        return { folders }
      })
    flip(seen)
    const ok = await window.__scribeApi.invoke('scribe:email-mark-read', { accountId, id, seen }).catch(() => false)
    if (!ok) flip(!seen)
    return ok
  },

  remove: async (accountId, id) => {
    const ok = await window.__scribeApi.invoke('scribe:email-delete', { accountId, id }).catch(() => false)
    if (ok)
      set((state) => {
        const folders = { ...state.folders }
        for (const folder of ['inbox', 'sent'] as const) {
          const key = folderKey(accountId, folder)
          const list = folders[key]
          if (list) folders[key] = list.filter((message) => message.id !== id)
        }
        return { folders }
      })
    return ok
  },

  receive: (message) =>
    set((state) => {
      // Contrato 53: a que uma regra levou a outra pasta (Arquivo, Lixeira) não é da Caixa de Entrada nem dos Enviados.
      if (!isInbox(message)) return {}
      const key = folderKey(message.accountId, 'inbox')
      const list = state.folders[key]
      if (!list) return {}
      return { folders: { ...state.folders, [key]: [message, ...list.filter((item) => item.id !== message.id)].sort(byDate) } }
    }),

  openDraft: (draft) => set({ draft, composing: true }),
  updateDraft: (patch) => set((state) => (state.draft ? { draft: { ...state.draft, ...patch } } : {})),
  closeDraft: (discard) => set((state) => ({ composing: false, draft: discard ? null : state.draft })),
  showDraft: () => set((state) => ({ composing: state.draft !== null })),
}))

/** O main avisa o estado das contas, cada email novo e cada lista que mudou; nada chega com o app bloqueado. */
export function watchEmail(): () => void {
  const offState = window.__scribeApi.on('scribe:email-state', (accounts) => {
    const before = new Set((useEmail.getState().accounts ?? []).map((status) => status.account.id))
    useEmail.setState((state) => {
      // Conta removida: as listas, os corpos e o rascunho dela saem.
      const ids = new Set(accounts.map((status) => status.account.id))
      const keep = (key: string): boolean => ids.has(key.split(/[:\n]/)[0] ?? '')
      return {
        accounts,
        folders: Object.fromEntries(Object.entries(state.folders).filter(([key]) => keep(key))),
        bodies: Object.fromEntries(Object.entries(state.bodies).filter(([key]) => keep(key))),
        ...(state.draft && !ids.has(state.draft.accountId) ? { draft: null, composing: false } : {}),
      }
    })
    // A lista vem também ao desbloquear (o que chegou bloqueado não veio por `email-message`): relê as pastas do cache.
    for (const status of accounts) {
      const state = useEmail.getState()
      void state.loadFolder(status.account.id, 'inbox')
      if (before.has(status.account.id) && state.folders[folderKey(status.account.id, 'sent')]) void state.loadFolder(status.account.id, 'sent')
    }
  })
  const offMessage = window.__scribeApi.on('scribe:email-message', (message) => useEmail.getState().receive(message))
  const offChanged = window.__scribeApi.on('scribe:email-changed', ({ accountId }) => {
    const state = useEmail.getState()
    void state.loadFolder(accountId, 'inbox')
    if (state.folders[folderKey(accountId, 'sent')]) void state.loadFolder(accountId, 'sent')
  })
  return () => {
    offState()
    offMessage()
    offChanged()
  }
}

/** Estado do email para a barra lateral e a tela: lido ao montar e acompanhado pelos avisos do main. */
export function useEmailSync(): void {
  useEffect(() => {
    void useEmail.getState().load()
    return watchEmail()
  }, [])
}
