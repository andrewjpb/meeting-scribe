import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { clockLabel, type CalendarUpcoming } from '../src/shared/calendar'
import {
  createTrayController,
  TRAY_IDS,
  TRAY_REBUILD_DEBOUNCE_MS,
  TRAY_TITLE_TICK_MS,
  todayMeetings,
  trayJoinUrl,
  trayMenuTemplate,
  trayTitle,
  type TrayControllerDeps,
  type TrayHandlers,
  type TrayLike,
  type TrayMeeting,
  type TrayState,
} from '../src/main/tray/menu'

const handlers = (calls: string[]): TrayHandlers => ({
  open: () => calls.push('open'),
  newRecording: () => calls.push('newRecording'),
  openRecording: () => calls.push('openRecording'),
  stopRecording: () => calls.push('stopRecording'),
  recordEvent: (key) => calls.push(`recordEvent:${key}`),
  joinEvent: (key) => calls.push(`joinEvent:${key}`),
  openMeeting: (id) => calls.push(`openMeeting:${id}`),
  toggleMeetingPrompt: () => calls.push('toggleMeetingPrompt'),
  openPlugins: () => calls.push('openPlugins'),
  lock: () => calls.push('lock'),
  automations: () => calls.push('automations'),
  togglePause: () => calls.push('togglePause'),
  quit: () => calls.push('quit'),
})

const meeting = (index: number, patch: Partial<TrayMeeting> = {}): TrayMeeting => ({ key: `google:primary:e${index}`, title: `Reunião ${index}`, time: `1${index}:00`, happening: false, hasJoinUrl: true, ...patch })

const state = (patch: Partial<TrayState> = {}): TrayState => ({
  brandName: 'LAP Reuniões',
  locked: false,
  canLock: true,
  recording: null,
  paused: false,
  next: [{ name: 'Resumo da semana', when: 'sex 17:00' }],
  meetings: [],
  recent: [],
  meetingPrompt: true,
  plugins: [],
  ...patch,
})

type Template = MenuItemConstructorOptions[]
const labels = (template: Template): string[] => template.map((item) => (item.type === 'separator' ? '—' : (item.label ?? '')))
const sub = (item: MenuItemConstructorOptions | undefined): Template => (Array.isArray(item?.submenu) ? item.submenu : [])
const byId = (template: Template, id: string): MenuItemConstructorOptions | undefined => {
  for (const item of template) {
    if (item.id === id) return item
    const found = byId(sub(item), id)
    if (found) return found
  }
  return undefined
}
const click = (item: MenuItemConstructorOptions | undefined): void => (item?.click as (() => void) | undefined)?.()

