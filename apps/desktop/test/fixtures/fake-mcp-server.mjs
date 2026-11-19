// Servidor MCP falso (contrato 21) para o smoke e os testes: duas ferramentas, `soma` (soma dois números) e
// `apagar_tudo` (que nunca apaga nada: só existe para o app negar). Sem rede para fora e sem disco.
// - Sem argumentos: comando local (stdio), JSON-RPC por linha no stdin/stdout.
// - `--http [--token <valor>]`: servidor "Streamable HTTP" em 127.0.0.1, numa porta livre, em `/mcp`; escreve
//   `PORT <n>` no stdout quando está ouvindo. Com `--token`, recusa (401) o pedido sem `Authorization: Bearer <valor>`.
//   O `tools/list` volta num fluxo SSE (o resto em JSON), para o cliente do app ler os dois formatos.
// Com `FAKE_MCP_ENV_LOG=<arquivo>`, o processo stdio grava ali os nomes (só os nomes) das variáveis que recebeu.
//
// Uso: node fake-mcp-server.mjs | node fake-mcp-server.mjs --http --token abc
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import process from 'node:process'
import { createInterface } from 'node:readline'

export const FAKE_MCP_TOOLS = [
  {
    name: 'soma',
    description: 'Soma dois números.',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  },
  {
    name: 'apagar_tudo',
    description: 'Apaga todos os arquivos (falso: nunca apaga nada).',
    inputSchema: { type: 'object', properties: {} },
  },
]

/** Resposta a uma mensagem JSON-RPC; `null` para notificação. */
export function answer(message) {
  if (typeof message?.id !== 'number' && typeof message?.id !== 'string') return null
  const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result })
  if (message.method === 'initialize') return reply({ protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'calculadora-falsa', version: '1.0.0' } })
  if (message.method === 'tools/list') return reply({ tools: FAKE_MCP_TOOLS })
  if (message.method === 'tools/call') {
    const { name, arguments: input = {} } = message.params ?? {}
    if (name === 'soma') return reply({ content: [{ type: 'text', text: String(Number(input.a ?? 0) + Number(input.b ?? 0)) }] })
    if (name === 'apagar_tudo') return reply({ content: [{ type: 'text', text: 'nada foi apagado' }], isError: true })
  }
  return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'método desconhecido' } }
}

const isMain = process.argv[1]?.endsWith('fake-mcp-server.mjs')
if (isMain) {
  const args = process.argv.slice(2)
  if (args.includes('--http')) {
    const token = args.includes('--token') ? args[args.indexOf('--token') + 1] : null
    const server = createServer((request, response) => {
      if (request.url !== '/mcp' || request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      if (token && request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401).end()
        return
      }
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        let message
        try {
          message = JSON.parse(body)
        } catch {
          response.writeHead(400).end()
          return
        }
        const reply = answer(message)
        if (!reply) {
          response.writeHead(202).end()
          return
        }
        if (message.method === 'tools/list') {
          response.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sessao-falsa' })
          response.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`)
          return
        }
        response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sessao-falsa' }).end(JSON.stringify(reply))
      })
    })
    server.listen(0, '127.0.0.1', () => process.stdout.write(`PORT ${server.address().port}\n`))
    process.on('SIGTERM', () => server.close(() => process.exit(0)))
  } else {
    if (process.env.FAKE_MCP_ENV_LOG) appendFileSync(process.env.FAKE_MCP_ENV_LOG, `${JSON.stringify(Object.keys(process.env).sort())}\n`)
    const lines = createInterface({ input: process.stdin })
    lines.on('line', (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      const reply = answer(message)
      if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
    })
    lines.on('close', () => process.exit(0))
  }
}
