import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTrayController, createWindowLifecycle, elapsedLabel, trayMenuTemplate, type TrayHandlers, type TrayLike, type TrayState } from '../src/main/tray/menu'
import { INVOKE_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'

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

const state = (patch: Partial<TrayState> = {}): TrayState => ({
  brandName: 'LAP Reuniões',
  locked: false,
  canLock: true,
  recording: null,
  paused: false,
  next: [
    { name: 'Resumo da semana', when: 'sex 17:00' },
    { name: 'Minhas tarefas', when: 'ter 08:00' },
    { name: 'Outra', when: 'qua 08:00' },
    { name: 'Quarta', when: 'qui 08:00' },
  ],
  meetings: [],
  recent: [],
  meetingPrompt: true,
  plugins: [],
  ...patch,
})

const labels = (template: ReturnType<typeof trayMenuTemplate>): string[] => template.map((item) => (item.type === 'separator' ? '—' : (item.label ?? '')))
const submenu = (template: ReturnType<typeof trayMenuTemplate>, label: string): ReturnType<typeof trayMenuTemplate> => {
  const found = template.find((item) => item.label === label)?.submenu
  return Array.isArray(found) ? found : []
}

describe('ícone na barra de menus (contrato 23, CA8 e CA9)', () => {
  it('desbloqueado: abrir, gravar, bloquear, o submenu Automações com as próximas 3 tarefas e pausar, e sair (contrato 50)', () => {
    const calls: string[] = []
    const template = trayMenuTemplate(state(), handlers(calls))
    expect(labels(template)).toEqual(['Abrir LAP Reuniões', 'Nova gravação', '—', 'Nenhuma reunião hoje', '—', 'Recentes', '—', 'Avisar quando uma reunião começar', 'Automações', 'Bloquear', '—', 'Sair'])
    const automations = submenu(template, 'Automações')
    expect(labels(automations)).toEqual(['Abrir Automações', '—', 'Resumo da semana · sex 17:00', 'Minhas tarefas · ter 08:00', 'Outra · qua 08:00', '—', 'Pausar todas as tarefas'])
    for (const item of [...template, ...automations]) (item.click as (() => void) | undefined)?.()
    expect(calls).toEqual(['open', 'newRecording', 'toggleMeetingPrompt', 'lock', 'quit', 'automations', 'togglePause'])
  })

  it('gravando: "Gravando · 12:34" com "Abrir gravação" e "Encerrar" no lugar de "Nova gravação"; pausado: "Retomar"', () => {
    const template = trayMenuTemplate(state({ recording: { elapsedMs: 754_000, title: null }, paused: true, next: [] }), handlers([]))
    expect(labels(template).slice(0, 5)).toEqual(['Abrir LAP Reuniões', 'Gravando · 12:34', 'Abrir gravação', 'Encerrar', '—'])
    expect(labels(template)).not.toContain('Nova gravação')
    expect(labels(submenu(template, 'Automações'))).toEqual(['Abrir Automações', '—', 'Tarefas pausadas', '—', 'Retomar'])
    expect(elapsedLabel(3_723_000)).toBe('1:02:03')
  })

  it('bloqueado: só "Abrir", "Bloqueado" e "Sair", sem nome de tarefa', () => {
    const template = trayMenuTemplate(state({ locked: true }), handlers([]))
    expect(labels(template)).toEqual(['Abrir', 'Bloqueado', '—', 'Sair'])
    expect(JSON.stringify(template)).not.toContain('Resumo da semana')
  })

  it('o ícone ganha o ponto com uma tarefa rodando; o menu fica preso ao ícone (o clique abre)', () => {
    let running = false
    const images: unknown[] = []
    const menus: unknown[] = []
    const tray: TrayLike = {
      setImage: (image) => images.push(image),
      setToolTip: () => undefined,
      setContextMenu: (menu) => menus.push(menu),
      setTitle: () => undefined,
      destroy: () => undefined,
    }
    const controller = createTrayController({
      create: (image) => {
        images.push(image)
        return tray
      },
      image: (icon) => icon,
      buildMenu: (template) => labels(template),
      state: () => state({ next: [] }),
      running: () => running,
      handlers: handlers([]),
    })
    running = true
    controller.refresh()
    controller.refresh()
    running = false
    controller.refresh()
    expect(images).toEqual(['idle', 'running', 'idle'])
    // A primeira montagem é na hora (sem `prepare`, sem espera).
    expect(menus).toEqual([expect.arrayContaining(['Automações'])])
    controller.dispose()
  })

  it('fechar a última janela: na barra de menus esconde o Dock; "Sair do app" sai; reabrir mostra o Dock', async () => {
    const calls: string[] = []
    let behavior: 'tray' | 'quit' = 'tray'
    const lifecycle = createWindowLifecycle({ dock: { hide: () => calls.push('hide'), show: () => calls.push('show') }, quit: () => calls.push('quit'), behavior: () => Promise.resolve(behavior) })
    await lifecycle.lastWindowClosed()
    lifecycle.reopened()
    behavior = 'quit'
    await lifecycle.lastWindowClosed()
    expect(calls).toEqual(['hide', 'show', 'quit'])
  })

  it('o macOS escondeu o ícone (barra cheia): o app fica no Dock e avisa', async () => {
    const calls: string[] = []
    let visible = false
    const lifecycle = createWindowLifecycle({
      dock: { hide: () => calls.push('hide'), show: () => calls.push('show') },
      quit: () => calls.push('quit'),
      behavior: () => Promise.resolve('tray'),
      trayVisible: () => visible,
      trayHidden: () => calls.push('hidden'),
    })
    await lifecycle.lastWindowClosed()
    visible = true
    await lifecycle.lastWindowClosed()
    expect(calls).toEqual(['hidden', 'hide'])
  })

  it('visible() lê o tamanho do ícone na barra', () => {
    let bounds = { width: 0, height: 0 }
    const tray: TrayLike = { setImage: () => undefined, setToolTip: () => undefined, setContextMenu: () => undefined, setTitle: () => undefined, destroy: () => undefined, getBounds: () => bounds }
    const controller = createTrayController({ create: () => tray, image: (icon) => icon, buildMenu: (t) => t, state: () => state(), running: () => false, handlers: handlers([]) })
    expect(controller.visible()).toBe(false)
    bounds = { width: 34, height: 24 }
    expect(controller.visible()).toBe(true)
  })
})

describe('segurança das automações (contrato 23, CA10)', () => {
  const channels = ['scribe:agents-list', 'scribe:agents-save', 'scribe:agents-delete', 'scribe:agents-test', 'scribe:tasks-list', 'scribe:tasks-save', 'scribe:tasks-delete', 'scribe:tasks-toggle', 'scribe:tasks-run-now', 'scribe:automations-ask', 'scribe:runs-list', 'scribe:runs-get', 'scribe:runs-rerun', 'scribe:automations-status', 'scribe:automations-pause'] as const

  it('todo canal novo está no WHEN_LOCKED do 22 e é recusado com o app bloqueado', () => {
    for (const channel of channels) {
      expect(INVOKE_CHANNELS).toContain(channel)
      expect(WHEN_LOCKED[channel]).toBe('refused')
    }
  })

  it('nenhum código das automações alcança o WhatsApp nem qualquer envio', () => {
    const root = join(import.meta.dirname, '..', 'src')
    const files = (folder: string): string[] =>
      readdirSync(folder).flatMap((name) => {
        const path = join(folder, name)
        return statSync(path).isDirectory() ? files(path) : [path]
      })
    const sources = ['main/agents', 'main/schedules', 'main/tray', 'renderer/src/features/agents', 'renderer/src/features/schedules'].flatMap((folder) => files(join(root, folder)))
    expect(sources.length).toBeGreaterThan(8)
    for (const file of [...sources, join(root, 'shared', 'automations.ts'), join(root, 'shared', 'automations-schema.ts')]) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/from ['"][^'"]*whatsapp[^'"]*['"]/)
      expect(text, file).not.toContain('scribe:whatsapp-send')
      expect(text, file).not.toContain('whatsappSend')
      expect(text, file).not.toMatch(/\bnet\.fetch\b|\bfetch\(|node:http|node:https|child_process/)
    }
    // No main, o serviço das automações não recebe o WhatsApp: o bloco que o cria não cita o serviço dele.
    const index = readFileSync(join(root, 'main', 'index.ts'), 'utf8')
    const block = index.slice(index.indexOf('const automations = createAutomationsService({'), index.indexOf('return {', index.indexOf('const automations = createAutomationsService({')))
    expect(block.length).toBeGreaterThan(200)
    expect(block).not.toMatch(/whatsapp\./)
  })
})