describe('barra de menus melhorada (contrato 50)', () => {
  it('a ordem final, desbloqueado e sem gravação', () => {
    const template = trayMenuTemplate(
      state({ meetings: [meeting(0, { title: 'Daily', time: '10:00', happening: true }), meeting(1, { title: 'Planejamento', time: '14:00' })], recent: [{ id: 'm1', title: 'Ontem' }], plugins: [{ name: 'Meet', connected: true }] }),
      handlers([]),
    )
    expect(labels(template)).toEqual([
      'Abrir LAP Reuniões',
      'Nova gravação',
      '—',
      'Agora · Daily (10:00)',
      'Planejamento · 14:00',
      '—',
      'Recentes',
      '—',
      'Avisar quando uma reunião começar',
      'Meet: conectado',
      'Automações',
      'Bloquear',
      '—',
      'Sair',
    ])
  })

  it('gravando: "Gravando · 12:03 — <título>", "Abrir gravação" e "Encerrar"; "Gravar agora" desabilitado', () => {
    const calls: string[] = []
    const template = trayMenuTemplate(state({ recording: { elapsedMs: 723_000, title: 'Daily do time' }, meetings: [meeting(0)] }), handlers(calls))
    expect(labels(template).slice(0, 4)).toEqual(['Abrir LAP Reuniões', 'Gravando · 12:03 — Daily do time', 'Abrir gravação', 'Encerrar'])
    expect(byId(template, TRAY_IDS.newRecording)).toBeUndefined()
    expect(byId(template, TRAY_IDS.recording)?.enabled).toBe(false)
    expect(byId(template, `${TRAY_IDS.event}-0-record`)?.enabled).toBe(false)
    click(byId(template, TRAY_IDS.openRecording))
    click(byId(template, TRAY_IDS.stopRecording))
    expect(calls).toEqual(['openRecording', 'stopRecording'])
  })

  it('agenda: 0 reuniões mostra "Nenhuma reunião hoje" desabilitado; 1 vira submenu; 5 cortam em 3', () => {
    const none = trayMenuTemplate(state(), handlers([]))
    expect(byId(none, TRAY_IDS.noEvents)).toMatchObject({ label: 'Nenhuma reunião hoje', enabled: false })

    const calls: string[] = []
    const one = trayMenuTemplate(state({ meetings: [meeting(0)] }), handlers(calls))
    const item = byId(one, `${TRAY_IDS.event}-0`)
    expect(item?.label).toBe('Reunião 0 · 10:00')
    expect(labels(sub(item))).toEqual(['Gravar agora', 'Entrar na reunião'])
    for (const entry of sub(item)) click(entry)
    expect(calls).toEqual(['recordEvent:google:primary:e0', 'joinEvent:google:primary:e0'])
    expect(byId(one, TRAY_IDS.noEvents)).toBeUndefined()

    const five = trayMenuTemplate(state({ meetings: [0, 1, 2, 3, 4].map((index) => meeting(index)) }), handlers([]))
    expect(labels(five).filter((label) => label.startsWith('Reunião '))).toEqual(['Reunião 0 · 10:00', 'Reunião 1 · 11:00', 'Reunião 2 · 12:00'])
  })

  it('"Agora" marca a que está acontecendo; título cortado em 40; sem link não há "Entrar na reunião"', () => {
    const long = 'Uma reunião com um título comprido demais para caber no menu'
    const template = trayMenuTemplate(state({ meetings: [meeting(0, { title: long, time: '09:30', happening: true, hasJoinUrl: false })] }), handlers([]))
    const item = byId(template, `${TRAY_IDS.event}-0`)
    expect(item?.label).toBe(`Agora · ${trayTitle(long)} (09:30)`)
    expect(trayTitle(long)).toHaveLength(40)
    expect(trayTitle(long).endsWith('…')).toBe(true)
    expect(trayTitle('Linha\num  e  dois')).toBe('Linha um e dois')
    expect(labels(sub(item))).toEqual(['Gravar agora'])
  })

  it('"Recentes": as 3 mais recentes, cada uma abre o detalhe; sem nenhuma, uma linha desabilitada', () => {
    const calls: string[] = []
    const template = trayMenuTemplate(state({ recent: ['a', 'b', 'c', 'd'].map((id) => ({ id, title: `Reunião ${id}` })) }), handlers(calls))
    const recent = sub(byId(template, TRAY_IDS.recent))
    expect(labels(recent)).toEqual(['Reunião a', 'Reunião b', 'Reunião c'])
    for (const entry of recent) click(entry)
    expect(calls).toEqual(['openMeeting:a', 'openMeeting:b', 'openMeeting:c'])
    const empty = sub(byId(trayMenuTemplate(state(), handlers([])), TRAY_IDS.recent))
    expect(empty).toEqual([expect.objectContaining({ label: 'Nenhuma reunião gravada', enabled: false })])
  })

  it('o aviso de reunião é uma marca que reflete a configuração e alterna ao clicar', () => {
    const calls: string[] = []
    const on = byId(trayMenuTemplate(state({ meetingPrompt: true }), handlers(calls)), TRAY_IDS.meetingPrompt)
    const off = byId(trayMenuTemplate(state({ meetingPrompt: false }), handlers(calls)), TRAY_IDS.meetingPrompt)
    expect(on).toMatchObject({ type: 'checkbox', checked: true })
    expect(off).toMatchObject({ type: 'checkbox', checked: false })
    click(off)
    expect(calls).toEqual(['toggleMeetingPrompt'])
  })

  it('plugins: só os ligados; nenhum ligado, nenhuma linha; o clique leva a Configurações › Plugins', () => {
    const calls: string[] = []
    const both = trayMenuTemplate(state({ plugins: [{ name: 'Meet', connected: true }, { name: 'Navegador', connected: false }] }), handlers(calls))
    expect(byId(both, TRAY_IDS.plugins)?.label).toBe('Meet: conectado · Navegador: desconectado')
    click(byId(both, TRAY_IDS.plugins))
    expect(calls).toEqual(['openPlugins'])
    expect(byId(trayMenuTemplate(state({ plugins: [{ name: 'Navegador', connected: true }] }), handlers([])), TRAY_IDS.plugins)?.label).toBe('Navegador: conectado')
    expect(byId(trayMenuTemplate(state(), handlers([])), TRAY_IDS.plugins)).toBeUndefined()
  })

  it('bloqueado: só "Abrir", "Bloqueado" e "Sair"; nenhum título de reunião, evento ou recente, nem gravando', () => {
    const template = trayMenuTemplate(
      state({
        locked: true,
        recording: { elapsedMs: 60_000, title: 'Título secreto da gravação' },
        meetings: [meeting(0, { title: 'Evento secreto da agenda', happening: true })],
        recent: [{ id: 'm1', title: 'Recente secreta' }],
        plugins: [{ name: 'Meet', connected: true }],
      }),
      handlers([]),
    )
    expect(labels(template)).toEqual(['Abrir', 'Bloqueado', '—', 'Sair'])
    const text = JSON.stringify(template)
    for (const secret of ['secreto', 'secreta', 'Resumo da semana', 'Gravando', 'Meet']) expect(text).not.toContain(secret)
  })

  it('reuniões de hoje: começa hoje ou está acontecendo; amanhã fica de fora', () => {
    const now = new Date(2026, 10, 19, 9, 0).getTime()
    const at = (hours: number, day = 19): string => new Date(2026, 10, day, hours, 0).toISOString()
    const event = (id: string, start: string, happening: boolean, hasJoinUrl = true): CalendarUpcoming => ({ key: id, provider: 'google', title: id, start, end: start, attendees: [], hasJoinUrl, happening })
    const result = todayMeetings([event('ontem-ainda', at(23, 18), true), event('hoje', at(14), false, false), event('amanha', at(8, 20), false)], now)
    expect(result).toEqual([
      { key: 'ontem-ainda', title: 'ontem-ainda', time: clockLabel(at(23, 18)), happening: true, hasJoinUrl: true },
      { key: 'hoje', title: 'hoje', time: clockLabel(at(14)), happening: false, hasJoinUrl: false },
    ])
  })

  it('"Entrar na reunião" só abre http/https', () => {
    expect(trayJoinUrl('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij')
    expect(trayJoinUrl('http://zoom.us/j/123')).toBe('http://zoom.us/j/123')
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'zoommtg://zoom.us/join?confno=1', 'mailto:a@b.c', 'não é link', '', null, undefined, 42, `https://x.com/${'a'.repeat(2100)}`]) expect(trayJoinUrl(bad)).toBeNull()
  })
})

