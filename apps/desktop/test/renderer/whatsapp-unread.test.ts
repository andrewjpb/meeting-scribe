// Contrato 160/164: com a lista de conversas carregada cedo (o centro de notificações pede as conversas ao conectar), as
// mensagens que chegam pelo evento e que a lista já contava não podem somar de novo nas não lidas.
import { beforeEach, describe, expect, it } from 'vitest'
import { useWhatsApp } from '../../src/renderer/src/features/whatsapp/whatsappStore'
import type { WhatsAppChat, WhatsAppMessage } from '../../src/shared/whatsapp'

const ANA = '5511911110000@s.whatsapp.net'
const msg = (id: string, at: number, fromMe = false): WhatsAppMessage => ({ id, chatId: ANA, author: fromMe ? 'Você' : 'Ana', fromMe, at, type: 'text', text: 't', media: null })
const chat = (lastMessage: WhatsAppMessage | null, unread: number): WhatsAppChat => ({ id: ANA, name: 'Ana', kind: 'person', unread, lastMessage })

describe('não lidas do WhatsApp no renderer', () => {
  beforeEach(() => {
    useWhatsApp.setState({ chats: [chat(msg('m2', 2000), 2)], messages: {} })
  })

  it('a mensagem que a lista já trazia como última não soma de novo', () => {
    useWhatsApp.getState().receive(msg('m2', 2000), 'Ana')
    expect(useWhatsApp.getState().chats?.[0]?.unread).toBe(2)
  })

  it('o histórico (mais antigo que a última) não soma nem vira a última mensagem', () => {
    useWhatsApp.getState().receive(msg('m1', 1000), 'Ana')
    const atual = useWhatsApp.getState().chats?.[0]
    expect(atual?.unread).toBe(2)
    expect(atual?.lastMessage?.id).toBe('m2')
  })

  it('a mensagem nova soma e vira a última; a minha não soma', () => {
    useWhatsApp.getState().receive(msg('m3', 3000), 'Ana')
    expect(useWhatsApp.getState().chats?.[0]?.unread).toBe(3)
    useWhatsApp.getState().receive(msg('m4', 4000, true), 'Ana')
    const atual = useWhatsApp.getState().chats?.[0]
    expect(atual?.unread).toBe(3)
    expect(atual?.lastMessage?.id).toBe('m4')
  })
})
