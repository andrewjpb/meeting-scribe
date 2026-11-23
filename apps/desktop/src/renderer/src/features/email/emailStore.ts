// Email no renderer (contrato 43): as contas com o estado, a Caixa de Entrada e os Enviados de cada uma (do cache do
// main), os corpos pedidos (para a leitura e para a prévia de uma linha da lista) e o rascunho do composer. Nada de
// senha chega aqui. O envio passa por `__scribeApi.emailSend`, que só funciona no clique da pessoa.
//
// As Caixas de Entrada de todas as contas são lidas ao abrir o app: a barra lateral mostra as não lidas de cada uma.
// Os corpos da prévia são pedidos só para as linhas que aparecem na tela, no máximo 3 ao mesmo tempo (no IMAP, o main
// baixa a mensagem sem marcá-la como lida).
//
// Contrato 55: a árvore de pastas de cada conta (`scribe:email-folders`), as listas de qualquer pasta (por path), o
// mover (otimista, com o esmaecimento das que saem e a volta se o servidor recusar), criar, renomear e apagar pasta, e o
// lote do Assistente que organiza (`scribe:email-organize`, contrato 56) para o painel "Organizando" e a faixa.
import { useEffect } from 'react'
import { create } from 'zustand'
import { EMAIL_INBOX_MAILBOX, isInbox, type EmailAccountStatus, type EmailBody, type EmailFolderError, type EmailFolderNode, type EmailMessage } from '@shared/email'
import type { EmailBatchUndoResult, EmailOrganizeEvent } from '@shared/email-organize'
import type { EmailRouteFolder } from '@shared/routes'
import { useSettings } from '../../app/settingsStore'
import type { ComposeDraft } from './format'
import { moveChunks, pushRecent } from './moveTargets'
import { BANNER_RESULT_MS, batchMeta, undoResultText, type BannerResult, type BatchMeta } from './organizeState'

/** `carregando`, o corpo, ou a falha (a leitura diz "não foi possível abrir"). */
export type BodyState = 'loading' | 'error' | EmailBody

/** A árvore de uma conta: a última lida na sessão (com a conta fora do ar, continua a de antes). */
export interface FolderTreeState {
  nodes: EmailFolderNode[]
  pop3: boolean
}

export type MoveOutcome = { ok: true; moved: number } | { ok: false; error: EmailFolderError; moved: number; total: number }
export type FolderPathOutcome = { ok: true; path: string } | { ok: false; error: EmailFolderError }
export type FolderDeleteOutcome = { ok: true } | { ok: false; error: EmailFolderError; contents?: { messages: number; folders: number } }

interface OrganizeState {
  running: EmailOrganizeEvent | null
  today: EmailOrganizeEvent[]
}