/** Relógios na mão: o teste avança o tempo e dispara o que venceu. */
function fakeTimers(): { timers: NonNullable<TrayControllerDeps['timers']>; advance: (ms: number) => void; intervals: () => number } {
  let now = 0
  let nextId = 0
  const timeouts = new Map<number, { at: number; fn: () => void }>()
  const intervals = new Map<number, { at: number; every: number; fn: () => void }>()
  return {
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++nextId
        timeouts.set(id, { at: now + ms, fn })
        return id
      },
      clearTimeout: (id) => void timeouts.delete(id as number),
      setInterval: (fn, ms) => {
        const id = ++nextId
        intervals.set(id, { at: now + ms, every: ms, fn })
        return id
      },
      clearInterval: (id) => void intervals.delete(id as number),
    },
    advance: (ms) => {
      const end = now + ms
      for (;;) {
        const due = [...[...timeouts].map(([id, entry]) => ({ id, at: entry.at, kind: 'timeout' as const })), ...[...intervals].map(([id, entry]) => ({ id, at: entry.at, kind: 'interval' as const }))]
          .filter((entry) => entry.at <= end)
          .sort((a, b) => a.at - b.at)[0]
        if (!due) break
        now = due.at
        if (due.kind === 'timeout') {
          const entry = timeouts.get(due.id)
          timeouts.delete(due.id)
          entry?.fn()
        } else {
          const entry = intervals.get(due.id)
          if (entry) {
            entry.at += entry.every
            entry.fn()
          }
        }
      }
      now = end
    },
    intervals: () => intervals.size,
  }
}

