// Contrato 34 na tela do WhatsApp: a barra de citação e o bloco da citação no balão, o emoji que sai ao tocar (tocar na
// sua de novo tira), as reações novas numa mensagem, o "digitando…" que vence em 10 s e o seu "digitando…", que só sai
// com espera de 3 s (e o "parou" ao limpar, enviar ou sair).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyPresence,
  createTypingSignal,
  pruneTyping,
  quotedBlock,
  quoteFor,
  quotePreview,
  reactionToSend,
  stopTyping,
  typingLabel,
  withReactions,
} from '../../src/renderer/src/features/whatsapp/interactions'
import { useWhatsApp } from '../../src/renderer/src/features/whatsapp/whatsappStore'
import { WHATSAPP_REACTION_EMOJIS, WHATSAPP_TYPING_TTL_MS, type WhatsAppMessage } from '../../src/shared/whatsapp'

const ANA = '5511911110000@s.whatsapp.net'
const ATLAS = '120363000000000001@g.us'
const THUMBS = '\u{1F44D}'
const HEART = '❤️'
const message = (id: string, extra: Partial<WhatsAppMessage> = {}): WhatsAppMessage => ({ id, chatId: ANA, author: 'Ana Souza', fromMe: false, at: 1000, type: 'text', text: 'Oi', media: null, ...extra })

describe('responder citando (CA1)', () => {
  it('a barra de citação leva quem mandou e o trecho numa linha, até 120', () => {
    expect(quoteFor(message('m1', { text: 'Conseguimos marcar\n\na reunião?' }))).toEqual({ id: 'm1', author: 'Ana Souza', preview: 'Conseguimos marcar a reunião?' })
    expect(quoteFor(message('m2', { fromMe: true, author: 'Andrea' })).author).toBe('Você')
    expect(quotePreview({ type: 'image', text: '' })).toBe('Imagem')
    expect(quotePreview({ type: 'audio', text: '  ' })).toBe('Áudio')
    expect(quotePreview({ type: 'image', text: 'com legenda' })).toBe('com legenda')
    expect(quotePreview({ type: 'text', text: 'x'.repeat(300) })).toHaveLength(120)
  })

  it('o balão que responde mostra o trecho guardado e, com a citada carregada, o autor (e deixa rolar até ela)', () => {
    const quoted = message('m1', { text: 'Pauta de sexta' })
    const reply = message('r1', { fromMe: true, text: 'Combinado', replyToId: 'm1', replyPreview: 'Pauta de sexta' })
    expect(quotedBlock(reply, [quoted, reply])).toEqual({ id: 'm1', author: 'Ana Souza', preview: 'Pauta de sexta', loaded: true })
    // Citada fora da tela (mais antiga, não carregada): só o trecho, sem rolar.
    expect(quotedBlock(reply, [reply])).toEqual({ id: 'm1', author: null, preview: 'Pauta de sexta', loaded: false })
    // Sem o trecho guardado: o da citada carregada; sem nada, "Mensagem".
    expect(quotedBlock(message('r2', { replyToId: 'm1' }), [quoted])?.preview).toBe('Pauta de sexta')
    expect(quotedBlock(message('r3', { replyToId: 'sumiu' }), [quoted])?.preview).toBe('Mensagem')
    expect(quotedBlock(message('r4'), [quoted])).toBeNull()
  })
})

describe('reações (CA2)', () => {
  it('tocar num emoji manda ele; tocar de novo na sua tira (vai o vazio)', () => {
    expect(reactionToSend(undefined, THUMBS)).toBe(THUMBS)
    expect(reactionToSend([{ emoji: THUMBS, count: 2, mine: false }], THUMBS)).toBe(THUMBS)
    expect(reactionToSend([{ emoji: THUMBS, count: 2, mine: true }], THUMBS)).toBe('')
    // Trocar a sua por outra: o outro emoji (o WhatsApp troca, uma por pessoa).
    expect(reactionToSend([{ emoji: THUMBS, count: 1, mine: true }], HEART)).toBe(HEART)
    expect(WHATSAPP_REACTION_EMOJIS).toEqual([THUMBS, HEART, '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'])
  })

  it('as reações novas entram só na mensagem delas; a lista vazia tira os chips', () => {
    const list = [message('m1'), message('m2')]
    const next = withReactions(list, 'm2', [{ emoji: THUMBS, count: 1, mine: true }])
    expect(next?.[1]?.reactions).toEqual([{ emoji: THUMBS, count: 1, mine: true }])
    expect(next?.[0]).toBe(list[0])
    expect(withReactions(next, 'm2', [])?.[1]?.reactions).toBeUndefined()
    expect(withReactions(list, 'outra', [])).toBe(list)
    expect(withReactions(undefined, 'm1', [])).toBeUndefined()
  })

  it('o store aplica as reações que chegam na conversa carregada', () => {
    useWhatsApp.setState({ messages: { [ANA]: [message('m1')] } })
    useWhatsApp.getState().setReactions(ANA, 'm1', [{ emoji: HEART, count: 3, mine: false }])
    expect(useWhatsApp.getState().messages[ANA]?.[0]?.reactions).toEqual([{ emoji: HEART, count: 3, mine: false }])
    // Conversa não carregada: nada muda.
    useWhatsApp.getState().setReactions(ATLAS, 'm1', [])
    expect(useWhatsApp.getState().messages[ATLAS]).toBeUndefined()
  })
})

