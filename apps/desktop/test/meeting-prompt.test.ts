// Contrato 48 (aviso-reuniao): a regra de quando avisar (as seis condições, uma vez por reunião, "não perguntar nesta
// reunião" e a troca de reunião), a geometria da janela (abaixo da barra de menus, na tela secundária) e o
// controlador do main com uma janela de mentira: os dois canais só atendem a janela do aviso, cada botão faz o que
// diz, o aviso some em 60 s ou quando a reunião acaba, e o título vai para a gravação que começou pelo aviso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import type { MeetState } from '../src/shared/meet'
import { MEETING_PROMPT_TIMEOUT_MS, meetingPromptTitle, recordingTitleFor, shouldPrompt, type MeetingPromptInput, type MeetingPromptState } from '../src/shared/meeting-prompt'
import { createMeetingPromptController, MEETING_PROMPT_PICK_MS, type MeetingPromptSettings, type MeetingPromptWindow } from '../src/main/meeting-prompt/controller'

// A janela de verdade (Electron) não abre no teste: só a geometria pura de window.ts.
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), nativeTheme: { shouldUseDarkColors: false } }))
const { meetingPromptBounds, MEETING_PROMPT_SIZE, MEETING_PROMPT_TOP_GAP } = await import('../src/main/meeting-prompt/window')

const base = (patch: Partial<MeetingPromptInput> = {}): MeetingPromptInput => ({
  meetingPrompt: true,
  meetSpeakers: true,
  meeting: 'abc-defg-hij',
  participants: 2,
  prompted: new Set(),
  skipped: new Set(),
  recording: false,
  locked: false,
  ...patch,
})

describe('shouldPrompt', () => {
  it('avisa com tudo valendo', () => {
    expect(shouldPrompt(base())).toBe(true)
  })

  it('cada uma das seis condições sozinha impede o aviso', () => {
    expect(shouldPrompt(base({ meetingPrompt: false }))).toBe(false)
    expect(shouldPrompt(base({ meetSpeakers: false }))).toBe(false)
    expect(shouldPrompt(base({ meeting: null }))).toBe(false)
    expect(shouldPrompt(base({ participants: 0 }))).toBe(false)
    expect(shouldPrompt(base({ prompted: new Set(['abc-defg-hij']) }))).toBe(false)
    expect(shouldPrompt(base({ recording: true }))).toBe(false)
    expect(shouldPrompt(base({ locked: true }))).toBe(false)
    expect(shouldPrompt(base({ skipped: new Set(['abc-defg-hij']) }))).toBe(false)
  })

  it('outra reunião avisa mesmo depois de a primeira ter avisado ou ficado em "não perguntar"', () => {
    expect(shouldPrompt(base({ meeting: 'xyz-abcd-efg', prompted: new Set(['abc-defg-hij']), skipped: new Set(['abc-defg-hij']) }))).toBe(true)
  })

  it('título: o da página; sem ele, de onde é a reunião', () => {
    expect(meetingPromptTitle('Revisão do contrato', 'meet')).toBe('Revisão do contrato')
    expect(meetingPromptTitle(null, 'meet')).toBe('Reunião no Meet')
    expect(meetingPromptTitle(null, 'teams')).toBe('Reunião no Teams')
    expect(meetingPromptTitle(null, null)).toBe('Reunião no navegador')
  })

  it('título da gravação: começou pelo aviso, o dele vence o da agenda; por outro caminho, o da agenda', () => {
    expect(recordingTitleFor('Revisão do contrato', 'Almoço da equipe')).toBe('Revisão do contrato')
    expect(recordingTitleFor(null, 'Almoço da equipe')).toBe('Almoço da equipe')
    expect(recordingTitleFor('Revisão do contrato', null)).toBe('Revisão do contrato')
    expect(recordingTitleFor(null, undefined)).toBeNull()
    expect(recordingTitleFor(null, '')).toBeNull()
  })
})