describe('controlador do ícone (contrato 50)', () => {
  const setup = (initial: Partial<TrayState> = {}) => {
    let current = state(initial)
    const clock = fakeTimers()
    const menus: Template[] = []
    const titles: string[] = []
    const relabels: string[] = []
    let prepares = 0
    const tray: TrayLike = {
      setImage: () => undefined,
      setToolTip: () => undefined,
      setContextMenu: (menu) => menus.push(menu as Template),
      setTitle: (title) => titles.push(title),
      destroy: () => undefined,
    }
    const controller = createTrayController({
      create: () => tray,
      image: (icon) => icon,
      buildMenu: (template) => template,
      setLabel: (_menu, id, label) => relabels.push(`${id}=${label}`),
      prepare: async () => {
        prepares++
      },
      state: () => current,
      running: () => false,
      handlers: handlers([]),
      timers: clock.timers,
    })
    return {
      controller,
      clock,
      menus,
      titles,
      relabels,
      prepares: () => prepares,
      set: (patch: Partial<TrayState>) => (current = { ...current, ...patch }),
    }
  }
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('o clique é do macOS: o menu vai preso ao ícone; mudanças seguidas remontam uma vez, depois de 500 ms', async () => {
    const t = setup()
    await flush()
    expect(t.menus).toHaveLength(1)
    t.set({ meetings: [meeting(0)] })
    t.controller.refresh()
    t.controller.refresh()
    t.clock.advance(TRAY_REBUILD_DEBOUNCE_MS - 1)
    await flush()
    expect(t.menus).toHaveLength(1)
    t.controller.refresh()
    t.clock.advance(1)
    await flush()
    expect(t.menus).toHaveLength(2)
    expect(labels(t.menus[1] ?? [])).toContain('Reunião 0 · 10:00')
    expect(t.prepares()).toBe(2)
    t.controller.dispose()
  })

  it('bloquear troca o menu na hora, sem a folga e sem ler nada', async () => {
    const t = setup({ meetings: [meeting(0, { title: 'Segredo' })] })
    await flush()
    const prepares = t.prepares()
    t.set({ locked: true })
    t.controller.refresh()
    expect(labels(t.menus.at(-1) ?? [])).toEqual(['Abrir', 'Bloqueado', '—', 'Sair'])
    expect(t.prepares()).toBe(prepares)
    t.controller.dispose()
  })

  it('gravando: o tempo ao lado do ícone a cada 1 s, sem remontar o menu; acabou ou bloqueou, o texto some e o relógio para', async () => {
    const t = setup()
    await flush()
    t.set({ recording: { elapsedMs: 5_000, title: 'Daily' } })
    t.controller.refresh()
    expect(t.titles).toEqual([' 00:05'])
    t.clock.advance(TRAY_REBUILD_DEBOUNCE_MS)
    await flush()
    const built = t.menus.length
    t.set({ recording: { elapsedMs: 6_000, title: 'Daily' } })
    t.clock.advance(TRAY_TITLE_TICK_MS)
    t.set({ recording: { elapsedMs: 7_000, title: 'Daily' } })
    t.clock.advance(TRAY_TITLE_TICK_MS)
    expect(t.titles).toEqual([' 00:05', ' 00:06', ' 00:07'])
    expect(t.menus).toHaveLength(built)
    expect(t.relabels.at(-1)).toBe(`${TRAY_IDS.recording}=Gravando · 00:07 — Daily`)
    expect(t.clock.intervals()).toBe(1)

    t.set({ locked: true })
    t.controller.refresh()
    expect(t.titles.at(-1)).toBe('')
    expect(t.clock.intervals()).toBe(0)

    t.set({ locked: false, recording: { elapsedMs: 8_000, title: null } })
    t.controller.refresh()
    expect(t.titles.at(-1)).toBe(' 00:08')
    t.set({ recording: null })
    t.controller.refresh()
    expect(t.titles.at(-1)).toBe('')
    expect(t.clock.intervals()).toBe(0)
    t.controller.dispose()
  })

  it('sem gravação, nenhum texto ao lado do ícone e nenhum relógio', async () => {
    const t = setup()
    await flush()
    t.controller.refresh()
    t.clock.advance(5 * TRAY_TITLE_TICK_MS)
    expect(t.titles).toEqual([])
    expect(t.clock.intervals()).toBe(0)
    t.controller.dispose()
  })
})
