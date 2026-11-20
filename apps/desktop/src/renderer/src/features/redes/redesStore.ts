// Redes no renderer (contrato 69): as contas do Instagram e o armazenamento de mídia, como o main manda (`RedesState`).
// O token colado e a chave secreta digitada só passam por aqui a caminho do main, no pedido; nunca ficam no estado.
// Contrato 72: a fila de publicações e a cota de cada conta (pelo evento `scribe:redes-publications`), o editor aberto,
// as contas recolhidas no nível Redes e os não lidos (zerados aqui; os contratos 73 e 74 preenchem).
import { useEffect } from 'react'
import { create } from 'zustand'
import type {
  MediaCandidate,
  MediaHostConfig,
  MediaHostSaveResult,
  MediaHostStatus,
  Publication,
  PublicationActionResult,
  PublicationQuota,
  PublicationSaveInput,
  PublicationSaveResult,
  RedesConnectResult,
  RedesPublicationsPayload,
  RedesState,
} from '@shared/redes'
// 73: comentários
import type { RedesCommentActionResult, RedesCommentReplyResult, RedesCommentsPayload } from '@shared/redes'
// fim 73
// 75: métricas
import type { MetricPeriod, RedesMetricsState } from '@shared/redes'
// fim 75
// 74: mensagens
import type { RedesMessageSendResult, RedesMessagesPayload } from '@shared/redes'
// fim 74

const FAILED = 'Não foi possível falar com o app. Tente de novo.'

/** Os não lidos de uma conta no nível Redes (contrato 72: zerados; 73 e 74 preenchem comentários e mensagens). */
export interface RedesUnread {
  comments: number
  messages: number
}

/** O editor aberto na tela: uma publicação da fila ou uma nova (`novo`). */
export interface RedesEditorTarget {
  accountId: string
  id: string | 'novo'
  /** Um erro para o editor mostrar ao reabrir (a publicação foi salva, mas o "Agendar" ou o "Publicar agora" não passou). */
  notice?: string
}

/** Cada abertura do editor tem a sua revisão: reabrir a mesma publicação (depois de salvar) remonta o painel. */
export type RedesEditorOpen = RedesEditorTarget & { revision: number }

/** A cota de uma conta: a lida, a consulta em curso ou indisponível agora (sem entrada: ainda não pedida). */
export type RedesQuotaView = PublicationQuota | 'consultando' | 'indisponivel'

interface RedesStoreState {
  state: RedesState | null
  loadFailed: boolean
  /** O que está em andamento (um por vez na tela): conectar, renovar ou remover uma conta, salvar ou testar o armazenamento. */
  busy: { kind: 'connect' } | { kind: 'refresh' | 'remove'; accountId: string } | { kind: 'media-save' | 'media-test' | 'media-clear' } | null
  load: () => Promise<void>
  connect: (token: string) => Promise<RedesConnectResult>
  refresh: (accountId: string) => Promise<RedesConnectResult>
  remove: (accountId: string) => Promise<boolean>
  /** Recusado com a razão (`ok: false`), ou `null` se o pedido nem chegou ao main. */
  saveMediaHost: (config: MediaHostConfig, secretAccessKey: string | null) => Promise<MediaHostSaveResult | null>
  testMediaHost: () => Promise<MediaHostStatus | null>
  clearMediaHost: () => Promise<MediaHostStatus | null>