interface EmailState {
  accounts: EmailAccountStatus[] | null
  loadFailed: boolean
  /** Por `folderKey(conta, pasta)`, da mais nova para a mais antiga; ausente: ainda não leu. */
  folders: Record<string, EmailMessage[]>
  /** As mensagens saindo de cada lista (esmaecendo por `--duration-base` antes de sair de vez). */
  leaving: Record<string, string[]>
  /** A falha da última leitura de uma pasta (fora a INBOX e os Enviados). */
  folderErrors: Record<string, EmailFolderError>
  /** Por conta. */
  trees: Record<string, FolderTreeState>
  /** Por `bodyKey(conta, id)`. */
  bodies: Record<string, BodyState>
  /** O rascunho aberto (um por vez) e se o composer está à vista no lugar da leitura. */
  draft: ComposeDraft | null
  composing: boolean
  /** A lista aberta na tela (a que o `scribe:email-changed` relê do servidor). */
  viewing: string | null
  organize: OrganizeState
  /** O pedido, as horas e a pasta de cada lote, por `batchId`. */
  batches: Record<string, BatchMeta>
  /** Lotes que esta sessão viu rodando (o painel fica no resumo até o "Fechar"), fechados e faixas fechadas no ×. */
  organizeLive: string[]
  organizeClosed: string[]
  bannerDismissed: string[]
  load: () => Promise<void>
  /** A lista de uma pasta: a INBOX e os Enviados do cache; as outras, do servidor (`fresh`) ou do cache. */
  loadFolder: (accountId: string, folder: EmailRouteFolder, fresh?: boolean) => Promise<void>
  loadTree: (accountId: string) => Promise<void>
  /** Pede o corpo, se ainda não pediu (`again` tenta de novo o que falhou). Nunca espera. */
  requestBody: (accountId: string, id: string, again?: boolean) => void
  /** O corpo já lido ou pedido agora, esperando a resposta (Responder e Encaminhar citam a mensagem inteira). */
  loadBody: (accountId: string, id: string) => Promise<EmailBody | null>
  /** "Marcar como (não) lida": a lista muda na hora e volta se o servidor recusar. */
  markRead: (accountId: string, id: string, seen: boolean) => Promise<boolean>
  remove: (accountId: string, id: string) => Promise<boolean>
  receive: (message: EmailMessage) => void
  /** Mover (contrato 55, CA10): saem da lista na hora e voltam se o servidor recusar; em lotes de 500. */
  move: (accountId: string, from: EmailRouteFolder, ids: readonly string[], toPath: string) => Promise<MoveOutcome>
  createFolder: (accountId: string, parentPath: string | null, name: string) => Promise<FolderPathOutcome>
  renameFolder: (accountId: string, path: string, newName: string, delimiter: string | null) => Promise<FolderPathOutcome>
  /** Sem `force`, a pasta com conteúdo volta `invalid` com o que ela tem (a tela pede a confirmação). */
  deleteFolder: (accountId: string, path: string, delimiter: string | null, force?: boolean) => Promise<FolderDeleteOutcome>
  loadOrganize: () => Promise<void>
  applyOrganize: (event: EmailOrganizeEvent) => void
  undoBatch: (batchId: string) => Promise<EmailBatchUndoResult>
  closePanel: (batchId: string) => void
  dismissBanner: (batchId: string) => void
  /** O resultado do Desfazer pela faixa (fica 5 s; com falha, até o ×). */
  bannerResults: Record<string, BannerResult>
  undoFromBanner: (batchId: string, where: string) => Promise<void>
  openDraft: (draft: ComposeDraft) => void
  updateDraft: (patch: Partial<ComposeDraft>) => void
  /** O composer sai da frente; com `discard`, o rascunho some. */
  closeDraft: (discard: boolean) => void
  showDraft: () => void
}

/** A chave de uma lista: `<conta>:inbox`, `<conta>:sent` ou `<conta>:p:<path>` (a INBOX por path é a mesma da Caixa de Entrada). */
export const folderKey = (accountId: string, folder: EmailRouteFolder): string => {
  if (typeof folder === 'string') return `${accountId}:${folder}`
  return folder.path.toUpperCase() === EMAIL_INBOX_MAILBOX ? `${accountId}:inbox` : `${accountId}:p:${folder.path}`
}
export const bodyKey = (accountId: string, id: string): string => `${accountId}\n${id}`

/** A pasta de uma lista pela chave (o contrário de `folderKey`). */
function folderOfKey(key: string): { accountId: string; folder: EmailRouteFolder } | null {
  const at = key.indexOf(':')
  if (at === -1) return null
  const accountId = key.slice(0, at)
  const rest = key.slice(at + 1)
  if (rest === 'inbox' || rest === 'sent') return { accountId, folder: rest }
  return rest.startsWith('p:') ? { accountId, folder: { path: rest.slice(2) } } : null
}

/** A pasta (ou uma subpasta dela). */
const within = (path: string, parent: string, delimiter: string | null): boolean => path === parent || (delimiter !== null && path.startsWith(`${parent}${delimiter}`))

/** Corpos pedidos ao mesmo tempo e o teto do que fica guardado na memória da tela. */
const BODY_PARALLEL = 3
const BODIES_MAX = 400
const bodyQueue: { accountId: string; id: string }[] = []
let bodyRunning = 0

/** `--duration-base` de `tokens.css`: o esmaecimento de quem sai da lista. */
export const LEAVE_MS = 160

const byDate = (a: EmailMessage, b: EmailMessage): number => b.date - a.date || b.id.localeCompare(a.id)
const reducedMotion = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A pasta dos enviados guardados no app, da conta. */
const sentOf = (accountId: string, accounts: EmailAccountStatus[] | null): string | null => accounts?.find((status) => status.account.id === accountId)?.sentMailbox ?? null

