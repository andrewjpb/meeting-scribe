// Cliente HTTP do serviço local do WhatsApp (contrato 24): só `127.0.0.1`, com `Authorization: Bearer <token>`
// em todo pedido, e toda resposta conferida com zod antes de chegar ao resto do app. O envio exige a prova de
// clique (`SendProof`, de `send-guard.ts`). `/events` é lido como SSE e reconectado pelo serviço do main. Nada
// daqui vai para log com texto de mensagem.
//
// Contrato 37: a mídia de uma mensagem (`media`) volta em bytes, não em JSON: leitor próprio, até 64 MB, com o
// `Content-Type` conferido (só `audio/`, `image/` e `video/`).
//
// Contrato 39: o envio de imagem ou vídeo é um POST com os bytes no corpo e o tipo, o nome e a legenda nos cabeçalhos
// (`X-Media-Mime`, `X-Media-Name`, `X-Caption`, os dois últimos com `encodeURIComponent`), só com a prova de clique.
//
// Contrato 34: a resposta (`send` com `replyToId`) e a reação (`react`) só com a prova de clique; a presença
// ("digitando…", `presence`) não é mensagem e não leva prova (o serviço do main só chama com o interruptor ligado). A
// citação, as reações e o "digitando…" que chegam são dados conferidos aqui: emoji só como texto curto, sem controle.
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { z } from 'zod'
import {
  WHATSAPP_MEDIA_MAX,
  WHATSAPP_MESSAGE_ID_PATTERN,
  WHATSAPP_REPLY_PREVIEW_MAX,
  WHATSAPP_SERVICE_STATES,
  WHATSAPP_CHAT_ID_PATTERN,
  type WhatsAppChat,
  type WhatsAppMe,
  type WhatsAppMessage,
  type WhatsAppPresence,
  type WhatsAppReaction,
  type WhatsAppReactionEmoji,
  type WhatsAppSearchHit,
  type WhatsAppServiceState,
} from '../../shared/whatsapp'
import { isSendProof, type SendProof } from './send-guard'

