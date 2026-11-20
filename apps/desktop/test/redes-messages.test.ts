// Contrato 74 (R6, CA11): as mensagens diretas do Instagram. As regras puras (a mesclagem por id, a não lida, a janela
// de 24 h, os bytes em UTF-8, a recusa de acesso pelo código ou pelo texto da Meta) e o serviço com o Instagram falso em
// memória e o relógio injetado: a leitura só das conversas que mudaram, abrir marca como lida, "Enviar" só com o token
// de clique, fora da janela a recusa da Meta com a razão, o acesso negado zerando o número, o arquivo à parte que a fila
// de publicações não apaga e o "Remover" levando tudo.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MESSAGE_TEXT_MAX_BYTES, MESSAGE_TOO_LONG_MESSAGE, MESSAGE_WINDOW_MS, MESSAGE_WINDOW_REFUSED_MESSAGE, messageBytes, outsideMessageWindow, type RedesMessage, type RedesMessagesPayload } from '../src/shared/redes'
import { REDES_MESSAGE_CLICK_MESSAGE } from '../src/shared/ipc'
import type { HttpFetch, HttpResponse } from '../src/main/accounts/http'
import { createEmailClickGuard } from '../src/main/email/service'
import type { SafeStorageLike } from '../src/main/secrets'
import { createFakeInstagram, SMOKE_IG_TOKEN, SMOKE_IG_USER_ID, SMOKE_IG_USERNAME, type FakeInstagram } from '../src/main/redes/fake-instagram'
import { createInstagramClient, MESSAGES_DENIED_SUMMARY } from '../src/main/redes/instagram-client'
import { conversationView, emptySnapshot, markConversationRead, mergeMessages, messagesState, parseMessagesFile, serializeMessages, syncMessages, type MessagesSnapshot } from '../src/main/redes/messages'
import { testMediaHost } from '../src/main/redes/media-host'
import { createRedesService, type RedesService } from '../src/main/redes/service'

const T0 = Date.parse('2026-11-20T12:00:00.000Z')
const HOUR = 3_600_000
const WINDOW = 7
const ACCOUNT = { id: SMOKE_IG_USER_ID, username: SMOKE_IG_USERNAME }
const MARINA = { id: '7310000000000001', username: 'marina.alves', name: 'Marina Alves' }
const TIAGO = { id: '7310000000000002', username: 'tiago.ramos', name: 'Tiago Ramos' }

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decryptString: (data) => [...data.toString().slice(4)].reverse().join(''),
}

const message = (id: string, at: number, fromMe: boolean, text: string | null = 'oi'): RedesMessage => ({ id, conversationId: 'conv1', fromId: fromMe ? SMOKE_IG_USER_ID : MARINA.id, fromMe, text, attachments: [], createdAt: new Date(at).toISOString() })

const answer = (status: number, body: unknown): HttpResponse => ({ status, header: () => 'application/json', text: () => Promise.resolve(JSON.stringify(body)), bytes: () => Promise.resolve(new Uint8Array(0)) })