export const useEmail = create<EmailState>()((set, get) => {
  /**
   * Troca a lista; as que saíram ficam esmaecendo por 160 ms antes de sair de vez (nenhum esmaecimento com
   * `prefers-reduced-motion`, nem numa lista que ainda não estava na tela).
   */
  const putList = (key: string, next: EmailMessage[]): void => {
    const before = get().folders[key]
    const ids = new Set(next.map((message) => message.id))
    const gone = (before ?? []).filter((message) => !ids.has(message.id))
    if (!gone.length || reducedMotion() || get().viewing !== key) {
      set((state) => ({ folders: { ...state.folders, [key]: next } }))
      return
    }
    set((state) => ({
      folders: { ...state.folders, [key]: [...next, ...gone].sort(byDate) },
      leaving: { ...state.leaving, [key]: [...new Set([...(state.leaving[key] ?? []), ...gone.map((message) => message.id)])] },
    }))
    setTimeout(() => {
      set((state) => {
        const leaving = new Set(state.leaving[key] ?? [])
        const list = state.folders[key]
        const rest = Object.fromEntries(Object.entries(state.leaving).filter(([other]) => other !== key))
        return list ? { folders: { ...state.folders, [key]: list.filter((message) => !leaving.has(message.id)) }, leaving: rest } : { leaving: rest }
      })
    }, LEAVE_MS)
  }

  /** As recentes das contas que existem e as da conta pedida. */
  const recentsOf = (accountId: string): { recents: Record<string, string[]>; list: string[] } => {
    const accounts = new Set((get().accounts ?? []).map((status) => status.account.id))
    const recents = Object.fromEntries(Object.entries(useSettings.getState().settings.emailRecentFolders).filter(([id]) => accounts.has(id)))
    return { recents, list: recents[accountId] ?? [] }
  }

  /** As recentes (CA6) e as subárvores recolhidas (CA2) acompanham o renomear e o apagar feitos pelo app. */
  const fixFolderSettings = (accountId: string, change: (path: string) => string | null): void => {
    const { recents, list } = recentsOf(accountId)
    const keep = (value: string | null): value is string => value !== null
    const nextList = [...new Set(list.map(change).filter(keep))]
    const prefix = `${accountId}\n`
    const collapsed = useSettings.getState().settings.emailFoldersCollapsed.map((entry) => {
      if (!entry.startsWith(prefix)) return entry
      const value = change(entry.slice(prefix.length))
      return value === null ? null : `${prefix}${value}`
    })
    void useSettings.getState().update({ emailRecentFolders: { ...recents, [accountId]: nextList }, emailFoldersCollapsed: [...new Set(collapsed.filter(keep))] })
  }

  const fetchMeta = (batchId: string): void => {
    void window.__scribeApi.invoke('scribe:email-batch-get', { batchId }).then(
      (result) => {
        if (result?.ok) set((state) => ({ batches: { ...state.batches, [batchId]: batchMeta(result.batch) } }))
      },
      () => undefined,
    )
  }

  const failed = <T extends { ok: false; error: EmailFolderError }>(): T => ({ ok: false, error: 'unavailable' }) as T

  return {
    accounts: null,
    loadFailed: false,
    folders: {},
    leaving: {},
    folderErrors: {},
    trees: {},
    bodies: {},
    draft: null,
    composing: false,
    viewing: null,
    organize: { running: null, today: [] },
    batches: {},
    organizeLive: [],
    organizeClosed: [],
    bannerDismissed: [],
    bannerResults: {},

    load: async () => {
      try {
        const accounts = await window.__scribeApi.invoke('scribe:email-accounts')
        set({ accounts, loadFailed: false })
        await Promise.all(accounts.map((status) => get().loadFolder(status.account.id, 'inbox')))
        for (const status of accounts) void get().loadTree(status.account.id)
        void get().loadOrganize()
      } catch {
        set({ loadFailed: true })
      }
    },

    loadFolder: async (accountId, folder, fresh = true) => {
      const key = folderKey(accountId, folder)
      try {
        if (typeof folder === 'string' || key === folderKey(accountId, 'inbox')) {
          const messages = await window.__scribeApi.invoke('scribe:email-messages', { accountId, folder: typeof folder === 'string' ? folder : 'inbox' })
          putList(key, [...messages].sort(byDate))
          return
        }
        if (!fresh) {
          const messages = await window.__scribeApi.invoke('scribe:email-messages', { accountId, mailbox: folder.path })
          putList(key, [...messages].sort(byDate))
          return
        }
        const result = await window.__scribeApi.invoke('scribe:email-open-folder', { accountId, path: folder.path })
        if (result.ok) {
          set((state) => ({ folderErrors: Object.fromEntries(Object.entries(state.folderErrors).filter(([other]) => other !== key)) }))
          putList(key, [...result.messages].sort(byDate))
          return
        }
        set((state) => ({ folderErrors: { ...state.folderErrors, [key]: result.error } }))
        // Sem conexão: o que o app guardou da pasta, se guardou.
        if (get().folders[key] === undefined) {
          const cached = await window.__scribeApi.invoke('scribe:email-messages', { accountId, mailbox: folder.path }).catch(() => [])
          set((state) => ({ folders: { ...state.folders, [key]: [...cached].sort(byDate) } }))
        }
      } catch {
        // Bloqueado ou a conta saiu: a lista fica como estava.
      }
    },

    loadTree: async (accountId) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:email-folders', { accountId })
        // Conta fora do ar: fica a última árvore conhecida da sessão.
        if (result?.ok) set((state) => ({ trees: { ...state.trees, [accountId]: { nodes: result.folders, pop3: result.pop3 } } }))
      } catch {
        // Bloqueado: a árvore fica como estava.
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
          for (const [key, list] of Object.entries(folders)) {
            if (key.startsWith(`${accountId}:`)) folders[key] = list.map((message) => (message.id === id ? { ...message, seen: value } : message))
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
        // Contrato 55 (53 CA5): a que uma regra levou a outra pasta entra na lista dela, se a lista já foi lida.
        const key = isInbox(message) ? folderKey(message.accountId, 'inbox') : message.mailbox === sentOf(message.accountId, state.accounts) ? null : folderKey(message.accountId, { path: message.mailbox })
        const list = key ? state.folders[key] : undefined
        if (!key || !list) return {}
        return { folders: { ...state.folders, [key]: [message, ...list.filter((item) => item.id !== message.id)].sort(byDate) } }
      }),

    move: async (accountId, from, ids, toPath) => {
      const key = folderKey(accountId, from)
      const list = get().folders[key] ?? []
      const fromPath = from === 'inbox' ? EMAIL_INBOX_MAILBOX : from === 'sent' ? (sentOf(accountId, get().accounts) ?? '') : from.path
      const wanted = new Set(ids)
      const picked = list.filter((message) => wanted.has(message.id) && message.uid !== null)
      if (!picked.length) return { ok: false, error: 'invalid', moved: 0, total: 0 }
      const byUid = new Map(picked.map((message) => [message.uid as number, message]))
      // Na hora: saem da lista (esmaecendo).
      const pickedIds = new Set(picked.map((message) => message.id))
      putList(key, list.filter((message) => !pickedIds.has(message.id)))
      let moved = 0
      const chunks = moveChunks(picked.map((message) => message.uid as number))
      for (const [index, chunk] of chunks.entries()) {
        const result = await window.__scribeApi.invoke('scribe:email-move', { accountId, fromPath, uids: chunk, toPath }).catch(() => failed<{ ok: false; error: EmailFolderError }>())
        if (!result.ok) {
          // O servidor recusou: as deste lote e as dos seguintes voltam.
          const back = chunks
            .slice(index)
            .flat()
            .flatMap((uid) => {
              const message = byUid.get(uid)
              return message ? [message] : []
            })
          const backIds = new Set(back.map((message) => message.id))
          set((state) => {
            const current = (state.folders[key] ?? []).filter((message) => !backIds.has(message.id))
            return {
              folders: { ...state.folders, [key]: [...current, ...back].sort(byDate) },
              leaving: { ...state.leaving, [key]: (state.leaving[key] ?? []).filter((id) => !backIds.has(id)) },
            }
          })
          if (moved > 0) void get().loadTree(accountId)
          return { ok: false, error: result.error, moved, total: picked.length }
        }
        moved += chunk.length
      }
      const { recents, list: recent } = recentsOf(accountId)
      void useSettings.getState().update({ emailRecentFolders: { ...recents, [accountId]: pushRecent(recent, toPath) } })
      void get().loadTree(accountId)
      return { ok: true, moved }
    },

    createFolder: async (accountId, parentPath, name) => {
      const result = await window.__scribeApi.invoke('scribe:email-folder-create', { accountId, parentPath, name }).catch(() => failed<{ ok: false; error: EmailFolderError }>())
      if (!result.ok) return { ok: false, error: result.error }
      await get().loadTree(accountId)
      return { ok: true, path: result.path }
    },

    renameFolder: async (accountId, path, newName, delimiter) => {
      const result = await window.__scribeApi.invoke('scribe:email-folder-rename', { accountId, path, newName }).catch(() => failed<{ ok: false; error: EmailFolderError }>())
      if (!result.ok) return { ok: false, error: result.error }
      fixFolderSettings(accountId, (item) => (within(item, path, delimiter) ? `${result.path}${item.slice(path.length)}` : item))
      // As listas guardadas da pasta antiga (e das subpastas) não valem mais: o path mudou.
      const prefix = `${accountId}:p:`
      set((state) => ({ folders: Object.fromEntries(Object.entries(state.folders).filter(([key]) => !key.startsWith(prefix) || !within(key.slice(prefix.length), path, delimiter))) }))
      await get().loadTree(accountId)
      return { ok: true, path: result.path }
    },

    deleteFolder: async (accountId, path, delimiter, force = false) => {
      const result = await window.__scribeApi.invoke('scribe:email-folder-delete', { accountId, path, ...(force ? { force: true } : {}) }).catch(() => failed<{ ok: false; error: EmailFolderError }>())
      if (!result.ok) return { ok: false, error: result.error, ...('contents' in result && result.contents ? { contents: result.contents } : {}) }
      fixFolderSettings(accountId, (item) => (within(item, path, delimiter) ? null : item))
      await get().loadTree(accountId)
      return { ok: true }
    },

    loadOrganize: async () => {
      try {
        const result = await window.__scribeApi.invoke('scribe:email-organize-state')
        if (!result?.ok) return
        const running = result.running
        set((state) => ({ organize: { running, today: result.today }, organizeLive: running && !state.organizeLive.includes(running.batchId) ? [...state.organizeLive, running.batchId] : state.organizeLive }))
        for (const event of [...(running ? [running] : []), ...result.today]) if (!get().batches[event.batchId]) fetchMeta(event.batchId)
      } catch {
        // Bloqueado: o painel fica como estava e se refaz ao desbloquear.
      }
    },

    applyOrganize: (event) => {
      const { organize } = get()
      const before = [...(organize.running ? [organize.running] : []), ...organize.today].find((item) => item.batchId === event.batchId)
      set((state) => {
        const today = [...state.organize.today.filter((item) => item.batchId !== event.batchId), ...(event.state === 'running' ? [] : [event])]
        const running = event.state === 'running' ? event : state.organize.running?.batchId === event.batchId ? null : state.organize.running
        const live = event.state === 'running' && !state.organizeLive.includes(event.batchId) ? [...state.organizeLive, event.batchId] : state.organizeLive
        return { organize: { running, today }, organizeLive: live }
      })
      const meta = get().batches[event.batchId]
      // Uma vez por lote; de novo quando ele para (a hora do fim) e quando o primeiro mover diz a pasta organizada.
      if (!meta || (before?.state === 'running' && event.state !== 'running') || (meta.fromPath === null && event.moved > 0 && (before?.moved ?? 0) === 0)) fetchMeta(event.batchId)
    },

    undoBatch: async (batchId) => {
      const result = await window.__scribeApi.invoke('scribe:email-batch-undo', { batchId }).catch((): EmailBatchUndoResult => ({ ok: false, error: 'unavailable' }))
      void get().loadOrganize()
      return result
    },

    closePanel: (batchId) => set((state) => ({ organizeClosed: [...new Set([...state.organizeClosed, batchId])] })),
    dismissBanner: (batchId) =>
      set((state) => ({ bannerDismissed: [...new Set([...state.bannerDismissed, batchId])], bannerResults: Object.fromEntries(Object.entries(state.bannerResults).filter(([id]) => id !== batchId)) })),

    undoFromBanner: async (batchId, where) => {
      const result = undoResultText(await get().undoBatch(batchId), where)
      set((state) => ({ bannerResults: { ...state.bannerResults, [batchId]: result } }))
      if (!result.failed) setTimeout(() => get().dismissBanner(batchId), BANNER_RESULT_MS)
    },

    openDraft: (draft) => set({ draft, composing: true }),
    updateDraft: (patch) => set((state) => (state.draft ? { draft: { ...state.draft, ...patch } } : {})),
    closeDraft: (discard) => set((state) => ({ composing: false, draft: discard ? null : state.draft })),
    showDraft: () => set((state) => ({ composing: state.draft !== null })),
  }
})