  // Contrato 72: a tela Redes.
  publications: Record<string, Publication[]>
  quota: Record<string, RedesQuotaView>
  unread: Record<string, RedesUnread>
  editor: RedesEditorOpen | null
  /** As contas recolhidas no nível Redes, nesta sessão (com uma conta só, nada recolhe). */
  collapsed: string[]
  /** As miniaturas por caminho (`null`: o main disse que não há, como o vídeo; sem a chave: ainda não chegou). */
  thumbs: Record<string, string | null>
  /** Um aviso da tela para a conta (o editor que saiu com mudança e foi salvo como rascunho, ou não pôde ser). */
  notice: { accountId: string; text: string } | null
  setNotice: (notice: { accountId: string; text: string } | null) => void
  loadPublications: (accountId: string) => Promise<void>
  loadQuota: (accountId: string) => Promise<void>
  openEditor: (target: RedesEditorTarget | null) => void
  toggleCollapsed: (accountId: string) => void
  thumbnail: (path: string) => void
  pickMedia: () => Promise<MediaCandidate[] | null>
  savePublication: (input: PublicationSaveInput) => Promise<PublicationSaveResult>
  deletePublication: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  unschedule: (id: string) => Promise<PublicationActionResult>
  retry: (id: string) => Promise<PublicationActionResult>
  /** "Publicar agora" e "Agendar": pelo preload, com o clique da pessoa (token de clique). */
  publish: (id: string | null, save?: PublicationSaveInput) => Promise<PublicationActionResult>
  schedule: (id: string | null, at: string, save?: PublicationSaveInput) => Promise<PublicationActionResult>
  // 73: comentários
  /** Contrato 73: os comentários de cada conta, agrupados por mídia, como o main mandou por último. */
  comments: Record<string, RedesCommentsPayload>
  /** A leitura em curso de cada conta (o "Atualizar" desabilita). */
  commentsLoading: Record<string, boolean>
  /** O que está guardado no main (sem ler o Instagram): o número do nível ao abrir o app. */
  loadComments: (accountId: string) => Promise<void>
  /** Abrir a seção e o "Atualizar": lê as mídias e os comentários agora. */
  refreshComments: (accountId: string) => Promise<void>
  /** Abrir uma mídia: os comentários dela ficam lidos (na tela na hora; o main confirma). */
  markCommentsRead: (accountId: string, mediaId: string) => Promise<void>
  /** Os comentários que eram novos quando a mídia foi aberta (o selo "novo" fica neles enquanto ela está aberta). */
  commentsFresh: Record<string, string[]>
  clearCommentsFresh: () => void
  replyComment: (accountId: string, commentId: string, message: string) => Promise<RedesCommentReplyResult>
  hideComment: (accountId: string, commentId: string, hide: boolean) => Promise<RedesCommentActionResult>
  deleteComment: (accountId: string, commentId: string) => Promise<RedesCommentActionResult>
  // fim 73
  // 74: mensagens
  /** Contrato 74: as conversas e mensagens de cada conta, como o main mandou por último. */
  messages: Record<string, RedesMessagesPayload>
  /** A leitura em curso de cada conta (o "Atualizar" desabilita). */
  messagesLoading: Record<string, boolean>
  /** O que está guardado no main (sem ler o Instagram): o número do nível ao abrir o app. */
  loadMessages: (accountId: string) => Promise<void>
  /** "Atualizar" e a abertura da seção: lê as conversas agora. */
  refreshMessages: (accountId: string) => Promise<void>
  /** A conversa aberta pela pessoa deixa de ser não lida. */
  markConversationRead: (accountId: string, conversationId: string) => Promise<void>
  /** "Enviar": pelo preload, com o clique da pessoa (token de clique). */
  sendMessage: (accountId: string, conversationId: string, text: string) => Promise<RedesMessageSendResult>
  // fim 74
  // 75: métricas
  /** Contrato 75: as métricas de cada conta (os três períodos e as mídias), como o main mandou por último. */
  metrics: Record<string, RedesMetricsState>
  /** O período escolhido em cada conta, nesta sessão (28 dias até escolher outro). */
  metricsPeriod: Record<string, MetricPeriod>
  /** A leitura em curso de cada conta (o "Atualizar" desabilita). */
  metricsLoading: Record<string, boolean>
  /** Abrir a seção ou trocar o período: o cache do main (1 h) ou a Meta; `force` é o "Atualizar". */
  loadMetrics: (accountId: string, period: MetricPeriod, force?: boolean) => Promise<void>
  setMetricsPeriod: (accountId: string, period: MetricPeriod) => void
  // fim 75
}

