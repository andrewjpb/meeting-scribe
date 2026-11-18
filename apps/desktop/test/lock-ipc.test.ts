import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS, RECORDING_SESSION_CHANNELS, RENDERER_EVENT_CHANNELS, RENDERER_EVENTS_WHEN_LOCKED, WHEN_LOCKED, type InvokeChannel, type RendererEvent } from '../src/shared/ipc'
import { createRecordingSessions, leaveButtons } from '../src/main/lock/recording-session'

// O registro do main (`main/ipc.ts`) com um `ipcMain` falso: cada canal registrado fica aqui para o teste chamar.
const invokeHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const eventListeners = new Map<string, (event: unknown, payload: unknown) => void>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => invokeHandlers.set(channel, handler),
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => eventListeners.set(channel, listener),
  },
}))

const { handle, onEvent, setLockGate } = await import('../src/main/ipc')

const ORIGIN = 'scribe://app'
const trusted = { senderFrame: { url: `${ORIGIN}/index.html` } }
const calls: string[] = []
let locked = false
const sessions = createRecordingSessions()

beforeAll(() => {
  setLockGate(
    () => locked,
    () => sessions.active(),
  )
  for (const channel of INVOKE_CHANNELS) {
    handle(channel, ORIGIN, (() => {
      calls.push(channel)
      return 'resposta'
    }) as never)
  }
  for (const channel of RENDERER_EVENT_CHANNELS) onEvent(channel, ORIGIN, () => void calls.push(channel))
  // Canal que não está no mapa: a lista é de permitidos, então ele é recusado.
  handle('scribe:canal-novo' as InvokeChannel, ORIGIN, (() => {
    calls.push('scribe:canal-novo')
    return 'resposta'
  }) as never)
})

beforeEach(() => {
  calls.length = 0
  locked = false
  const token = sessions.active()
  if (token) sessions.close(token)
})

const invoke = async (channel: InvokeChannel): Promise<unknown> => invokeHandlers.get(channel)?.(trusted, {})

/** Canais que passam com o app bloqueado: o próprio bloqueio, a base da janela e a gravação em curso. */
const ALLOWED: readonly InvokeChannel[] = [
  'scribe:lock-status',
  'scribe:lock-now',
  'scribe:lock-unlock',
  'scribe:lock-touch-id',
  'scribe:app-info',
  'scribe:capture-mode',
  'scribe:settings-get',
  'scribe:branding-get',
  'scribe:mic-access',
  'scribe:update-get',
  'scribe:transcription-token',
  'scribe:translate-turn',
  'scribe:claude-start',
  'scribe:claude-translate',
  'scribe:claude-stop',
  'scribe:audio-append',
  'scribe:recording-session-close',
]