/**
 * Contrato 157 (R16): a mensagem que o Painel pediu para responder, na lista guardada da pasta (ou, fora dela, no cache
 * do main por `scribe:email-messages`); `null` se ela saiu de lá.
 */
export async function findReplyTarget(accountId: string, replyTo: { messageKey: string; mailbox: string }): Promise<EmailMessage | null> {
  const folder: EmailRouteFolder = replyTo.mailbox.toUpperCase() === EMAIL_INBOX_MAILBOX ? 'inbox' : { path: replyTo.mailbox }
  const find = (list: readonly EmailMessage[] | undefined): EmailMessage | null => list?.find((message) => message.id === replyTo.messageKey) ?? null
  const listed = find(useEmail.getState().folders[folderKey(accountId, folder)])
  if (listed) return listed
  return find(await window.__scribeApi.invoke('scribe:email-messages', folder === 'inbox' ? { accountId, folder: 'inbox' } : { accountId, mailbox: replyTo.mailbox }).catch((): EmailMessage[] => []))
}

/**
 * Relê as listas de uma conta depois de uma mudança. A aberta (fora a INBOX) vem do que o main guardou da pasta, sem ir
 * ao servidor: o mover e o lote do Assistente já atualizam esse cache, e quem relê do servidor é o watch de 5 min do
 * contrato 52 (ou abrir a pasta de novo). As outras guardadas saem (são relidas ao abrir).
 */