export const WHATSAPP_HOST = '127.0.0.1'
const REQUEST_TIMEOUT_MS = 15_000
const RESPONSE_MAX = 8 * 1024 * 1024
/** Contrato 37: o download da mídia pode demorar mais que um pedido comum (o serviço baixa do WhatsApp antes). */
const MEDIA_TIMEOUT_MS = 120_000
/** Contrato 39: o envio do anexo (o upload ao WhatsApp e, no vídeo, o ffmpeg) tem até 300 s. */
export const SEND_MEDIA_TIMEOUT_MS = 300_000
const MEDIA_MIME = /^(?:audio|image|video)\/[\w.+-]{1,60}(?:; ?[\w.+-]{1,40}=[\w.+"-]{1,40}){0,3}$/

const meSchema: z.ZodType<WhatsAppMe> = z.object({ name: z.string().max(200), phone: z.string().max(40) })
export const healthSchema = z.object({
  version: z.string().max(40),
  state: z.enum(WHATSAPP_SERVICE_STATES),
  me: meSchema.nullable(),
  /** Com o token: o id da instalação e o PID do serviço. */
  id: z.string().max(64).optional(),
  pid: z.number().int().positive().optional(),
})
const mediaSchema = z.object({
  kind: z.enum(['text', 'image', 'video', 'audio', 'document', 'sticker', 'other']),
  mime: z.string().max(100).nullable(),
  size: z.number().int().nonnegative().nullable(),
  name: z.string().max(200).nullable(),
  // Contrato 37: baixa no clique; a duração do áudio.
  downloadable: z.boolean().optional().catch(undefined),
  seconds: z.number().int().positive().max(86_400).optional().catch(undefined),
})
/** Contrato 34: o emoji recebido é texto curto, sem caractere de controle (nunca marcação nem instrução). */
const EMOJI_TEXT = /^[^\p{Cc}\p{Zl}\p{Zp}]{1,16}$/u
const reactionSchema: z.ZodType<WhatsAppReaction> = z.object({ emoji: z.string().regex(EMOJI_TEXT), count: z.number().int().positive().max(100_000), mine: z.boolean() })
export const reactionsSchema = z.array(reactionSchema).max(50)
export const messageSchema = z.object({
  id: z.string().min(1).max(200),
  chatId: z.string().min(1).max(200),
  author: z.string().max(200),
  fromMe: z.boolean(),
  at: z.number().int().nonnegative(),
  type: z.enum(['text', 'image', 'video', 'audio', 'document', 'sticker', 'other']),
  text: z.string().max(20_000),
  media: mediaSchema.nullable(),
  // Contrato 34: a citação e as reações; fora do formato, a mensagem chega sem elas.
  replyToId: z.string().regex(WHATSAPP_MESSAGE_ID_PATTERN).optional().catch(undefined),
  // A bridge corta em WHATSAPP_REPLY_PREVIEW_MAX pontos de código (Python); em UTF-16 isso pode dar o dobro.
  replyPreview: z.string().max(WHATSAPP_REPLY_PREVIEW_MAX * 2).optional().catch(undefined),
  reactions: reactionsSchema.optional().catch(undefined),
})
const chatSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(200),
  kind: z.enum(['person', 'group']),
  unread: z.number().int().nonnegative(),
  lastMessage: messageSchema.nullable(),
  // Contrato 25: o número de uma conversa `@lid`, quando o serviço sabe.
  phone: z
    .string()
    .regex(/^\+\d{6,15}$/)
    .optional(),
})
const pairSchema = z.object({ state: z.enum(WHATSAPP_SERVICE_STATES), qr: z.string().max(4000).nullable(), code: z.string().max(40).nullable() })
const chatsSchema = z.object({ chats: z.array(chatSchema).max(5000) })
const messagesSchema = z.object({ messages: z.array(messageSchema).max(1000) })
const searchSchema = z.object({ messages: z.array(messageSchema.extend({ chatName: z.string().max(200) })).max(1000) })
const sendSchema = z.object({ id: z.string().min(1).max(200) })
/** Contrato 32: a foto de perfil como data URL de imagem (até 512 KB em base64), ou `null`. */
export const PHOTO_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/
export const PHOTO_URL_MAX = 700_000
const photoSchema = z.object({ photo: z.string().max(PHOTO_URL_MAX).regex(PHOTO_DATA_URL).nullable().catch(null) })
const eventMessageSchema = messageSchema.extend({ chatName: z.string().max(200).nullable().optional() })
const chatIdText = z.string().regex(WHATSAPP_CHAT_ID_PATTERN)
const reactSchema = z.object({ reactions: reactionsSchema })
const okSchema = z.object({ ok: z.literal(true) })
const eventReactionsSchema = z.object({ chatId: chatIdText, messageId: z.string().regex(WHATSAPP_MESSAGE_ID_PATTERN), reactions: reactionsSchema })
const eventPresenceSchema: z.ZodType<WhatsAppPresence> = z.object({ chatId: chatIdText, state: z.enum(['composing', 'paused']), author: z.string().max(200).nullable().catch(null) })

export type WhatsAppHealth = z.infer<typeof healthSchema>

export class WhatsAppServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`serviço do WhatsApp respondeu ${status} (${code})`)
  }
}

export type BridgeEvent =
  | { type: 'state'; health: WhatsAppHealth }
  | { type: 'message'; message: WhatsAppMessage; chatName: string | null }
  /** As conversas mudaram de uma vez (histórico do celular, nomes achados depois): relê a lista. */
  | { type: 'chats' }
  /** Contrato 34: as reações de uma mensagem mudaram (todas, juntas por emoji). */
  | { type: 'reactions'; chatId: string; messageId: string; reactions: WhatsAppReaction[] }
  /** Contrato 34: alguém digitando (ou parou) numa conversa. */
  | { type: 'presence'; presence: WhatsAppPresence }

