// Agente ACP falso (contrato 17, CA10) no lugar do adaptador `@agentclientprotocol/claude-agent-acp`, para
// o smoke e para os testes: fala o mesmo protocolo pelo `agent()` do SDK oficial e imita o formato dos
// eventos do adaptador (0.107.0): `agent_thought_chunk`, `tool_call`/`tool_call_update` com `name`, `kind`,
// `title`, `locations` e `rawInput`, `plan`, `usage_update` com o custo acumulado e o modelo em
// `_meta["_claude/model"]`, e o fim do `session/prompt` com `usage`. Não acessa rede; só lê a pasta da
// sessão (o acervo) e nunca escreve fora do registro.
//
// O que ele faz depende da sessão (pelo `_meta.claudeCode.options` do `session/new`):
// - tradução (instrução "You translate…", sem ferramentas): cada prompt `<turn>texto</turn>` responde
//   `[EN] texto` em dois pedaços e manda o contexto em uso crescendo;
// - resumo (instrução "Você resume…"): o JSON do resumo entre cercas, montado só com as linhas da transcrição;
// - análise (instrução "Você analisa…", contrato 19): espera (5 × `pause`) e devolve a análise falsa
//   (`fake-analysis.mjs`) entre cercas, com o custo no `usage_update`;
// - chat: pensa em pedaços, monta o "Plano", lê o `INDICE.md` e a reunião mais recente e procura um termo,
//   cada leitura pedindo permissão; tenta escrever um arquivo (permissão pedida e negada), ler um arquivo
//   fora da pasta pelo cliente (`fs/read_text_file`, recusado) e abrir um terminal (recusado); responde em
//   pedaços com a citação `meeting:` e fecha com uso e custo. Pergunta com "devagar" sai em 40 pedaços
//   espaçados e para no `session/cancel`.
//
// Uso: node fake-acp-agent.mjs [--log <arquivo.jsonl>] | node fake-acp-agent.mjs --version
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { Readable, Writable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { fakeAnalysis } from './fake-analysis.mjs'
import { fakeDraft } from './fake-draft.mjs'

export const FAKE_ACP_VERSION = '0.107.0-falso'
const MODEL_IDS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', default: 'claude-sonnet-5-5' }

function configOptions(state) {
  return [
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: state.mode,
      options: ['default', 'acceptEdits', 'plan', 'auto'].map((value) => ({ value, name: value })),
    },
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: state.model,
      options: ['default', 'haiku', 'sonnet', 'opus'].map((value) => ({ value, name: value })),
    },
    {
      id: 'effort',
      name: 'Effort',
      category: 'thought_level',
      type: 'select',
      currentValue: state.effort,
      options: ['default', 'low', 'medium', 'high', 'xhigh'].map((value) => ({ value, name: value })),
    },
  ]
}

/** A reunião mais recente que a pasta mostra: do índice ou do único `.md` (como o `claude` falso). */
function readFolder(cwd) {
  let files = []
  try {
    files = readdirSync(cwd).filter((name) => name.endsWith('.md'))
  } catch {
    return { files, index: false, first: null, count: 0, file: undefined }
  }
  if (files.includes('INDICE.md')) {
    const lines = readFileSync(join(cwd, 'INDICE.md'), 'utf8').split('\n')
    const entries = lines
      .map((line) => /^- (\d{2})\/(\d{2})\/\d{4} \d{2}:\d{2} · (.+?) · .* · meeting:([\w-]+)$/.exec(line))
      .filter(Boolean)
      .map((match) => ({ day: `${match[1]}/${match[2]}`, title: match[3], id: match[4] }))
    const file = entries[0] ? files.find((name) => name.endsWith(` - ${entries[0].id}.md`)) : undefined
    return { files, index: true, first: entries[0] ?? null, count: entries.length, file }
  }
  const text = files[0] ? readFileSync(join(cwd, files[0]), 'utf8') : ''
  const id = /^- Id: ([\w-]+)$/m.exec(text)?.[1]
  const title = /^# (.+)$/m.exec(text)?.[1]
  const day = /\((\d{2}\/\d{2})\)$/m.exec(text)?.[1]
  return { files, index: false, first: id && title && day ? { id, title, day } : null, count: files.length, file: files[0] }
}

