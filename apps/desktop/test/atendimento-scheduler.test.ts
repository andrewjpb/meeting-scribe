import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAtendimentoScheduler, GLOBAL_MAX_PER_HOUR, isWithinHours, type SchedulerDeps } from '../src/main/whatsapp/atendimento/scheduler'
import { ATENDIMENTO_BINDING_DEFAULTS, type AtendimentoBinding } from '../src/shared/atendimento'

const MINUTE = 60_000
/** Segunda, 23/11/2026, 10:00 na hora local. */
const START = new Date(2026, 10, 23, 10, 0).getTime()

const binding = (overrides: Partial<AtendimentoBinding> = {}): AtendimentoBinding => ({
  ...ATENDIMENTO_BINDING_DEFAULTS,
  chatId: '5511999990000@c.us',
  agentId: 'agente-1',
  updatedAt: new Date(START).toISOString(),
  ...overrides,
})

/** Relógio e temporizador falsos: `advance` dispara os temporizadores vencidos em ordem de horário. */
function fakeDeps(randomValue = 0) {
  let now = START
  let nextId = 1
  const timers = new Map<number, { fn: () => void; at: number; ms: number }>()
  const due: { chatId: string; ids: string[]; at: number }[] = []
  const created: number[] = []
  const cleared: number[] = []
  const random = { value: randomValue }
  const deps: SchedulerDeps = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++
      timers.set(id, { fn, at: now + ms, ms })
      created.push(ms)
      return id
    },
    clearTimer: (handle) => {
      cleared.push(handle as number)
      timers.delete(handle as number)
    },
    random: () => random.value,
    onDue: (chatId, ids) => due.push({ chatId, ids, at: now }),
  }
  const advance = (ms: number): void => {
    const target = now + ms
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0])
      now = next[1].at
      next[1].fn()
    }
    now = target
  }
  return { deps, advance, timers, due, created, cleared, random, now: () => now }
}

const incoming = (messageId: string, overrides: Partial<AtendimentoBinding> = {}, pausedAll = false, chatId = '5511999990000@c.us') => ({
  chatId,
  messageId,
  binding: binding({ chatId, ...overrides }),
  pausedAll,
})

