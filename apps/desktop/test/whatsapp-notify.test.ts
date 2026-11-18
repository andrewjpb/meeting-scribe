// Notificações do WhatsApp (contrato 40): as regras puras com a `Notification` injetada. Nunca o que eu mandei; nada
// com a opção desligada; grupo só com "Só pessoas" desligado; nada com a conversa aberta na janela em foco; bloqueado,
// sem o texto; rajada de 3 ou mais no mesmo chat em 5 s vira uma só; corpo até 140 e os rótulos de mídia.
import { describe, expect, it } from 'vitest'
import { BURST_WINDOW_MS, clip, createWhatsAppNotifier, NOTICE_BODY_MAX, noticeBody, noticeTitle, shouldNotify, type IncomingNotice, type WhatsAppNotice } from '../src/main/whatsapp/notify'
import type { WhatsAppMessage } from '../src/shared/whatsapp'

const ANA = '5511911110000@s.whatsapp.net'
const BRUNO = '5511922220000@s.whatsapp.net'
const ATLAS = '120363000000000001@g.us'

const message = (over: Partial<WhatsAppMessage> = {}): WhatsAppMessage => ({ id: 'm1', chatId: ANA, author: 'Ana Souza', fromMe: false, at: 0, type: 'text', text: 'Oi!', media: null, ...over })

const input = (over: Partial<IncomingNotice> = {}): IncomingNotice => ({
  message: message(),
  chatName: 'Ana Souza',
  settings: { enabled: true, groups: true },
  viewing: false,
  locked: false,
  ...over,
})

function setup() {
  let now = 1_000_000
  const shown: (WhatsAppNotice & { closed: boolean })[] = []
  const notifier = createWhatsAppNotifier({
    show: (notice) => {
      const entry = { ...notice, closed: false }
      shown.push(entry)
      return { close: () => void (entry.closed = true) }
    },
    appName: () => 'LAP Reuniões',
    now: () => now,
  })
  return { notifier, shown, advance: (ms: number) => void (now += ms), open: () => shown.filter((item) => !item.closed) }
}

describe('quando notificar', () => {
  it('mensagem recebida notifica com o nome e o texto', () => {
    const { notifier, shown } = setup()
    expect(notifier.receive(input())).toEqual({ chatId: ANA, title: 'Ana Souza', body: 'Oi!', count: 1, icon: null })
    expect(shown).toHaveLength(1)
  })

  it('nunca o que eu mandei', () => {
    const { notifier, shown } = setup()
    expect(notifier.receive(input({ message: message({ fromMe: true }) }))).toBeNull()
    expect(shown).toHaveLength(0)
  })

  it('desligado, nada sai', () => {
    const { notifier, shown } = setup()
    expect(notifier.receive(input({ settings: { enabled: false, groups: true } }))).toBeNull()
    expect(notifier.receive(input({ locked: true, settings: { enabled: false, groups: true } }))).toBeNull()
    expect(shown).toHaveLength(0)
  })

  it('janela em foco com a conversa aberta não notifica; outra conversa notifica', () => {
    const { notifier, shown } = setup()
    expect(notifier.receive(input({ viewing: true }))).toBeNull()
    expect(notifier.receive(input({ message: message({ chatId: BRUNO, author: 'Bruno Lima' }), chatName: 'Bruno Lima' }))?.title).toBe('Bruno Lima')
    expect(shown.map((item) => item.chatId)).toEqual([BRUNO])
  })

  it('grupo: "Autor · Grupo"; com "Só pessoas" não notifica', () => {
    const { notifier } = setup()
    const group = input({ message: message({ chatId: ATLAS, author: 'Carla Dias', text: 'Prazo dia 28' }), chatName: 'Projeto Atlas' })
    expect(notifier.receive(group)).toMatchObject({ title: 'Carla Dias · Projeto Atlas', body: 'Prazo dia 28' })
    expect(notifier.receive({ ...group, settings: { enabled: true, groups: false } })).toBeNull()
    expect(shouldNotify({ ...input(), settings: { enabled: true, groups: false } })).toBe(true)
  })

  it('bloqueado: o nome do app e só de quem é, sem o texto e sem a foto, mesmo com a conversa aberta', () => {
    const { notifier } = setup()
    const shown = notifier.receive(input({ locked: true, viewing: true, icon: 'data:image/png;base64,AAAA', message: message({ text: 'segredo' }) }))
    expect(shown).toEqual({ chatId: ANA, title: 'LAP Reuniões', body: 'Mensagem de Ana Souza', count: 1, icon: null })
    expect(JSON.stringify(shown)).not.toContain('segredo')
  })

  it('a foto vai como ícone, quando há', () => {
    const { notifier } = setup()
    expect(notifier.receive(input({ icon: 'data:image/png;base64,AAAA' }))?.icon).toBe('data:image/png;base64,AAAA')
  })
})