describe('regras das mensagens (contrato 74)', () => {
  it('conta os bytes como a Meta (UTF-8): acento vale 2 e emoji vale 4', () => {
    expect(messageBytes('abc')).toBe(3)
    expect(messageBytes('ação')).toBe(6)
    expect(messageBytes('👍')).toBe(4)
    expect(MESSAGE_TEXT_MAX_BYTES).toBe(1000)
    expect(messageBytes('é'.repeat(500))).toBe(1000)
    expect(messageBytes('é'.repeat(501))).toBeGreaterThan(MESSAGE_TEXT_MAX_BYTES)
  })

  it('a janela de 24 h conta da última mensagem do contato; sem ela, está fora', () => {
    expect(MESSAGE_WINDOW_MS).toBe(24 * HOUR)
    expect(outsideMessageWindow(new Date(T0 - 23 * HOUR).toISOString(), T0)).toBe(false)
    expect(outsideMessageWindow(new Date(T0 - 24 * HOUR).toISOString(), T0)).toBe(false)
    expect(outsideMessageWindow(new Date(T0 - 25 * HOUR).toISOString(), T0)).toBe(true)
    expect(outsideMessageWindow(null, T0)).toBe(true)
  })

  it('mescla por id, em ordem, e a local (enviada sem id) sai quando a de verdade chega', () => {
    const merged = mergeMessages([message('b', T0 - 1000, false), message('a', T0 - 5000, false)], [message('b', T0 - 1000, false, 'editada'), message('c', T0, true)])
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(merged[1]?.text).toBe('editada')
    const local = { ...message('local-1', T0, true, 'Combinado!') }
    const withReal = mergeMessages([local], [message('real', T0 + 2000, true, 'Combinado!')])
    expect(withReal.map((item) => item.id)).toEqual(['real'])
    // Texto diferente: as duas ficam.
    expect(mergeMessages([local], [message('real', T0 + 2000, true, 'Outro')]).length).toBe(2)
  })

  it('não lida: a última é do contato e chegou depois da abertura; abrir marca até a última', () => {
    const conversation = { id: 'conv1', participantId: MARINA.id, participantName: MARINA.name, participantUsername: MARINA.username, updatedAt: new Date(T0).toISOString(), readAt: null, syncedAt: null, olderCount: 0 }
    const snapshot: MessagesSnapshot = { ...emptySnapshot(), conversations: [conversation], messages: { conv1: [message('a', T0 - 2000, true), message('b', T0 - 1000, false, 'Vocês fazem\napp?')] }, access: 'ok' }
    const before = conversationView(conversation, snapshot.messages['conv1'] ?? [])
    expect(before).toMatchObject({ unread: true, lastMessage: 'Vocês fazem app?', lastInboundAt: new Date(T0 - 1000).toISOString() })
    expect(messagesState(snapshot).unread).toBe(1)
    const read = markConversationRead(snapshot, 'conv1')
    expect(messagesState(read).unread).toBe(0)
    // Mensagem nova do contato depois da abertura: não lida de novo.
    const again: MessagesSnapshot = { ...read, messages: { conv1: [...(read.messages['conv1'] ?? []), message('c', T0, false)] } }
    expect(messagesState(again).unread).toBe(1)
    // A última sendo minha: não é não lida.
    const mine: MessagesSnapshot = { ...again, messages: { conv1: [...(again.messages['conv1'] ?? []), message('d', T0 + 1000, true)] } }
    expect(messagesState(mine).unread).toBe(0)
    // Acesso negado: nenhum não lido.
    expect(messagesState({ ...again, access: 'denied' }).unread).toBe(0)
  })

  it('o arquivo inválido vale como vazio e o válido volta igual', () => {
    expect(parseMessagesFile({ version: 9 })).toEqual(emptySnapshot())
    expect(parseMessagesFile(null)).toEqual(emptySnapshot())
    const snapshot: MessagesSnapshot = { ...emptySnapshot(), access: 'ok', updatedAt: new Date(T0).toISOString() }
    expect(parseMessagesFile(JSON.parse(JSON.stringify(serializeMessages(snapshot))))).toEqual(snapshot)
  })

  it('a recusa de acesso pelo código (230, 10, 200) ou só pelo texto vira `denied`, com o resumo sem o texto da Meta', async () => {
    const cases: { body: unknown; denied: boolean }[] = [
      { body: { error: { code: 230, message: '(#230) Requires instagram_manage_messages permission to manage the object with conta-secreta' } }, denied: true },
      { body: { error: { code: 10, message: 'Application does not have permission for this action' } }, denied: true },
      { body: { error: { code: 200, message: 'Permissions error' } }, denied: true },
      { body: { error: { code: 100, message: 'The app does not have the capability to make this API call' } }, denied: true },
      { body: { error: { code: 4, message: 'Application request limit reached' } }, denied: false },
      { body: { error: { code: 190, message: 'Invalid OAuth access token' } }, denied: false },
      { body: { error: { code: 100, message: 'Unsupported get request' } }, denied: false },
    ]
    for (const item of cases) {
      const client = createInstagramClient(() => Promise.resolve(answer(400, item.body)))
      const result = await client.conversations(SMOKE_IG_TOKEN)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.denied, JSON.stringify(item.body)).toBe(item.denied)
      expect(result.error).not.toMatch(/conta-secreta|permission|capability/i)
    }
    const denied = await createInstagramClient(() => Promise.resolve(answer(400, cases[0]?.body))).conversations(SMOKE_IG_TOKEN)
    expect(!denied.ok && denied.error).toBe(`${MESSAGES_DENIED_SUMMARY} (erro 230)`)
    // A falha de rede nunca é recusa de acesso.
    const offline = await createInstagramClient(() => Promise.reject(new Error('rede'))).conversations(SMOKE_IG_TOKEN)
    expect(!offline.ok && offline.denied).toBe(false)
  })

  it('lê as conversas e as mensagens (só as 20 mais recentes com detalhe) e o anexo só por https', async () => {
    const fetch: HttpFetch = (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/me/conversations')) {
        return Promise.resolve(answer(200, { data: [{ id: 'conv1', updated_time: '2026-11-20T10:14:00+0000', participants: { data: [{ username: SMOKE_IG_USERNAME, id: SMOKE_IG_USER_ID }, { username: MARINA.username, id: MARINA.id }] } }, { id: 'ruim/id', updated_time: '2026-11-20T10:14:00+0000' }] }))
      }
      return Promise.resolve(
        answer(200, {
          id: 'conv1',
          messages: {
            data: [
              { id: 'm3', created_time: '2026-11-20T10:14:00+0000', from: { username: MARINA.username, id: MARINA.id }, message: '<b>oi</b>', attachments: { data: [{ image_data: { url: 'https://cdn.example/a.jpg' } }, { video_data: { url: 'javascript:alert(1)' } }] } },
              { id: 'm2', created_time: '2026-11-20T09:58:00+0000', from: { username: SMOKE_IG_USERNAME, id: SMOKE_IG_USER_ID }, message: 'Olá' },
              { id: 'm1' },
            ],
          },
        }),
      )
    }
    const client = createInstagramClient(fetch)
    const result = await syncMessages(client, SMOKE_IG_TOKEN, ACCOUNT, emptySnapshot(), T0)
    expect(result.error).toBeNull()
    const state = messagesState(result.snapshot)
    expect(state.access).toBe('ok')
    expect(state.conversations).toHaveLength(1)
    expect(state.conversations[0]).toMatchObject({ id: 'conv1', participantId: MARINA.id, participantUsername: MARINA.username, unread: true, olderCount: 1, lastMessage: '<b>oi</b>' })
    const list = state.messages['conv1'] ?? []
    expect(list.map((item) => [item.id, item.fromMe])).toEqual([
      ['m2', true],
      ['m3', false],
    ])
    // O texto do contato fica como veio (a tela mostra como texto); o anexo fora de https fica sem link.
    expect(list[1]?.text).toBe('<b>oi</b>')
    expect(list[1]?.attachments).toEqual([
      { kind: 'imagem', url: 'https://cdn.example/a.jpg' },
      { kind: 'video', url: null },
    ])
  })
})

