// Cliente POP3 mínimo (contrato 42, R3 da PRD) sobre `node:net`/`node:tls`: `USER`/`PASS`, `STLS`, `UIDL`, `RETR`,
// `DELE` e `QUIT` (RFC 1939 e 2595). Não há biblioteca POP3 mantida e o protocolo é curto. Um comando por vez; a
// resposta de várias linhas termina em `.` sozinho e tem o ponto do começo das linhas desfeito. Com `starttls`, o
// servidor que recusar o `STLS` encerra a conexão: a senha nunca vai em texto puro sem a pessoa ter escolhido
// "nenhuma". Os erros são curtos e nunca levam a senha nem a resposta do servidor.
import { isIP, connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from 'node:tls'
import { EMAIL_RAW_MAX_BYTES, type EmailSecurity } from '../../shared/email'

export const POP3_TIMEOUT_MS = 30_000
/** Linha de status ou da lista: bem menos que isto. */
const LINE_MAX = 64 * 1024

export type Pop3ErrorKind = 'auth' | 'connection' | 'tls' | 'timeout' | 'protocol' | 'too-big'

export class Pop3Error extends Error {
  constructor(
    readonly kind: Pop3ErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'Pop3Error'
  }
}

export interface Pop3Config {
  host: string
  port: number
  security: EmailSecurity
  user: string
  pass: string
  /** Opções extras do TLS (nos testes, o certificado do servidor falso). */
  tls?: ConnectionOptions | undefined
  timeoutMs?: number | undefined
}

export interface Pop3Session {
  /** `UIDL`: número da mensagem nesta sessão → id único dela no servidor. */
  uidl(): Promise<Map<number, string>>
  /** `LIST`: número da mensagem → tamanho em octetos (a grande demais nem chega ao `RETR`). */
  sizes(): Promise<Map<number, number>>
  /** `RETR`: a mensagem inteira, como veio (sem o ponto de escape). */
  retr(number: number): Promise<Buffer>
  /** `DELE`: apaga no `QUIT`. */
  dele(number: number): Promise<void>
  /** `QUIT` e fecha. */
  quit(): Promise<void>
  /** Fecha sem `QUIT` (nada marcado com `DELE` é apagado). */
  close(): void
}

export type Pop3Connect = (config: Pop3Config) => Promise<Pop3Session>

const CRLF = Buffer.from('\r\n')
const END = Buffer.from('\r\n.\r\n')

/** Desfaz o ponto de escape (`..x` → `.x`) do corpo de uma resposta de várias linhas. */
export function unstuff(body: Buffer): Buffer {
  const text = body.toString('latin1')
  return Buffer.from(text.replace(/(^|\r\n)\.\./g, '$1.'), 'latin1')
}

/** Uma linha não pode levar CR, LF ou NUL: senão vira outro comando no servidor. */
const safeArgument = (value: string): boolean => !/[\r\n\0]/.test(value)

class Connection {
  private buffer = Buffer.alloc(0)
  private waiter: (() => void) | null = null
  private failure: Pop3Error | null = null
  private readonly onData = (chunk: Buffer): void => {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.buffer.length > EMAIL_RAW_MAX_BYTES + LINE_MAX) this.fail(new Pop3Error('too-big', 'Mensagem grande demais.'))
    this.waiter?.()
  }
  private readonly onEnd = (): void => this.fail(new Pop3Error('connection', 'O servidor fechou a conexão.'))
  private readonly onError = (error: Error): void => this.fail(networkError(error))
  private readonly onTimeout = (): void => this.fail(new Pop3Error('timeout', 'O servidor não respondeu a tempo.'))

  constructor(
    private socket: Socket | TLSSocket,
    private readonly timeoutMs: number,
  ) {
    this.attach()
  }

  private attach(): void {
    this.socket.setTimeout(this.timeoutMs)
    this.socket.on('data', this.onData)
    this.socket.on('end', this.onEnd)
    this.socket.on('close', this.onEnd)
    this.socket.on('error', this.onError)
    this.socket.on('timeout', this.onTimeout)
  }

  private detach(): void {
    this.socket.off('data', this.onData)
    this.socket.off('end', this.onEnd)
    this.socket.off('close', this.onEnd)
    this.socket.off('error', this.onError)
    this.socket.off('timeout', this.onTimeout)
  }

  private fail(error: Pop3Error): void {
    if (!this.failure) this.failure = error
    this.socket.destroy()
    this.waiter?.()
  }

  /** Espera até `ready` achar o fim da resposta no buffer; devolve o que ela consumiu. */
  private async until(find: () => number): Promise<Buffer> {
    for (;;) {
      const end = find()
      if (end >= 0) {
        const chunk = this.buffer.subarray(0, end)
        this.buffer = this.buffer.subarray(end)
        return chunk
      }
      if (this.failure) throw this.failure
      await new Promise<void>((resolve) => (this.waiter = resolve))
      this.waiter = null
    }
  }

  /** Linha de status (`+OK …` ou `-ERR …`), sem o CRLF. */
  async status(): Promise<{ ok: boolean; line: string }> {
    const line = await this.until(() => {
      const at = this.buffer.indexOf(CRLF)
      if (at < 0 && this.buffer.length > LINE_MAX) this.fail(new Pop3Error('protocol', 'Resposta inválida do servidor.'))
      return at < 0 ? -1 : at + CRLF.length
    })
    const text = line.subarray(0, line.length - CRLF.length).toString('latin1')
    if (text.startsWith('+OK')) return { ok: true, line: text }
    if (text.startsWith('-ERR')) return { ok: false, line: text }
    throw new Pop3Error('protocol', 'Resposta inválida do servidor.')
  }

  /** Corpo de uma resposta de várias linhas, já sem o `.` final e sem o ponto de escape. */
  async multiline(): Promise<Buffer> {
    // A linha de status já saiu: o corpo pode ser vazio (`.` logo em seguida).
    const body = await this.until(() => {
      if (this.buffer.subarray(0, 3).equals(Buffer.from('.\r\n'))) return 3
      const at = this.buffer.indexOf(END)
      return at < 0 ? -1 : at + END.length
    })
    if (body.length === 3) return Buffer.alloc(0)
    return unstuff(body.subarray(0, body.length - END.length + CRLF.length))
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`, 'latin1')
  }

  async command(line: string): Promise<{ ok: boolean; line: string }> {
    if (this.failure) throw this.failure
    this.write(line)
    return this.status()
  }

  /** `STLS` aceito: a mesma conexão sobe para TLS antes de qualquer senha. */
  async upgrade(options: ConnectionOptions): Promise<void> {
    this.detach()
    const plain = this.socket
    const secure = await new Promise<TLSSocket>((resolve, reject) => {
      const upgraded = tlsConnect({ ...options, socket: plain }, () => resolve(upgraded))
      upgraded.once('error', reject)
    }).catch((error: unknown) => {
      plain.destroy()
      throw networkError(error)
    })
    this.socket = secure
    this.buffer = Buffer.alloc(0)
    this.attach()
  }

  destroy(): void {
    this.detach()
    this.socket.destroy()
  }

  end(): void {
    this.detach()
    this.socket.end()
  }
}

/** Erro do `net`/`tls` num tipo curto, sem a mensagem original. */
function networkError(error: unknown): Pop3Error {
  if (error instanceof Pop3Error) return error
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
  if (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return new Pop3Error('tls', 'Falha na conexão segura (TLS).')
  if (code === 'ETIMEDOUT') return new Pop3Error('timeout', 'O servidor não respondeu a tempo.')
  return new Pop3Error('connection', 'Servidor fora do ar ou inacessível.')
}

/** SNI só com nome: o Node recusa IP como `servername`. */
const serverName = (host: string): { servername?: string } => (isIP(host) ? {} : { servername: host })

function open(config: Pop3Config, timeoutMs: number): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsOptions: ConnectionOptions = { ...config.tls, host: config.host, port: config.port, ...serverName(config.host) }
    const socket = config.security === 'tls' ? tlsConnect(tlsOptions) : netConnect({ host: config.host, port: config.port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Pop3Error('timeout', 'O servidor não respondeu a tempo.'))
    }, timeoutMs)
    socket.once(config.security === 'tls' ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer)
      socket.removeAllListeners('error')
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(networkError(error))
    })
  })
}

export const connectPop3: Pop3Connect = async (config) => {
  if (!safeArgument(config.user) || !safeArgument(config.pass)) throw new Pop3Error('auth', 'Usuário ou senha recusados.')
  const timeoutMs = config.timeoutMs ?? POP3_TIMEOUT_MS
  const connection = new Connection(await open(config, timeoutMs), timeoutMs)
  try {
    if (!(await connection.status()).ok) throw new Pop3Error('connection', 'O servidor recusou a conexão.')
    if (config.security === 'starttls') {
      if (!(await connection.command('STLS')).ok) throw new Pop3Error('tls', 'O servidor não oferece conexão segura (STLS).')
      await connection.upgrade({ ...config.tls, ...serverName(config.host) })
    }
    if (!(await connection.command(`USER ${config.user}`)).ok) throw new Pop3Error('auth', 'Usuário ou senha recusados.')
    if (!(await connection.command(`PASS ${config.pass}`)).ok) throw new Pop3Error('auth', 'Usuário ou senha recusados.')
  } catch (error) {
    connection.destroy()
    throw error
  }

  const expectOk = async (line: string): Promise<void> => {
    if (!(await connection.command(line)).ok) throw new Pop3Error('protocol', 'O servidor recusou o comando.')
  }

  return {
    async uidl() {
      await expectOk('UIDL')
      const list = new Map<number, string>()
      for (const line of (await connection.multiline()).toString('latin1').split('\r\n')) {
        const match = /^(\d+) ([\x21-\x7e]{1,70})$/.exec(line)
        if (match?.[1] && match[2]) list.set(Number(match[1]), match[2])
      }
      return list
    },

    async sizes() {
      await expectOk('LIST')
      const list = new Map<number, number>()
      for (const line of (await connection.multiline()).toString('latin1').split('\r\n')) {
        const match = /^(\d+) (\d{1,15})/.exec(line)
        if (match?.[1] && match[2]) list.set(Number(match[1]), Number(match[2]))
      }
      return list
    },

    async retr(number) {
      await expectOk(`RETR ${Math.trunc(number)}`)
      return connection.multiline()
    },

    async dele(number) {
      await expectOk(`DELE ${Math.trunc(number)}`)
    },

    async quit() {
      await connection.command('QUIT').catch(() => undefined)
      connection.end()
    },

    close() {
      connection.destroy()
    },
  }
}