export interface BridgeClient {
  readonly port: number
  health(): Promise<WhatsAppHealth>
  pair(phone?: string): Promise<{ state: WhatsAppServiceState; qr: string | null; code: string | null }>
  logout(): Promise<WhatsAppHealth>
  chats(): Promise<WhatsAppChat[]>
  /** Com `before` e `beforeId`, o cursor (hora, id): as do mesmo milissegundo com id menor também vêm. */
  messages(chatId: string, options?: { before?: number; beforeId?: string; limit?: number }): Promise<WhatsAppMessage[]>
  search(term: string): Promise<WhatsAppSearchHit[]>
  /** Contrato 32: foto de perfil da conversa (data URL) ou `null`. */
  photo(chatId: string): Promise<string | null>
  /** Contrato 37: os bytes da mídia de uma mensagem (até 64 MB). Lança `WhatsAppServiceError` (404, 410, 413…). */
  media(chatId: string, messageId: string): Promise<{ mime: string; bytes: Buffer }>
  /** Só com a prova de um clique de verdade, para a mesma conversa. Contrato 34: com `replyToId`, como resposta. */
  send(proof: SendProof, chatId: string, text: string, replyToId?: string): Promise<string>
  /** Contrato 34: reagir (emoji vazio tira a sua), com a mesma prova de clique. Devolve as reações da mensagem. */
  react(proof: SendProof, chatId: string, messageId: string, emoji: WhatsAppReactionEmoji | ''): Promise<WhatsAppReaction[]>
  /** Contrato 34: "digitando…" ou "parou" da sua conta. Não é mensagem (sem prova); só com o interruptor ligado. */
  presence(chatId: string, state: 'composing' | 'paused'): Promise<void>
  /** Contrato 39: a imagem ou o vídeo, com a mesma prova. Lança `WhatsAppServiceError` (400, 409, 413, 502…). */
  sendMedia(proof: SendProof, chatId: string, media: { name: string; mime: string; bytes: Uint8Array; caption?: string | undefined }): Promise<string>
  /** SSE de `/events`; `onClose` quando a conexão cai. Devolve o que fecha. */
  events(onEvent: (event: BridgeEvent) => void, onClose: () => void): () => void
  /** Rotas do serviço falso (smoke): ler o QR, receber uma mensagem. */
  fake(action: string, body?: Record<string, unknown>): Promise<unknown>
}

function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    res.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > RESPONSE_MAX) {
        res.destroy()
        reject(new WhatsAppServiceError(0, 'too-large'))
        return
      }
      chunks.push(chunk)
    })
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    res.on('error', reject)
  })
}

const chatPath = (chatId: string): string => encodeURIComponent(chatId)

/** Contrato 37: o corpo em bytes, até `max` (o `Content-Length` maior que isso já recusa sem ler). */
function readBytes(res: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(res.headers['content-length'] ?? NaN)
    if (Number.isFinite(declared) && declared > max) {
      res.destroy()
      reject(new WhatsAppServiceError(413, 'too-big'))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    res.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > max) {
        res.destroy()
        reject(new WhatsAppServiceError(413, 'too-big'))
        return
      }
      chunks.push(chunk)
    })
    res.on('end', () => resolve(Buffer.concat(chunks)))
    res.on('error', reject)
  })
}

/** O código de erro do corpo JSON (`{"error": "gone"}`), ou `http`. */
function errorCode(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    const code = typeof parsed === 'object' && parsed !== null ? (parsed as { error?: unknown }).error : undefined
    return typeof code === 'string' ? code.slice(0, 40) : 'http'
  } catch {
    return 'http'
  }
}