describe('mensagens no serviço das redes (contrato 74)', () => {
  let dir: string
  let fake: FakeInstagram
  let clock: number
  let locked: boolean
  let events: RedesMessagesPayload[]
  let service: RedesService
  let click: () => string
  let sendFailure: number | null = null

  const make = (): RedesService => {
    const guard = createEmailClickGuard(() => clock)
    click = () => {
      const token = crypto.randomUUID()
      guard.register(WINDOW, token)
      return token
    }
    return createRedesService({
      userData: dir,
      safeStorage,
      onState: () => undefined,
      now: () => clock,
      testMediaHost,
      isLocked: () => locked,
      clickGuard: guard,
      onMessages: (payload) => events.push(payload),
      // O "Enviar" que a Meta recusa com outro código (`sendFailure`), para a razão não virar a da janela.
      fetch: (url, init) => {
        const code = sendFailure
        if (code === null || init.method !== 'POST' || !new URL(url).pathname.endsWith('/messages')) return fake.fetch(url, init)
        sendFailure = null
        const text = JSON.stringify({ error: { message: 'erro do teste', code, fbtrace_id: 'teste' } })
        return Promise.resolve({ status: 400, header: () => 'application/json', text: () => Promise.resolve(text), bytes: () => Promise.resolve(new Uint8Array(Buffer.from(text))) })
      },
    })
  }
  const messageReads = (): number => fake.calls.filter((call) => call.method === 'GET' && /^\/v\d+\.\d+\/aWdf/.test(call.path)).length

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'redes-msg-'))
    clock = T0
    locked = false
    events = []
    fake = createFakeInstagram({ now: () => clock })
    service = make()
    await service.init()
    expect((await service.connect({ token: SMOKE_IG_TOKEN })).ok).toBe(true)
  })
  afterEach(() => {
    service.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('lê só as conversas que mudaram, marca como lida ao abrir e guarda num arquivo à parte', async () => {
    const marina = fake.addConversation(MARINA)
    const tiago = fake.addConversation(TIAGO)
    fake.addInbound(marina, 'Vocês fazem app para clínica também?', T0 - 10 * 60_000)
    fake.addInbound(tiago, 'Valeu pela indicação!', T0 - 3 * 24 * HOUR)
    const first = await service.refreshMessages({ accountId: SMOKE_IG_USER_ID })
    expect(first.conversations.map((item) => item.participantUsername)).toEqual([MARINA.username, TIAGO.username])
    expect(first.unread).toBe(2)
    expect(events.at(-1)?.unread).toBe(2)
    expect(messageReads()).toBe(2)

    // Nada mudou: nenhuma conversa é relida.
    await service.refreshMessages({ accountId: SMOKE_IG_USER_ID })
    expect(messageReads()).toBe(2)

    const read = await service.markConversationRead({ accountId: SMOKE_IG_USER_ID, conversationId: marina })
    expect(read.unread).toBe(1)
    expect(read.conversations.find((item) => item.id === marina)?.unread).toBe(false)

    // Mensagem nova: só a conversa dela é relida, e volta a não lida.
    clock += 60_000
    fake.addInbound(marina, 'Queria entender prazo e valores.')
    const after = await service.refreshMessages({ accountId: SMOKE_IG_USER_ID })
    expect(messageReads()).toBe(3)
    expect(after.unread).toBe(2)
    expect(after.messages[marina]?.map((item) => item.text)).toEqual(['Vocês fazem app para clínica também?', 'Queria entender prazo e valores.'])

    // O arquivo à parte; a fila de publicações regrava o da conta e as mensagens ficam.
    const file = join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.messages.json`)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain(SMOKE_IG_TOKEN)
    await service.refresh({ accountId: SMOKE_IG_USER_ID })
    service.dispose()
    service = make()
    await service.init()
    const reopened = await service.messagesState({ accountId: SMOKE_IG_USER_ID })
    expect(reopened.conversations).toHaveLength(2)
    expect(reopened.unread).toBe(2)
  })

  it('"Enviar" só com o token de clique; dentro da janela sai, acima de 1000 bytes não', async () => {
    const marina = fake.addConversation(MARINA)
    fake.addInbound(marina, 'Oi!', T0 - HOUR)
    await service.refreshMessages({ accountId: SMOKE_IG_USER_ID })
    const request = { accountId: SMOKE_IG_USER_ID, conversationId: marina, text: 'Oi, Marina! Fazemos sim.' }
    expect(await service.sendMessage(WINDOW, { ...request, clickToken: 'inventado' })).toEqual({ ok: false, error: REDES_MESSAGE_CLICK_MESSAGE })
    expect(await service.sendMessage(WINDOW + 1, { ...request, clickToken: click() })).toEqual({ ok: false, error: REDES_MESSAGE_CLICK_MESSAGE })
    expect(fake.sentMessages).toEqual([])
    expect(await service.sendMessage(WINDOW, { ...request, text: 'ç'.repeat(501), clickToken: click() })).toEqual({ ok: false, error: MESSAGE_TOO_LONG_MESSAGE })
    const sent = await service.sendMessage(WINDOW, { ...request, clickToken: click() })
    expect(sent.ok).toBe(true)
    expect(fake.sentMessages).toEqual([{ recipientId: MARINA.id, text: 'Oi, Marina! Fazemos sim.' }])
    if (!sent.ok) return
    expect(sent.message.fromMe).toBe(true)
    expect(sent.payload.messages[marina]?.at(-1)?.text).toBe('Oi, Marina! Fazemos sim.')
    expect(sent.payload.unread).toBe(0)
    // O mesmo token não vale duas vezes.
    const token = click()
    await service.sendMessage(WINDOW, { ...request, clickToken: token })
    expect(await service.sendMessage(WINDOW, { ...request, clickToken: token })).toEqual({ ok: false, error: REDES_MESSAGE_CLICK_MESSAGE })
    // A leitura seguinte traz a de verdade sem duplicar.
    clock += 60_000
    const after = await service.refreshMessages({ accountId: SMOKE_IG_USER_ID })
    expect(after.messages[marina]?.filter((item) => item.text === 'Oi, Marina! Fazemos sim.')).toHaveLength(2)
  })

  it('fora da janela de 24 h tenta e, com a recusa da Meta, devolve a razão da janela', async () => {
    const tiago = fake.addConversation(TIAGO)
    fake.addInbound(tiago, 'Valeu pela indicação!', T0 - 25 * HOUR)
    const state = await service.refreshMessages({ accountId: SMOKE_IG_USER_ID })
    expect(outsideMessageWindow(state.conversations[0]?.lastInboundAt ?? null, T0)).toBe(true)
    const result = await service.sendMessage(WINDOW, { accountId: SMOKE_IG_USER_ID, conversationId: tiago, text: 'Deu certo com o Studio Ponto?', clickToken: click() })
    expect(result).toEqual({ ok: false, error: MESSAGE_WINDOW_REFUSED_MESSAGE })
    expect(fake.calls.some((call) => call.method === 'POST' && call.path.endsWith('/messages'))).toBe(true)
    // Fora da janela, mas outra recusa (limite de chamadas): a razão é a da Meta, não a da janela.
    sendFailure = 4
    const limited = await service.sendMessage(WINDOW, { accountId: SMOKE_IG_USER_ID, conversationId: tiago, text: 'De novo', clickToken: click() })
    expect(limited).toEqual({ ok: false, error: 'Limite de chamadas do Instagram; tente mais tarde' })
  })

  it('acesso negado: `denied` com o resumo e nenhum não lido; liberado de novo, volta', async () => {
    const marina = fake.addConversation(MARINA)
    fake.addInbound(marina, 'Oi!', T0 - HOUR)
    expect((await service.refreshMessages({ accountId: SMOKE_IG_USER_ID })).unread).toBe(1)
    fake.setMessagingAccess(false)
    const denied = await service.refreshMessages({ accountId: SMOKE_IG_USER_ID })
    expect(denied).toMatchObject({ access: 'denied', unread: 0, error: null })
    expect(denied.accessError).toContain(MESSAGES_DENIED_SUMMARY)
    fake.setMessagingAccess(true)
    expect(await service.refreshMessages({ accountId: SMOKE_IG_USER_ID })).toMatchObject({ access: 'ok', accessError: null, unread: 1 })
  })

  it('o polling lê as contas conectadas, nada bloqueado; "Remover" apaga o arquivo', async () => {
    const marina = fake.addConversation(MARINA)
    fake.addInbound(marina, 'Oi!', T0 - HOUR)
    locked = true
    await service.poll()
    expect(fake.calls.some((call) => call.path.endsWith('/me/conversations'))).toBe(false)
    locked = false
    await service.poll()
    expect(events.at(-1)?.unread).toBe(1)
    const file = join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.messages.json`)
    expect(existsSync(file)).toBe(true)
    expect((await service.remove({ accountId: SMOKE_IG_USER_ID })).ok).toBe(true)
    expect(existsSync(file)).toBe(false)
    expect((await service.messagesState({ accountId: SMOKE_IG_USER_ID })).conversations).toEqual([])
  })
})
