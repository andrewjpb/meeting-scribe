// `claude` falso para o smoke e para o teste do processo de verdade (contrato 05, CA12). Fala o mesmo
// protocolo `stream-json` medido em 14/11/2026 com o Claude Code 2.1.312: uma linha JSON por trecho no
// stdin; para cada uma, `system/init` e depois `result` no stdout. Não acessa rede nem disco; a "tradução"
// é o texto do trecho com o prefixo `[EN]`. Sai quando o stdin fecha.
//
// Com `--output-format json` (resumo da reunião, contrato 08): lê o stdin inteiro e devolve um único
// `result` com o JSON do resumo entre cercas ```json, montado só a partir das linhas da transcrição. Com a
// instrução da análise ("Você analisa…", contrato 19), espera 1,5 s e devolve a análise falsa
// (`fake-analysis.mjs`) entre cercas, com custo nominal.
//
// Com `--include-partial-messages` (chat "Perguntar", contrato 15): para cada pergunta, lê a pasta atual (o
// `INDICE.md` do acervo ou o único `.md` de uma reunião), escreve a resposta em pedaços (`stream_event`),
// depois a mensagem `assistant` inteira e o `result`. A resposta cita a reunião mais recente com o link
// `meeting:<id>` e diz quantos arquivos a pasta tem e se o histórico veio. Pergunta com "devagar" sai em 40
// pedaços espaçados (dá tempo de clicar em "Parar"); com "ferramenta", tenta o Bash e recebe a negação.
//
// Contrato 16: toda resposta do chat anuncia o modelo no `system/init`, pensa antes (`thinking` em pedaços
// e o bloco inteiro na mensagem `assistant`, com um `<b>` que tem de aparecer como texto), lê com três
// ferramentas (Read do `INDICE.md` quando há, Read do `.md` da reunião mais recente e um Grep), tenta o
// Bash e recebe a negação, e fecha com o `result` com tokens, custo nominal e número de turnos. Cada passo
// espera um pouco: dá tempo de a tela mostrar "Pensando…" e depois o passo.
//
// Uso: node fake-claude.mjs --version | node fake-claude.mjs -p --model haiku --input-format stream-json ...
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { FAKE_ANALYSIS_DELAY_MS, fakeAnalysis } from './fake-analysis.mjs'
import { fakeDraft } from './fake-draft.mjs'

const args = process.argv.slice(2)

if (args.includes('--version')) {
  process.stdout.write('2.1.312 (Claude Code)\n')
  process.exit(0)
}

const MODEL_IDS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }
const model = MODEL_IDS[args[args.indexOf('--model') + 1]] ?? MODEL_IDS.haiku