describe('canais com o app bloqueado (contrato 22, CA4)', () => {
  it('toda a lista de canais tem uma regra e só os esperados passam', () => {
    expect(Object.keys(WHEN_LOCKED).sort()).toEqual([...INVOKE_CHANNELS].sort())
    expect(INVOKE_CHANNELS.filter((channel) => WHEN_LOCKED[channel] === 'allowed').sort()).toEqual([...ALLOWED].sort())
    expect(INVOKE_CHANNELS.filter((channel) => WHEN_LOCKED[channel] === 'session').sort()).toEqual([...RECORDING_SESSION_CHANNELS].sort())
  })

  it('canal fora do mapa é recusado com o app bloqueado', async () => {
    locked = true
    await expect(invoke('scribe:canal-novo' as InvokeChannel)).rejects.toThrow(/^locked$/)
    expect(calls).toEqual([])
  })

  it.each([...RECORDING_SESSION_CHANNELS])('%s: bloqueado, só passa com o token da gravação em curso', async (channel) => {
    const request = channel === 'scribe:summary-generate' ? { meetingId: 'm', auto: true } : {}
    const call = (tag?: unknown): Promise<unknown> => Promise.resolve().then(() => invokeHandlers.get(channel)?.(trusted, request, tag))
    locked = true
    await expect(call()).rejects.toThrow(/^locked$/)
    await expect(call({ recordingSession: 'inventado' })).rejects.toThrow(/^locked$/)
    const token = sessions.open()
    await expect(call({ recordingSession: 'inventado' })).rejects.toThrow(/^locked$/)
    await expect(call({ recordingSession: token })).resolves.toBe('resposta')
    expect(calls).toEqual([channel])
    // Sessão fechada: volta a recusa.
    expect(sessions.close(token)).toBe(true)
    await expect(call({ recordingSession: token })).rejects.toThrow(/^locked$/)
  })

  it('resumo pedido à mão não passa bloqueado, nem com o token', async () => {
    locked = true
    const token = sessions.open()
    await expect(Promise.resolve().then(() => invokeHandlers.get('scribe:summary-generate')?.(trusted, { meetingId: 'm' }, { recordingSession: token }))).rejects.toThrow(/^locked$/)
  })

  it('sessão: a janela que a abriu sumir fecha a sessão; o fechamento avisa; fechar com outro token não fecha', () => {
    let closed = 0
    const own = createRecordingSessions(() => void closed++)
    let destroyed: (() => void) | undefined
    const token = own.open({ once: (_event, listener) => (destroyed = listener) })
    expect(own.close('outro')).toBe(false)
    expect(own.active()).toBe(token)
    destroyed?.()
    expect(own.active()).toBeNull()
    expect(closed).toBe(1)
  })

  it('diálogo de sair com gravação: bloqueado só "Cancelar"', () => {
    expect(leaveButtons(true)).toEqual(['Cancelar'])
    expect(leaveButtons(false)).toEqual(['Cancelar', 'Encerrar e sair'])
  })

  it.each(INVOKE_CHANNELS.filter((channel) => WHEN_LOCKED[channel] === 'refused'))('%s: recusado com "locked" sem chamar o handler', async (channel) => {
    locked = true
    await expect(invoke(channel)).rejects.toThrow(/^locked$/)
    expect(calls).toEqual([])
    locked = false
    await expect(invoke(channel)).resolves.toBe('resposta')
    expect(calls).toEqual([channel])
  })

  it.each(ALLOWED)('%s: passa com o app bloqueado', async (channel) => {
    locked = true
    await expect(invoke(channel)).resolves.toBe('resposta')
    expect(calls).toEqual([channel])
  })

  it('os canais de conteúdo do contrato estão todos recusados', () => {
    const content: InvokeChannel[] = [
      'scribe:meetings-list',
      'scribe:meetings-get',
      'scribe:meetings-overview',
      'scribe:meetings-search',
      // Contrato 28: pastas e mover reunião.
      'scribe:folders-list',
      'scribe:folders-create',
      'scribe:folders-rename',
      'scribe:folders-delete',
      'scribe:meetings-move',
      'scribe:transcript-get',
      'scribe:transcript-copy',
      'scribe:summary-get',
      'scribe:summary-copy',
      'scribe:notes-get',
      'scribe:notes-copy',
      'scribe:analyses-get',
      'scribe:analysis-copy',
      'scribe:chat-list',
      'scribe:chat-get',
      'scribe:chat-copy',
      'scribe:meeting-files',
      'scribe:meeting-file-open',
      'scribe:meeting-file-download',
      // Contrato 31: "Salvar plugin…".
      'scribe:plugin-save',
      // Contrato 32: a foto de perfil e os Detalhes do WhatsApp.
      'scribe:whatsapp-photo',
      'scribe:whatsapp-insights',
      'scribe:whatsapp-insights-run',
      // Contrato 37: a mídia baixada e a transcrição do áudio.
      'scribe:whatsapp-media',
      'scribe:whatsapp-transcribe',
      // Contrato 39: o envio do anexo e o seletor de arquivo.
      'scribe:whatsapp-send-media',
      'scribe:whatsapp-attach-pick',
      'scribe:settings-update',
      'scribe:lock-password-set',
      'scribe:lock-password-remove',
    ]
    for (const channel of content) expect(WHEN_LOCKED[channel], channel).toBe('refused')
  })

  it('origem estranha continua recusada antes do bloqueio', async () => {
    await expect(Promise.resolve().then(() => invokeHandlers.get('scribe:lock-status')?.({ senderFrame: { url: 'https://exemplo.com/' } }))).rejects.toThrow(/origem não autorizada/)
  })

  it.each(RENDERER_EVENT_CHANNELS)('mensagem %s segue a regra com o app bloqueado', (channel: RendererEvent) => {
    locked = true
    eventListeners.get(channel)?.(trusted, undefined)
    expect(calls).toEqual(RENDERER_EVENTS_WHEN_LOCKED[channel] === 'pass' ? [channel] : [])
  })

  it('abrir link, Ajustes ou o painel da chave é ignorado bloqueado', () => {
    expect(RENDERER_EVENTS_WHEN_LOCKED['scribe:open-link']).toBe('ignored')
    expect(RENDERER_EVENTS_WHEN_LOCKED['scribe:open-privacy-settings']).toBe('ignored')
    expect(RENDERER_EVENTS_WHEN_LOCKED['scribe:open-key-dashboard']).toBe('ignored')
  })

  it('contrato 40: a conversa aberta no WhatsApp é ignorada bloqueado (o main não muda a regra da notificação)', () => {
    expect(RENDERER_EVENTS_WHEN_LOCKED['scribe:whatsapp-viewing']).toBe('ignored')
  })
})
