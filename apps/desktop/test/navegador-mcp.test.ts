// Contrato 47 (plugin-navegador): o servidor MCP local das ferramentas do navegador. `initialize` e `tools/list` com as 7;
// `tools/call` vira o comando da ponte (uma ponte falsa injetada) e o resultado volta como texto JSON; erros da ponte viram
// mensagens acionáveis; sem token, com token revogado, com `Origin` ou com outro `Host`, recusado; ferramenta
// desconhecida e JSON-RPC quebrado viram erro limpo; uma chamada por vez na ponte.
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { NAVEGADOR_FERRAMENTAS } from '../src/shared/navegador-ferramentas'
import type { NavegadorComando } from '../src/shared/navegador'
import { createNavegadorMcpServer, NAVEGADOR_MCP_PATH, NAVEGADOR_MCP_TOOL_LIST, navegadorComandoOf, navegadorErroTexto, type NavegadorMcpServer, type NavegadorPonte } from '../src/main/navegador/mcp'
import { NavegadorErro } from '../src/main/navegador/server'

interface Reply {
  status: number
  body: string
}

function send(port: number, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ agent: false, host: '127.0.0.1', port, method: options.method ?? 'POST', path: options.path ?? NAVEGADOR_MCP_PATH, headers: options.headers ?? {} }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' || error.code === 'EPIPE' ? resolve({ status: 0, body: '' }) : reject(error)))
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

/** Ponte falsa: registra cada comando e responde com o que o teste mandar. */
function fakePonte(reply: (comando: NavegadorComando) => Promise<unknown>): NavegadorPonte & { comandos: NavegadorComando[] } {
  const comandos: NavegadorComando[] = []
  return {
    comandos,
    enviarComando: ((comando: NavegadorComando) => {
      comandos.push(comando)
      return reply(comando)
    }) as NavegadorPonte['enviarComando'],
  }
}