describe('geometria da janela do aviso', () => {
  it('~420×88 (460 de largura, para o texto caber), centrada na tela, 8 px abaixo da barra de menus', () => {
    expect(MEETING_PROMPT_SIZE).toEqual({ width: 460, height: 88 })
    expect(MEETING_PROMPT_TOP_GAP).toBe(8)
    // MacBook com notch: barra de menus de 37 px, Dock embaixo.
    expect(meetingPromptBounds({ x: 0, y: 37, width: 1512, height: 900 })).toEqual({ x: 526, y: 45, width: 460, height: 88 })
  })

  it('tela secundária (à esquerda e mais alta, com barra de menus de 25 px): a conta usa a área útil dela', () => {
    expect(meetingPromptBounds({ x: -1920, y: -200 + 25, width: 1920, height: 1055 })).toEqual({ x: -1190, y: -167, width: 460, height: 88 })
    expect(meetingPromptBounds({ x: 1512, y: 25, width: 2560, height: 1415 })).toEqual({ x: 2562, y: 33, width: 460, height: 88 })
  })

  it('tela mais estreita que o aviso: ele encolhe para caber, sem sair dela', () => {
    expect(meetingPromptBounds({ x: 100, y: 0, width: 300, height: 600 })).toEqual({ x: 100, y: 8, width: 300, height: 88 })
  })
})

describe('canais do aviso', () => {
  it('declarados e recusados com o app bloqueado', () => {
    expect(INVOKE_CHANNELS).toEqual(expect.arrayContaining(['scribe:meeting-prompt-state', 'scribe:meeting-prompt-act']))
    expect(WHEN_LOCKED['scribe:meeting-prompt-state']).toBe('refused')
    expect(WHEN_LOCKED['scribe:meeting-prompt-act']).toBe('refused')
  })
})

interface FakeWindow extends MeetingPromptWindow {
  sender: object
  closed: boolean
  updates: MeetingPromptState[]
}

