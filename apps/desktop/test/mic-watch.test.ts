// Contrato 49 (aviso-reuniao): o aviso quando outro app liga o microfone. O protocolo do `lap-mic-watch` (linhas
// válidas, inválidas, campo a mais recusado), a regra com a fonte `app` (3 s mínimos, 2 min para reunião nova,
// navegadores e o próprio app ignorados, nome amigável), o controlador com uma janela de mentira e o processo filho
// com o binário falso (test/fixtures/fake-mic-watch.mjs): reinício com recuo e parada.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeMicApps,
  ignoredMicApp,
  MIC_PROMPT_MIN_MS,
  MIC_SESSION_GAP_MS,
  micAppKey,
  micAppName,
  micMeetingKey,
  micPromptTitle,
  shouldPrompt,
  updateMicSessions,
  type MeetingPromptInput,
  type MicSession,
  type MicWatchState,
} from '../src/shared/meeting-prompt'
import { createMeetingPromptController, type MeetingPromptSettings, type MeetingPromptWindow } from '../src/main/meeting-prompt/controller'
import { createMicWatch, createMicWatchService, locateMicWatch, MIC_WATCH_SWIFTC_ARGS, parseMicWatchLine, supportsMicWatch, type MicWatchCommand, type SpawnMicWatch } from '../src/main/mic-watch/process'

const FAKE = join(__dirname, 'fixtures', 'fake-mic-watch.mjs')
const ZOOM_ON = '{"v":1,"mic":true,"apps":["us.zoom.xos"],"names":{"us.zoom.xos":"zoom.us"},"camera":false}'

describe('protocolo do lap-mic-watch', () => {
  it('linhas válidas, com e sem os nomes', () => {
    expect(parseMicWatchLine(ZOOM_ON)).toEqual({ mic: true, apps: ['us.zoom.xos'], names: { 'us.zoom.xos': 'zoom.us' }, camera: false })
    expect(parseMicWatchLine('{"v":1,"mic":false,"apps":[],"camera":true}')).toEqual({ mic: false, apps: [], names: {}, camera: true })
    // A saída de verdade do binário (chaves em ordem alfabética).
    expect(parseMicWatchLine('{"apps":[],"camera":false,"mic":false,"names":{},"v":1}')).toEqual({ mic: false, apps: [], names: {}, camera: false })
  })

  it('linhas inválidas e campo a mais são recusados', () => {
    expect(parseMicWatchLine('')).toBeNull()
    expect(parseMicWatchLine('não é json')).toBeNull()
    expect(parseMicWatchLine('{"v":2,"mic":true,"apps":[],"camera":false}')).toBeNull()
    expect(parseMicWatchLine('{"v":1,"mic":"sim","apps":[],"camera":false}')).toBeNull()
    expect(parseMicWatchLine('{"v":1,"mic":true,"apps":[""],"camera":false}')).toBeNull()
    expect(parseMicWatchLine('{"v":1,"mic":true,"apps":[],"camera":false,"extra":1}')).toBeNull()
    expect(parseMicWatchLine('{"v":1,"mic":true,"apps":[]}')).toBeNull()
  })

  it('macOS 14.4 ou mais novo', () => {
    expect(supportsMicWatch('26.6.0')).toBe(true)
    expect(supportsMicWatch('14.4')).toBe(true)
    expect(supportsMicWatch('14.3.1')).toBe(false)
    expect(supportsMicWatch('13.6')).toBe(false)
  })
})

