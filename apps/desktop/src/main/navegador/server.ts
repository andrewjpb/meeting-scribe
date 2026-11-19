// Contrato 46 (plugin-navegador): ponte local com a extensão "Controle do navegador", no molde do servidor do
// Meet. `node:http` só em 127.0.0.1, na primeira porta livre de 47672 a 47681 (a extensão tenta na mesma ordem).
// Ida e volta por long-poll: a extensão faz `GET /v1/navegador/comandos` e o app segura até 25 s (responde o
// comando ou `{}`); ela executa e faz `POST /v1/navegador/resultados`. Só a origem `chrome-extension://`, só os
// dois caminhos, corpo até 512 KB; qualquer outra coisa é 404 sem corpo. Um comando por vez. O que volta da
// página é dado (zod estrito, textos cortados), nunca instrução.
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import { navegadorComandoSchema, navegadorDadosSchemas, navegadorResultadoSchema, type NavegadorComando, type NavegadorDados } from '../../shared/navegador'

/** Portas que a extensão tenta, em ordem. */
export const NAVEGADOR_PORTS: readonly number[] = Array.from({ length: 10 }, (_, index) => 47672 + index)
export const NAVEGADOR_COMANDOS_PATH = '/v1/navegador/comandos'
export const NAVEGADOR_RESULTADOS_PATH = '/v1/navegador/resultados'
/** O resultado de `ler` carrega o texto da página. */
export const NAVEGADOR_BODY_MAX_BYTES = 512 * 1024
/**
 * Sem GET nem POST há mais que isto, a extensão conta como desconectada; um GET ainda aberto ou um comando entregue
 * à espera do resultado seguram a conexão (o comando tem o próprio prazo de 30 s).
 */
export const NAVEGADOR_CONNECTED_MS = 35_000
/** Quanto o app segura o GET sem comando antes de responder `{}`. */
export const NAVEGADOR_POLL_MS = 25_000
/** Prazo de um comando, da chamada até o resultado. */
export const NAVEGADOR_TIMEOUT_MS = 30_000

/** Por que um comando não deu resultado. `extensao`: a própria extensão respondeu com erro (ex.: "janela fechada"). */
export type NavegadorErroMotivo = 'desligada' | 'desconectada' | 'ocupada' | 'tempo' | 'invalido' | 'extensao'

/** Recusa de `enviarComando`: o motivo para quem chama decidir, e a mensagem curta em pt-BR. */
export class NavegadorErro extends Error {
  readonly motivo: NavegadorErroMotivo
  constructor(motivo: NavegadorErroMotivo, message: string) {
    super(message)
    this.name = 'NavegadorErro'
    this.motivo = motivo
  }
}

const setSchema = z.object({ ativo: z.boolean() }).strict()

/** Pedido do `scribe:navegador-set` ("Ativar ponte"): o valor novo, ou `null` se não for o formato. */
export function parseNavegadorSet(raw: unknown): boolean | null {
  const parsed = setSchema.safeParse(raw)
  return parsed.success ? parsed.data.ativo : null
}

/**
 * Cabeçalho que a extensão manda em todo pedido. O Chrome não põe `Origin` no GET de um service worker com
 * `host_permissions` (o pedido não é CORS), então o GET chega sem origem. Uma página da web não consegue mandar
 * este cabeçalho para 127.0.0.1 sem um preflight OPTIONS, que aqui recebe 404 — o navegador barra o pedido.
 */
export const NAVEGADOR_HEADER = 'x-lap-navegador'

/**
 * Só a extensão: método e caminho conhecidos, o cabeçalho {@link NAVEGADOR_HEADER} e, se vier `Origin`, só
 * `chrome-extension://`; no POST, JSON.
 */
export function acceptsNavegadorRequest(request: Pick<IncomingMessage, 'method' | 'url' | 'headers'>): 'comandos' | 'resultados' | null {
  if (request.headers[NAVEGADOR_HEADER] !== '1') return null
  const origin = request.headers.origin
  if (origin !== undefined && !origin.startsWith('chrome-extension://')) return null
  const path = (request.url ?? '').split('?')[0]
  if (request.method === 'GET' && path === NAVEGADOR_COMANDOS_PATH) return 'comandos'
  const type = request.headers['content-type']
  if (request.method === 'POST' && path === NAVEGADOR_RESULTADOS_PATH && typeof type === 'string' && type.split(';')[0]?.trim().toLowerCase() === 'application/json') {
    return 'resultados'
  }
  return null
}