describe('servidor MCP do navegador', () => {
  let server: NavegadorMcpServer | null = null
  afterEach(async () => {
    await server?.close()
    server = null
  })

  const start = async (ponte: NavegadorPonte | null) => {
    server = createNavegadorMcpServer({ ponte: () => ponte })
    const entry = await server.open()
    if (!entry) throw new Error('sem servidor')
    const port = Number(new URL(entry.url).port)
    let next = 0
    const rpc = async (method: string, params?: unknown, token: string = entry.token): Promise<{ status: number; json: Record<string, unknown> | null }> => {
      const reply = await send(port, {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++next, method, ...(params !== undefined ? { params } : {}) }),
      })
      return { status: reply.status, json: reply.body ? (JSON.parse(reply.body) as Record<string, unknown>) : null }
    }
    return { entry, port, rpc }
  }

  it('127.0.0.1, porta efêmera, url /mcp; initialize e tools/list com as 7, nos esquemas do comando', async () => {
    const { entry, rpc, port } = await start(fakePonte(() => Promise.resolve({})))
    expect(entry.url).toBe(`http://127.0.0.1:${port}/mcp`)
    expect(entry.token.length).toBeGreaterThanOrEqual(40)
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2' } })
    expect(init.status).toBe(200)
    expect(init.json).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'navegador' } } })
    // Versão que o servidor não conhece: responde com a dele.
    expect((await rpc('initialize', { protocolVersion: '2099-01-01' })).json).toMatchObject({ result: { protocolVersion: '2025-06-18' } })
    // A notificação não tem resposta.
    const notified = await send(port, { headers: { authorization: `Bearer ${entry.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    expect(notified).toEqual({ status: 202, body: '' })
    expect((await rpc('ping')).json).toMatchObject({ result: {} })
    const list = await rpc('tools/list')
    const tools = (list.json?.['result'] as { tools: { name: string; inputSchema: { required?: string[]; additionalProperties: boolean; properties: Record<string, unknown> } }[] }).tools
    expect(tools.map((tool) => tool.name)).toEqual([...NAVEGADOR_FERRAMENTAS])
    const schema = Object.fromEntries(tools.map((tool) => [tool.name, { campos: Object.keys(tool.inputSchema.properties).sort(), obrigatorios: tool.inputSchema.required ?? [], extra: tool.inputSchema.additionalProperties }]))
    expect(schema).toEqual({
      navegador_abrir: { campos: ['url'], obrigatorios: ['url'], extra: false },
      navegador_abas: { campos: [], obrigatorios: [], extra: false },
      navegador_ler: { campos: ['aba'], obrigatorios: [], extra: false },
      navegador_clicar: { campos: ['aba', 'ref'], obrigatorios: ['ref'], extra: false },
      navegador_digitar: { campos: ['aba', 'ref', 'texto'], obrigatorios: ['ref', 'texto'], extra: false },
      navegador_aguardar: { campos: ['segundos'], obrigatorios: ['segundos'], extra: false },
      navegador_fechar: { campos: ['aba'], obrigatorios: [], extra: false },
    })
    expect(NAVEGADOR_MCP_TOOL_LIST).toHaveLength(7)
  })

  it('tools/call de navegador_abrir chega à ponte como `abrir` e o resultado volta em JSON', async () => {
    const ponte = fakePonte((comando) => Promise.resolve(comando.tipo === 'abrir' ? { aba: 2, titulo: 'Exemplo', url: comando.url } : { ok: true }))
    const { rpc } = await start(ponte)
    const called = await rpc('tools/call', { name: 'navegador_abrir', arguments: { url: 'https://exemplo.example/' }, _meta: { 'claudecode/toolUseId': 'toolu_1' } })
    expect(ponte.comandos).toEqual([{ tipo: 'abrir', url: 'https://exemplo.example/' }])
    expect(called.json).toEqual({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"aba":2,"titulo":"Exemplo","url":"https://exemplo.example/"}' }] } })
    // Sem argumentos (as abas), e cada ferramenta com o comando dela.
    await rpc('tools/call', { name: 'navegador_abas' })
    await rpc('tools/call', { name: 'navegador_ler', arguments: { aba: 2 } })
    await rpc('tools/call', { name: 'navegador_clicar', arguments: { ref: 3 } })
    await rpc('tools/call', { name: 'navegador_digitar', arguments: { ref: 1, texto: 'oi' } })
    await rpc('tools/call', { name: 'navegador_aguardar', arguments: { segundos: 2 } })
    await rpc('tools/call', { name: 'navegador_fechar', arguments: {} })
    expect(ponte.comandos.slice(1)).toEqual([{ tipo: 'abas' }, { tipo: 'ler', aba: 2 }, { tipo: 'clicar', ref: 3 }, { tipo: 'digitar', ref: 1, texto: 'oi' }, { tipo: 'aguardar', segundos: 2 }, { tipo: 'fechar' }])
  })

  it('argumentos fora do esquema e erros da ponte viram resultado com isError e o que fazer; nada chega à ponte errado', async () => {
    let erro: NavegadorErro = new NavegadorErro('desconectada', 'extensão desconectada')
    const ponte = fakePonte(() => Promise.reject(erro))
    const { rpc } = await start(ponte)
    const text = async (name: string, args?: unknown): Promise<{ text: string; isError: boolean }> => {
      const result = (await rpc('tools/call', { name, ...(args !== undefined ? { arguments: args } : {}) })).json?.['result'] as { content: { text: string }[]; isError?: boolean }
      return { text: result.content[0]?.text ?? '', isError: result.isError === true }
    }
    expect(await text('navegador_abrir', { url: 'file:///etc/passwd' })).toEqual({ text: 'Erro: argumentos fora do formato da ferramenta (url)', isError: true })
    expect((await text('navegador_clicar', { ref: 3, tipo: 'fechar' })).text).toContain('argumentos fora do formato')
    expect((await text('navegador_aguardar', { segundos: 60 })).isError).toBe(true)
    expect((await text('navegador_ler', { aba: 1, extra: true })).text).toBe('Erro: argumentos fora do formato da ferramenta (extra)')
    expect(ponte.comandos).toEqual([])

    expect(await text('navegador_ler')).toEqual({ text: expect.stringContaining('extensão desconectada') as string, isError: true })
    erro = new NavegadorErro('extensao', 'ref vencida, leia a página de novo')
    expect((await text('navegador_clicar', { ref: 2 })).text).toBe('Erro: ref vencida — leia a página de novo (navegador_ler) e use o ref novo')
    // A ponte desligada (servidor do contrato 46 parado) ou ainda inexistente.
    erro = new NavegadorErro('desligada', 'ponte desligada')
    expect((await text('navegador_abas')).text).toContain('Configurações › Plugins')
    await server?.close()
    const { rpc: semPonte } = await start(null)
    const result = (await semPonte('tools/call', { name: 'navegador_abas' })).json?.['result'] as { content: { text: string }[]; isError: boolean }
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0]?.text).toContain('ponte desligada')
  })

  it('mensagens acionáveis da tabela do contrato', () => {
    const texto = (motivo: ConstructorParameters<typeof NavegadorErro>[0], message: string): string => navegadorErroTexto(new NavegadorErro(motivo, message))
    expect(texto('desligada', 'ponte desligada')).toBe('ponte desligada — peça para a pessoa ligar "Ativar ponte" em Configurações › Plugins')
    expect(texto('desconectada', 'extensão desconectada')).toMatch(/^extensão desconectada — /)
    expect(texto('extensao', 'ref vencida, leia a página de novo')).toMatch(/^ref vencida — leia a página de novo/)
    expect(texto('extensao', 'aba não existe')).toBe('aba não existe — veja as abas abertas com navegador_abas')
    expect(texto('extensao', 'muitas abas: feche alguma antes (máximo 10)')).toBe('muitas abas: feche alguma antes (máximo 10) — use navegador_fechar')
    expect(texto('extensao', 'campo de senha: o app não digita senha')).toBe('campo de senha: o app não digita senha')
    expect(texto('tempo', 'a extensão não respondeu a tempo')).toMatch(/não respondeu a tempo/)
    expect(navegadorErroTexto(new Error('x'))).toBe('o navegador não respondeu — tente de novo')
    expect(navegadorComandoOf('navegador_abas', null)).toEqual({ ok: true, comando: { tipo: 'abas' } })
    expect(navegadorComandoOf('navegador_abas', ['x'])).toMatchObject({ ok: false })
  })

  it('sem token, token errado ou revogado: 401; Origin ou outro Host: 403; outro caminho: 404; GET: 405', async () => {
    const ponte = fakePonte(() => Promise.resolve({ ok: true }))
    const { entry, port, rpc } = await start(ponte)
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const json = { 'content-type': 'application/json' }
    expect(await send(port, { headers: json, body })).toEqual({ status: 401, body: '' })
    expect(await send(port, { headers: { ...json, authorization: 'Bearer errado' }, body })).toEqual({ status: 401, body: '' })
    expect(await send(port, { headers: { ...json, authorization: entry.token }, body })).toEqual({ status: 401, body: '' })
    expect(await send(port, { headers: { ...json, authorization: `Bearer ${entry.token}`, origin: 'https://evil.example' }, body })).toEqual({ status: 403, body: '' })
    expect(await send(port, { headers: { ...json, authorization: `Bearer ${entry.token}`, host: 'evil.example' }, body })).toEqual({ status: 403, body: '' })
    expect((await send(port, { path: '/outro', headers: { ...json, authorization: `Bearer ${entry.token}` }, body })).status).toBe(404)
    expect((await send(port, { method: 'GET', headers: { authorization: `Bearer ${entry.token}` } })).status).toBe(405)
    expect((await send(port, { headers: { 'content-type': 'text/plain', authorization: `Bearer ${entry.token}` }, body })).status).toBe(415)
    expect((await rpc('tools/list')).status).toBe(200)

    // Cada sessão tem o próprio token; fechar uma não derruba a outra.
    const other = await server?.open()
    entry.close()
    expect((await rpc('tools/list')).status).toBe(401)
    expect((await rpc('tools/list', undefined, other?.token)).status).toBe(200)
    expect(ponte.comandos).toEqual([])
  })

  it('ferramenta desconhecida, método desconhecido, JSON quebrado e lote: erro JSON-RPC limpo', async () => {
    const ponte = fakePonte(() => Promise.resolve({ ok: true }))
    const { entry, port, rpc } = await start(ponte)
    expect((await rpc('tools/call', { name: 'navegador_baixar', arguments: {} })).json).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32602 } })
    expect((await rpc('tools/call', { name: 'navegador_abas', outro: 1 })).json).toMatchObject({ error: { code: -32602 } })
    expect((await rpc('resources/list')).json).toMatchObject({ error: { code: -32601 } })
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${entry.token}` }
    const broken = await send(port, { headers, body: '{"jsonrpc":' })
    expect(broken.status).toBe(400)
    expect(JSON.parse(broken.body)).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } })
    expect(JSON.parse((await send(port, { headers, body: '[]' })).body)).toMatchObject({ error: { code: -32600 } })
    expect(JSON.parse((await send(port, { headers, body: JSON.stringify({ jsonrpc: '1.0', id: 7, method: 'ping' }) })).body)).toMatchObject({ id: 7, error: { code: -32600 } })
    expect((await send(port, { headers, body: 'x'.repeat(300 * 1024) })).status).toBeOneOf([0, 413])
    expect(ponte.comandos).toEqual([])
  })

  it('uma chamada por vez na ponte: a segunda espera a primeira', async () => {
    let emCurso = 0
    let maximo = 0
    const ponte = fakePonte(async () => {
      emCurso += 1
      maximo = Math.max(maximo, emCurso)
      await new Promise((resolve) => setTimeout(resolve, 30))
      emCurso -= 1
      return { ok: true }
    })
    const { rpc } = await start(ponte)
    const [a, b] = await Promise.all([rpc('tools/call', { name: 'navegador_aguardar', arguments: { segundos: 1 } }), rpc('tools/call', { name: 'navegador_aguardar', arguments: { segundos: 2 } })])
    expect(maximo).toBe(1)
    expect([a.json?.['result'], b.json?.['result']]).toEqual([{ content: [{ type: 'text', text: '{"ok":true}' }] }, { content: [{ type: 'text', text: '{"ok":true}' }] }])
    expect(ponte.comandos.map((comando) => (comando.tipo === 'aguardar' ? comando.segundos : 0)).sort()).toEqual([1, 2])
  })
})