describe('regra com a fonte app', () => {
  const base = (patch: Partial<MeetingPromptInput> = {}): MeetingPromptInput => ({
    meetingPrompt: true,
    meetSpeakers: false,
    meeting: micMeetingKey('us.zoom.xos', 1000),
    participants: 0,
    prompted: new Set(),
    skipped: new Set(),
    recording: false,
    locked: false,
    fonte: { tipo: 'app', bundleId: 'us.zoom.xos', micMs: MIC_PROMPT_MIN_MS },
    ...patch,
  })

  it('3 s de microfone ligado bastam (sem "Quem fala no Meet" nem participantes)', () => {
    expect(MIC_PROMPT_MIN_MS).toBe(3_000)
    expect(shouldPrompt(base())).toBe(true)
    expect(shouldPrompt(base({ fonte: { tipo: 'app', bundleId: 'us.zoom.xos', micMs: MIC_PROMPT_MIN_MS - 1 } }))).toBe(false)
  })

  it('gravação, bloqueio, configuração desligada, já avisada e "nesta reunião" valem igual', () => {
    const key = micMeetingKey('us.zoom.xos', 1000)
    expect(shouldPrompt(base({ recording: true }))).toBe(false)
    expect(shouldPrompt(base({ locked: true }))).toBe(false)
    expect(shouldPrompt(base({ meetingPrompt: false }))).toBe(false)
    expect(shouldPrompt(base({ prompted: new Set([key]) }))).toBe(false)
    expect(shouldPrompt(base({ skipped: new Set([key]) }))).toBe(false)
  })

  it('navegadores, o próprio app e os processos do sistema ficam de fora; os apps de reunião contam', () => {
    for (const id of ['com.google.Chrome', 'com.google.Chrome.helper', 'com.microsoft.edgemac.helper', 'com.apple.Safari', 'com.apple.WebKit.GPU', 'company.thebrowser.Browser', 'com.lap.reunioes', 'com.lap.reunioes.helper', 'com.github.Electron.helper', 'com.apple.corespeechd', 'com.apple.accessibility.heard']) {
      expect(ignoredMicApp(id)).toBe(true)
      expect(shouldPrompt(base({ fonte: { tipo: 'app', bundleId: id, micMs: 10_000 } }))).toBe(false)
    }
    for (const id of ['us.zoom.xos', 'com.apple.FaceTime', 'com.apple.avconferenced', 'com.microsoft.teams2', 'com.tinyspeck.slackmacgap.helper', 'com.hnc.Discord', 'com.exemplo.reunioes']) expect(ignoredMicApp(id)).toBe(false)
    for (const id of ['com.brave.Browser', 'com.brave.Browser.helper', 'org.mozilla.firefox', 'org.mozilla.firefox.plugincontainer', 'com.operasoftware.Opera', 'com.vivaldi.Vivaldi.helper', 'company.thebrowser.dia', 'company.thebrowser.dia.helper']) expect(ignoredMicApp(id)).toBe(true)
    expect(activeMicApps({ mic: true, apps: ['com.google.Chrome.helper', 'us.zoom.xos'], names: {}, camera: false })).toEqual(['us.zoom.xos'])
    expect(activeMicApps(null)).toEqual([])
  })

  it('decide pela lista de processos: Zoom num headset USB (microfone padrão parado) conta; o LAP gravando pelo padrão não libera ninguém', () => {
    expect(activeMicApps({ mic: false, apps: ['us.zoom.xos'], names: {}, camera: false })).toEqual(['us.zoom.xos'])
    expect(activeMicApps({ mic: true, apps: ['com.lap.reunioes.helper', 'com.google.Chrome.helper'], names: {}, camera: false })).toEqual([])
  })

  it('os processos do mesmo app são um app só', () => {
    expect(micAppKey('us.zoom.xos.helper')).toBe('us.zoom.xos')
    expect(micAppKey('com.apple.avconferenced')).toBe('com.apple.FaceTime')
    expect(micAppKey('com.microsoft.teams2.helper.renderer')).toBe('com.microsoft.teams2')
    expect(micAppKey('com.exemplo.app.Helper.GPU')).toBe('com.exemplo.app')
    expect(micAppKey('com.exemplo.app')).toBe('com.exemplo.app')
    expect(activeMicApps({ mic: true, apps: ['com.apple.FaceTime', 'com.apple.avconferenced', 'us.zoom.xos', 'us.zoom.xos.helper'], names: {}, camera: false })).toEqual(['com.apple.FaceTime', 'us.zoom.xos'])
  })

  it('nome amigável: o do mapa, senão o do macOS (sem " Helper"), senão "outro app"', () => {
    expect(micPromptTitle('us.zoom.xos', 'zoom.us')).toBe('Reunião no Zoom')
    expect(micAppName('com.apple.FaceTime', null)).toBe('FaceTime')
    expect(micAppName('com.apple.avconferenced', null)).toBe('FaceTime')
    expect(micAppName('com.microsoft.teams2', null)).toBe('Teams')
    expect(micAppName('com.tinyspeck.slackmacgap.helper', 'Slack Helper')).toBe('Slack')
    expect(micAppName('com.cisco.webexmeetingsapp', null)).toBe('Webex')
    expect(micAppName('com.hnc.Discord', null)).toBe('Discord')
    expect(micAppName('com.exemplo.reunioes', 'Reuniões Exemplo')).toBe('Reuniões Exemplo')
    expect(micAppName('com.exemplo.reunioes.helper', 'Reuniões Exemplo Helper (Renderer)')).toBe('Reuniões Exemplo')
    expect(micPromptTitle('com.exemplo.desconhecido', null)).toBe('Reunião no outro app')
  })

  it('sessão: desligou e religou antes de 2 min é a mesma reunião; depois, outra', () => {
    expect(MIC_SESSION_GAP_MS).toBe(120_000)
    let sessions: Map<string, MicSession> = updateMicSessions(new Map(), ['us.zoom.xos'], 1000)
    expect(sessions.get('us.zoom.xos')).toEqual({ start: 1000, onSince: 1000, offAt: null })
    sessions = updateMicSessions(sessions, ['us.zoom.xos'], 5000)
    expect(sessions.get('us.zoom.xos')).toEqual({ start: 1000, onSince: 1000, offAt: null })
    sessions = updateMicSessions(sessions, [], 10_000)
    expect(sessions.get('us.zoom.xos')).toEqual({ start: 1000, onSince: null, offAt: 10_000 })
    // Religou 1 min depois: a mesma sessão, ligada de novo agora (os 3 s contam de novo).
    sessions = updateMicSessions(sessions, ['us.zoom.xos'], 70_000)
    expect(sessions.get('us.zoom.xos')).toEqual({ start: 1000, onSince: 70_000, offAt: null })
    sessions = updateMicSessions(sessions, [], 80_000)
    // Religou 2 min depois de desligar: reunião nova.
    sessions = updateMicSessions(sessions, ['us.zoom.xos'], 80_000 + MIC_SESSION_GAP_MS)
    expect(sessions.get('us.zoom.xos')?.start).toBe(80_000 + MIC_SESSION_GAP_MS)
    // Desligada há 2 min, a sessão sai do mapa.
    sessions = updateMicSessions(sessions, [], 300_000)
    sessions = updateMicSessions(sessions, [], 300_000 + MIC_SESSION_GAP_MS)
    expect(sessions.size).toBe(0)
  })
})