function refreshAccount(accountId: string): void {
  const state = useEmail.getState()
  void state.loadFolder(accountId, 'inbox')
  if (state.folders[folderKey(accountId, 'sent')]) void state.loadFolder(accountId, 'sent')
  const stale: string[] = []
  for (const key of Object.keys(state.folders)) {
    const found = folderOfKey(key)
    if (!found || found.accountId !== accountId || typeof found.folder === 'string') continue
    if (state.viewing === key) void state.loadFolder(accountId, found.folder, false)
    else stale.push(key)
  }
  if (stale.length) useEmail.setState((current) => ({ folders: Object.fromEntries(Object.entries(current.folders).filter(([key]) => !stale.includes(key))) }))
  void state.loadTree(accountId)
}

/** O main avisa o estado das contas, cada email novo e cada lista que mudou; nada chega com o app bloqueado. */
export function watchEmail(): () => void {
  const offState = window.__scribeApi.on('scribe:email-state', (accounts) => {
    const before = new Set((useEmail.getState().accounts ?? []).map((status) => status.account.id))
    useEmail.setState((state) => {
      // Conta removida: as listas, as árvores, os corpos e o rascunho dela saem.
      const ids = new Set(accounts.map((status) => status.account.id))
      const keep = (key: string): boolean => ids.has(key.split(/[:\n]/)[0] ?? '')
      return {
        accounts,
        folders: Object.fromEntries(Object.entries(state.folders).filter(([key]) => keep(key))),
        trees: Object.fromEntries(Object.entries(state.trees).filter(([key]) => ids.has(key))),
        bodies: Object.fromEntries(Object.entries(state.bodies).filter(([key]) => keep(key))),
        ...(state.draft && !ids.has(state.draft.accountId) ? { draft: null, composing: false } : {}),
      }
    })
    // A lista vem também ao desbloquear (o que chegou bloqueado não veio por `email-message`): relê as pastas do cache.
    for (const status of accounts) {
      const state = useEmail.getState()
      void state.loadFolder(status.account.id, 'inbox')
      if (before.has(status.account.id) && state.folders[folderKey(status.account.id, 'sent')]) void state.loadFolder(status.account.id, 'sent')
      // Conectou (ou reconectou): a árvore com as contagens.
      void state.loadTree(status.account.id)
    }
    void useEmail.getState().loadOrganize()
  })
  const offMessage = window.__scribeApi.on('scribe:email-message', (message) => useEmail.getState().receive(message))
  const offChanged = window.__scribeApi.on('scribe:email-changed', ({ accountId }) => refreshAccount(accountId))
  const offOrganize = window.__scribeApi.on('scribe:email-organize', (event) => useEmail.getState().applyOrganize(event))
  return () => {
    offState()
    offMessage()
    offChanged()
    offOrganize()
  }
}

/** Estado do email para a barra lateral e a tela: lido ao montar e acompanhado pelos avisos do main. */
export function useEmailSync(): void {
  useEffect(() => {
    void useEmail.getState().load()
    return watchEmail()
  }, [])
}
