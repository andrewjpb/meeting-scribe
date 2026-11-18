// CA3, CA7 e CA8: envio de quadros, contagem da lacuna, pausa, reconexão e troca de sessão.
import { describe, expect, it, vi } from 'vitest'
import type { AudioFrame, AudioSource } from '../../src/renderer/src/audio/frames'
import { AssemblyAiSink, PAUSE_TERMINATION_TIMEOUT_MS, RECONNECT_DELAYS_MS, SESSION_ROTATE_MS, STABLE_CONNECTION_MS, type OpenSocket, type StreamingSocket } from '../../src/renderer/src/transcription/sink'
import { TranscriptionSession } from '../../src/renderer/src/transcription/session'
import type { StreamEnvelope } from '../../src/renderer/src/transcription/reducer'
import { DEFAULT_SETTINGS } from '../../src/shared/settings-defaults'
import type { TranscriptionTokenResult } from '../../src/shared/transcription'

class FakeSocket implements StreamingSocket {
  readyState = 0
  sent: (string | ArrayBuffer | ArrayBufferView)[] = []
  closedWith: { code?: number; reason?: string } | null = null
  onopen: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event?: unknown) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { ...(code !== undefined ? { code } : {}), ...(reason !== undefined ? { reason } : {}) }
    this.readyState = 3
    this.onclose?.({ code })
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  message(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  drop(): void {
    this.readyState = 3
    this.onclose?.({ code: 1006 })
  }

  get text(): string[] {
    return this.sent.filter((item): item is string => typeof item === 'string')
  }
}

const frame = (source: AudioSource, seq: number): AudioFrame => {
  const bytes = new Uint8Array(8 + 3200)
  bytes[0] = 1
  bytes[1] = source === 'mic' ? 0 : 1
  bytes[7] = 0xaa
  const pcm = bytes.subarray(8)
  pcm.fill(seq + 1)
  return { source, seq, bytes, pcm }
}

const token = (value: string): TranscriptionTokenResult => ({ ok: true, token: value, expiresInSeconds: 60 })

interface Harness {
  sink: AssemblyAiSink
  sockets: FakeSocket[]
  tokens: string[]
  urls: string[]
  envelopes: StreamEnvelope[]
  statuses: string[]
}

interface HarnessOptions {
  elapsed?: () => number
  rotateAfterMs?: number
  sessionIds?: string[]
  /** Resposta do n-ésimo pedido de token (1, 2, …); sem resposta, token novo. */
  tokenResult?: (issued: number) => TranscriptionTokenResult | Promise<TranscriptionTokenResult> | undefined
}