export function createBridgeClient(port: number, token: string): BridgeClient {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error('porta inválida')
  const headers = { Authorization: `Bearer ${token}` }

  /** O pedido com o corpo (JSON ou, no contrato 39, os bytes do anexo) e a resposta JSON conferida com o `schema`. */
  function request<T>(method: 'GET' | 'POST', path: string, schema: z.ZodType<T>, body: { data: Uint8Array; headers: Record<string, string> } | undefined, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: WHATSAPP_HOST,
          port,
          method,
          path,
          headers: { ...headers, ...(body ? { ...body.headers, 'Content-Length': String(body.data.byteLength) } : {}) },
          timeout,
        },
        (res) => {
          readBody(res).then((text) => {
            let parsed: unknown
            try {
              parsed = JSON.parse(text)
            } catch {
              reject(new WhatsAppServiceError(res.statusCode ?? 0, 'json'))
              return
            }
            if ((res.statusCode ?? 0) !== 200) {
              const code = typeof parsed === 'object' && parsed !== null && typeof (parsed as { error?: unknown }).error === 'string' ? (parsed as { error: string }).error : 'http'
              reject(new WhatsAppServiceError(res.statusCode ?? 0, code.slice(0, 40)))
              return
            }
            const checked = schema.safeParse(parsed)
            if (checked.success) resolve(checked.data)
            else reject(new WhatsAppServiceError(200, 'schema'))
          }, reject)
        },
      )
      req.on('timeout', () => req.destroy(new WhatsAppServiceError(0, 'timeout')))
      req.on('error', reject)
      req.end(body?.data)
    })
  }

  function call<T>(method: 'GET' | 'POST', path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const data = body === undefined ? undefined : { data: Buffer.from(JSON.stringify(body), 'utf8'), headers: { 'Content-Type': 'application/json' } }
    return request(method, path, schema, data, REQUEST_TIMEOUT_MS)
  }

  /** Contrato 37: GET que responde bytes, com o tipo conferido; erro do serviço vem em JSON. */
  function callBinary(path: string): Promise<{ mime: string; bytes: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: WHATSAPP_HOST, port, method: 'GET', path, headers, timeout: MEDIA_TIMEOUT_MS }, (res) => {
        const status = res.statusCode ?? 0
        if (status !== 200) {
          readBody(res).then((text) => reject(new WhatsAppServiceError(status, errorCode(text))), reject)
          return
        }
        const mime = String(res.headers['content-type'] ?? '').trim()
        if (!MEDIA_MIME.test(mime)) {
          res.destroy()
          reject(new WhatsAppServiceError(200, 'mime'))
          return
        }
        readBytes(res, WHATSAPP_MEDIA_MAX).then((bytes) => {
          if (bytes.byteLength === 0) reject(new WhatsAppServiceError(200, 'empty'))
          else resolve({ mime, bytes })
        }, reject)
      })
      req.on('timeout', () => req.destroy(new WhatsAppServiceError(0, 'timeout')))
      req.on('error', reject)
      req.end()
    })
  }

  return {
    port,
    health: () => call('GET', '/health', healthSchema),
    pair: (phone) => call('GET', phone ? `/pair?phone=${encodeURIComponent(phone)}` : '/pair', pairSchema),
    logout: () => call('POST', '/logout', healthSchema, {}),
    chats: async () => (await call('GET', '/chats', chatsSchema)).chats,
    messages: async (chatId, options = {}) => {
      const query = new URLSearchParams()
      if (options.before !== undefined) query.set('before', String(Math.floor(options.before)))
      if (options.before !== undefined && options.beforeId !== undefined) query.set('beforeId', options.beforeId)
      if (options.limit !== undefined) query.set('limit', String(Math.floor(options.limit)))
      const suffix = query.size ? `?${query.toString()}` : ''
      return (await call('GET', `/chats/${chatPath(chatId)}/messages${suffix}`, messagesSchema)).messages
    },
    search: async (term) => (await call('GET', `/search?q=${encodeURIComponent(term)}`, searchSchema)).messages,
    photo: async (chatId) => (await call('GET', `/chats/${chatPath(chatId)}/photo`, photoSchema)).photo,
    media: (chatId, messageId) => callBinary(`/chats/${chatPath(chatId)}/messages/${encodeURIComponent(messageId)}/media`),
    send: async (proof, chatId, text, replyToId) => {
      if (!isSendProof(proof) || proof.chatId !== chatId) throw new WhatsAppServiceError(0, 'click')
      return (await call('POST', `/chats/${chatPath(chatId)}/send`, sendSchema, replyToId ? { text, replyToId } : { text })).id
    },
    react: async (proof, chatId, messageId, emoji) => {
      if (!isSendProof(proof) || proof.chatId !== chatId) throw new WhatsAppServiceError(0, 'click')
      return (await call('POST', `/chats/${chatPath(chatId)}/messages/${encodeURIComponent(messageId)}/react`, reactSchema, { emoji })).reactions
    },
    presence: async (chatId, state) => {
      await call('POST', `/chats/${chatPath(chatId)}/presence`, okSchema, { state })
    },
    sendMedia: async (proof, chatId, media) => {
      if (!isSendProof(proof) || proof.chatId !== chatId) throw new WhatsAppServiceError(0, 'click')
      const mediaHeaders: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'X-Media-Mime': media.mime,
        'X-Media-Name': encodeURIComponent(media.name),
        ...(media.caption ? { 'X-Caption': encodeURIComponent(media.caption) } : {}),
      }
      // O upload ao WhatsApp (e o quadro do vídeo) demora mais que um pedido comum.
      return (await request('POST', `/chats/${chatPath(chatId)}/send-media`, sendSchema, { data: media.bytes, headers: mediaHeaders }, SEND_MEDIA_TIMEOUT_MS)).id
    },
    fake: (action, body = {}) => call('POST', `/_fake/${action}`, z.unknown(), body),

    events(onEvent, onClose) {
      let closed = false
      const req = httpRequest({ host: WHATSAPP_HOST, port, method: 'GET', path: '/events', headers: { ...headers, Accept: 'text/event-stream' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return
        }
        res.setEncoding('utf8')
        let buffer = ''
        res.on('data', (chunk: string) => {
          buffer += chunk
          if (buffer.length > RESPONSE_MAX) {
            res.destroy()
            return
          }
          let end: number
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            const parsed = parseSseBlock(block)
            if (parsed) onEvent(parsed)
          }
        })
      })
      const finish = (): void => {
        if (closed) return
        closed = true
        onClose()
      }
      req.on('error', finish)
      req.on('close', finish)
      req.end()
      return () => {
        closed = true
        req.destroy()
      }
    },
  }
}