describe('agendador do atendimento (contrato 140)', () => {
  it('CA1: sorteia o atraso entre o mínimo e o máximo', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    expect(scheduler.onIncoming(incoming('m1'))).toEqual({ status: 'scheduled', dueAt: START + 2 * MINUTE })

    const high = fakeDeps(0.999999)
    const result = createAtendimentoScheduler(high.deps).onIncoming(incoming('m1'))
    expect(result.status).toBe('scheduled')
    if (result.status !== 'scheduled') return
    expect(result.dueAt).toBeLessThan(START + 5 * MINUTE)
    expect(result.dueAt).toBeGreaterThan(START + 4 * MINUTE)

    const fixed = fakeDeps(0.7)
    expect(createAtendimentoScheduler(fixed.deps).onIncoming(incoming('m1', { delayMinMinutes: 3, delayMaxMinutes: 3 }))).toEqual({ status: 'scheduled', dueAt: START + 3 * MINUTE })
  })

  it('CA2: atraso zero passa pelo temporizador com 0 ms, nunca de forma síncrona', () => {
    const fake = fakeDeps(0.5)
    const scheduler = createAtendimentoScheduler(fake.deps)
    expect(scheduler.onIncoming(incoming('m1', { delayMinMinutes: 0, delayMaxMinutes: 0 }))).toEqual({ status: 'scheduled', dueAt: START })
    expect(fake.due).toEqual([])
    expect(fake.created).toEqual([0])
    fake.advance(0)
    expect(fake.due).toEqual([{ chatId: '5511999990000@c.us', ids: ['m1'], at: START }])
  })

  it('CA3: o disparo entrega todos os ids pendentes, em ordem, uma vez, e limpa a pendência', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    scheduler.onIncoming(incoming('m1'))
    fake.advance(30_000)
    scheduler.onIncoming(incoming('m2'))
    expect(scheduler.pending('5511999990000@c.us')?.messageIds).toEqual(['m1', 'm2'])
    fake.advance(10 * MINUTE)
    expect(fake.due).toEqual([{ chatId: '5511999990000@c.us', ids: ['m1', 'm2'], at: START + 30_000 + 2 * MINUTE }])
    expect(scheduler.pending('5511999990000@c.us')).toBeNull()
  })

  it('CA4: outra mensagem limpa o temporizador anterior e sorteia de novo a partir de agora', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    scheduler.onIncoming(incoming('m1'))
    expect(fake.timers.size).toBe(1)
    const [firstHandle] = fake.timers.keys()
    fake.advance(MINUTE)
    expect(scheduler.onIncoming(incoming('m2'))).toEqual({ status: 'scheduled', dueAt: START + 3 * MINUTE })
    expect(fake.cleared).toEqual([firstHandle])
    expect(fake.timers.size).toBe(1)
    expect(scheduler.pending('5511999990000@c.us')).toEqual({ dueAt: START + 3 * MINUTE, messageIds: ['m1', 'm2'] })
  })

  it('CA5: o reagendamento não passa de 2 × delayMax desde a primeira mensagem', () => {
    const fake = fakeDeps(0.999999)
    const scheduler = createAtendimentoScheduler(fake.deps)
    const ids: string[] = []
    for (let minute = 0; minute < 15 && fake.due.length === 0; minute++) {
      const id = `m${minute}`
      ids.push(id)
      const result = scheduler.onIncoming(incoming(id))
      expect(result.status).toBe('scheduled')
      if (result.status === 'scheduled') expect(result.dueAt).toBeLessThanOrEqual(START + 10 * MINUTE)
      fake.advance(MINUTE)
    }
    expect(fake.due).toHaveLength(1)
    expect(fake.due[0]?.at).toBe(START + 10 * MINUTE)
    expect(fake.due[0]?.ids).toEqual(ids)

    const zero = fakeDeps(0.5)
    const immediate = createAtendimentoScheduler(zero.deps)
    expect(immediate.onIncoming(incoming('z1', { delayMinMinutes: 0, delayMaxMinutes: 0 }))).toEqual({ status: 'scheduled', dueAt: START })
    expect(immediate.onIncoming(incoming('z2', { delayMinMinutes: 0, delayMaxMinutes: 0 }))).toEqual({ status: 'scheduled', dueAt: START })
    zero.advance(0)
    expect(zero.due).toEqual([{ chatId: '5511999990000@c.us', ids: ['z1', 'z2'], at: START }])
  })

  it('CA6: conversas diferentes têm filas e temporizadores independentes', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    scheduler.onIncoming(incoming('a1', {}, false, 'a@c.us'))
    fake.advance(MINUTE)
    scheduler.onIncoming(incoming('b1', { delayMinMinutes: 5, delayMaxMinutes: 5 }, false, 'b@c.us'))
    expect(fake.cleared).toEqual([])
    expect(fake.timers.size).toBe(2)
    fake.advance(MINUTE)
    expect(fake.due).toEqual([{ chatId: 'a@c.us', ids: ['a1'], at: START + 2 * MINUTE }])
    expect(scheduler.pending('b@c.us')).toEqual({ dueAt: START + 6 * MINUTE, messageIds: ['b1'] })
    fake.advance(10 * MINUTE)
    expect(fake.due.map((entry) => entry.chatId)).toEqual(['a@c.us', 'b@c.us'])
  })

  it('CA7: desligado, pausa geral, pausa da conversa e grupo não agendam', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    expect(scheduler.onIncoming(incoming('m1', { enabled: false }))).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(scheduler.onIncoming(incoming('m2', {}, true))).toEqual({ status: 'skipped', reason: 'paused-all' })
    expect(scheduler.onIncoming(incoming('m3', { pausedUntil: new Date(START + MINUTE).toISOString() }))).toEqual({ status: 'skipped', reason: 'paused' })
    expect(scheduler.onIncoming(incoming('m4', {}, false, '120363000000000000@g.us'))).toEqual({ status: 'skipped', reason: 'group' })
    expect(fake.created).toEqual([])
    expect(scheduler.onIncoming(incoming('m5', { pausedUntil: new Date(START - MINUTE).toISOString() })).status).toBe('scheduled')
    expect(fake.created).toHaveLength(1)
  })

  it('CA8: horário de atendimento, com fim exclusivo e faixa que cruza a meia-noite', () => {
    expect(isWithinHours(null, new Date(2026, 10, 28, 3, 0))).toBe(true)
    const weekdays = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }
    expect(isWithinHours(weekdays, new Date(2026, 10, 23, 9, 0))).toBe(true)
    expect(isWithinHours(weekdays, new Date(2026, 10, 23, 17, 59))).toBe(true)
    expect(isWithinHours(weekdays, new Date(2026, 10, 23, 18, 0))).toBe(false)
    expect(isWithinHours(weekdays, new Date(2026, 10, 28, 10, 0))).toBe(false)
    const night = { days: [5], start: '22:00', end: '06:00' }
    expect(isWithinHours(night, new Date(2026, 10, 27, 23, 0))).toBe(true)
    expect(isWithinHours(night, new Date(2026, 10, 28, 5, 0))).toBe(true)
    expect(isWithinHours(night, new Date(2026, 10, 28, 23, 0))).toBe(false)
    expect(isWithinHours(night, new Date(2026, 10, 27, 5, 0))).toBe(false)
  })

  it('CA9: mensagem fora do horário não agenda', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    // START é segunda às 10:00: fora de uma faixa das 12:00 às 18:00.
    expect(scheduler.onIncoming(incoming('m1', { hours: { days: [1], start: '12:00', end: '18:00' } }))).toEqual({ status: 'skipped', reason: 'out-of-hours' })
    expect(fake.created).toEqual([])
  })

  it('CA10: limite por conversa e geral em janela deslizante de 60 min', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    for (let i = 0; i < 6; i++) {
      expect(scheduler.canSend('a@c.us', 6)).toBe(true)
      scheduler.recordSent('a@c.us')
      fake.advance(5 * MINUTE)
    }
    expect(scheduler.canSend('a@c.us', 6)).toBe(false)
    expect(scheduler.canSend('b@c.us', 6)).toBe(true)
    fake.advance(60 * MINUTE - 30 * MINUTE - 1)
    expect(scheduler.canSend('a@c.us', 6)).toBe(false)
    fake.advance(1)
    expect(scheduler.canSend('a@c.us', 6)).toBe(true)

    const global = fakeDeps(0)
    const all = createAtendimentoScheduler(global.deps)
    for (let i = 0; i < GLOBAL_MAX_PER_HOUR; i++) {
      all.recordSent(`chat-${i % 10}@c.us`)
      global.advance(MINUTE)
    }
    expect(GLOBAL_MAX_PER_HOUR).toBe(30)
    expect(all.canSend('chat-0@c.us', 30)).toBe(false)
    expect(all.canSend('outra@c.us', 30)).toBe(false)
    global.advance(30 * MINUTE)
    expect(all.canSend('outra@c.us', 30)).toBe(true)
  })

  it('CA11: sem cota na hora, a mensagem não agenda', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    scheduler.recordSent('5511999990000@c.us')
    expect(scheduler.onIncoming(incoming('m1', { maxPerHour: 1 }))).toEqual({ status: 'skipped', reason: 'rate-limited' })
    expect(fake.created).toEqual([])
  })

  it('CA12: cancelar devolve os ids pendentes; cancelar tudo devolve as conversas', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    expect(scheduler.cancel('a@c.us')).toEqual([])
    scheduler.onIncoming(incoming('a1', {}, false, 'a@c.us'))
    scheduler.onIncoming(incoming('a2', {}, false, 'a@c.us'))
    expect(scheduler.cancel('a@c.us')).toEqual(['a1', 'a2'])
    expect(scheduler.pending('a@c.us')).toBeNull()
    expect(fake.timers.size).toBe(0)

    scheduler.onIncoming(incoming('b1', {}, false, 'b@c.us'))
    scheduler.onIncoming(incoming('c1', {}, false, 'c@c.us'))
    expect(scheduler.cancelAll().sort()).toEqual(['b@c.us', 'c@c.us'])
    expect(scheduler.cancelAll()).toEqual([])
    expect(fake.timers.size).toBe(0)
    fake.advance(60 * MINUTE)
    expect(fake.due).toEqual([])
  })

  it('CA13: depois de dispose nenhum onDue é chamado', () => {
    const fake = fakeDeps(0)
    const scheduler = createAtendimentoScheduler(fake.deps)
    scheduler.onIncoming(incoming('a1', {}, false, 'a@c.us'))
    scheduler.onIncoming(incoming('b1', {}, false, 'b@c.us'))
    const handles = [...fake.timers.keys()]
    scheduler.dispose()
    expect(fake.cleared.sort()).toEqual(handles.sort())
    expect(fake.timers.size).toBe(0)
    // Mesmo um temporizador que o ambiente deixasse escapar não chega ao `onDue`.
    const leaked = fakeDeps(0)
    const other = createAtendimentoScheduler({ ...leaked.deps, clearTimer: () => {} })
    other.onIncoming(incoming('x1'))
    other.dispose()
    leaked.advance(60 * MINUTE)
    expect(leaked.due).toEqual([])
    fake.advance(60 * MINUTE)
    expect(fake.due).toEqual([])
  })

  it('CA14: o módulo é puro e o atendimento não vaza para agentes, agendamentos e bandeja', () => {
    const root = join(import.meta.dirname, '..', 'src')
    const text = readFileSync(join(root, 'main', 'whatsapp', 'atendimento', 'scheduler.ts'), 'utf8')
    const imports = [...text.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')
    expect(imports.length).toBeGreaterThan(0)
    for (const source of imports) {
      expect(source).not.toMatch(/^electron$|^(node:)?fs(\/promises)?$/)
      expect(source).not.toMatch(/store/)
      // Fora da própria pasta, nada de `main/whatsapp`: só `../../../shared/...` ou `./...`.
      expect(source.startsWith('./') || source.startsWith('../../../shared/')).toBe(true)
    }
    expect(text).not.toMatch(/\bDate\.now\b|\bsetTimeout\b|\bsetInterval\b|\bMath\.random\b/)

    const files = (folder: string): string[] =>
      readdirSync(folder).flatMap((name) => {
        const path = join(folder, name)
        return statSync(path).isDirectory() ? files(path) : [path]
      })
    const sources = ['main/agents', 'main/schedules', 'main/tray'].flatMap((folder) => files(join(root, folder)))
    expect(sources.length).toBeGreaterThan(3)
    for (const file of sources) expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"][^'"]*whatsapp\/atendimento[^'"]*['"]/)
  })
})
