// Contrato 78: o registro dos eventos que o Assistente pôs no Calendário do Mac (`chat-events.json`).
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHAT_EVENTS_FILE, CHAT_EVENTS_MAX, createChatEventsStore, type ChatEventRecord } from '../src/main/chat/events-store'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chat-events-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const record = (n: number, patch: Partial<ChatEventRecord> = {}): ChatEventRecord => ({
  actionId: `a${n}`,
  chatId: 'c1',
  calendarId: 'cal-pessoal',
  eventIdentifier: `ev-${n}`,
  calendarItemIdentifier: `item-${n}`,
  externalIdentifier: null,
  title: `Evento ${n}`,
  start: '2026-11-20T23:00:00.000Z',
  end: '2026-11-21T00:00:00.000Z',
  allDay: false,
  createdAt: '2026-11-20T12:00:00.000Z',
  ...patch,
})

describe('chat-events.json', () => {
  it('grava cada evento com os ids do EventKit, 0600, versão 1; vazio sem arquivo', async () => {
    const store = createChatEventsStore(dir)
    expect(await store.list()).toEqual([])
    expect(existsSync(join(dir, CHAT_EVENTS_FILE))).toBe(false)
    await Promise.all([store.add(record(1)), store.add(record(2, { eventIdentifier: null }))])
    expect((await store.list()).map((item) => item.actionId)).toEqual(['a1', 'a2'])
    const file = join(dir, CHAT_EVENTS_FILE)
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { version: number; events: ChatEventRecord[] }
    expect(raw.version).toBe(1)
    expect(raw.events[1]).toEqual(record(2, { eventIdentifier: null }))
    // Outro processo lê o mesmo arquivo.
    expect(await createChatEventsStore(dir).list()).toHaveLength(2)
  })

  it('recusa registro fora do esquema; linha estragada sai na leitura', async () => {
    const store = createChatEventsStore(dir)
    await expect(store.add({ ...record(1), calendarItemIdentifier: '' })).rejects.toThrow()
    await expect(store.add({ ...record(1), extra: 1 } as ChatEventRecord)).rejects.toThrow()
    const file = join(dir, CHAT_EVENTS_FILE)
    writeFileSync(file, JSON.stringify({ version: 1, events: [record(1), { actionId: 'x' }] }))
    expect((await store.list()).map((item) => item.actionId)).toEqual(['a1'])
  })

  it('arquivo ilegível ou de outra versão não é sobrescrito: vira chat-events.<instante>.bad e o registro começa de novo', async () => {
    const file = join(dir, CHAT_EVENTS_FILE)
    let clock = 1000
    const store = createChatEventsStore(dir, { now: () => clock })
    writeFileSync(file, '{ não é json')
    await store.add(record(3))
    expect((await store.list()).map((item) => item.actionId)).toEqual(['a3'])
    expect(readFileSync(join(dir, 'chat-events.1000.bad'), 'utf8')).toBe('{ não é json')
    expect((statSync(join(dir, 'chat-events.1000.bad')).mode & 0o777).toString(8)).toBe('600')
    clock = 2000
    const future = JSON.stringify({ version: 2, events: [record(9)] })
    writeFileSync(file, future)
    expect(await store.list()).toEqual([])
    expect(readFileSync(join(dir, 'chat-events.2000.bad'), 'utf8')).toBe(future)
    expect(existsSync(file)).toBe(false)
    await store.add(record(4))
    expect((await store.list()).map((item) => item.actionId)).toEqual(['a4'])
    expect(readdirSync(dir).sort()).toEqual(['chat-events.1000.bad', 'chat-events.2000.bad', CHAT_EVENTS_FILE])
  })

  it(`passou de ${CHAT_EVENTS_MAX}, saem os mais antigos`, async () => {
    const file = join(dir, CHAT_EVENTS_FILE)
    writeFileSync(file, JSON.stringify({ version: 1, events: Array.from({ length: CHAT_EVENTS_MAX }, (_, n) => record(n)) }))
    const store = createChatEventsStore(dir)
    await store.add(record(CHAT_EVENTS_MAX))
    const list = await store.list()
    expect(list).toHaveLength(CHAT_EVENTS_MAX)
    expect(list[0]?.actionId).toBe('a1')
    expect(list.at(-1)?.actionId).toBe(`a${CHAT_EVENTS_MAX}`)
  })
})