/**
 * `/health` sem token: o id da instalação que o serviço naquela porta diz ter. O app só manda o token para a porta
 * salva depois de este id bater com o guardado (outro programa na mesma porta não recebe o token).
 */
export function probeInstance(port: number): Promise<string | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return Promise.resolve(null)
  return new Promise((resolve) => {
    const req = httpRequest({ host: WHATSAPP_HOST, port, method: 'GET', path: '/health', timeout: 3000 }, (res) => {
      readBody(res).then(
        (text) => {
          try {
            const parsed = z.object({ id: z.string().max(64) }).safeParse(JSON.parse(text))
            resolve(res.statusCode === 200 && parsed.success ? parsed.data.id : null)
          } catch {
            resolve(null)
          }
        },
        () => resolve(null),
      )
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end()
  })
}

/** Um bloco do SSE (`event:` e `data:`) para um evento conferido; comentário e evento desconhecido são `null`. */
export function parseSseBlock(block: string): BridgeEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (!data.length) return null
  let payload: unknown
  try {
    payload = JSON.parse(data.join('\n'))
  } catch {
    return null
  }
  if (event === 'state') {
    const health = healthSchema.safeParse(payload)
    return health.success ? { type: 'state', health: health.data } : null
  }
  if (event === 'chats') return { type: 'chats' }
  if (event === 'reactions') {
    const reactions = eventReactionsSchema.safeParse(payload)
    return reactions.success ? { type: 'reactions', ...reactions.data } : null
  }
  if (event === 'presence') {
    const presence = eventPresenceSchema.safeParse(payload)
    return presence.success ? { type: 'presence', presence: presence.data } : null
  }
  if (event === 'message') {
    const message = eventMessageSchema.safeParse(payload)
    if (!message.success) return null
    const { chatName, ...rest } = message.data
    return { type: 'message', message: rest, chatName: chatName ?? null }
  }
  return null
}
