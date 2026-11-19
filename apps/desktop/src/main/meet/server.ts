// Quem fala no Meet (contrato 27, CA2): servidor local que recebe da extensão do Chrome os nomes dos
// participantes e os eventos "começou/parou de falar". `node:http` só em 127.0.0.1, na primeira porta livre de
// 47632 a 47641 (a extensão tenta na mesma ordem). Aceita só `POST /v1/eventos` vindo de `chrome-extension://`,
// em JSON, até 64 KB; qualquer outra coisa é 404 sem corpo. A resposta é sempre `{ ok: true }`: o app nunca
// devolve dado nenhum à extensão. Tudo que chega é dado (zod estrito, nomes cortados), nunca instrução.
// Contrato 48: o id da reunião segue para o estado, com a plataforma e o título que a página mostra (campos
// opcionais: a extensão antiga, sem eles, continua aceita).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import type { MeetPlatform, MeetSpeakingEvent, MeetState } from '../../shared/meet'

/** Portas que a extensão tenta, em ordem. */
export const MEET_PORTS: readonly number[] = Array.from({ length: 10 }, (_, index) => 47632 + index)
export const MEET_PATH = '/v1/eventos'
export const MEET_BODY_MAX_BYTES = 64 * 1024
export const MEET_NAME_MAX = 80
export const MEET_PARTICIPANTS_MAX = 100
export const MEET_EVENTS_MAX = 200
/** Título da reunião (contrato 48): só texto, numa linha, cortado em 120 caracteres. */
export const MEET_TITLE_MAX = 120
/** Sem envio há mais que isto, a extensão conta como desconectada. */
export const MEET_CONNECTED_MS = 15_000

/** Nome numa linha só, sem espaço sobrando, cortado em 80 caracteres. */
const nameSchema = z.string().transform((value) => value.replace(/\s+/g, ' ').trim().slice(0, MEET_NAME_MAX).trim())

/** Caractere de controle (abaixo do espaço e o DEL) vira espaço. */
const withoutControls = (value: string): string => Array.from(value, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)).join('')

/** Título numa linha só, sem caractere de controle, cortado em 120; vazio vira `null`. */
const titleSchema = z
  .string()
  .max(1000)
  .transform((value) => withoutControls(value).replace(/\s+/g, ' ').trim().slice(0, MEET_TITLE_MAX).trim() || null)

const bodySchema = z
  .object({
    reuniao: z.string().max(200),
    participantes: z.array(nameSchema).max(MEET_PARTICIPANTS_MAX),
    eventos: z
      .array(z.object({ nome: nameSchema, falando: z.boolean(), ts: z.number().finite() }).strict())
      .max(MEET_EVENTS_MAX),
    // Contrato 48: opcionais, a extensão de antes não manda.
    plataforma: z.enum(['meet', 'teams']).optional(),
    titulo: titleSchema.optional(),
  })
  .strict()

export interface MeetPost {
  meeting: string
  participants: string[]
  events: MeetSpeakingEvent[]
  plataforma: MeetPlatform | null
  titulo: string | null
}

/**
 * Plataforma pelo id, para a extensão antiga (sem `plataforma`): o Meet usa `abc-defg-hij`; o leitor do Teams
 * (contrato 41) manda `19:meeting_…@thread.v2`, `teams-live-<número>` ou `teams-<hash>`. Outro formato: `null`.
 */
export function platformOfMeeting(meeting: string): MeetPlatform | null {
  if (/^[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}$/.test(meeting)) return 'meet'
  if (meeting.startsWith('19:meeting_') || meeting.startsWith('teams-')) return 'teams'
  return null
}

/** Corpo de um envio já lido como JSON; `null` se não for o formato. Nome vazio sai; participante repetido também. */
export function parseMeetPost(raw: unknown): MeetPost | null {
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return null
  const participants = [...new Set(parsed.data.participantes.filter(Boolean))]
  const events = parsed.data.eventos
    .filter((event) => event.nome)
    .map((event) => ({ name: event.nome, speaking: event.falando, ts: event.ts }))
    // Estável: eventos com o mesmo `ts` ficam na ordem em que vieram.
    .sort((a, b) => a.ts - b.ts)
  const meeting = parsed.data.reuniao
  return { meeting, participants, events, plataforma: parsed.data.plataforma ?? platformOfMeeting(meeting), titulo: parsed.data.titulo ?? null }
}

