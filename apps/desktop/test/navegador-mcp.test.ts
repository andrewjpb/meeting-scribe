// Contrato 47 (plugin-navegador): o servidor MCP local das ferramentas do navegador. `initialize` e `tools/list` com as 7;
// `tools/call` vira o comando da ponte (uma ponte falsa injetada) e o resultado volta como texto JSON; erros da ponte viram
// mensagens acionáveis; sem token, com token revogado, com `Origin` ou com outro `Host`, recusado; ferramenta
// desconhecida e JSON-RPC quebrado viram erro limpo; uma chamada por vez na ponte. Endereço local não abre (pelo nome
// e pelo DNS, com um resolvedor injetado), e a página que cai num endereço local não tem o conteúdo entregue.
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { NAVEGADOR_FERRAMENTAS } from '../src/shared/navegador-ferramentas'
import { navegadorDadosSchemas, type NavegadorComando } from '../src/shared/navegador'
import {
  createNavegadorMcpServer,
  NAVEGADOR_MCP_PATH,
  NAVEGADOR_PAGINA_LOCAL,
  NAVEGADOR_URL_LOCAL,
  navegadorDnsErro,
  navegadorResultadoSeguro,
  navegadorUrlLocal,
  navegadorUrlPublica, NAVEGADOR_MCP_TOOL_LIST, navegadorComandoOf, navegadorErroTexto, type NavegadorMcpServer, type NavegadorPonte } from '../src/main/navegador/mcp'
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

  /** Sem DNS de verdade: todo nome resolve para um IP público, a não ser que o teste diga outra coisa. */
  const start = async (ponte: NavegadorPonte | null, resolver: (hostname: string) => Promise<string[]> = () => Promise.resolve(['93.184.216.34'])) => {
    server = createNavegadorMcpServer({ ponte: () => ponte, resolver, resolverMs: 100 })
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

  it('navegador_abrir recusa endereço local (localhost, nome sem ponto, loopback, link-local, faixas privadas) antes da ponte', async () => {
    const ponte = fakePonte((comando) => Promise.resolve(comando.tipo === 'abrir' ? { aba: 1, titulo: 'T', url: comando.url } : { ok: true }))
    const { rpc } = await start(ponte)
    const locais = [
      'http://localhost:3000/',
      'http://LOCALHOST/',
      'http://app.localhost/',
      'http://127.0.0.1/',
      'http://127.1/',
      'http://2130706433/',
      'http://10.1.2.3/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.0.10/',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[fd12:3456::1]/',
      'http://[fc00::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://intranet/',
      'http://impressora.local/',
    ]
    for (const url of locais) {
      expect(navegadorUrlPublica(url), url).toBe(false)
      const result = (await rpc('tools/call', { name: 'navegador_abrir', arguments: { url } })).json?.['result'] as { content: { text: string }[]; isError?: boolean }
      expect(result, url).toEqual({ content: [{ type: 'text', text: `Erro: ${NAVEGADOR_URL_LOCAL}` }], isError: true })
    }
    expect(ponte.comandos).toEqual([])
    expect(NAVEGADOR_URL_LOCAL.startsWith('endereço local não é permitido')).toBe(true)
    // Público: abre (172.32 já está fora da faixa privada).
    for (const url of ['https://exemplo.example/', 'http://172.32.0.1/', 'https://8.8.8.8/']) expect(navegadorUrlPublica(url), url).toBe(true)
    expect((await rpc('tools/call', { name: 'navegador_abrir', arguments: { url: 'https://exemplo.example/' } })).json?.['result']).not.toHaveProperty('isError')
    expect(ponte.comandos).toEqual([{ tipo: 'abrir', url: 'https://exemplo.example/' }])
  })

  it('nome que resolve para endereço local (ou não resolve) não abre; IP público resolvido abre', async () => {
    const tabela: Record<string, string[]> = {
      'exemplo.example': ['93.184.216.34', '2606:2800:220:1::1'],
      '192-168-0-1.nip.io': ['192.168.0.1'],
      'misto.example': ['93.184.216.34', '10.0.0.7'],
      'v6.example': ['fd00::5'],
      'mapeado.example': ['::ffff:192.168.1.1'],
      'metadados.example': ['169.254.169.254'],
    }
    const resolver = (hostname: string): Promise<string[]> => (hostname in tabela ? Promise.resolve(tabela[hostname] ?? []) : Promise.reject(new Error('ENOTFOUND')))
    const ponte = fakePonte((comando) => Promise.resolve(comando.tipo === 'abrir' ? { aba: 1, titulo: 'T', url: comando.url } : { ok: true }))
    const { rpc } = await start(ponte, resolver)
    const abrir = async (url: string): Promise<{ text: string; isError: boolean }> => {
      const result = (await rpc('tools/call', { name: 'navegador_abrir', arguments: { url } })).json?.['result'] as { content: { text: string }[]; isError?: boolean }
      return { text: result.content[0]?.text ?? '', isError: result.isError === true }
    }
    for (const host of ['192-168-0-1.nip.io', 'misto.example', 'v6.example', 'mapeado.example', 'metadados.example']) {
      expect(await abrir(`https://${host}/`), host).toEqual({ text: `Erro: ${NAVEGADOR_URL_LOCAL}`, isError: true })
    }
    expect(await abrir('https://nao-existe.example/')).toEqual({ text: 'Erro: o nome nao-existe.example não existe — confira o endereço', isError: true })
    expect(ponte.comandos).toEqual([])
    expect((await abrir('https://exemplo.example/')).isError).toBe(false)
    // IP público escrito no endereço não passa pelo DNS.
    expect(await navegadorDnsErro('https://8.8.8.8/', () => Promise.reject(new Error('não devia resolver')))).toBeNull()
    // DNS lento: recusa no prazo, sem travar o agente.
    expect(await navegadorDnsErro('https://lento.example/', () => new Promise(() => undefined), 20)).toBe('o nome lento.example não resolveu a tempo — confira o endereço e tente de novo')
    expect(await navegadorDnsErro('https://vazio.example/', () => Promise.resolve([]))).toMatch(/não existe/)
  })

  it('página que cai num endereço local (redirecionamento, clique, aba aberta pela página): conteúdo não vai ao agente', async () => {
    let url = 'http://192.168.0.1/admin'
    const ponte = fakePonte((comando) => {
      if (comando.tipo === 'abas') {
        return Promise.resolve({
          abas: [
            { aba: 1, titulo: 'Público', url: 'https://exemplo.example/', ativa: false },
            { aba: 2, titulo: 'Roteador — senha', url, ativa: true },
          ],
        })
      }
      if (comando.tipo === 'ler') return Promise.resolve({ aba: 2, titulo: 'Roteador', url, texto: 'senha do wi-fi: segredo', elementos: [] })
      if (comando.tipo === 'clicar') return Promise.resolve({ ok: true, aba: 2, titulo: 'Roteador', url, rotulo: 'Entrar' })
      return Promise.resolve({ aba: 2, titulo: 'Roteador', url })
    })
    const { rpc } = await start(ponte)
    const call = async (name: string, args: unknown = {}): Promise<{ text: string; isError: boolean }> => {
      const result = (await rpc('tools/call', { name, arguments: args })).json?.['result'] as { content: { text: string }[]; isError?: boolean }
      return { text: result.content[0]?.text ?? '', isError: result.isError === true }
    }
    const bloqueado = { text: `Erro: ${NAVEGADOR_PAGINA_LOCAL.replace('endereço local', 'endereço local (aba 2)')}`, isError: true }
    // O `abrir` de um endereço público que redirecionou para a rede local.
    expect(await call('navegador_abrir', { url: 'https://exemplo.example/' })).toEqual(bloqueado)
    expect(await call('navegador_ler')).toEqual(bloqueado)
    expect(await call('navegador_clicar', { ref: 1 })).toEqual(bloqueado)
    for (const tool of ['navegador_abrir', 'navegador_ler', 'navegador_clicar']) expect(JSON.stringify(await call(tool, tool === 'navegador_clicar' ? { ref: 1 } : tool === 'navegador_abrir' ? { url: 'https://exemplo.example/' } : {}))).not.toContain('segredo')
    // Na lista, a aba local fica só com o número (dá para fechar), sem título nem endereço.
    const abas = JSON.parse((await call('navegador_abas')).text) as { abas: Record<string, unknown>[] }
    expect(abas.abas).toEqual([
      { aba: 1, titulo: 'Público', url: 'https://exemplo.example/', ativa: false },
      { aba: 2, titulo: '', url: '', ativa: true, local: true },
    ])
    // Outras faixas e o loopback também; página pública, about:blank e a de erro do Chrome, não.
    for (const local of ['http://127.0.0.1:8080/', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://intranet/', 'http://10.0.0.1/']) expect(navegadorUrlLocal(local), local).toBe(true)
    for (const fora of ['https://exemplo.example/', 'about:blank', 'chrome-error://chromewebdata/', '']) expect(navegadorUrlLocal(fora), fora).toBe(false)
    url = 'https://exemplo.example/painel'
    expect((await call('navegador_ler')).isError).toBe(false)
    expect(navegadorResultadoSeguro('digitar', { ok: true })).toEqual({ ok: true, dados: { ok: true } })
  })

  it('o rótulo do elemento volta no resultado de clicar e digitar', async () => {
    const ponte = fakePonte((comando) =>
      Promise.resolve(
        comando.tipo === 'clicar'
          ? navegadorDadosSchemas.clicar.parse({ ok: true, aba: 1, titulo: 'T', url: 'https://exemplo.example/', rotulo: ' Entrar\n agora ' })
          : navegadorDadosSchemas.digitar.parse({ ok: true, rotulo: 'Buscar' }),
      ),
    )
    const { rpc } = await start(ponte)
    const text = async (name: string, args: unknown): Promise<string> => ((await rpc('tools/call', { name, arguments: args })).json?.['result'] as { content: { text: string }[] }).content[0]?.text ?? ''
    expect(JSON.parse(await text('navegador_clicar', { ref: 3 }))).toMatchObject({ rotulo: 'Entrar agora' })
    expect(JSON.parse(await text('navegador_digitar', { ref: 1, texto: 'x' }))).toEqual({ ok: true, rotulo: 'Buscar' })
    // Sem o rótulo (extensão antiga) também vale; campo a mais, não.
    expect(navegadorDadosSchemas.digitar.safeParse({ ok: true }).success).toBe(true)
    expect(navegadorDadosSchemas.clicar.safeParse({ ok: true, aba: 1, titulo: 'T', url: 'u' }).success).toBe(true)
    expect(navegadorDadosSchemas.digitar.safeParse({ ok: true, rotulo: 'x', valor: 'segredo' }).success).toBe(false)
    expect(navegadorDadosSchemas.clicar.parse({ ok: true, aba: 1, titulo: 'T', url: 'u', rotulo: 'x'.repeat(500) }).rotulo).toHaveLength(200)
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
