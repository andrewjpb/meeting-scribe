// `claude` falso para o smoke e para o teste do processo de verdade (contrato 05, CA12). Fala o mesmo
// protocolo `stream-json` medido em 14/11/2026 com o Claude Code 2.1.312: uma linha JSON por trecho no
// stdin; para cada uma, `system/init` e depois `result` no stdout. Não acessa rede nem disco; a "tradução"
// é o texto do trecho com o prefixo `[EN]`. Sai quando o stdin fecha.
//
// Com `--output-format json` (resumo da reunião, contrato 08): lê o stdin inteiro e devolve um único
// `result` com o JSON do resumo entre cercas ```json, montado só a partir das linhas da transcrição.
//
// Uso: node fake-claude.mjs --version | node fake-claude.mjs -p --model haiku --input-format stream-json ...
import process from 'node:process'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)

if (args.includes('--version')) {
  process.stdout.write('2.1.312 (Claude Code)\n')
  process.exit(0)
}

const model = args[args.indexOf('--model') + 1] === 'sonnet' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5'

if (args[args.indexOf('--output-format') + 1] === 'json') {
  const started = Date.now()
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', () => {
    const body = /<transcricao>\n([\s\S]*)\n<\/transcricao>/.exec(input)?.[1] ?? ''
    const lines = body.split('\n').filter((line) => /^\[[\d:]+\] [^:]+: /.test(line))
    const speakers = [...new Set(lines.map((line) => /^\[[\d:]+\] ([^:]+): /.exec(line)?.[1] ?? ''))]
    const participant = speakers.find((name) => name !== 'Você') ?? null
    const summary = {
      overview: `Reunião com ${lines.length} falas de ${speakers.join(' e ')}. A conversa tratou da captura do microfone e do áudio do sistema durante a gravação.`,
      decisions: ['Manter a captura do microfone separada do áudio do sistema.'],
      tasks: [
        { task: 'Revisar a transcrição da reunião', owner: 'Você', due: 'sexta-feira' },
        { task: 'Enviar as notas aos participantes', owner: participant, due: null },
      ],
    }
    process.stdout.write(
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: Date.now() - started,
        result: `\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``,
        usage: { input_tokens: Math.ceil(input.length / 4), output_tokens: 120 },
        total_cost_usd: 0,
      })}\n`,
      // Pipe no macOS escreve de forma assíncrona: só sai depois de a linha ir inteira.
      () => process.exit(0),
    )
  })
} else {
  let turns = 0

  const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const content = typeof message?.message?.content === 'string' ? message.message.content : ''
    const text = /^<turn>([\s\S]*)<\/turn>$/.exec(content)?.[1] ?? content
    turns += 1
    emit({ type: 'system', subtype: 'init', model, tools: [], mcp_servers: [] })
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: `[EN] ${text}`,
      usage: { input_tokens: 12, cache_read_input_tokens: 600 + turns * 40, cache_creation_input_tokens: 0, output_tokens: 20 },
      total_cost_usd: 0,
    })
  })
  lines.on('close', () => process.exit(0))
}