if (args.includes('--include-partial-messages')) {
  const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

  /** A reunião mais recente que a pasta mostra: do índice ou do único `.md`. */
  const readFolder = () => {
    const files = readdirSync(process.cwd()).filter((name) => name.endsWith('.md'))
    if (files.includes('INDICE.md')) {
      const lines = readFileSync(join(process.cwd(), 'INDICE.md'), 'utf8').split('\n')
      const entries = lines
        .map((line) => /^- (\d{2})\/(\d{2})\/\d{4} \d{2}:\d{2} · (.+?) · .* · meeting:([\w-]+)$/.exec(line))
        .filter(Boolean)
        .map((match) => ({ day: `${match[1]}/${match[2]}`, title: match[3], id: match[4] }))
      const file = entries[0] ? files.find((name) => name.endsWith(` - ${entries[0].id}.md`)) : undefined
      return { files, index: true, first: entries[0] ?? null, count: entries.length, file }
    }
    const text = files[0] ? readFileSync(join(process.cwd(), files[0]), 'utf8') : ''
    const id = /^- Id: ([\w-]+)$/m.exec(text)?.[1]
    const title = /^# (.+)$/m.exec(text)?.[1]
    const day = /\((\d{2}\/\d{2})\)$/m.exec(text)?.[1]
    return { files, index: false, first: id && title && day ? { id, title, day } : null, count: files.length, file: files[0] }
  }

  let queue = Promise.resolve()
  const answer = async (content) => {
    const started = Date.now()
    const history = content.startsWith('<historico>')
    const question = history ? (/\nPergunta: ([\s\S]*)$/.exec(content)?.[1] ?? content) : content
    const folder = readFolder()
    emit({ type: 'system', subtype: 'init', model, cwd: process.cwd(), tools: ['Read', 'Grep', 'Glob'], mcp_servers: [] })
    const denials = []
    const pause = () => sleep(/devagar/i.test(question) ? 100 : 350)
    // Raciocínio em pedaços e, depois, o bloco inteiro (que não pode repetir na tela).
    const thinking = `A pessoa perguntou: ${question.slice(0, 60)}. Vou ler o índice e abrir a reunião mais recente. <b>sem HTML</b>`
    emit({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant' } } })
    emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } })
    for (let at = 0; at < thinking.length; at += 24) {
      await sleep(40)
      emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: thinking.slice(at, at + 24) } } })
    }
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking, signature: 'x' }] } })
    await pause()
    let tool = 0
    const use = async (name, input, denied = false) => {
      tool += 1
      const id = `toolu_${tool}`
      emit({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant' } } })
      emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } } })
      emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
      await pause()
      const content = denied ? `Permission to use ${name} has been denied.` : 'ok'
      emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: denied, content }] } })
      if (denied) denials.push({ tool_name: name, tool_use_id: id, tool_input: input })
    }
    if (folder.index) await use('Read', { file_path: join(process.cwd(), 'INDICE.md') })
    if (folder.file) await use('Read', { file_path: join(process.cwd(), folder.file) })
    await use('Grep', { pattern: 'decid', path: process.cwd() })
    await use('Bash', { command: /ferramenta/i.test(question) ? 'ls ~' : 'cat ~/.ssh/config' }, true)
    const cite = folder.first ? `[${folder.first.title} · ${folder.first.day}](meeting:${folder.first.id})` : 'Não encontrei nas reuniões.'
    const text = folder.index
      ? `Li o **INDICE.md**: ${folder.count} reuniões. A mais recente é ${cite}.\n\n- Arquivos na pasta: ${folder.files.length}\n- Histórico: ${history ? 'sim' : 'não'}`
      : `Esta conversa é só sobre ${cite}.\n\n- Arquivos na pasta: ${folder.files.length}\n- Histórico: ${history ? 'sim' : 'não'}`
    const slow = /devagar/i.test(question)
    const parts = slow ? 40 : 6
    const size = Math.ceil(text.length / parts)
    emit({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant' } } })
    emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } })
    for (let at = 0; at < text.length; at += size) {
      await sleep(slow ? 250 : 120)
      emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(at, at + size) } } })
    }
    emit({ type: 'stream_event', event: { type: 'message_stop' } })
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: Date.now() - started,
      num_turns: tool + 1,
      result: text,
      permission_denials: denials,
      usage: { input_tokens: 12, cache_creation_input_tokens: 2100, cache_read_input_tokens: 1000, output_tokens: 420 },
      total_cost_usd: 0.0213,
    })
  }

  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const content = typeof message?.message?.content === 'string' ? message.message.content : ''
    queue = queue.then(() => answer(content))
  })
  lines.on('close', () => void queue.then(() => process.exit(0)))
} else if (args[args.indexOf('--output-format') + 1] === 'json') {
  const started = Date.now()
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', async () => {
    const systemPrompt = args[args.indexOf('--system-prompt') + 1] ?? ''
    // Contrato 24: o rascunho do WhatsApp, só texto.
    if (systemPrompt.startsWith('Você escreve rascunhos')) {
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: Date.now() - started, result: fakeDraft(input), usage: { input_tokens: Math.ceil(input.length / 4), output_tokens: 30 }, total_cost_usd: 0 })}\n`,
        () => process.exit(0),
      )
      return
    }
    if (systemPrompt.startsWith('Você analisa')) {
      await sleep(FAKE_ANALYSIS_DELAY_MS)
      process.stdout.write(
        `${JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: Date.now() - started,
          result: `\`\`\`json\n${JSON.stringify(fakeAnalysis(input), null, 2)}\n\`\`\``,
          usage: { input_tokens: Math.ceil(input.length / 4), output_tokens: 90 },
          total_cost_usd: 0.0042,
        })}\n`,
        () => process.exit(0),
      )
      return
    }
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