export interface NavegadorServer {
  /** Sobe na primeira porta livre; já no ar, devolve a mesma. `null` se as 10 estiverem ocupadas. */
  start(): Promise<number | null>
  /** Para, solta o GET pendurado e recusa o comando em curso ("ponte desligada"). */
  close(): Promise<void>
  port(): number | null
  /** A extensão fez GET ou POST há menos de 35 s. */
  connected(): boolean
  /**
   * Manda um comando à extensão e espera o resultado (até 30 s). Recusa na hora com a ponte desligada, a extensão
   * desconectada, um comando já em curso ("ponte ocupada") ou um comando fora do formato.
   */
  enviarComando<C extends NavegadorComando>(comando: C): Promise<NavegadorDados[C['tipo']]>
}

export interface NavegadorServerDeps {
  ports?: readonly number[]
  connectedMs?: number
  pollMs?: number
  timeoutMs?: number
  /** Conectou ou desconectou. */
  onChange?: (conectado: boolean) => void
  log?: (message: string) => void
}

interface Pendente {
  id: string
  comando: NavegadorComando
  /** Já foi entregue num GET: não vai de novo (clicar duas vezes não é a mesma coisa que uma). */
  entregue: boolean
  resolve: (dados: unknown) => void
  reject: (error: NavegadorErro) => void
  timer: ReturnType<typeof setTimeout>
}

interface Espera {
  response: ServerResponse
  timer: ReturnType<typeof setTimeout>
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

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }

export function createNavegadorServer(deps: NavegadorServerDeps = {}): NavegadorServer {
  const ports = deps.ports ?? NAVEGADOR_PORTS
  const connectedMs = deps.connectedMs ?? NAVEGADOR_CONNECTED_MS
  const pollMs = deps.pollMs ?? NAVEGADOR_POLL_MS
  const timeoutMs = deps.timeoutMs ?? NAVEGADOR_TIMEOUT_MS
  let server: Server | null = null
  let port: number | null = null
  let starting: Promise<number | null> | null = null
  let connected = false
  let expiry: ReturnType<typeof setTimeout> | null = null
  let pendente: Pendente | null = null
  const esperas = new Set<Espera>()

  const falhar = (motivo: NavegadorErroMotivo, message: string): void => {
    const atual = pendente
    if (!atual) return
    pendente = null
    clearTimeout(atual.timer)
    atual.reject(new NavegadorErro(motivo, message))
  }

  const disconnect = (): void => {
    if (expiry) clearTimeout(expiry)
    expiry = null
    // Sem a extensão, o comando em curso não tem mais quem responda.
    falhar('desconectada', 'extensão desconectada')
    if (!connected) return
    connected = false
    deps.onChange?.(false)
  }

  // Vencido o relógio: se a extensão ainda segura um GET ou está executando um comando entregue, ela está viva.
  const expire = (): void => {
    if (esperas.size > 0 || pendente?.entregue) return arm()
    disconnect()
  }

  const arm = (): void => {
    if (expiry) clearTimeout(expiry)
    expiry = setTimeout(expire, connectedMs)
    expiry.unref?.()
  }

  const markActive = (): void => {
    arm()
    if (connected) return
    connected = true
    deps.onChange?.(true)
  }

  const soltar = (espera: Espera, body: string): void => {
    esperas.delete(espera)
    clearTimeout(espera.timer)
    if (!espera.response.writableEnded) espera.response.writeHead(200, JSON_HEADERS).end(body)
  }

  const entregar = (espera: Espera, atual: Pendente): void => {
    atual.entregue = true
    // A entrega também é atividade: o relógio dos 35 s recomeça daqui.
    markActive()
    soltar(espera, JSON.stringify({ comando: { id: atual.id, ...atual.comando } }))
  }

  const refuse = (request: IncomingMessage, response: ServerResponse): void => {
    if (!response.headersSent) response.writeHead(404, { connection: 'close' }).end()
    request.resume()
  }

  const comandos = (request: IncomingMessage, response: ServerResponse): void => {
    request.resume()
    markActive()
    const espera: Espera = { response, timer: setTimeout(() => soltar(espera, '{}'), pollMs) }
    espera.timer.unref?.()
    if (pendente && !pendente.entregue) return entregar(espera, pendente)
    esperas.add(espera)
    // A extensão desistiu do GET (service worker parado, aba recarregada): não entrega o comando a ninguém.
    response.on('close', () => {
      esperas.delete(espera)
      clearTimeout(espera.timer)
    })
  }

  const resultado = (raw: unknown, response: ServerResponse, request: IncomingMessage): void => {
    const parsed = navegadorResultadoSchema.safeParse(raw)
    if (!parsed.success) return refuse(request, response)
    markActive()
    const atual = pendente
    // Resultado de um comando que já venceu (ou de outro): nada a fazer com ele.
    if (!atual || !atual.entregue || atual.id !== parsed.data.id) return refuse(request, response)
    response.writeHead(200, JSON_HEADERS).end('{"ok":true}')
    pendente = null
    clearTimeout(atual.timer)
    if (!parsed.data.ok) {
      atual.reject(new NavegadorErro('extensao', parsed.data.erro?.trim() || 'a extensão não conseguiu executar o comando'))
      return
    }
    const dados = navegadorDadosSchemas[atual.comando.tipo].safeParse(parsed.data.dados)
    if (dados.success) atual.resolve(dados.data)
    else atual.reject(new NavegadorErro('invalido', 'resposta da extensão fora do formato'))
  }

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    const kind = acceptsNavegadorRequest(request)
    if (!kind) return refuse(request, response)
    if (kind === 'comandos') return comandos(request, response)
    const declared = Number(request.headers['content-length'] ?? 0)
    if (Number.isFinite(declared) && declared > NAVEGADOR_BODY_MAX_BYTES) return refuse(request, response)
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    request.on('data', (chunk: Buffer) => {
      if (tooBig) return
      size += chunk.byteLength
      if (size > NAVEGADOR_BODY_MAX_BYTES) {
        tooBig = true
        chunks.length = 0
        refuse(request, response)
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
        return refuse(request, response)
      }
      resultado(raw, response, request)
    })
  }

  async function listen(): Promise<number | null> {
    for (const candidate of ports) {
      const next = createServer(handler)
      // Conexão parada não segura o app: sem cabeçalho em 5 s, cai. O GET do long-poll fica aberto até `pollMs`.
      next.headersTimeout = 5_000
      next.requestTimeout = Math.max(10_000, pollMs + 10_000)
      try {
        if (await listenOn(next, candidate)) {
          server = next
          port = candidate
          deps.log?.(`[navegador] ouvindo em 127.0.0.1:${candidate}`)
          return candidate
        }
      } catch {
        // Erro que não é porta ocupada: tenta a próxima.
      }
      next.close()
    }
    deps.log?.(`[navegador] nenhuma porta livre de ${ports[0] ?? '?'} a ${ports.at(-1) ?? '?'}`)
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

    close: async () => {
      await starting?.catch(() => null)
      const current = server
      server = null
      port = null
      falhar('desligada', 'ponte desligada')
      for (const espera of [...esperas]) soltar(espera, '{}')
      disconnect()
      if (!current) return
      await new Promise<void>((resolve) => {
        current.close(() => resolve())
        current.closeAllConnections?.()
      })
      deps.log?.('[navegador] parado')
    },

    port: () => port,

    connected: () => connected,

    enviarComando: <C extends NavegadorComando>(comando: C) => {
      const parsed = navegadorComandoSchema.safeParse(comando)
      if (!parsed.success) return Promise.reject(new NavegadorErro('invalido', 'comando fora do formato'))
      if (!server) return Promise.reject(new NavegadorErro('desligada', 'ponte desligada'))
      if (pendente) return Promise.reject(new NavegadorErro('ocupada', 'ponte ocupada'))
      if (!connected) return Promise.reject(new NavegadorErro('desconectada', 'extensão desconectada'))
      return new Promise<NavegadorDados[C['tipo']]>((resolve, reject) => {
        const atual: Pendente = {
          id: randomUUID(),
          comando: parsed.data,
          entregue: false,
          resolve: (dados) => resolve(dados as NavegadorDados[C['tipo']]),
          reject,
          timer: setTimeout(() => falhar('tempo', 'a extensão não respondeu a tempo'), timeoutMs),
        }
        atual.timer.unref?.()
        pendente = atual
        // A extensão já está esperando num GET: entrega agora; senão, vai no próximo.
        const espera = esperas.values().next().value
        if (espera) entregar(espera, atual)
      })
    },
  }
}