/**
 * O agente. `log` recebe cada coisa que o cliente mandou ou respondeu; `pause` é a espera entre os passos do
 * chat (o teste usa 0).
 */
export function fakeAcpAgent({ log = () => undefined, pause = 300 } = {}) {
  const sessions = new Map()
  let next = 0

  const purposeOf = (options) => {
    const prompt = typeof options?.systemPrompt === 'string' ? options.systemPrompt : ''
    if (prompt.startsWith('You translate')) return 'translate'
    if (prompt.startsWith('Você resume')) return 'summary'
    if (prompt.startsWith('Você analisa')) return 'analysis'
    if (prompt.startsWith('Você escreve rascunhos')) return 'draft'
    return 'chat'
  }

  return acp
    .agent({ name: 'fake-claude-agent-acp' })
    .onRequest('initialize', (ctx) => {
      log({ method: 'initialize', protocolVersion: ctx.params.protocolVersion, clientCapabilities: ctx.params.clientCapabilities })
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { promptCapabilities: { image: false, embeddedContext: true }, loadSession: false },
        agentInfo: { name: '@agentclientprotocol/claude-agent-acp', title: 'Claude Agent (falso)', version: FAKE_ACP_VERSION },
        authMethods: [],
      }
    })
    .onRequest('session/new', (ctx) => {
      const options = ctx.params._meta?.claudeCode?.options ?? {}
      const sessionId = `sessao-${++next}`
      const state = { cwd: ctx.params.cwd, purpose: purposeOf(options), mode: 'auto', model: 'default', effort: 'default', cancelled: false, cost: 0, turns: 0, tools: 0 }
      for (const entry of ctx.params.configOptions ?? []) if (entry.configId in { mode: 1, model: 1, effort: 1 }) state[entry.configId] = entry.value
      sessions.set(sessionId, state)
      log({
        method: 'session/new',
        sessionId,
        purpose: state.purpose,
        cwd: ctx.params.cwd,
        mcpServers: ctx.params.mcpServers,
        configOptions: ctx.params.configOptions ?? [],
        options: { ...options, systemPrompt: typeof options.systemPrompt === 'string' ? options.systemPrompt.split('\n')[0] : options.systemPrompt },
      })
      return { sessionId, configOptions: configOptions(state) }
    })
    .onRequest('session/set_config_option', (ctx) => {
      const state = sessions.get(ctx.params.sessionId)
      if (!state) throw acp.RequestError.invalidParams(undefined, 'sessão desconhecida')
      log({ method: 'session/set_config_option', sessionId: ctx.params.sessionId, configId: ctx.params.configId, value: ctx.params.value })
      if (!(ctx.params.configId in { mode: 1, model: 1, effort: 1 })) throw acp.RequestError.invalidParams(undefined, 'opção desconhecida')
      state[ctx.params.configId] = ctx.params.value
      return { configOptions: configOptions(state) }
    })
    .onNotification('session/cancel', (ctx) => {
      const state = sessions.get(ctx.params.sessionId)
      log({ method: 'session/cancel', sessionId: ctx.params.sessionId })
      if (state) state.cancelled = true
    })
    .onRequest('session/prompt', async (ctx) => {
      const { sessionId } = ctx.params
      const state = sessions.get(sessionId)
      if (!state) throw acp.RequestError.invalidParams(undefined, 'sessão desconhecida')
      state.cancelled = false
      state.turns += 1
      const content = ctx.params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
      log({ method: 'session/prompt', sessionId, purpose: state.purpose, history: content.startsWith('<historico>'), chars: content.length })
      const update = (body) => ctx.client.notify('session/update', { sessionId, update: body })
      const say = (text) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
      const modelId = MODEL_IDS[state.model] ?? MODEL_IDS.default

      if (state.purpose === 'translate') {
        const text = /^<turn>([\s\S]*)<\/turn>$/.exec(content)?.[1] ?? content
        const answer = `[EN] ${text}`
        const half = Math.ceil(answer.length / 2)
        await say(answer.slice(0, half))
        await say(answer.slice(half))
        await update({ sessionUpdate: 'usage_update', used: 600 + state.turns * 40, size: 200000, cost: { amount: 0, currency: 'USD' }, _meta: { '_claude/model': modelId } })
        return { stopReason: 'end_turn', usage: { totalTokens: 32, inputTokens: 12, outputTokens: 20 } }
      }

      if (state.purpose === 'summary') {
        const body = /<transcricao>\n([\s\S]*)\n<\/transcricao>/.exec(content)?.[1] ?? ''
        const lines = body.split('\n').filter((line) => /^\[[\d:]+\] [^:]+: /.test(line))
        const speakers = [...new Set(lines.map((line) => /^\[[\d:]+\] ([^:]+): /.exec(line)?.[1] ?? ''))]
        const participant = speakers.find((name) => name !== 'Você') ?? null
        const summary = {
          overview: `Reunião com ${lines.length} falas de ${speakers.join(' e ')}, resumida pelo agente. A conversa tratou da captura do microfone e do áudio do sistema durante a gravação.`,
          decisions: ['Manter a captura do microfone separada do áudio do sistema.'],
          tasks: [
            { task: 'Revisar a transcrição da reunião', owner: 'Você', due: 'sexta-feira' },
            { task: 'Enviar as notas aos participantes', owner: participant, due: null },
          ],
        }
        const text = `\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``
        for (let at = 0; at < text.length; at += 80) await say(text.slice(at, at + 80))
        return { stopReason: 'end_turn', usage: { totalTokens: Math.ceil(content.length / 4) + 120, inputTokens: Math.ceil(content.length / 4), outputTokens: 120 } }
      }

      // Contrato 24: o rascunho do WhatsApp, só texto (o agente nunca envia nada).
      if (state.purpose === 'draft') {
        await say(fakeDraft(content))
        return { stopReason: 'end_turn', usage: { totalTokens: Math.ceil(content.length / 4) + 30, inputTokens: Math.ceil(content.length / 4), outputTokens: 30 } }
      }

      if (state.purpose === 'analysis') {
        await sleep(pause * 5)
        const text = `\`\`\`json\n${JSON.stringify(fakeAnalysis(content), null, 2)}\n\`\`\``
        for (let at = 0; at < text.length; at += 80) await say(text.slice(at, at + 80))
        await update({ sessionUpdate: 'usage_update', used: 900, size: 200000, cost: { amount: 0.0042, currency: 'USD' }, _meta: { '_claude/model': modelId } })
        return { stopReason: 'end_turn', usage: { totalTokens: Math.ceil(content.length / 4) + 90, inputTokens: Math.ceil(content.length / 4), outputTokens: 90 } }
      }

      // Chat.
      const history = content.startsWith('<historico>')
      const question = history ? (/\nPergunta: ([\s\S]*)$/.exec(content)?.[1] ?? content) : content
      const slow = /devagar/i.test(question)
      const wait = () => sleep(slow ? Math.min(pause, 100) : pause)
      const folder = readFolder(state.cwd)
      const thinking = `A pessoa perguntou: ${question.slice(0, 60)}. Vou ler o índice e abrir a reunião mais recente. <b>sem HTML</b>`
      for (let at = 0; at < thinking.length; at += 24) {
        await sleep(Math.min(pause, 40))
        await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: thinking.slice(at, at + 24) } })
      }
      const plan = [
        { content: 'Ler o índice das reuniões', priority: 'high', status: 'in_progress' },
        { content: 'Abrir a reunião mais recente', priority: 'high', status: 'pending' },
        { content: 'Responder com a citação', priority: 'medium', status: 'pending' },
      ]
      await update({ sessionUpdate: 'plan', entries: plan })

      const use = async (name, kind, title, rawInput, locations) => {
        state.tools += 1
        const toolCallId = `toolu_${sessionId}_${state.tools}`
        // Como o adaptador: primeiro a chamada com a entrada vazia, depois a entrada completa.
        await update({ sessionUpdate: 'tool_call', toolCallId, name, kind, title: name, status: 'pending', rawInput: {}, content: [] })
        await update({ sessionUpdate: 'tool_call_update', toolCallId, title, kind, rawInput, ...(locations ? { locations } : {}) })
        await wait()
        const response = await ctx.client.request('session/request_permission', {
          sessionId,
          toolCall: { toolCallId, title, rawInput },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        })
        const allowed = response.outcome.outcome === 'selected' && response.outcome.optionId.startsWith('allow')
        log({ event: 'permission', sessionId, tool: name, kind, outcome: allowed ? 'allow' : 'reject' })
        if (allowed) await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' })
        await wait()
        await update({ sessionUpdate: 'tool_call_update', toolCallId, status: allowed ? 'completed' : 'failed' })
        return allowed
      }
      if (folder.index) await use('Read', 'read', 'Read INDICE.md', { file_path: join(state.cwd, 'INDICE.md') }, [{ path: join(state.cwd, 'INDICE.md'), line: 1 }])
      plan[0].status = 'completed'
      plan[1].status = 'in_progress'
      await update({ sessionUpdate: 'plan', entries: plan })
      if (folder.file) await use('Read', 'read', `Read ${folder.file}`, { file_path: join(state.cwd, folder.file) }, [{ path: join(state.cwd, folder.file), line: 1 }])
      await use('Grep', 'search', 'grep "decid"', { pattern: 'decid', path: state.cwd })
      // Escrita: permissão pedida e negada.
      await use('Write', 'edit', 'Write nota.md', { file_path: join(state.cwd, 'nota.md'), content: 'x' }, [{ path: join(state.cwd, 'nota.md') }])
      // Leitura fora da pasta pelo cliente: recusada.
      try {
        await ctx.client.request('fs/read_text_file', { sessionId, path: join(state.cwd, '..', 'fora.txt') })
        log({ event: 'read-outside', sessionId, refused: false })
      } catch (error) {
        log({ event: 'read-outside', sessionId, refused: true, code: error?.code ?? null })
      }
      // Terminal: o cliente não tem.
      try {
        await ctx.client.request('terminal/create', { sessionId, command: 'ls', args: ['~'] })
        log({ event: 'terminal', sessionId, refused: false })
      } catch (error) {
        log({ event: 'terminal', sessionId, refused: true, code: error?.code ?? null })
      }
      plan[1].status = 'completed'
      plan[2].status = 'in_progress'
      await update({ sessionUpdate: 'plan', entries: plan })

      const cite = folder.first ? `[${folder.first.title} · ${folder.first.day}](meeting:${folder.first.id})` : 'Não encontrei nas reuniões.'
      const text = folder.index
        ? `Li o **INDICE.md** pelo agente: ${folder.count} reuniões. A mais recente é ${cite}.\n\n- Arquivos na pasta: ${folder.files.length}\n- Histórico: ${history ? 'sim' : 'não'}\n- Modelo: ${state.model}`
        : `Esta conversa é só sobre ${cite}.\n\n- Arquivos na pasta: ${folder.files.length}\n- Histórico: ${history ? 'sim' : 'não'}\n- Modelo: ${state.model}`
      const parts = slow ? 40 : 6
      const size = Math.ceil(text.length / parts)
      for (let at = 0; at < text.length; at += size) {
        if (state.cancelled) break
        await sleep(slow ? 250 : Math.min(pause, 120))
        if (state.cancelled) break
        await say(text.slice(at, at + size))
      }
      if (state.cancelled) {
        log({ event: 'cancelled', sessionId })
        return { stopReason: 'cancelled', usage: { totalTokens: 100, inputTokens: 80, outputTokens: 20 } }
      }
      plan[2].status = 'completed'
      await update({ sessionUpdate: 'plan', entries: plan })
      state.cost += 0.0213
      await update({ sessionUpdate: 'usage_update', used: 3100, size: 200000, cost: { amount: state.cost, currency: 'USD' }, _meta: { '_claude/model': modelId } })
      return { stopReason: 'end_turn', usage: { totalTokens: 3532, inputTokens: 12, outputTokens: 420, cachedReadTokens: 1000, cachedWriteTokens: 2100 } }
    })
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${FAKE_ACP_VERSION}\n`)
    process.exit(0)
  }
  const logAt = args.indexOf('--log')
  const logPath = logAt === -1 ? null : args[logAt + 1]
  const log = logPath ? (entry) => appendFileSync(logPath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`) : () => undefined
  const connection = fakeAcpAgent({ log }).connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
  // Como o adaptador: sai quando a conexão fecha (stdin no fim) ou no SIGTERM.
  void connection.closed.then(() => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
}