interface FakeWindow extends MeetingPromptWindow {
  sender: object
  closed: boolean
}

describe('controlador do aviso com o microfone dos apps', () => {
  let settings: MeetingPromptSettings
  let recording: boolean
  let locked: boolean
  let windows: FakeWindow[]
  let records: number
  let clock: number

  const mic = (apps: string[], on = true, names: Record<string, string> = {}): MicWatchState => ({ mic: on, apps, names, camera: false })

  const controller = () =>
    createMeetingPromptController({
      settings: () => Promise.resolve(settings),
      recording: () => recording,
      locked: () => locked,
      openWindow: () => {
        const listeners: (() => void)[] = []
        const sender = {}
        const win: FakeWindow = {
          sender,
          closed: false,
          isSender: (candidate) => !win.closed && candidate === sender,
          close: () => {
            if (win.closed) return
            win.closed = true
            for (const listener of listeners) listener()
          },
          onClosed: (listener) => void listeners.push(listener),
          update: () => undefined,
        }
        windows.push(win)
        return win
      },
      record: () => void records++,
      disable: () => Promise.resolve(),
      now: () => clock,
    })

  /** Avança o relógio do controlador e os timers juntos. */
  const advance = async (ms: number): Promise<void> => {
    clock += ms
    await vi.advanceTimersByTimeAsync(ms)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    settings = { meetingPrompt: true, meetSpeakers: false, theme: 'system' }
    recording = false
    locked = false
    windows = []
    records = 0
    clock = 1_000_000
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('Zoom com o microfone ligado 3 s abre "Reunião no Zoom", sem precisar de "Quem fala no Meet"', async () => {
    const prompt = controller()
    await prompt.micChanged(mic(['us.zoom.xos'], true, { 'us.zoom.xos': 'zoom.us' }))
    expect(windows).toHaveLength(0)
    await advance(MIC_PROMPT_MIN_MS - 1)
    expect(windows).toHaveLength(0)
    await advance(1)
    expect(windows).toHaveLength(1)
    expect(prompt.state(windows[0]?.sender)).toEqual({ titulo: 'Reunião no Zoom', plataforma: null })
    expect(prompt.open()).toBe(micMeetingKey('us.zoom.xos', 1_000_000))
  })

  it('microfone que desliga antes de 3 s não avisa (ditado, áudio curto)', async () => {
    const prompt = controller()
    await prompt.micChanged(mic(['us.zoom.xos']))
    await advance(2_000)
    await prompt.micChanged(mic([], false))
    await advance(10_000)
    expect(windows).toHaveLength(0)
  })

  it('o app desligou o microfone: o aviso fecha; religou antes de 2 min, não avisa de novo; depois, avisa', async () => {
    const prompt = controller()
    await prompt.micChanged(mic(['us.zoom.xos']))
    await advance(MIC_PROMPT_MIN_MS)
    expect(windows).toHaveLength(1)
    await prompt.micChanged(mic([], false))
    expect(windows[0]?.closed).toBe(true)
    await advance(60_000)
    await prompt.micChanged(mic(['us.zoom.xos']))
    await advance(10_000)
    expect(windows).toHaveLength(1)
    await prompt.micChanged(mic([], false))
    await advance(MIC_SESSION_GAP_MS)
    await prompt.micChanged(mic(['us.zoom.xos']))
    await advance(MIC_PROMPT_MIN_MS)
    expect(windows).toHaveLength(2)
  })

  it('navegador e o próprio app não avisam; durante uma gravação, a reunião não avisa nem depois', async () => {
    const prompt = controller()
    await prompt.micChanged(mic(['com.google.Chrome.helper', 'com.lap.reunioes.helper']))
    await advance(10_000)
    expect(windows).toHaveLength(0)
    recording = true
    await prompt.micChanged(mic(['com.google.Chrome.helper', 'com.lap.reunioes.helper', 'com.apple.FaceTime']))
    await advance(10_000)
    recording = false
    await prompt.micChanged(mic(['com.apple.FaceTime']))
    await advance(10_000)
    expect(windows).toHaveLength(0)
  })

  it('"Não perguntar nesta reunião" vale para a sessão; o título do app não vira título da gravação', async () => {
    const prompt = controller()
    await prompt.micChanged(mic(['com.apple.FaceTime']))
    await advance(MIC_PROMPT_MIN_MS)
    expect(prompt.state(windows[0]?.sender).titulo).toBe('Reunião no FaceTime')
    expect(await prompt.act(windows[0]?.sender, { acao: 'nesta' })).toBe(true)
    await prompt.micChanged(mic([], false))
    await prompt.micChanged(mic(['com.apple.FaceTime']))
    await advance(10_000)
    expect(windows).toHaveLength(1)
    // Outra sessão (do Zoom) e "Começar a transcrever": grava, com o título padrão.
    await prompt.micChanged(mic(['us.zoom.xos']))
    await advance(MIC_PROMPT_MIN_MS)
    expect(windows).toHaveLength(2)
    await prompt.act(windows[1]?.sender, { acao: 'gravar' })
    expect(records).toBe(1)
    prompt.recordingStarted()
    expect(prompt.recordingTitle()).toBeNull()
  })

  it('bloqueado ou com a configuração desligada não avisa; o observador parou (null), o aviso do app fecha', async () => {
    const prompt = controller()
    locked = true
    await prompt.micChanged(mic(['us.zoom.xos']))
    await advance(10_000)
    settings = { ...settings, meetingPrompt: false }
    locked = false
    await prompt.micChanged(mic(['us.zoom.xos', 'com.hnc.Discord']))
    await advance(10_000)
    expect(windows).toHaveLength(0)
    settings = { ...settings, meetingPrompt: true }
    await prompt.micChanged(mic(['com.cisco.webexmeetingsapp']))
    await advance(MIC_PROMPT_MIN_MS)
    expect(windows).toHaveLength(1)
    await prompt.micChanged(null)
    expect(windows[0]?.closed).toBe(true)
  })

  it('dois processos do mesmo app são uma reunião só: trocar de processo não avisa de novo, e "nesta reunião" vale para os dois', async () => {
    const prompt = controller()
    await prompt.micChanged(mic(['com.apple.FaceTime']))
    await advance(MIC_PROMPT_MIN_MS)
    expect(windows).toHaveLength(1)
    expect(await prompt.act(windows[0]?.sender, { acao: 'nesta' })).toBe(true)
    // A chamada passa para o avconferenced (e depois os dois juntos): é a mesma reunião do FaceTime.
    await prompt.micChanged(mic(['com.apple.avconferenced']))
    await advance(10_000)
    await prompt.micChanged(mic(['com.apple.FaceTime', 'com.apple.avconferenced']))
    await advance(10_000)
    expect(windows).toHaveLength(1)
    // O Zoom com o principal e o auxiliar ao mesmo tempo abre um aviso só, com o nome do principal.
    await prompt.micChanged(mic(['us.zoom.xos', 'us.zoom.xos.helper'], true, { 'us.zoom.xos': 'zoom.us', 'us.zoom.xos.helper': 'zoom.us Helper' }))
    await advance(MIC_PROMPT_MIN_MS)
    expect(windows).toHaveLength(2)
    expect(prompt.state(windows[1]?.sender).titulo).toBe('Reunião no Zoom')
    await prompt.micChanged(mic(['us.zoom.xos.helper']))
    expect(windows[1]?.closed).toBe(false)
  })

  it('completou os 3 s bloqueado: avisa ao desbloquear (recheck), sem esperar outra linha', async () => {
    const prompt = controller()
    locked = true
    await prompt.micChanged(mic(['us.zoom.xos']))
    await advance(10_000)
    expect(windows).toHaveLength(0)
    locked = false
    await prompt.recheck()
    expect(windows).toHaveLength(1)
    expect(prompt.state(windows[0]?.sender).titulo).toBe('Reunião no Zoom')
  })

  it('a reunião da extensão que esperou o aviso de um app avisa quando ele fecha', async () => {
    const prompt = controller()
    settings = { ...settings, meetSpeakers: true }
    await prompt.micChanged(mic(['us.zoom.xos']))
    await advance(MIC_PROMPT_MIN_MS)
    expect(windows).toHaveLength(1)
    await prompt.meetChanged({ connected: true, participants: ['Ana'], events: [], meeting: 'abc-defg-hij', plataforma: 'meet', titulo: 'Revisão do contrato' })
    expect(windows).toHaveLength(1)
    await prompt.act(windows[0]?.sender, { acao: 'fechar' })
    await vi.advanceTimersByTimeAsync(0)
    expect(windows).toHaveLength(2)
    expect(prompt.state(windows[1]?.sender).titulo).toBe('Revisão do contrato')
  })

  it('o aviso da extensão não fecha por causa do microfone, e o do app não fecha pela extensão', async () => {
    const prompt = controller()
    settings = { ...settings, meetSpeakers: true }
    await prompt.meetChanged({ connected: true, participants: ['Ana'], events: [], meeting: 'abc-defg-hij', plataforma: 'meet', titulo: null })
    expect(windows).toHaveLength(1)
    await prompt.micChanged(mic(['com.google.Chrome.helper']))
    await prompt.micChanged(mic([], false))
    expect(windows[0]?.closed).toBe(false)
    await prompt.act(windows[0]?.sender, { acao: 'fechar' })
    await prompt.micChanged(mic(['us.zoom.xos']))
    await advance(MIC_PROMPT_MIN_MS)
    expect(windows).toHaveLength(2)
    await prompt.meetChanged({ connected: false, participants: [], events: [], meeting: null, plataforma: null, titulo: null })
    expect(windows[1]?.closed).toBe(false)
  })
})

describe('processo do lap-mic-watch (com o binário falso)', () => {
  const command = (env: Record<string, string> = {}): MicWatchCommand => ({ file: process.execPath, args: [FAKE], env: { ...env } })

  it('repassa as linhas válidas, ignora as fora do formato e sai quando o stdin fecha', async () => {
    const states: (MicWatchState | null)[] = []
    const logs: string[] = []
    const watch = createMicWatch({ command: command({ FAKE_MIC_WATCH_LINES: JSON.stringify(['lixo', ZOOM_ON]) }), onState: (state) => void states.push(state), log: (message) => void logs.push(message) })
    watch.start()
    await vi.waitFor(() => expect(states).toHaveLength(1))
    expect(states[0]?.apps).toEqual(['us.zoom.xos'])
    expect(logs.some((message) => message.includes('fora do formato'))).toBe(true)
    expect(watch.running()).toBe(true)
    await watch.stop()
    expect(watch.running()).toBe(false)
    // Saiu: o estado de antes não vale mais.
    expect(states.at(-1)).toBeNull()
  })

  it('caiu: sobe de novo com recuo exponencial, no máximo 5 vezes seguidas', async () => {
    const spawns: number[] = []
    const started = Date.now()
    const spawnFake: SpawnMicWatch = (cmd) => {
      spawns.push(Date.now() - started)
      return spawn(cmd.file, [...cmd.args], { env: cmd.env, stdio: ['pipe', 'pipe', 'pipe'] })
    }
    const logs: string[] = []
    const watch = createMicWatch({ command: command({ FAKE_MIC_WATCH_EXIT: '3' }), onState: () => undefined, spawn: spawnFake, baseDelayMs: 20, log: (message) => void logs.push(message) })
    watch.start()
    await vi.waitFor(() => expect(logs.some((message) => message.includes('5 vezes seguidas'))).toBe(true), { timeout: 10_000 })
    expect(spawns).toHaveLength(6)
    // Cada espera é pelo menos o dobro da base anterior: 20, 40, 80, 160, 320 ms.
    const gaps = spawns.slice(1).map((at, index) => at - (spawns[index] ?? 0))
    gaps.forEach((gap, index) => expect(gap).toBeGreaterThanOrEqual(20 * 2 ** index - 5))
    expect(watch.running()).toBe(false)
    // Religar zera as tentativas.
    watch.start()
    await vi.waitFor(() => expect(spawns).toHaveLength(7))
    await watch.stop()
  }, 15_000)

  it('parado não sobe de novo; o serviço só liga e desliga na troca da configuração', async () => {
    let spawned = 0
    const spawnFake: SpawnMicWatch = (cmd) => {
      spawned++
      return spawn(cmd.file, [...cmd.args], { env: cmd.env, stdio: ['pipe', 'pipe', 'pipe'] })
    }
    const states: (MicWatchState | null)[] = []
    const service = createMicWatchService({ command: () => Promise.resolve(command()), onState: (state) => void states.push(state), spawn: spawnFake })
    service.apply(true)
    service.apply(true)
    await vi.waitFor(() => expect(states).toHaveLength(1))
    expect(spawned).toBe(1)
    service.apply(false)
    await vi.waitFor(() => expect(states.at(-1)).toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(spawned).toBe(1)
    service.apply(true)
    await vi.waitFor(() => expect(spawned).toBe(2))
    await service.dispose()
  })

  it('sem binário (comando null) o serviço fica desligado sem erro', async () => {
    const service = createMicWatchService({ command: () => Promise.resolve(null), onState: () => undefined })
    service.apply(true)
    await service.dispose()
  })
})

describe('onde está o binário', () => {
  const base = { platform: 'darwin' as const, arch: 'arm64', systemVersion: '26.6.0', resourcesPath: '/nao/existe/Resources', appPath: join(__dirname, '..') }

  it('fora do Apple Silicon, macOS antigo ou pacote sem o binário: desligado, com o motivo no log', async () => {
    const logs: string[] = []
    const log = (message: string): void => void logs.push(message)
    expect(await locateMicWatch({ ...base, arch: 'x64', packaged: true, log })).toBeNull()
    expect(await locateMicWatch({ ...base, systemVersion: '14.2', packaged: true, log })).toBeNull()
    expect(await locateMicWatch({ ...base, packaged: true, log })).toBeNull()
    expect(logs).toHaveLength(3)
    expect(logs.every((message) => message.startsWith('[mic-watch] desligado:'))).toBe(true)
  })

  it('no dev, sem as ferramentas do Xcode, não chama o swiftc; com elas, compila com o comando do pack.sh', async () => {
    const appPath = mkdtempSync(join(tmpdir(), 'mic-watch-dev-'))
    try {
      mkdirSync(join(appPath, 'native', 'mic-watch'), { recursive: true })
      writeFileSync(join(appPath, 'native', 'mic-watch', 'main.swift'), '// fonte\n')
      const calls: string[][] = []
      const logs: string[] = []
      let tools = false
      const options = {
        ...base,
        appPath,
        packaged: false,
        run: (file: string, args: readonly string[]) => {
          calls.push([file, ...args])
          if (file === '/usr/bin/swiftc') writeFileSync(join(appPath, 'out', 'bin', 'lap-mic-watch'), '')
          return Promise.resolve(file === '/usr/bin/xcode-select' ? tools : true)
        },
        log: (message: string) => void logs.push(message),
      }
      expect(await locateMicWatch(options)).toBeNull()
      expect(calls).toEqual([['/usr/bin/xcode-select', '-p']])
      expect(logs.at(-1)).toContain('swiftc ausente')
      tools = true
      const out = join(appPath, 'out', 'bin', 'lap-mic-watch')
      expect(await locateMicWatch(options)).toBe(out)
      expect(calls.at(-1)).toEqual(['/usr/bin/swiftc', ...MIC_WATCH_SWIFTC_ARGS, join(appPath, 'native', 'mic-watch', 'main.swift'), '-o', out])
      // Binário mais novo que a fonte: não compila de novo.
      calls.length = 0
      expect(await locateMicWatch(options)).toBe(out)
      expect(calls).toEqual([])
    } finally {
      rmSync(appPath, { recursive: true, force: true })
    }
  })
})