/** Só a extensão: método, caminho, origem `chrome-extension://` e JSON. */
export function acceptsRequest(request: Pick<IncomingMessage, 'method' | 'url' | 'headers'>): boolean {
  const origin = request.headers.origin
  const type = request.headers['content-type']
  const path = (request.url ?? '').split('?')[0]
  return (
    request.method === 'POST' &&
    path === MEET_PATH &&
    typeof origin === 'string' &&
    origin.startsWith('chrome-extension://') &&
    typeof type === 'string' &&
    type.split(';')[0]?.trim().toLowerCase() === 'application/json'
  )
}

export interface MeetServer {
  /** Sobe na primeira porta livre; já no ar, devolve a mesma. `null` se as 10 estiverem ocupadas. */
  start(): Promise<number | null>
  /** Para e esquece o estado (a tela deixa de mostrar o Meet). */
  stop(): Promise<void>
  status(): MeetState
  port(): number | null
}

export interface MeetServerDeps {
  onChange: (state: MeetState) => void
  ports?: readonly number[]
  connectedMs?: number
  log?: (message: string) => void
}

function listenOn(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false)
      else reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, index) => value === b[index])

export function createMeetServer(deps: MeetServerDeps): MeetServer {
  const ports = deps.ports ?? MEET_PORTS
  const connectedMs = deps.connectedMs ?? MEET_CONNECTED_MS
  let server: Server | null = null
  let port: number | null = null
  let starting: Promise<number | null> | null = null
  let connected = false
  let participants: string[] = []
  let meeting: string | null = null
  let plataforma: MeetPlatform | null = null
  let titulo: string | null = null
  let expiry: ReturnType<typeof setTimeout> | null = null

  const snapshot = (events: MeetSpeakingEvent[]): MeetState => ({ connected, participants: [...participants], events, meeting, plataforma, titulo })
  const emit = (events: MeetSpeakingEvent[]): void => deps.onChange(snapshot(events))

  const clearExpiry = (): void => {
    if (expiry) clearTimeout(expiry)
    expiry = null
  }

  const disconnect = (): void => {
    clearExpiry()
    if (!connected && !participants.length && meeting === null) return
    connected = false
    participants = []
    meeting = null
    plataforma = null
    titulo = null
    emit([])
  }

  const receive = (post: MeetPost): void => {
    const changed = !connected || !sameList(participants, post.participants) || meeting !== post.meeting || plataforma !== post.plataforma || titulo !== post.titulo
    connected = true
    participants = post.participants
    meeting = post.meeting
    plataforma = post.plataforma
    titulo = post.titulo
    clearExpiry()
    expiry = setTimeout(disconnect, connectedMs)
    expiry.unref?.()
    if (changed || post.events.length) emit(post.events)
  }

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    const refuse = (): void => {
      if (!response.headersSent) response.writeHead(404, { connection: 'close' }).end()
      request.resume()
    }
    if (!acceptsRequest(request)) return refuse()
    const declared = Number(request.headers['content-length'] ?? 0)
    if (Number.isFinite(declared) && declared > MEET_BODY_MAX_BYTES) return refuse()
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    request.on('data', (chunk: Buffer) => {
      if (tooBig) return
      size += chunk.byteLength
      if (size > MEET_BODY_MAX_BYTES) {
        tooBig = true
        chunks.length = 0
        refuse()
        return
      }
      chunks.push(chunk)
    })
    request.on('error', () => undefined)
    request.on('end', () => {
      if (tooBig) return
      let raw: unknown
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return refuse()
      }
      const post = parseMeetPost(raw)
      if (!post) return refuse()
      receive(post)
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"ok":true}')
    })
  }

  async function listen(): Promise<number | null> {
    for (const candidate of ports) {
      const next = createServer(handler)
      // Conexão parada não segura o app: sem cabeçalho em 5 s, cai.
      next.headersTimeout = 5_000
      next.requestTimeout = 10_000
      try {
        if (await listenOn(next, candidate)) {
          server = next
          port = candidate
          deps.log?.(`[meet] ouvindo em 127.0.0.1:${candidate}`)
          return candidate
        }
      } catch {
        // Erro que não é porta ocupada: tenta a próxima.
      }
      next.close()
    }
    deps.log?.('[meet] nenhuma porta livre de 47632 a 47641')
    return null
  }

  return {
    start: () => {
      if (server) return Promise.resolve(port)
      if (!starting) {
        starting = listen().finally(() => {
          starting = null
        })
      }
      return starting
    },

    stop: async () => {
      await starting?.catch(() => null)
      const current = server
      server = null
      port = null
      disconnect()
      if (!current) return
      await new Promise<void>((resolve) => {
        current.close(() => resolve())
        current.closeAllConnections?.()
      })
      deps.log?.('[meet] parado')
    },

    status: () => snapshot([]),

    port: () => port,
  }
}