function harness(options: HarnessOptions = {}): Harness {
  const sockets: FakeSocket[] = []
  const tokens: string[] = []
  const urls: string[] = []
  const envelopes: StreamEnvelope[] = []
  const statuses: string[] = []
  let issued = 0
  const ids = options.sessionIds ? [...options.sessionIds] : null
  const openSocket: OpenSocket = (url) => {
    urls.push(url)
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket
  }
  const sink = new AssemblyAiSink({
    openSocket,
    getToken: () => {
      issued += 1
      const value = `tok-${issued}`
      tokens.push(value)
      const custom = options.tokenResult?.(issued)
      return Promise.resolve(custom ?? token(value))
    },
    urlFor: (value, source) => `wss://exemplo/${source}?token=${value}`,
    onMessage: (envelope) => envelopes.push(envelope),
    elapsedMs: options.elapsed ?? (() => 0),
    onStatus: (_source, status) => statuses.push(status.status),
    ...(options.rotateAfterMs !== undefined ? { rotateAfterMs: options.rotateAfterMs } : {}),
    ...(ids ? { newSessionId: () => ids.shift() ?? 'extra' } : {}),
  })
  return { sink, sockets, tokens, urls, envelopes, statuses }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('AssemblyAiSink.write (CA3)', () => {
  it('aberto: manda só os 3200 bytes de PCM de cada quadro, como binário', async () => {
    const h = harness()
    h.sink.start(['mic'])
    await settle()
    h.sockets[0]?.open()
    const sample = frame('mic', 3)
    h.sink.write(sample)
    expect(h.sockets[0]?.sent).toHaveLength(1)
    const sent = h.sockets[0]?.sent[0] as Uint8Array
    expect(sent).toBeInstanceOf(Uint8Array)
    expect(sent.byteLength).toBe(3200)
    expect(sent).toEqual(sample.pcm)
    expect(sent[0]).toBe(4)
  })

  it('socket ainda não aberto: guarda 50 quadros (5 s) e descarta os mais antigos contando a lacuna', async () => {
    const h = harness()
    h.sink.start(['mic'])
    await settle()
    for (let seq = 0; seq < 60; seq++) h.sink.write(frame('mic', seq))
    expect(h.sockets[0]?.sent).toHaveLength(0)
    expect(h.sink.gaps.mic).toBe(10)
    h.sockets[0]?.open()
    expect(h.sockets[0]?.sent).toHaveLength(50)
    // Os primeiros 10 saíram: o buffer guardou os quadros 10..59.
    expect((h.sockets[0]?.sent[0] as Uint8Array)[0]).toBe(11)
    expect((h.sockets[0]?.sent.at(-1) as Uint8Array)[0]).toBe(60)
  })

  it('pausado não envia nada', async () => {
    const h = harness()
    h.sink.start(['mic', 'system'])
    await settle()
    h.sockets.forEach((socket) => socket.open())
    h.sink.pause()
    h.sink.write(frame('mic', 1))
    h.sink.write(frame('system', 1))
    expect(h.sockets[0]?.sent.filter((item) => typeof item !== 'string')).toHaveLength(0)
    expect(h.sockets[1]?.sent.filter((item) => typeof item !== 'string')).toHaveLength(0)
  })
})

describe('ciclo de vida (CA7)', () => {
  it('iniciar abre uma sessão por fonte ativa, com token novo em cada uma', async () => {
    const h = harness()
    h.sink.start(['mic', 'system'])
    await settle()
    expect(h.sockets).toHaveLength(2)
    expect(h.tokens).toEqual(['tok-1', 'tok-2'])
    expect(h.urls[0]).toContain('token=tok-1')
  })

  it('pausar manda Terminate e fecha os sockets; retomar abre sessão nova com token e deslocamento novos', async () => {
    vi.useFakeTimers()
    try {
      const h = harness({ elapsed: () => 14_000, sessionIds: ['mic-a', 'sys-a', 'mic-b', 'sys-b'] })
      h.sink.start(['mic', 'system'])
      await settle()
      h.sockets.forEach((socket) => socket.open())
      for (const socket of h.sockets) expect(socket.text).toEqual([])

      h.sink.pause()
      expect(h.sockets[0]?.text).toEqual([JSON.stringify({ type: 'Terminate' })])
      expect(h.sink.statusOf('mic')?.status).toBe('paused')
      // Sem `Termination`, o socket fecha no limite de 2 s, nem antes nem depois.
      expect(PAUSE_TERMINATION_TIMEOUT_MS).toBe(2_000)
      await vi.advanceTimersByTimeAsync(1_999)
      expect(h.sockets[0]?.closedWith).toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(h.sockets[0]?.closedWith?.code).toBe(1000)
      expect(h.sockets[1]?.closedWith?.code).toBe(1000)

      h.sink.resume()
      await settle()
      expect(h.sockets).toHaveLength(4)
      expect(h.tokens).toEqual(['tok-1', 'tok-2', 'tok-3', 'tok-4'])
      h.sockets[2]?.open()
      h.sockets[2]?.message({ type: 'Turn', turn_order: 0, end_of_turn: true, transcript: 'oi', words: [{ text: 'oi', start: 2500, end: 2900 }] })
      expect(h.envelopes.at(-1)).toMatchObject({ source: 'mic', sessionId: 'mic-b', offsetMs: 14_000 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('pausar: o turno final antes do Termination chega com a sessão antiga, e o socket fecha na hora do Termination', async () => {
    vi.useFakeTimers()
    try {
      let elapsed = 3_000
      const h = harness({ elapsed: () => elapsed, sessionIds: ['mic-a', 'mic-b'] })
      h.sink.start(['mic'])
      await settle()
      h.sockets[0]?.open()
      elapsed = 9_000
      h.sink.pause()
      // Retomar antes de a sessão antiga terminar: a nova abre, a antiga continua entregando o final.
      h.sink.resume()
      await settle()
      expect(h.sockets).toHaveLength(2)
      h.sockets[0]?.message({ type: 'Turn', turn_order: 4, end_of_turn: true, transcript: 'até já', words: [{ text: 'até', start: 500, end: 900 }] })
      expect(h.envelopes.at(-1)).toMatchObject({ source: 'mic', sessionId: 'mic-a', offsetMs: 3_000 })
      expect(h.sockets[0]?.closedWith).toBeNull()
      h.sockets[0]?.message({ type: 'Termination', audio_duration_seconds: 6 })
      await vi.advanceTimersByTimeAsync(0)
      expect(h.sockets[0]?.closedWith?.code).toBe(1000)
      // A sessão nova não foi tocada pelo fechamento da antiga.
      expect(h.sockets[1]?.closedWith).toBeNull()
      expect(h.sink.statusOf('mic')?.status).toBe('connecting')
    } finally {
      vi.useRealTimers()
    }
  })

  it('pausar e retomar com o token ainda pendente abre exatamente 1 socket, e encerrar fecha todos', async () => {
    vi.useFakeTimers()
    try {
      const pending: ((value: TranscriptionTokenResult) => void)[] = []
      const h = harness({
        tokenResult: () =>
          new Promise<TranscriptionTokenResult>((resolve) => {
            pending.push(resolve)
          }),
      })
      h.sink.start(['mic'])
      h.sink.pause()
      h.sink.resume()
      expect(pending).toHaveLength(2)
      // O token antigo chega depois da retomada: é descartado.
      pending[0]?.(token('velho'))
      await settle()
      expect(h.sockets).toHaveLength(0)
      pending[1]?.(token('novo'))
      await settle()
      expect(h.sockets).toHaveLength(1)
      expect(h.urls).toEqual(['wss://exemplo/mic?token=novo'])
      h.sockets[0]?.open()
      expect(h.sink.statusOf('mic')?.status).toBe('live')

      // Mais uma pausa e retomada com a sessão aberta: a antiga ainda drena quando a nova abre.
      h.sink.pause()
      h.sink.resume()
      pending[2]?.(token('terceiro'))
      await settle()
      expect(h.sockets).toHaveLength(2)
      expect(h.sink.openSockets()).toHaveLength(2)

      const ending = h.sink.end()
      await vi.advanceTimersByTimeAsync(3_000)
      await ending
      expect(h.sink.openSockets()).toHaveLength(0)
      for (const socket of h.sockets) expect(socket.closedWith?.code).toBe(1000)
      // Token pedido antes do fim e entregue depois dele não abre nada.
      expect(h.sockets).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('token que chega depois de encerrar não abre socket', async () => {
    let release: ((value: TranscriptionTokenResult) => void) | null = null
    const h = harness({
      tokenResult: () =>
        new Promise<TranscriptionTokenResult>((resolve) => {
          release = resolve
        }),
    })
    h.sink.start(['mic'])
    await h.sink.end()
    ;(release as ((value: TranscriptionTokenResult) => void) | null)?.(token('tarde'))
    await settle()
    expect(h.sockets).toHaveLength(0)
    expect(h.sink.statusOf('mic')?.status).toBe('stopped')
  })

  it('encerrar manda Terminate, espera Termination por até 3 s e então fecha', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.sink.start(['mic'])
      await settle()
      h.sockets[0]?.open()
      let done = false
      const ending = h.sink.end().then(() => {
        done = true
      })
      await settle()
      expect(h.sockets[0]?.text).toEqual([JSON.stringify({ type: 'Terminate' })])
      await vi.advanceTimersByTimeAsync(2_999)
      expect(done).toBe(false)
      expect(h.sockets[0]?.closedWith).toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(done).toBe(true)
      expect(h.sockets[0]?.closedWith?.code).toBe(1000)
      await ending
    } finally {
      vi.useRealTimers()
    }
  })

  it('Termination chegando antes do tempo limite encerra na hora', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.sink.start(['mic'])
      await settle()
      h.sockets[0]?.open()
      const ending = h.sink.end()
      await settle()
      h.sockets[0]?.message({ type: 'Termination', audio_duration_seconds: 3 })
      await vi.advanceTimersByTimeAsync(0)
      await ending
      expect(h.sink.statusOf('mic')?.status).toBe('stopped')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('reconexão e troca de sessão (CA8)', () => {
  it('queda inesperada reconecta em 1, 2, 4 e 8 s com token novo; esgotadas, avisa e a outra fonte segue', async () => {
    vi.useFakeTimers()
    try {
      const h = harness({ elapsed: () => 5_000 })
      h.sink.start(['mic', 'system'])
      await settle()
      h.sockets[0]?.open()
      h.sockets[1]?.open()
      expect(RECONNECT_DELAYS_MS).toEqual([1_000, 2_000, 4_000, 8_000])

      let mic = h.sockets[0] as FakeSocket
      for (let attempt = 0; attempt < 4; attempt++) {
        mic.drop()
        expect(h.sink.statusOf('mic')?.status).toBe('reconnecting')
        expect(h.sink.statusOf('mic')?.attempts).toBe(attempt + 1)
        const before = h.sockets.length
        await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[attempt] as number)
        await settle()
        expect(h.sockets.length).toBe(before + 1)
        // A tentativa nova também cai antes de abrir: as esperas continuam crescendo.
        mic = h.sockets.at(-1) as FakeSocket
      }
      mic.drop()
      await settle()
      expect(h.sink.statusOf('mic')?.status).toBe('failed')
      expect(h.sink.statusOf('system')?.status).toBe('live')
      expect(h.statuses).toContain('reconnecting')
      // A fonte que caiu não recebe mais quadros; a outra continua.
      h.sink.write(frame('mic', 1))
      h.sink.write(frame('system', 1))
      expect(mic.sent).toHaveLength(0)
      expect(h.sockets[1]?.sent).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('abrir e cair logo conta como tentativa; só uma conexão estável zera a contagem', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.sink.start(['mic'])
      await settle()
      h.sockets[0]?.open()
      h.sockets[0]?.drop()
      // O servidor aceita e fecha na hora, sempre: sem o limite, reconectaria para sempre.
      for (let attempt = 0; attempt < 4; attempt++) {
        await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[attempt] as number)
        await settle()
        const socket = h.sockets.at(-1) as FakeSocket
        socket.open()
        expect(h.sink.statusOf('mic')).toMatchObject({ status: 'live', attempts: attempt + 1 })
        socket.drop()
      }
      expect(h.sink.statusOf('mic')?.status).toBe('failed')
      expect(h.sockets).toHaveLength(5)

      // Conexão que ficou de pé o bastante: a queda seguinte recomeça em 1 s.
      const s = harness()
      s.sink.start(['mic'])
      await settle()
      s.sockets[0]?.open()
      s.sockets[0]?.drop()
      await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0])
      await settle()
      s.sockets[1]?.open()
      await vi.advanceTimersByTimeAsync(STABLE_CONNECTION_MS)
      s.sockets[1]?.drop()
      expect(s.sink.statusOf('mic')).toMatchObject({ status: 'reconnecting', attempts: 1, nextRetryMs: 1_000 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('falha ao pedir o token na reconexão conta como tentativa e segue 1, 2, 4 e 8 s', async () => {
    vi.useFakeTimers()
    try {
      // O primeiro token sai; todos os seguintes falham por rede (ou servidor).
      const h = harness({ tokenResult: (issued) => (issued === 1 ? undefined : { ok: false, error: issued % 2 ? 'server' : 'network' }) })
      h.sink.start(['mic'])
      await settle()
      h.sockets[0]?.open()
      h.sockets[0]?.drop()
      expect(h.sink.statusOf('mic')).toMatchObject({ status: 'reconnecting', attempts: 1, nextRetryMs: 1_000 })
      for (let attempt = 1; attempt < 4; attempt++) {
        await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[attempt - 1] as number)
        await settle()
        expect(h.sink.statusOf('mic')).toMatchObject({ status: 'reconnecting', attempts: attempt + 1, nextRetryMs: RECONNECT_DELAYS_MS[attempt] })
      }
      await vi.advanceTimersByTimeAsync(8_000)
      await settle()
      expect(h.sink.statusOf('mic')?.status).toBe('failed')
      // 1 token da sessão original + 4 tentativas, nenhum socket novo.
      expect(h.tokens).toHaveLength(5)
      expect(h.sockets).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('chave ausente ou recusada na reconexão para na hora, sem esperar', async () => {
    vi.useFakeTimers()
    try {
      for (const error of ['no-key', 'key-rejected'] as const) {
        const h = harness({ tokenResult: (issued) => (issued === 1 ? undefined : { ok: false, error }) })
        h.sink.start(['mic'])
        await settle()
        h.sockets[0]?.open()
        h.sockets[0]?.drop()
        await vi.advanceTimersByTimeAsync(1_000)
        await settle()
        expect(h.sink.statusOf('mic')).toMatchObject({ status: error === 'no-key' ? 'no-key' : 'failed', error })
        await vi.advanceTimersByTimeAsync(20_000)
        expect(h.tokens).toHaveLength(2)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('"Tentar de novo" volta a conectar a fonte que falhou', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.sink.start(['mic'])
      await settle()
      h.sockets[0]?.open()
      for (let attempt = 0; attempt < 4; attempt++) {
        h.sockets.at(-1)?.drop()
        await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[attempt] as number)
        await settle()
      }
      h.sockets.at(-1)?.drop()
      expect(h.sink.statusOf('mic')?.status).toBe('failed')
      const count = h.sockets.length
      h.sink.retry('mic')
      await settle()
      expect(h.sockets.length).toBe(count + 1)
      h.sockets.at(-1)?.open()
      expect(h.sink.statusOf('mic')?.status).toBe('live')
    } finally {
      vi.useRealTimers()
    }
  })

  it('aos 170 min a sessão é trocada de forma planejada, sem aviso de reconexão', async () => {
    vi.useFakeTimers()
    try {
      const h = harness({ rotateAfterMs: 1_000, sessionIds: ['mic-a', 'mic-b'] })
      const statuses: string[] = []
      h.sink.start(['mic'])
      await settle()
      h.sockets[0]?.open()
      expect(SESSION_ROTATE_MS).toBe(170 * 60_000)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(h.sockets[0]?.text).toEqual([JSON.stringify({ type: 'Terminate' })])
      h.sockets[0]?.message({ type: 'Termination', audio_duration_seconds: 30 })
      await vi.advanceTimersByTimeAsync(0)
      await settle()
      statuses.push(h.sink.statusOf('mic')?.status ?? '')
      expect(h.sockets).toHaveLength(2)
      expect(h.tokens).toEqual(['tok-1', 'tok-2'])
      expect(statuses).not.toContain('reconnecting')
      h.sockets[1]?.open()
      h.sockets[1]?.message({ type: 'Turn', turn_order: 0, end_of_turn: false, transcript: 'oi', words: [{ text: 'oi', start: 100, end: 200 }] })
      expect(h.envelopes.at(-1)).toMatchObject({ sessionId: 'mic-b' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('"Ouvir só os participantes" (contrato 29)', () => {
  it('desligar fecha só o socket do mic, sem reconexão nem falha; religar abre sessão nova com token novo', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.sink.start(['mic', 'system'])
      await settle()
      h.sockets.forEach((socket) => socket.open())
      const [mic, system] = h.sockets
      h.sink.setSourceEnabled('mic', false)
      expect(mic?.text).toEqual([JSON.stringify({ type: 'Terminate' })])
      expect(system?.text).toEqual([])
      expect(h.sink.statusOf('mic')?.status).toBe('paused')
      expect(h.sink.statusOf('system')?.status).toBe('live')
      await vi.advanceTimersByTimeAsync(PAUSE_TERMINATION_TIMEOUT_MS + RECONNECT_DELAYS_MS.reduce((a, b) => a + b, 0))
      await settle()
      expect(mic?.closedWith?.code).toBe(1000)
      expect(system?.closedWith).toBeNull()
      // Nenhuma tentativa de reconexão nem aviso de falha: nada de socket novo.
      expect(h.sockets).toHaveLength(2)
      expect(h.statuses).not.toContain('reconnecting')
      expect(h.statuses).not.toContain('failed')
      h.sink.write(frame('mic', 1))
      expect(mic?.sent.filter((item) => typeof item !== 'string')).toHaveLength(0)
      // Pausar e retomar no meio não reabre o mic desligado; "Tentar de novo" também não.
      h.sink.pause()
      h.sink.resume()
      h.sink.retry('mic')
      await settle()
      expect(h.urls.filter((url) => url.includes('/mic?'))).toHaveLength(1)
      expect(h.sink.statusOf('mic')?.status).toBe('paused')

      h.sink.setSourceEnabled('mic', true)
      await settle()
      const reopened = h.sockets.at(-1)
      expect(h.urls.at(-1)).toContain('/mic?')
      reopened?.open()
      expect(h.sink.statusOf('mic')?.status).toBe('live')
      h.sink.write(frame('mic', 2))
      expect(reopened?.sent.filter((item) => typeof item !== 'string')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('religado durante a pausa, o mic só reabre na retomada; desligado antes do início, não abre', async () => {
    const h = harness()
    h.sink.setSourceEnabled('mic', false)
    h.sink.start(['mic', 'system'])
    await settle()
    expect(h.urls.map((url) => url.split('?')[0])).toEqual(['wss://exemplo/system'])
    expect(h.sink.statusOf('mic')?.status).toBe('paused')
    h.sink.pause()
    h.sink.setSourceEnabled('mic', true)
    await settle()
    expect(h.urls).toHaveLength(1)
    h.sink.resume()
    await settle()
    expect(h.urls.map((url) => url.split('?')[0]).sort()).toEqual(['wss://exemplo/mic', 'wss://exemplo/system', 'wss://exemplo/system'])
  })
})

describe('TranscriptionSession', () => {
  it('monta a URL com o mesmo construtor do app e as configurações da gravação', async () => {
    const urls: string[] = []
    const session = new TranscriptionSession({
      sources: ['system'],
      settings: { ...DEFAULT_SETTINGS, translationEnabled: false, identifySpeakers: true },
      elapsedMs: () => 0,
      getToken: () => Promise.resolve(token('tok-9')),
      openSocket: (url) => {
        urls.push(url)
        return new FakeSocket()
      },
      onMessage: () => undefined,
      newSessionId: () => 'sys-1',
    })
    session.start(['system'])
    await settle()
    expect(urls[0]).toContain('wss://streaming.assemblyai.com/v3/ws?')
    const query = new URL(urls[0] as string).searchParams
    expect(query.get('token')).toBe('tok-9')
    expect(query.get('speaker_labels')).toBe('true')
    expect(query.get('llm_gateway')).toBeNull()
  })
})