describe('"digitando…" (CA3)', () => {
  it('vale 10 s depois do último aviso, sai com o "parou" e com a mensagem que chega', () => {
    let typing = applyPresence({}, { chatId: ANA, state: 'composing', author: null }, 1000)
    expect(typingLabel(typing, ANA, false, 1000)).toBe('digitando…')
    expect(typingLabel(typing, ANA, false, 1000 + WHATSAPP_TYPING_TTL_MS - 1)).toBe('digitando…')
    expect(typingLabel(typing, ANA, false, 1000 + WHATSAPP_TYPING_TTL_MS)).toBeNull()
    expect(pruneTyping(typing, 1000 + WHATSAPP_TYPING_TTL_MS)).toEqual({})
    expect(pruneTyping(typing, 2000)).toBe(typing)
    // Um aviso novo renova.
    typing = applyPresence(typing, { chatId: ANA, state: 'composing', author: null }, 9000)
    expect(typingLabel(typing, ANA, false, 12_000)).toBe('digitando…')
    expect(applyPresence(typing, { chatId: ANA, state: 'paused', author: null }, 9500)).toEqual({})
    expect(stopTyping(typing, [ANA])).toEqual({})
    expect(stopTyping(typing, [ATLAS])).toBe(typing)
  })

  it('no grupo, "Fulano está digitando…" quando o autor vem', () => {
    const typing = applyPresence({}, { chatId: ATLAS, state: 'composing', author: 'Carla Dias' }, 0)
    expect(typingLabel(typing, ATLAS, true, 0)).toBe('Carla Dias está digitando…')
    expect(typingLabel(applyPresence({}, { chatId: ATLAS, state: 'composing', author: null }, 0), ATLAS, true, 0)).toBe('digitando…')
    expect(typingLabel(typing, ANA, false, 0)).toBeNull()
  })

  describe('o aviso vence sozinho no store', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('sem aviso novo em 10 s, o "digitando…" sai da tela', () => {
      useWhatsApp.setState({ typing: {} })
      useWhatsApp.getState().receivePresence({ chatId: ANA, state: 'composing', author: null })
      expect(Object.keys(useWhatsApp.getState().typing)).toEqual([ANA])
      vi.advanceTimersByTime(WHATSAPP_TYPING_TTL_MS - 500)
      expect(Object.keys(useWhatsApp.getState().typing)).toEqual([ANA])
      vi.advanceTimersByTime(1000)
      expect(useWhatsApp.getState().typing).toEqual({})
      // A mensagem de quem digitava tira o aviso na hora.
      useWhatsApp.getState().receivePresence({ chatId: ANA, state: 'composing', author: null })
      useWhatsApp.setState({ chats: null, messages: {} })
      useWhatsApp.getState().receiveMany([{ message: message('nova'), chatName: 'Ana Souza' }])
      expect(useWhatsApp.getState().typing).toEqual({})
    })
  })

  describe('o seu "digitando…" (interruptor ligado)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('sai no primeiro caractere, de novo no máximo a cada 3 s, e "parou" depois de 3 s sem digitar', () => {
      const sent: string[] = []
      const signal = createTypingSignal({ send: (state) => sent.push(state), now: () => Date.now() })
      signal.input('O')
      signal.input('Oi')
      expect(sent).toEqual(['composing'])
      vi.advanceTimersByTime(2000)
      signal.input('Oi,')
      expect(sent).toEqual(['composing'])
      vi.advanceTimersByTime(1500)
      signal.input('Oi, t')
      expect(sent).toEqual(['composing', 'composing'])
      vi.advanceTimersByTime(2999)
      expect(sent).toEqual(['composing', 'composing'])
      vi.advanceTimersByTime(1)
      expect(sent).toEqual(['composing', 'composing', 'paused'])
      // Só um "parou" por "digitando".
      signal.stop()
      expect(sent).toHaveLength(3)
    })

    it('campo vazio ou o envio mandam "parou" na hora; sem ter digitado, nada sai', () => {
      const sent: string[] = []
      const signal = createTypingSignal({ send: (state) => sent.push(state) })
      signal.stop()
      signal.input('   ')
      expect(sent).toEqual([])
      signal.input('a')
      signal.input('')
      expect(sent).toEqual(['composing', 'paused'])
      signal.input('b')
      signal.stop()
      expect(sent).toEqual(['composing', 'paused', 'composing', 'paused'])
      vi.advanceTimersByTime(10_000)
      expect(sent).toHaveLength(4)
    })
  })
})