const failedAction: PublicationActionResult = { ok: false, error: FAILED }

/** Contrato 72: miniatura pedida e ainda sem resposta, e as falhas de cada caminho (até 3 tentativas). */
const THUMB_TRIES = 3
const thumbPending = new Set<string>()
const thumbFailures = new Map<string, number>()

export const useRedes = create<RedesStoreState>()((set, get) => {
  const withMediaHost = (mediaHost: MediaHostStatus): void => {
    const current = get().state
    if (current) set({ state: { ...current, mediaHost } })
  }
  const mediaCall = async (kind: 'media-test' | 'media-clear', call: () => Promise<MediaHostStatus>): Promise<MediaHostStatus | null> => {
    if (get().busy) return null
    set({ busy: { kind } })
    try {
      const status = await call()
      withMediaHost(status)
      return status
    } catch {
      return null
    } finally {
      set({ busy: null })
    }
  }

  // 74: mensagens
  /** O estado de mensagens de uma conta e o número de não lidas dela no nível Redes. */
  const withMessages = (payload: RedesMessagesPayload): void => {
    if (!payload.accountId) return
    set((current) => ({
      messages: { ...current.messages, [payload.accountId]: payload },
      unread: { ...current.unread, [payload.accountId]: { comments: current.unread[payload.accountId]?.comments ?? 0, messages: payload.unread } },
    }))
  }
  // fim 74
  // 73: comentários
  /** Os comentários de uma conta e o número de não lidos dela no nível Redes. */
  const withComments = (payload: RedesCommentsPayload): void => {
    if (!payload.accountId) return
    set((current) => ({
      comments: { ...current.comments, [payload.accountId]: payload },
      unread: { ...current.unread, [payload.accountId]: { comments: payload.unread, messages: current.unread[payload.accountId]?.messages ?? 0 } },
    }))
  }
  /** Uma ação de comentário: o estado novo volta junto com o resultado (e chega também pelo evento). */
  const commentAction = async <T extends RedesCommentActionResult | RedesCommentReplyResult>(call: () => Promise<T>): Promise<T | { ok: false; error: string }> => {
    try {
      const result = await call()
      if (result.ok) withComments(result.payload)
      return result
    } catch {
      return { ok: false, error: FAILED }
    }
  }
  // fim 73
  const withPublications = (payload: RedesPublicationsPayload): void => {
    if (!payload.accountId) return
    set((current) => ({
      publications: { ...current.publications, [payload.accountId]: payload.publications },
      ...(payload.quota ? { quota: { ...current.quota, [payload.accountId]: payload.quota } } : {}),
    }))
  }
  /** Uma ação da fila: o resultado volta à tela e a fila chega pelo evento (aqui também, para não esperar por ele). */
  const action = async (call: () => Promise<PublicationActionResult>): Promise<PublicationActionResult> => {
    try {
      const result = await call()
      // Contrato 72: a edição salva junto do "Publicar agora"/"Agendar" que não passou também entra na fila.
      const publication = result.ok ? result.publication : result.saved
      if (publication) {
        set((current) => {
          const list = current.publications[publication.accountId] ?? []
          const next = list.some((item) => item.id === publication.id) ? list.map((item) => (item.id === publication.id ? publication : item)) : [...list, publication]
          return { publications: { ...current.publications, [publication.accountId]: next } }
        })
      }
      return result
    } catch {
      return failedAction
    }
  }

  return {
    state: null,
    loadFailed: false,
    busy: null,
    publications: {},
    quota: {},
    unread: {},
    editor: null,
    collapsed: [],
    thumbs: {},
    notice: null,
    // 73: comentários
    comments: {},
    commentsLoading: {},
    loadComments: async (accountId) => {
      try {
        withComments(await window.__scribeApi.invoke('scribe:redes-comments', { accountId }))
      } catch {
        // Os comentários chegam pelo evento quando o main responder de novo.
      }
    },
    refreshComments: async (accountId) => {
      set((current) => ({ commentsLoading: { ...current.commentsLoading, [accountId]: true } }))
      try {
        withComments(await window.__scribeApi.invoke('scribe:redes-comments-refresh', { accountId }))
      } catch {
        set((current) => {
          const last = current.comments[accountId]
          return { comments: { ...current.comments, [accountId]: { ...(last ?? { accountId, media: [], unread: 0, updatedAt: null }), error: FAILED } } }
        })
      } finally {
        set((current) => ({ commentsLoading: { ...current.commentsLoading, [accountId]: false } }))
      }
    },
    markCommentsRead: async (accountId, mediaId) => {
      const last = get().comments[accountId]
      const target = last?.media.find((item) => item.mediaId === mediaId)
      if (!last || !target || target.unread === 0) return
      // Na tela na hora (o número do nível também); o main confirma com o estado inteiro.
      const readAll = <C extends { read: boolean; replies: C[] }>(comment: C): C => ({ ...comment, read: true, replies: comment.replies.map(readAll) })
      const media = last.media.map((item) => (item.mediaId === mediaId ? { ...item, unread: 0, comments: item.comments.map(readAll) } : item))
      const fresh = target.comments.flatMap((top) => [top, ...top.replies]).filter((comment) => !comment.read).map((comment) => comment.id)
      set((current) => ({ commentsFresh: { ...current.commentsFresh, [mediaId]: [...(current.commentsFresh[mediaId] ?? []), ...fresh] } }))
      withComments({ ...last, media, unread: media.reduce((sum, item) => sum + item.unread, 0) })
      try {
        withComments(await window.__scribeApi.invoke('scribe:redes-comments-read', { accountId, mediaId }))
      } catch {
        // A próxima leitura traz o estado do main.
      }
    },
    commentsFresh: {},
    clearCommentsFresh: () => set({ commentsFresh: {} }),
    // Responder e excluir pelo preload, com o clique da pessoa (token de clique); nada esperado antes.
    replyComment: (accountId, commentId, message) => commentAction(() => window.__scribeApi.redesCommentReply(accountId, commentId, message)),
    hideComment: (accountId, commentId, hide) => commentAction(() => window.__scribeApi.invoke('scribe:redes-comment-hide', { accountId, commentId, hide })),
    deleteComment: (accountId, commentId) => commentAction(() => window.__scribeApi.redesCommentDelete(accountId, commentId)),
    // fim 73
    // 74: mensagens
    messages: {},
    messagesLoading: {},
    loadMessages: async (accountId) => {
      try {
        withMessages(await window.__scribeApi.invoke('scribe:redes-messages', { accountId }))
      } catch {
        // O estado chega pelo evento quando o main responder de novo.
      }
    },
    refreshMessages: async (accountId) => {
      set((current) => ({ messagesLoading: { ...current.messagesLoading, [accountId]: true } }))
      try {
        withMessages(await window.__scribeApi.invoke('scribe:redes-messages-refresh', { accountId }))
      } catch {
        set((current) => {
          const last = current.messages[accountId]
          return last ? { messages: { ...current.messages, [accountId]: { ...last, error: FAILED } } } : {}
        })
      } finally {
        set((current) => ({ messagesLoading: { ...current.messagesLoading, [accountId]: false } }))
      }
    },
    markConversationRead: async (accountId, conversationId) => {
      // Na tela na hora (o número do nível também); o main confirma com o estado inteiro.
      set((current) => {
        const last = current.messages[accountId]
        if (!last) return {}
        const conversations = last.conversations.map((item) => (item.id === conversationId ? { ...item, unread: false } : item))
        const unread = last.access === 'denied' ? 0 : conversations.filter((item) => item.unread).length
        return { messages: { ...current.messages, [accountId]: { ...last, conversations, unread } }, unread: { ...current.unread, [accountId]: { comments: current.unread[accountId]?.comments ?? 0, messages: unread } } }
      })
      try {
        withMessages(await window.__scribeApi.invoke('scribe:redes-conversation-read', { accountId, conversationId }))
      } catch {
        // A próxima leitura traz o estado do main.
      }
    },
    sendMessage: async (accountId, conversationId, text) => {
      try {
        // Sem nada esperado antes: o preload confere a ativação do clique na hora.
        const result = await window.__scribeApi.redesMessageSend({ accountId, conversationId, text })
        if (result.ok) withMessages(result.payload)
        return result
      } catch {
        return { ok: false, error: FAILED }
      }
    },
    // fim 74
    // 75: métricas
    metrics: {},
    metricsPeriod: {},
    metricsLoading: {},
    loadMetrics: async (accountId, period, force = false) => {
      set((current) => ({ metricsLoading: { ...current.metricsLoading, [accountId]: true } }))
      try {
        const state = await window.__scribeApi.invoke(force ? 'scribe:redes-metrics-refresh' : 'scribe:redes-metrics', { accountId, period })
        if (state.accountId === accountId) set((current) => ({ metrics: { ...current.metrics, [accountId]: state } }))
      } catch {
        // Fica o que já estava; o erro do pedido que nem chegou ao main vai na nota.
        set((current) => {
          const last = current.metrics[accountId]
          return { metrics: { ...current.metrics, [accountId]: { ...(last ?? { accountId, account: { 7: null, 28: null, 90: null }, media: [], updatedAt: null }), error: FAILED } } }
        })
      } finally {
        set((current) => ({ metricsLoading: { ...current.metricsLoading, [accountId]: false } }))
      }
    },
    setMetricsPeriod: (accountId, period) => set((current) => ({ metricsPeriod: { ...current.metricsPeriod, [accountId]: period } })),
    // fim 75
    setNotice: (notice) => set({ notice }),

    load: async () => {
      try {
        set({ state: await window.__scribeApi.invoke('scribe:redes-state'), loadFailed: false })
      } catch {
        set({ loadFailed: true })
      }
    },

    connect: async (token) => {
      if (get().busy) return { ok: false, error: FAILED }
      set({ busy: { kind: 'connect' } })
      try {
        return await window.__scribeApi.invoke('scribe:redes-connect', { token })
      } catch {
        return { ok: false, error: FAILED }
      } finally {
        set({ busy: null })
      }
    },

    refresh: async (accountId) => {
      if (get().busy) return { ok: false, error: FAILED }
      set({ busy: { kind: 'refresh', accountId } })
      try {
        return await window.__scribeApi.invoke('scribe:redes-refresh', { accountId })
      } catch {
        return { ok: false, error: FAILED }
      } finally {
        set({ busy: null })
      }
    },

    remove: async (accountId) => {
      if (get().busy) return false
      set({ busy: { kind: 'remove', accountId } })
      try {
        return (await window.__scribeApi.invoke('scribe:redes-remove', { accountId })).ok
      } catch {
        return false
      } finally {
        set({ busy: null })
      }
    },

    saveMediaHost: async (config, secretAccessKey) => {
      if (get().busy) return null
      set({ busy: { kind: 'media-save' } })
      try {
        const result = await window.__scribeApi.invoke('scribe:redes-media-host-save', { config, secretAccessKey })
        withMediaHost(result.status)
        return result
      } catch {
        return { ok: false, error: FAILED, status: get().state?.mediaHost ?? { configured: false, config: null, secretSet: false, lastTest: null } }
      } finally {
        set({ busy: null })
      }
    },
    testMediaHost: () => mediaCall('media-test', () => window.__scribeApi.invoke('scribe:redes-media-host-test')),
    clearMediaHost: () => mediaCall('media-clear', () => window.__scribeApi.invoke('scribe:redes-media-host-clear')),

    loadPublications: async (accountId) => {
      try {
        withPublications(await window.__scribeApi.invoke('scribe:redes-publications', { accountId }))
      } catch {
        // A fila chega pelo evento quando o main responder de novo.
      }
    },

    loadQuota: async (accountId) => {
      if (!get().quota[accountId]) set((current) => ({ quota: { ...current.quota, [accountId]: 'consultando' } }))
      // Sem resposta, fica a última cota lida (se houver).
      const settle = (quota: PublicationQuota | null): void =>
        set((current) => {
          const last = current.quota[accountId]
          return { quota: { ...current.quota, [accountId]: quota ?? (typeof last === 'object' ? last : 'indisponivel') } }
        })
      try {
        const result = await window.__scribeApi.invoke('scribe:redes-quota', { accountId })
        settle(result.ok ? result.quota : null)
      } catch {
        settle(null)
      }
    },

    // Abrir o editor tira o aviso da tela (o de "salvo como rascunho" já foi visto).
    openEditor: (target) => set((current) => ({ editor: target ? { ...target, revision: (current.editor?.revision ?? 0) + 1 } : null, ...(target ? { notice: null } : {}) })),

    toggleCollapsed: (accountId) => set((current) => ({ collapsed: current.collapsed.includes(accountId) ? current.collapsed.filter((id) => id !== accountId) : [...current.collapsed, accountId] })),

    // A resposta do main fica (inclusive o `null`); a falha passageira não: a próxima renderização tenta de novo, até 3 vezes.
    thumbnail: (path) => {
      if (path in get().thumbs || thumbPending.has(path) || (thumbFailures.get(path) ?? 0) >= THUMB_TRIES) return
      thumbPending.add(path)
      void window.__scribeApi
        .invoke('scribe:redes-media-thumb', { path })
        .then((url) => set((current) => ({ thumbs: { ...current.thumbs, [path]: url } })))
        .catch(() => thumbFailures.set(path, (thumbFailures.get(path) ?? 0) + 1))
        .finally(() => thumbPending.delete(path))
    },

    pickMedia: async () => {
      try {
        return await window.__scribeApi.invoke('scribe:redes-media-pick')
      } catch {
        return null
      }
    },

    savePublication: async (input) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:redes-publication-save', input)
        if (result.ok) await action(() => Promise.resolve({ ok: true, publication: result.publication }))
        return result
      } catch {
        return { ok: false, problems: [FAILED] }
      }
    },

    deletePublication: async (id) => {
      try {
        return await window.__scribeApi.invoke('scribe:redes-publication-delete', { id })
      } catch {
        return { ok: false, error: FAILED }
      }
    },

    unschedule: (id) => action(() => window.__scribeApi.invoke('scribe:redes-publication-unschedule', { id })),
    retry: (id) => action(() => window.__scribeApi.invoke('scribe:redes-publication-retry', { id })),
    // Sem nada esperado antes: o preload confere a ativação do clique na hora.
    publish: (id, save) => action(() => window.__scribeApi.redesPublish(id, save)),
    schedule: (id, at, save) => action(() => window.__scribeApi.redesSchedule(id, at, save)),
  }
})

