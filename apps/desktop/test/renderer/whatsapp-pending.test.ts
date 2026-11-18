// Balão otimista do envio com "Corrigir ao enviar" ligado (contrato 36): o temporário entra no clique com o texto
// digitado, sai quando o eco com o `id` do envio chega (em qualquer ordem), volta o texto ao campo quando falha, para
// de brilhar 10 s depois do envio aceito sem eco e fica só na conversa de origem.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPending, confirmPending, failPending, markPendingSent, PENDING_ECHO_WAIT_MS, settlePending, visibleMessages, visiblePending, type PendingByChat } from '../../src/renderer/src/features/whatsapp/pending'
import { useWhatsApp } from '../../src/renderer/src/features/whatsapp/whatsappStore'
import type { WhatsAppMessage } from '../../src/shared/whatsapp'

const ANA = '5511911110000@s.whatsapp.net'
const BRUNO = '5511922220000@s.whatsapp.net'
const echo = (id: string, text: string, chatId = ANA): WhatsAppMessage => ({ id, chatId, author: 'Você', fromMe: true, at: 1000, type: 'text', text, media: null })

describe('Temporários (funções puras)', () => {
  const start = addPending({}, { key: 'k1', chatId: ANA, text: 'oi tudo bem', at: 1 })

  it('o clique cria o temporário na conversa de origem, sem id e corrigindo', () => {
    expect(start[ANA]).toEqual([{ key: 'k1', chatId: ANA, text: 'oi tudo bem', at: 1, id: null, phase: 'correcting' }])
    expect(start[BRUNO]).toBeUndefined()
  })

  it('sem id, nenhum eco o tira; com o id, o eco o troca pela mensagem real', () => {
    expect(settlePending(start, ANA, [echo('enviada-1', 'Oi, tudo bem?')])).toBe(start)
    const confirmed = confirmPending(start, ANA, 'k1', 'enviada-1', [])
    expect(confirmed[ANA]?.[0]?.id).toBe('enviada-1')
    expect(settlePending(confirmed, ANA, [echo('outra', 'x')])).toBe(confirmed)
    expect(settlePending(confirmed, ANA, [echo('enviada-1', 'Oi, tudo bem?')])[ANA]).toBeUndefined()
  })

  it('o eco chegou antes da resposta do envio: confirmar já tira o temporário', () => {
    expect(confirmPending(start, ANA, 'k1', 'enviada-1', [echo('enviada-1', 'Oi, tudo bem?')])[ANA]).toBeUndefined()
  })

  it('nunca mostra o temporário junto da mensagem real', () => {
    const confirmed = confirmPending(start, ANA, 'k1', 'enviada-1', [])
    expect(visiblePending(confirmed[ANA], [echo('enviada-1', 'Oi, tudo bem?')])).toEqual([])
    expect(visiblePending(confirmed[ANA], [])).toHaveLength(1)
  })

  it('o eco antes da resposta do envio fica fora da tela até o temporário ganhar o id (nunca os dois)', () => {
    const before: WhatsAppMessage = { ...echo('antiga', 'de ontem'), at: -10_000 }
    const theirs: WhatsAppMessage = { ...echo('dela', 'oi'), fromMe: false, at: 5000 }
    const early = { ...echo('enviada-1', 'Oi, tudo bem?'), at: 1200 }
    expect(visibleMessages([before, theirs, early], start[ANA])?.map((message) => message.id)).toEqual(['antiga', 'dela'])
    const confirmed = confirmPending(start, ANA, 'k1', 'enviada-1', [before, theirs, early])
    expect(visibleMessages([before, theirs, early], confirmed[ANA])?.map((message) => message.id)).toEqual(['antiga', 'dela', 'enviada-1'])
    expect(visiblePending(confirmed[ANA], [before, theirs, early])).toEqual([])
  })

  it('a falha tira o temporário e devolve o texto digitado', () => {
    const { pending, failed } = failPending(start, ANA, 'k1')
    expect(failed?.text).toBe('oi tudo bem')
    expect(pending[ANA]).toBeUndefined()
    expect(failPending(start, ANA, 'nenhum')).toEqual({ pending: start, failed: null })
  })

  it('"Enviada" só depois de aceito (sem id continua corrigindo)', () => {
    expect(markPendingSent(start, ANA, 'k1')).toBe(start)
    const confirmed = confirmPending(start, ANA, 'k1', 'enviada-1', [])
    expect(markPendingSent(confirmed, ANA, 'k1')[ANA]?.[0]).toMatchObject({ phase: 'sent', text: 'oi tudo bem', id: 'enviada-1' })
  })

  it('cada envio é um temporário próprio; os de outra conversa não mudam', () => {
    let pending: PendingByChat = addPending(start, { key: 'k2', chatId: ANA, text: 'segunda', at: 2 })
    pending = addPending(pending, { key: 'k3', chatId: BRUNO, text: 'para o Bruno', at: 3 })
    pending = confirmPending(pending, ANA, 'k2', 'enviada-2', [echo('enviada-2', 'Segunda.')])
    expect(pending[ANA]?.map((item) => item.key)).toEqual(['k1'])
    expect(pending[BRUNO]?.map((item) => item.text)).toEqual(['para o Bruno'])
  })
})

