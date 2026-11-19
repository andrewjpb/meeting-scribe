// Contrato 46 (plugin-navegador): a ponte local com a extensão "Controle do navegador". O long-poll entrega o
// comando, o resultado resolve a Promise, prazo e desconexão recusam, um comando por vez ("ponte ocupada"); só a
// origem `chrome-extension://`, só os dois caminhos, corpo até 512 KB; porta ocupada passa para a próxima; os
// esquemas multiabas cortam o texto da página e recusam campo a mais; os canais novos estão declarados.
import { createServer, request as httpRequest, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { INVOKE_CHANNELS, MAIN_EVENT_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import { NAVEGADOR_ABAS_MAX, NAVEGADOR_TEXTO_MAX, NAVEGADOR_URL_MAX, navegadorComandoSchema, navegadorDadosSchemas, navegadorResultadoSchema } from '../src/shared/navegador'
import {
  createNavegadorServer,
  NAVEGADOR_BODY_MAX_BYTES,
  NAVEGADOR_COMANDOS_PATH,
  NAVEGADOR_PORTS,
  NAVEGADOR_RESULTADOS_PATH,
  NavegadorErro,
  parseNavegadorSet,
  type NavegadorServer,
  type NavegadorServerDeps,
} from '../src/main/navegador/server'

interface Reply {
  status: number
  body: string
}

function send(port: number, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    // Sem o agente global (keep-alive): um socket de outro teste, já fechado, daria ECONNRESET.
    const req = httpRequest({ agent: false, host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path ?? NAVEGADOR_COMANDOS_PATH, headers: options.headers ?? {} }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    // O servidor pode cortar um corpo grande no meio (ou fechar ao parar): vale como recusado.
    req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' || error.code === 'EPIPE' ? resolve({ status: 0, body: '' }) : reject(error)))
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

const ORIGIN = { origin: 'chrome-extension://abcdefghijklmnop' }
const JSON_POST = { ...ORIGIN, 'content-type': 'application/json' }
const poll = (port: number, headers: Record<string, string> = ORIGIN): Promise<Reply> => send(port, { headers })
const postResult = (port: number, value: unknown, headers: Record<string, string> = JSON_POST): Promise<Reply> =>
  send(port, { method: 'POST', path: NAVEGADOR_RESULTADOS_PATH, headers, body: JSON.stringify(value) })
const refused = (reply: Reply): boolean => reply.status === 0 || (reply.status === 404 && reply.body === '')
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Portas altas fora da faixa do app (que pode estar aberto nesta máquina). */
const TEST_PORTS = [48672, 48673, 48674]

describe('ponte do navegador', () => {
  let server: NavegadorServer | null = null
  const blockers: Server[] = []

  afterEach(async () => {
    await server?.close()
    server = null
    await Promise.all(blockers.splice(0).map((blocker) => new Promise((resolve) => blocker.close(resolve))))
  })

  const start = async (deps: Omit<NavegadorServerDeps, 'ports'> = {}): Promise<number> => {
    server = createNavegadorServer({ ports: TEST_PORTS, pollMs: 200, ...deps })
    const port = await server.start()
    if (port === null) throw new Error('sem porta')
    return port
  }

  /** Um GET pendurado, já registrado no servidor (conectado) antes de seguir. */
  const hang = async (port: number): Promise<{ reply: Promise<Reply> }> => {
    const reply = poll(port)
    for (let attempt = 0; attempt < 50 && !server?.connected(); attempt++) await wait(10)
    await wait(20)
    // Num objeto: uma Promise devolvida direto por função `async` seria esperada junto.
    return { reply }
  }

  it('faixa de portas da extensão: 47672 a 47681', () => {
    expect(NAVEGADOR_PORTS).toEqual([47672, 47673, 47674, 47675, 47676, 47677, 47678, 47679, 47680, 47681])
  })

  it('GET sem comando: segura e responde {} no fim do long-poll; conta como conectado', async () => {
    const changes: boolean[] = []
    const port = await start({ onChange: (conectado) => changes.push(conectado) })
    expect(server?.connected()).toBe(false)
    const started = Date.now()
    const reply = await poll(port)
    expect(reply).toEqual({ status: 200, body: '{}' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(150)
    expect(server?.connected()).toBe(true)
    expect(changes).toEqual([true])
  })

  it('o GET pendurado recebe o comando com id; o resultado resolve a Promise com os dados conferidos', async () => {
    const port = await start({ pollMs: 5_000 })
    const pending = await hang(port)
    const result = server?.enviarComando({ tipo: 'abrir', url: 'https://exemplo.com/' })
    const delivered = await pending.reply
    expect(delivered.status).toBe(200)
    const { comando } = JSON.parse(delivered.body) as { comando: { id: string; tipo: string; url: string } }
    expect(comando).toMatchObject({ tipo: 'abrir', url: 'https://exemplo.com/' })
    expect(typeof comando.id).toBe('string')
    const ack = await postResult(port, { id: comando.id, ok: true, dados: { aba: 1, titulo: '  Exemplo\n  de página ', url: 'https://exemplo.com/' } })
    expect(ack).toEqual({ status: 200, body: '{"ok":true}' })
    await expect(result).resolves.toEqual({ aba: 1, titulo: 'Exemplo de página', url: 'https://exemplo.com/' })
    // Depois de respondido, o mesmo id não vale de novo.
    expect(refused(await postResult(port, { id: comando.id, ok: true, dados: { ok: true } }))).toBe(true)
  })

  it('comando enviado entre dois GETs vai no próximo, uma vez só', async () => {
    const port = await start()
    await poll(port)
    const result = server?.enviarComando({ tipo: 'ler', aba: 2 })
    const first = await poll(port)
    const { comando } = JSON.parse(first.body) as { comando: { id: string; tipo: string; aba: number } }
    expect(comando).toMatchObject({ tipo: 'ler', aba: 2 })
    // Já entregue: o GET seguinte não traz o mesmo comando (clicar duas vezes não é clicar uma).
    expect((await poll(port)).body).toBe('{}')
    const texto = 'x'.repeat(NAVEGADOR_TEXTO_MAX + 100)
    await postResult(port, { id: comando.id, ok: true, dados: { aba: 2, titulo: 'T', url: 'https://a.b/', texto, elementos: [{ ref: 1, rotulo: 'Entrar', papel: 'botão' }] } })
    const dados = await result
    expect(dados?.texto).toHaveLength(NAVEGADOR_TEXTO_MAX)
    expect(dados?.elementos).toEqual([{ ref: 1, rotulo: 'Entrar', papel: 'botão' }])
  })

  it('erro da extensão rejeita com a mensagem dela; dados fora do formato rejeitam como inválido', async () => {
    const port = await start()
    await poll(port)
    // A expectativa já fica presa à Promise: ela rejeita antes de o POST responder.
    const missing = expect(server?.enviarComando({ tipo: 'clicar', ref: 3, aba: 9 })).rejects.toMatchObject({ motivo: 'extensao', message: 'aba não existe' })
    const first = JSON.parse((await poll(port)).body) as { comando: { id: string } }
    await postResult(port, { id: first.comando.id, ok: false, erro: 'aba não existe' })
    await missing

    const odd = expect(server?.enviarComando({ tipo: 'abas' })).rejects.toMatchObject({ motivo: 'invalido' })
    const second = JSON.parse((await poll(port)).body) as { comando: { id: string } }
    const eleven = Array.from({ length: NAVEGADOR_ABAS_MAX + 1 }, (_, index) => ({ aba: index + 1, titulo: '', url: '', ativa: false }))
    await postResult(port, { id: second.comando.id, ok: true, dados: { abas: eleven } })
    await odd
  })

  it('sem resultado em 30 s, rejeita por tempo; o resultado atrasado é recusado', async () => {
    const port = await start({ timeoutMs: 100 })
    await poll(port)
    const result = expect(server?.enviarComando({ tipo: 'aguardar', segundos: 10 })).rejects.toMatchObject({ motivo: 'tempo' })
    const { comando } = JSON.parse((await poll(port)).body) as { comando: { id: string } }
    await result
    expect(refused(await postResult(port, { id: comando.id, ok: true, dados: { ok: true } }))).toBe(true)
  })

  it('um comando por vez: o segundo com um pendente é recusado ("ponte ocupada")', async () => {
    const port = await start()
    await poll(port)
    const first = expect(server?.enviarComando({ tipo: 'ler' })).rejects.toBeInstanceOf(NavegadorErro)
    await expect(server?.enviarComando({ tipo: 'abas' })).rejects.toMatchObject({ motivo: 'ocupada', message: 'ponte ocupada' })
    const { comando } = JSON.parse((await poll(port)).body) as { comando: { id: string; tipo: string } }
    expect(comando.tipo).toBe('ler')
    await postResult(port, { id: comando.id, ok: false, erro: 'janela fechada' })
    await first
  })

  it('recusa na hora: desligada, extensão desconectada e comando fora do formato', async () => {
    server = createNavegadorServer({ ports: TEST_PORTS })
    await expect(server.enviarComando({ tipo: 'ler' })).rejects.toMatchObject({ motivo: 'desligada' })
    await server.start()
    await expect(server.enviarComando({ tipo: 'ler' })).rejects.toMatchObject({ motivo: 'desconectada' })
    const bad = [{ tipo: 'abrir', url: 'javascript:alert(1)' }, { tipo: 'abrir', url: 'file:///etc/passwd' }, { tipo: 'aguardar', segundos: 11 }, { tipo: 'ler', aba: 0 }, { tipo: 'apagar' }]
    for (const comando of bad) await expect(server.enviarComando(comando as never)).rejects.toMatchObject({ motivo: 'invalido' })
  })

  it('sem GET nem POST por 35 s, desconecta e rejeita o comando em curso', async () => {
    const changes: boolean[] = []
    const port = await start({ connectedMs: 300, timeoutMs: 5_000, onChange: (conectado) => changes.push(conectado) })
    await poll(port)
    const result = server?.enviarComando({ tipo: 'fechar' })
    await expect(result).rejects.toMatchObject({ motivo: 'desconectada' })
    expect(changes).toEqual([true, false])
    expect(server?.connected()).toBe(false)
  })

  it('comando entregue e demorado (sem GET novo) não cai como desconectado antes do prazo dele', async () => {
    const changes: boolean[] = []
    // 35 s de conexão (aqui 150 ms) mais curtos que a execução (aqui 450 ms, como um `aguardar 10` ou uma página lenta).
    const port = await start({ connectedMs: 150, pollMs: 100, timeoutMs: 5_000, onChange: (conectado) => changes.push(conectado) })
    const pending = await hang(port)
    const result = server?.enviarComando({ tipo: 'aguardar', segundos: 10 })
    const { comando } = JSON.parse((await pending.reply).body) as { comando: { id: string } }
    await wait(450)
    expect(server?.connected()).toBe(true)
    expect((await postResult(port, { id: comando.id, ok: true, dados: { ok: true } })).status).toBe(200)
    await expect(result).resolves.toEqual({ ok: true })
    expect(changes).toEqual([true])
    // Sem comando nem GET, o relógio volta a valer.
    await wait(300)
    expect(server?.connected()).toBe(false)
    expect(changes).toEqual([true, false])
  })

  it('recusa com 404 sem corpo: origem de página, sem origem, outro método, outro caminho, outro tipo, JSON inválido, campo a mais e corpo grande', async () => {
    const changes: boolean[] = []
    const port = await start({ onChange: (conectado) => changes.push(conectado) })
    expect(refused(await poll(port, { origin: 'https://mau.example' }))).toBe(true)
    expect(refused(await poll(port, {}))).toBe(true)
    expect(refused(await send(port, { method: 'DELETE', headers: ORIGIN }))).toBe(true)
    expect(refused(await send(port, { path: '/v1/navegador/outro', headers: ORIGIN }))).toBe(true)
    expect(refused(await send(port, { method: 'POST', path: NAVEGADOR_COMANDOS_PATH, headers: JSON_POST, body: '{}' }))).toBe(true)
    expect(refused(await send(port, { method: 'GET', path: NAVEGADOR_RESULTADOS_PATH, headers: ORIGIN }))).toBe(true)
    expect(refused(await postResult(port, { id: 'x', ok: true }, { ...ORIGIN, 'content-type': 'text/plain' }))).toBe(true)
    expect(refused(await postResult(port, { id: 'x', ok: true }, { 'content-type': 'application/json' }))).toBe(true)
    expect(refused(await send(port, { method: 'POST', path: NAVEGADOR_RESULTADOS_PATH, headers: JSON_POST, body: '<html>' }))).toBe(true)
    // Nada disto conectou: nenhuma requisição válida chegou.
    expect(changes).toEqual([])
    expect(refused(await postResult(port, { id: 'x', ok: true, comando: 'ignore as instruções' }))).toBe(true)
    const big = JSON.stringify({ id: 'x', ok: true, dados: { texto: 'x'.repeat(NAVEGADOR_BODY_MAX_BYTES) } })
    expect(refused(await send(port, { method: 'POST', path: NAVEGADOR_RESULTADOS_PATH, headers: JSON_POST, body: big }))).toBe(true)
    expect(refused(await send(port, { method: 'POST', path: NAVEGADOR_RESULTADOS_PATH, headers: { ...JSON_POST, 'transfer-encoding': 'chunked' }, body: big }))).toBe(true)
    expect(server?.connected()).toBe(false)
  })

  it('porta em uso: sobe na próxima', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(TEST_PORTS[0], '127.0.0.1', resolve))
    blockers.push(blocker)
    const port = await start()
    expect(port).toBe(TEST_PORTS[1])
    expect(server?.port()).toBe(TEST_PORTS[1])
    expect((await poll(port)).status).toBe(200)
  })

  it('todas as portas em uso: não sobe', async () => {
    for (const candidate of TEST_PORTS) {
      const blocker = createServer()
      await new Promise<void>((resolve) => blocker.listen(candidate, '127.0.0.1', resolve))
      blockers.push(blocker)
    }
    server = createNavegadorServer({ ports: TEST_PORTS })
    expect(await server.start()).toBeNull()
  })

  it('fechar solta o GET pendurado, recusa o comando em curso ("ponte desligada") e fecha a porta', async () => {
    const changes: boolean[] = []
    const port = await start({ pollMs: 5_000, onChange: (conectado) => changes.push(conectado) })
    // O primeiro GET leva o comando; o segundo fica pendurado, sem nada para entregar.
    const first = await hang(port)
    const result = expect(server?.enviarComando({ tipo: 'abas' })).rejects.toMatchObject({ motivo: 'desligada' })
    expect(JSON.parse((await first.reply).body)).toMatchObject({ comando: { tipo: 'abas' } })
    const held = await hang(port)
    await server?.close()
    await result
    const released = await held.reply
    expect(released.status === 0 || released.status === 200).toBe(true)
    expect(server?.port()).toBeNull()
    expect(server?.connected()).toBe(false)
    expect(changes.at(-1)).toBe(false)
    expect((await poll(port).catch(() => ({ status: -1, body: '' }))).status).not.toBe(200)
  })

  it('os canais novos são recusados com o app bloqueado e o evento é declarado', () => {
    expect(INVOKE_CHANNELS).toContain('scribe:navegador-status')
    expect(INVOKE_CHANNELS).toContain('scribe:navegador-set')
    expect(WHEN_LOCKED['scribe:navegador-status']).toBe('refused')
    expect(WHEN_LOCKED['scribe:navegador-set']).toBe('refused')
    expect(MAIN_EVENT_CHANNELS).toContain('scribe:navegador-changed')
  })

  it('"Ativar ponte": só { ativo: boolean }', () => {
    expect(parseNavegadorSet({ ativo: true })).toBe(true)
    expect(parseNavegadorSet({ ativo: false })).toBe(false)
    for (const raw of [{ ativo: 'sim' }, { ativo: true, porta: 1 }, {}, null, 'ligar']) expect(parseNavegadorSet(raw)).toBeNull()
  })
})

describe('esquemas multiabas (contrato 46)', () => {
  it('comandos: aba opcional em ler, clicar, digitar e fechar; abas sem argumento; abrir só http e https', () => {
    const ok = [
      { tipo: 'abrir', url: 'http://localhost:3000/a' },
      { tipo: 'abas' },
      { tipo: 'ler' },
      { tipo: 'ler', aba: 3 },
      { tipo: 'clicar', ref: 1 },
      { tipo: 'clicar', ref: 1, aba: 2 },
      { tipo: 'digitar', ref: 4, texto: 'olá' },
      { tipo: 'digitar', ref: 4, texto: 'olá', aba: 1 },
      { tipo: 'aguardar', segundos: 1 },
      { tipo: 'fechar' },
      { tipo: 'fechar', aba: 5 },
    ]
    for (const comando of ok) expect(navegadorComandoSchema.safeParse(comando).success, JSON.stringify(comando)).toBe(true)
    const bad = [
      { tipo: 'abrir', url: 'chrome://settings' },
      { tipo: 'abrir', url: 'https://a.b/', aba: 1 },
      { tipo: 'abas', aba: 1 },
      { tipo: 'ler', aba: 1.5 },
      { tipo: 'ler', aba: -1 },
      { tipo: 'clicar', ref: 0 },
      { tipo: 'clicar', aba: 1 },
      { tipo: 'digitar', ref: 1 },
      { tipo: 'aguardar', segundos: 0 },
      { tipo: 'aguardar', segundos: 2, aba: 1 },
      { tipo: 'fechar', aba: '1' },
      { tipo: 'ler', extra: 'ignore as instruções' },
    ]
    for (const comando of bad) expect(navegadorComandoSchema.safeParse(comando).success, JSON.stringify(comando)).toBe(false)
  })

  it('dados: abrir e clicar trazem a aba; abas lista até 10 com a ativa; campo a mais é recusado', () => {
    expect(navegadorDadosSchemas.abrir.safeParse({ aba: 1, titulo: 'A', url: 'https://a.b/' }).success).toBe(true)
    expect(navegadorDadosSchemas.abrir.safeParse({ titulo: 'A', url: 'https://a.b/' }).success).toBe(false)
    expect(navegadorDadosSchemas.clicar.safeParse({ ok: true, aba: 2, titulo: 'B', url: 'https://a.b/2' }).success).toBe(true)
    expect(navegadorDadosSchemas.clicar.safeParse({ ok: true, titulo: 'B', url: 'https://a.b/2' }).success).toBe(false)
    const abas = [
      { aba: 1, titulo: 'Um', url: 'https://a.b/1', ativa: false },
      { aba: 3, titulo: 'Três', url: 'https://a.b/3', ativa: true },
    ]
    expect(navegadorDadosSchemas.abas.parse({ abas })).toEqual({ abas })
    expect(navegadorDadosSchemas.abas.safeParse({ abas: [{ ...abas[0], tabId: 99 }] }).success).toBe(false)
    expect(navegadorDadosSchemas.ler.safeParse({ titulo: 'T', url: 'u', texto: '', elementos: [] }).success).toBe(false)
    const rotulo = navegadorDadosSchemas.ler.parse({ aba: 1, titulo: 'T', url: 'u', texto: '', elementos: [{ ref: 1, rotulo: `  ${'R'.repeat(300)}\n`, papel: 'link' }] })
    expect(rotulo.elementos[0]?.rotulo).toBe('R'.repeat(200))
    // Endereço longo vindo da página (redirect de login, busca) é cortado, nunca recusado: recusar num `clicar`
    // levaria a clicar de novo.
    const longa = `https://a.b/?q=${'x'.repeat(NAVEGADOR_URL_MAX * 2)}`
    expect(navegadorDadosSchemas.clicar.parse({ ok: true, aba: 1, titulo: 'B', url: longa }).url).toHaveLength(NAVEGADOR_URL_MAX)
    expect(navegadorDadosSchemas.abas.parse({ abas: [{ aba: 1, titulo: 'A', url: longa, ativa: true }] }).abas[0]?.url).toHaveLength(NAVEGADOR_URL_MAX)
    expect(navegadorDadosSchemas.ler.parse({ aba: 1, titulo: 'T', url: longa, texto: '', elementos: [] }).url).toHaveLength(NAVEGADOR_URL_MAX)
    expect(navegadorDadosSchemas.fechar.safeParse({ ok: true }).success).toBe(true)
    expect(navegadorDadosSchemas.fechar.safeParse({ ok: false }).success).toBe(false)
  })

  it('envelope do resultado: id, ok, dados e erro; nada além', () => {
    expect(navegadorResultadoSchema.safeParse({ id: 'a', ok: true, dados: {} }).success).toBe(true)
    expect(navegadorResultadoSchema.safeParse({ id: 'a', ok: false, erro: 'muitas abas' }).success).toBe(true)
    expect(navegadorResultadoSchema.safeParse({ id: '', ok: true }).success).toBe(false)
    expect(navegadorResultadoSchema.safeParse({ id: 'a', ok: true, comando: { tipo: 'abrir' } }).success).toBe(false)
  })
})