describe('controlador do aviso', () => {
  let settings: MeetingPromptSettings
  let recording: boolean
  let locked: boolean
  let windows: FakeWindow[]
  let records: number
  let disabled: number
  let clock: number

  const state = (patch: Partial<MeetState> = {}): MeetState => ({ connected: true, participants: ['Ana'], events: [], meeting: 'abc-defg-hij', plataforma: 'meet', titulo: 'Revisão do contrato', ...patch })

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
          updates: [],
          isSender: (candidate) => !win.closed && candidate === sender,
          close: () => {
            if (win.closed) return
            win.closed = true
            for (const listener of listeners) listener()
          },
          onClosed: (listener) => void listeners.push(listener),
          update: (next) => void win.updates.push(next),
        }
        windows.push(win)
        return win
      },
      record: () => void records++,
      disable: () => {
        disabled++
        settings = { ...settings, meetingPrompt: false }
        return Promise.resolve()
      },
      now: () => clock,
    })

  beforeEach(() => {
    settings = { meetingPrompt: true, meetSpeakers: true, theme: 'system' }
    recording = false
    locked = false
    windows = []
    records = 0
    disabled = 0
    clock = 1_000_000
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reunião nova abre o aviso uma vez só; a mesma reunião não abre de novo, nem depois de fechar', async () => {
    const prompt = controller()
    await prompt.meetChanged(state())
    await prompt.meetChanged(state({ participants: ['Ana', 'Bruno'] }))
    expect(windows).toHaveLength(1)
    expect(prompt.open()).toBe('abc-defg-hij')
    expect(await prompt.act(windows[0]?.sender, { acao: 'fechar' })).toBe(true)
    expect(windows[0]?.closed).toBe(true)
    expect(prompt.open()).toBeNull()
    await prompt.meetChanged(state())
    expect(windows).toHaveLength(1)
  })

  it('sem participante, sem reunião, desligado, bloqueado: nada abre', async () => {
    const prompt = controller()
    await prompt.meetChanged(state({ participants: [] }))
    await prompt.meetChanged(state({ connected: false, meeting: null }))
    settings = { ...settings, meetingPrompt: false }
    await prompt.meetChanged(state())
    settings = { ...settings, meetingPrompt: true, meetSpeakers: false }
    await prompt.meetChanged(state())
    settings = { ...settings, meetSpeakers: true }
    locked = true
    await prompt.meetChanged(state())
    expect(windows).toHaveLength(0)
    // Desbloqueado, a mesma reunião ainda avisa (não tinha avisado).
    locked = false
    await prompt.meetChanged(state())
    expect(windows).toHaveLength(1)
  })

  it('vista durante uma gravação, a reunião não avisa depois que a gravação acaba', async () => {
    const prompt = controller()
    recording = true
    await prompt.meetChanged(state())
    recording = false
    await prompt.meetChanged(state())
    expect(windows).toHaveLength(0)
    await prompt.meetChanged(state({ meeting: 'xyz-abcd-efg' }))
    expect(windows).toHaveLength(1)
  })

  it('a reunião acabar (connected:false) fecha o aviso na hora; trocar de reunião fecha e abre o da nova', async () => {
    const prompt = controller()
    await prompt.meetChanged(state())
    await prompt.meetChanged(state({ connected: false, participants: [], meeting: null, plataforma: null, titulo: null }))
    expect(windows[0]?.closed).toBe(true)
    await prompt.meetChanged(state({ meeting: 'xyz-abcd-efg' }))
    expect(windows).toHaveLength(2)
    await prompt.meetChanged(state({ meeting: 'nova-abcd-efg' }))
    expect(windows[1]?.closed).toBe(true)
    expect(windows).toHaveLength(3)
    expect(prompt.open()).toBe('nova-abcd-efg')
  })

  it('some sozinho depois de 60 s sem clique', async () => {
    vi.useFakeTimers()
    const prompt = controller()
    await prompt.meetChanged(state())
    vi.advanceTimersByTime(MEETING_PROMPT_TIMEOUT_MS - 1)
    expect(windows[0]?.closed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(windows[0]?.closed).toBe(true)
    expect(prompt.open()).toBeNull()
  })

  it('os canais recusam quem não é a janela do aviso', async () => {
    const prompt = controller()
    expect(() => prompt.state({})).toThrow()
    await prompt.meetChanged(state())
    const intruder = {}
    expect(() => prompt.state(intruder)).toThrow()
    expect(await prompt.act(intruder, { acao: 'gravar' })).toBe(false)
    expect(await prompt.act(intruder, { acao: 'nunca' })).toBe(false)
    expect(records).toBe(0)
    expect(disabled).toBe(0)
    expect(windows[0]?.closed).toBe(false)
    expect(prompt.state(windows[0]?.sender)).toEqual({ titulo: 'Revisão do contrato', plataforma: 'meet' })
  })

  it('pedido fora do formato é recusado (zod estrito)', async () => {
    const prompt = controller()
    await prompt.meetChanged(state())
    const sender = windows[0]?.sender
    expect(await prompt.act(sender, { acao: 'apagar' })).toBe(false)
    expect(await prompt.act(sender, { acao: 'gravar', extra: 1 })).toBe(false)
    expect(await prompt.act(sender, null)).toBe(false)
    expect(records).toBe(0)
    expect(windows[0]?.closed).toBe(false)
  })

  it('sem título na página, o aviso mostra de onde é a reunião', async () => {
    const prompt = controller()
    await prompt.meetChanged(state({ titulo: null, plataforma: 'teams', meeting: '19:meeting_x@thread.v2' }))
    expect(prompt.state(windows[0]?.sender)).toEqual({ titulo: 'Reunião no Teams', plataforma: 'teams' })
  })

  it('"Começar a transcrever" grava, fecha o aviso e o título vai para a gravação que começar', async () => {
    const prompt = controller()
    await prompt.meetChanged(state())
    expect(await prompt.act(windows[0]?.sender, { acao: 'gravar' })).toBe(true)
    expect(records).toBe(1)
    expect(windows[0]?.closed).toBe(true)
    clock += 3_000
    prompt.recordingStarted()
    expect(prompt.recordingTitle()).toBe('Revisão do contrato')
    prompt.recordingEnded()
    expect(prompt.recordingTitle()).toBeNull()
    // A gravação seguinte, sem o aviso, não herda o título.
    prompt.recordingStarted()
    expect(prompt.recordingTitle()).toBeNull()
  })

  it('o título do aviso perde a vez depois do prazo, e não fica esperando se já havia gravação', async () => {
    const prompt = controller()
    await prompt.meetChanged(state())
    await prompt.act(windows[0]?.sender, { acao: 'gravar' })
    clock += MEETING_PROMPT_PICK_MS + 1
    prompt.recordingStarted()
    expect(prompt.recordingTitle()).toBeNull()
    await prompt.meetChanged(state({ meeting: 'xyz-abcd-efg' }))
    recording = true
    await prompt.act(windows[1]?.sender, { acao: 'gravar' })
    expect(records).toBe(2)
    recording = false
    prompt.recordingStarted()
    expect(prompt.recordingTitle()).toBeNull()
  })

  it('"Não perguntar nesta reunião" fecha e a reunião não avisa mais; outra reunião avisa', async () => {
    const prompt = controller()
    await prompt.meetChanged(state())
    expect(await prompt.act(windows[0]?.sender, { acao: 'nesta' })).toBe(true)
    expect(windows[0]?.closed).toBe(true)
    await prompt.meetChanged(state({ connected: false, meeting: null }))
    await prompt.meetChanged(state())
    expect(windows).toHaveLength(1)
    await prompt.meetChanged(state({ meeting: 'xyz-abcd-efg' }))
    expect(windows).toHaveLength(2)
  })

  it('"Nunca perguntar" desliga a configuração e fecha; depois disso nada abre', async () => {
    const prompt = controller()
    await prompt.meetChanged(state())
    expect(await prompt.act(windows[0]?.sender, { acao: 'nunca' })).toBe(true)
    expect(disabled).toBe(1)
    expect(windows[0]?.closed).toBe(true)
    await prompt.meetChanged(state({ meeting: 'xyz-abcd-efg' }))
    expect(windows).toHaveLength(1)
  })

  it('o título da mesma reunião mudar com o aviso aberto vai à janela; repetido, nada; o estado relido já vem novo', async () => {
    const prompt = controller()
    await prompt.meetChanged(state({ titulo: null }))
    expect(prompt.state(windows[0]?.sender)).toEqual({ titulo: 'Reunião no Meet', plataforma: 'meet' })
    await prompt.meetChanged(state({ titulo: 'Revisão do contrato' }))
    await prompt.meetChanged(state({ titulo: 'Revisão do contrato', participants: ['Ana', 'Bruno'] }))
    expect(windows).toHaveLength(1)
    expect(windows[0]?.updates).toEqual([{ titulo: 'Revisão do contrato', plataforma: 'meet' }])
    expect(prompt.state(windows[0]?.sender)).toEqual({ titulo: 'Revisão do contrato', plataforma: 'meet' })
    // O título que vai para a gravação também é o novo.
    await prompt.act(windows[0]?.sender, { acao: 'gravar' })
    prompt.recordingStarted()
    expect(prompt.recordingTitle()).toBe('Revisão do contrato')
  })

  it('bloqueado, a atualização do título não vai à janela', async () => {
    const prompt = controller()
    await prompt.meetChanged(state({ titulo: null }))
    locked = true
    await prompt.meetChanged(state({ titulo: 'Segredo' }))
    expect(windows[0]?.updates).toEqual([])
  })

  it('uma gravação começar por outro caminho fecha o aviso aberto; close() também', async () => {
    const prompt = controller()
    await prompt.meetChanged(state())
    prompt.recordingStarted()
    expect(windows[0]?.closed).toBe(true)
    expect(prompt.recordingTitle()).toBeNull()
    await prompt.meetChanged(state({ meeting: 'xyz-abcd-efg' }))
    prompt.close()
    expect(windows[1]?.closed).toBe(true)
  })
})