describe('Temporários no store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useWhatsApp.setState({ chats: null, messages: { [ANA]: [], [BRUNO]: [] }, pending: {}, swapped: {}, restore: {} })
  })
  afterEach(() => vi.useRealTimers())

  it('resposta do envio e depois o eco: sai o temporário, a mensagem real entra com o fade', () => {
    const store = useWhatsApp.getState()
    const key = store.startPending(ANA, 'oi tudo bem')
    expect(useWhatsApp.getState().pending[ANA]?.[0]?.text).toBe('oi tudo bem')
    store.confirmPending(ANA, key, 'enviada-1')
    expect(useWhatsApp.getState().pending[ANA]).toHaveLength(1)
    store.receiveMany([{ message: echo('enviada-1', 'Oi, tudo bem?'), chatName: 'Ana' }])
    const state = useWhatsApp.getState()
    expect(state.pending[ANA]).toBeUndefined()
    expect(state.swapped['enviada-1']).toBe(true)
    expect(state.messages[ANA]?.map((message) => message.text)).toEqual(['Oi, tudo bem?'])
  })

  it('o eco antes da resposta do envio: confirmar tira o temporário', () => {
    const store = useWhatsApp.getState()
    const key = store.startPending(ANA, 'oi tudo bem')
    store.receiveMany([{ message: echo('enviada-1', 'Oi, tudo bem?'), chatName: 'Ana' }])
    expect(useWhatsApp.getState().pending[ANA]).toHaveLength(1)
    store.confirmPending(ANA, key, 'enviada-1')
    expect(useWhatsApp.getState().pending[ANA]).toBeUndefined()
    expect(useWhatsApp.getState().swapped['enviada-1']).toBe(true)
  })

  it('a falha devolve o texto e o erro ao campo da conversa de origem (uma vez)', () => {
    const store = useWhatsApp.getState()
    const key = store.startPending(ANA, 'oi tudo bem')
    store.failPending(ANA, key, 'O WhatsApp não aceitou a mensagem. Tente de novo.')
    expect(useWhatsApp.getState().pending[ANA]).toBeUndefined()
    expect(store.takeRestore(BRUNO)).toBeNull()
    expect(store.takeRestore(ANA)).toEqual({ text: 'oi tudo bem', error: 'O WhatsApp não aceitou a mensagem. Tente de novo.' })
    expect(store.takeRestore(ANA)).toBeNull()
  })

  it('sem o eco 10 s depois do envio aceito: para de brilhar e diz "Enviada", com o texto digitado', () => {
    const store = useWhatsApp.getState()
    const key = store.startPending(ANA, 'oi tudo bem')
    store.confirmPending(ANA, key, 'enviada-1')
    vi.advanceTimersByTime(PENDING_ECHO_WAIT_MS - 1)
    expect(useWhatsApp.getState().pending[ANA]?.[0]?.phase).toBe('correcting')
    vi.advanceTimersByTime(1)
    expect(useWhatsApp.getState().pending[ANA]?.[0]).toMatchObject({ phase: 'sent', text: 'oi tudo bem' })
    store.receiveMany([{ message: echo('enviada-1', 'Oi, tudo bem?'), chatName: 'Ana' }])
    expect(useWhatsApp.getState().pending[ANA]).toBeUndefined()
  })

  it('o temporário fica na conversa de origem: o eco de outra conversa não o tira', () => {
    const store = useWhatsApp.getState()
    const key = store.startPending(ANA, 'oi tudo bem')
    store.confirmPending(ANA, key, 'enviada-1')
    store.receiveMany([{ message: echo('enviada-9', 'Bruno', BRUNO), chatName: 'Bruno' }])
    expect(useWhatsApp.getState().pending[ANA]).toHaveLength(1)
    expect(useWhatsApp.getState().pending[BRUNO]).toBeUndefined()
  })
})