describe('corpo', () => {
  it('até 140 caracteres, com reticências, sem partir emoji', () => {
    const long = 'a'.repeat(200)
    const body = noticeBody(message({ text: long }))
    expect(Array.from(body)).toHaveLength(NOTICE_BODY_MAX)
    expect(body.endsWith('…')).toBe(true)
    const emoji = clip('😀'.repeat(150))
    expect(Array.from(emoji)).toHaveLength(NOTICE_BODY_MAX)
    expect(emoji.startsWith('😀')).toBe(true)
    expect(noticeBody(message({ text: 'curto' }))).toBe('curto')
  })

  it('rótulos de mídia, com a legenda quando houver', () => {
    const media = (type: WhatsAppMessage['type'], text = '') => noticeBody(message({ type, text, media: { kind: type, mime: null, size: null, name: null } }))
    expect(media('image')).toBe('🖼 Imagem')
    expect(media('audio')).toBe('🎤 Áudio')
    expect(media('video')).toBe('🎬 Vídeo')
    expect(media('document')).toBe('📎 Documento')
    expect(media('image', 'Quadro do cronograma')).toBe('🖼 Imagem · Quadro do cronograma')
    expect(noticeBody(message({ text: '  ' }))).toBe('Mensagem')
  })

  it('título sem nome cai no número', () => {
    expect(noticeTitle(message(), '')).toBe('5511911110000')
    expect(noticeTitle(message({ chatId: ATLAS, author: '' }), 'Projeto Atlas')).toBe('Projeto Atlas')
  })
})

describe('rajadas', () => {
  it('3 mensagens do mesmo chat em 5 s viram uma ("3 mensagens de Fulano")', () => {
    const { notifier, shown, advance, open } = setup()
    notifier.receive(input())
    advance(1000)
    notifier.receive(input())
    advance(1000)
    const third = notifier.receive(input())
    expect(third).toEqual({ chatId: ANA, title: 'Ana Souza', body: '3 mensagens de Ana Souza', count: 3, icon: null })
    expect(shown).toHaveLength(3)
    expect(open()).toEqual([expect.objectContaining({ body: '3 mensagens de Ana Souza' })])
    advance(1000)
    notifier.receive(input())
    expect(open().map((item) => item.body)).toEqual(['4 mensagens de Ana Souza'])
  })

  it('fora dos 5 s, recomeça; outro chat não entra na rajada', () => {
    const { notifier, advance, open } = setup()
    notifier.receive(input())
    notifier.receive(input({ message: message({ chatId: BRUNO }), chatName: 'Bruno Lima' }))
    notifier.receive(input())
    advance(BURST_WINDOW_MS + 1)
    notifier.receive(input())
    expect(open().map((item) => item.body)).toEqual(['Oi!', 'Oi!', 'Oi!', 'Oi!'])
  })

  it('a rajada do grupo e a bloqueada também não mostram o texto', () => {
    const { notifier } = setup()
    const group = input({ message: message({ chatId: ATLAS, author: 'Carla Dias' }), chatName: 'Projeto Atlas' })
    notifier.receive(group)
    notifier.receive(group)
    expect(notifier.receive(group)).toMatchObject({ title: 'Projeto Atlas', body: '3 mensagens em Projeto Atlas' })
    const locked = setup()
    for (let i = 0; i < 2; i++) locked.notifier.receive(input({ locked: true, message: message({ text: 'segredo' }) }))
    expect(locked.notifier.receive(input({ locked: true, message: message({ text: 'segredo' }) }))).toEqual({ chatId: ANA, title: 'LAP Reuniões', body: '3 mensagens de Ana Souza', count: 3, icon: null })
  })

  it('mensagens à vista não contam para a rajada', () => {
    const { notifier } = setup()
    notifier.receive(input({ viewing: true }))
    notifier.receive(input({ viewing: true }))
    expect(notifier.receive(input())?.count).toBe(1)
  })
})