/** Contrato 72: a soma dos não lidos de uma conta (ou de todas, sem `accountId`), para os números do nível e da raiz. */
export function redesUnreadTotal(unread: Readonly<Record<string, RedesUnread>>, accountId?: string): number {
  const entries = accountId === undefined ? Object.values(unread) : unread[accountId] ? [unread[accountId]] : []
  return entries.reduce((sum, entry) => sum + entry.comments + entry.messages, 0)
}

/** O main avisa cada mudança (conta entrou, renovou, venceu, saiu; armazenamento salvo ou testado), de qualquer janela. */
export function watchRedes(): () => void {
  return window.__scribeApi.on('scribe:redes-state', (state) => useRedes.setState({ state, loadFailed: false }))
}

/**
 * Contrato 72: as contas (para o item "Redes" da barra lateral, que só aparece com conta) e a fila de cada uma, de
 * qualquer janela. A conta que saiu leva a fila e o editor aberto dela.
 */
export function useRedesSync(): void {
  useEffect(() => {
    void useRedes.getState().load()
    const offState = window.__scribeApi.on('scribe:redes-state', (state) => {
      const ids = new Set(state.accounts.map((account) => account.id))
      useRedes.setState((current) => ({
        state,
        loadFailed: false,
        editor: current.editor && ids.has(current.editor.accountId) ? current.editor : null,
        publications: Object.fromEntries(Object.entries(current.publications).filter(([id]) => ids.has(id))),
      }))
    })
    const offPublications = window.__scribeApi.on('scribe:redes-publications', (payload) => {
      if (!payload.accountId) return
      useRedes.setState((current) => ({
        publications: { ...current.publications, [payload.accountId]: payload.publications },
        ...(payload.quota ? { quota: { ...current.quota, [payload.accountId]: payload.quota } } : {}),
      }))
    })
    // 75: métricas
    const offMetrics = window.__scribeApi.on('scribe:redes-metrics', (state) => {
      if (!state.accountId) return
      useRedes.setState((current) => ({ metrics: { ...current.metrics, [state.accountId]: state } }))
    })
    // fim 75
    // 74: mensagens
    // Contrato 74: as mensagens de qualquer janela; a conta nova lê o que está guardado (o número do nível ao abrir o
    // app) e a que saiu leva as mensagens e o número dela.
    const offMessages = window.__scribeApi.on('scribe:redes-messages', (payload) => {
      if (!payload.accountId) return
      useRedes.setState((current) => ({
        messages: { ...current.messages, [payload.accountId]: payload },
        unread: { ...current.unread, [payload.accountId]: { comments: current.unread[payload.accountId]?.comments ?? 0, messages: payload.unread } },
      }))
    })
    const offAccounts = useRedes.subscribe((current, previous) => {
      if (current.state === previous.state || !current.state) return
      const ids = new Set(current.state.accounts.map((account) => account.id))
      if (Object.keys(current.messages).some((id) => !ids.has(id))) {
        useRedes.setState((now) => ({
          messages: Object.fromEntries(Object.entries(now.messages).filter(([id]) => ids.has(id))),
          unread: Object.fromEntries(Object.entries(now.unread).map(([id, entry]) => [id, ids.has(id) ? entry : { ...entry, messages: 0 }])),
        }))
      }
      for (const id of ids) if (!current.messages[id]) void current.loadMessages(id)
    })
    // fim 74
    // 73: comentários
    // Contrato 73: os comentários de qualquer janela; a conta nova lê o que está guardado (o número do nível ao abrir o
    // app) e a que saiu leva os comentários e o número dela.
    const offComments = window.__scribeApi.on('scribe:redes-comments', (payload) => {
      if (!payload.accountId) return
      useRedes.setState((current) => ({
        comments: { ...current.comments, [payload.accountId]: payload },
        unread: { ...current.unread, [payload.accountId]: { comments: payload.unread, messages: current.unread[payload.accountId]?.messages ?? 0 } },
      }))
    })
    const offCommentAccounts = useRedes.subscribe((current, previous) => {
      if (current.state === previous.state || !current.state) return
      const ids = new Set(current.state.accounts.map((account) => account.id))
      if (Object.keys(current.comments).some((id) => !ids.has(id))) {
        useRedes.setState((now) => ({
          comments: Object.fromEntries(Object.entries(now.comments).filter(([id]) => ids.has(id))),
          unread: Object.fromEntries(Object.entries(now.unread).map(([id, entry]) => [id, ids.has(id) ? entry : { ...entry, comments: 0 }])),
        }))
      }
      for (const id of ids) if (!current.comments[id]) void current.loadComments(id)
    })
    // fim 73
    return () => {
      offState()
      offPublications()
      // 73: comentários
      offComments()
      offCommentAccounts()
      // fim 73
      // 74: mensagens
      offMessages()
      offAccounts()
      // fim 74
      // 75: métricas
      offMetrics()
      // fim 75
    }
  }, [])
}
