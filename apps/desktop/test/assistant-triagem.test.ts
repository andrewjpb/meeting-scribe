// Contrato 163: os cartões da triagem do WhatsApp no Assistente (`triagem-agente` e `triagem-etiqueta`): o esquema dos
// blocos (CA1), o que o main lê para montar o cartão (CA2), o clique idempotente pelas funções injetadas (CA3, CA4), o
// histórico e o esquema gravado (CA5), a etiqueta no `CONVERSAS-WHATSAPP.md` (CA6), a seção do `AUTOMACOES.md` (CA7) e
// o "Abrir" de Notificações e das abas do WhatsApp (CA9, com o texto do cartão conferido no arquivo).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { whatsappOpenState, type ChatAction, type ChatActionTriagemAgente, type ChatActionTriagemEtiqueta } from '../src/shared/assistant'
import { TRIAGEM_TEMPLATE, type Agent, type ScheduledTask } from '../src/shared/automations'
import type { Chat } from '../src/shared/chat'
import { aplicarManual, type EtiquetaPatch, type TriagemStatus } from '../src/shared/triagem'
import type { WhatsAppChat, WhatsAppMessage } from '../src/shared/whatsapp'
import { actionsHistory, createChatActions, extractActions, type ActionResolver, type ChatActionsDeps } from '../src/main/chat/actions'
import { automationsMarkdown } from '../src/main/chat/sources'
import { chatActionSchema, createFileChatStore } from '../src/main/chat/store'
import { exportRecentWith, overviewLine } from '../src/main/whatsapp/export'
import type { BridgeClient } from '../src/main/whatsapp/client'

const SP = 'America/Sao_Paulo'
const ANA = '5511911110000@s.whatsapp.net'
const NINGUEM = '5511900000000@s.whatsapp.net'
const NOW = Date.parse('2026-11-23T14:24:00-03:00')
const ISO = new Date(NOW).toISOString()

const STATUS: TriagemStatus = { ativo: true, motivo: null, agenteNome: 'Triagem do WhatsApp', tarefaId: 't-1', hoje: 12, teto: 300 }
const agente = (patch: Partial<Agent> = {}): Agent => ({ ...TRIAGEM_TEMPLATE, id: 'ag-1', createdAt: ISO, updatedAt: ISO, ...patch })
const tarefa = (patch: Partial<ScheduledTask> = {}): ScheduledTask =>
  ({
    id: 't-1',
    name: 'Triagem do WhatsApp',
    agentId: 'ag-1',
    message: 'Classificar a conversa do WhatsApp que recebeu mensagem.',
    schedule: { kind: 'whatsapp-message', esperaSeg: 30, grupos: false },
    timezone: SP,
    enabled: true,
    runOnce: false,
    runOnceAction: 'disable',
    timeoutS: 300,
    notify: 'never',
    output: null,
    reminder: null,
    email: null,
    lastRunAt: null,
    nextRunAt: null,
    lastStatus: null,
    lastResultPreview: null,
    lastError: null,
    consecutiveFailures: 0,
    autoPaused: false,
    createdAt: ISO,
    updatedAt: ISO,
    ...patch,
  }) as ScheduledTask

const block = (json: unknown): string => `\`\`\`lap-acao\n${JSON.stringify(json)}\n\`\`\``

function resolver(leitura: { status?: TriagemStatus; agent?: Agent | null; task?: ScheduledTask | null } = {}, patch: Partial<ActionResolver> = {}): ActionResolver {
  let n = 0
  return {
    whatsappChat: (chatId) => Promise.resolve(chatId === ANA ? { name: 'Ana Souza', kind: 'person' } : null),
    triagem: () => Promise.resolve({ status: leitura.status ?? STATUS, agent: leitura.agent ?? null, task: leitura.task ?? null }),
    triagemEtiquetas: () => Promise.resolve({}),
    now: () => NOW,
    timeZone: () => SP,
    newId: () => `a${++n}`,
    ...patch,
  }
}

/** As Automações e a triagem em memória, com as chamadas contadas. */
function fakeTriagem(inicio: { agent: Agent | null; task: ScheduledTask | null }, pausaGeral = false) {
  const state = { ...inicio }
  const deps = {
    situacao: vi.fn(() =>
      Promise.resolve({ agent: state.agent, task: state.task, motivo: !state.agent || !state.task ? ('sem-agente' as const) : !state.task.enabled || pausaGeral ? ('pausado' as const) : null }),
    ),
    createFromTemplate: vi.fn(async () => {
      await new Promise((done) => setTimeout(done, 5))
      state.agent = agente()
      state.task = tarefa()
      return { ok: true as const, agentId: 'ag-1', taskId: 't-1' }
    }),
    saveAgent: vi.fn((input: Parameters<NonNullable<ChatActionsDeps['triagem']>['saveAgent']>[0]) => {
      state.agent = { ...agente(), ...input, id: input.id ?? 'ag-1' }
      return Promise.resolve({ ok: true as const, agent: state.agent })
    }),
    saveTask: vi.fn((input: Parameters<NonNullable<ChatActionsDeps['triagem']>['saveTask']>[0]) => {
      state.task = { ...(state.task ?? tarefa()), schedule: input.schedule }
      return Promise.resolve({ ok: true as const, task: state.task })
    }),
    toggleTask: vi.fn(({ enabled }: { id: string; enabled: boolean }) => {
      state.task = { ...(state.task ?? tarefa()), enabled }
      return Promise.resolve(state.task)
    }),
    set: vi.fn((_chatId: string, patch: EtiquetaPatch) => Promise.resolve({ ok: true as const, etiqueta: aplicarManual(null, patch, NOW) })),
  }
  return { state, deps }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'assistente-triagem-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const chatWith = (actions: ChatAction[]): Chat => ({
  id: 'c1',
  meetingId: null,
  title: 'Triagem do WhatsApp',
  createdAt: ISO,
  messages: [
    { role: 'user', text: 'Pedido', at: ISO },
    { role: 'assistant', text: 'Proposta', at: ISO, actions },
  ],
  scope: { kind: 'all' },
  model: null,
  thinkMore: false,
})
const ref = (actionId: string) => ({ chatId: 'c1', index: 1, actionId })

async function cartoes(text: string, using: ActionResolver = resolver()): Promise<ChatAction[]> {
  return (await extractActions(text, using)).actions
}

describe('CA1: o esquema dos blocos', () => {
  it('aceita os três formatos e recusa etiqueta sem eixo, espera abaixo de 5 e ação desconhecida', async () => {
    expect(await cartoes(block({ tipo: 'triagem-agente', acao: 'criar', instrucoes: 'Separe o urgente.', esperaSeg: 45, grupos: true }))).toHaveLength(1)
    expect(await cartoes(block({ tipo: 'triagem-agente', acao: 'pausar' }), resolver({ agent: agente(), task: tarefa() }))).toHaveLength(1)
    expect(await cartoes(block({ tipo: 'triagem-etiqueta', chatId: ANA, urgente: true, ambito: 'profissional' }))).toHaveLength(1)
    expect(await cartoes(block({ tipo: 'triagem-etiqueta', chatId: ANA, ambito: 'nenhum' }))).toHaveLength(1)
    expect(await cartoes(block({ tipo: 'triagem-etiqueta', chatId: ANA }))).toEqual([])
    expect(await cartoes(block({ tipo: 'triagem-agente', acao: 'criar', esperaSeg: 4 }))).toEqual([])
    expect(await cartoes(block({ tipo: 'triagem-agente', acao: 'apagar' }))).toEqual([])
    // O bloco recusado fica como texto.
    const recusado = await extractActions(block({ tipo: 'triagem-agente', acao: 'apagar' }), resolver())
    expect(recusado.text).toContain('"apagar"')
    // Com o app bloqueado (sem a triagem), os dois ficam como texto.
    const bloqueado = resolver({}, { triagem: () => Promise.resolve(null), triagemEtiquetas: () => Promise.resolve(null) })
    expect(await cartoes(block({ tipo: 'triagem-agente', acao: 'criar' }), bloqueado)).toEqual([])
    expect(await cartoes(block({ tipo: 'triagem-etiqueta', chatId: ANA, urgente: true }), bloqueado)).toEqual([])
  })
})

describe('CA2: o cartão do agente', () => {
  it('sem agente: "criar", o funil nas permissões e a prévia das instruções do modelo pronto em 140 caracteres e "…"', async () => {
    const [card] = (await cartoes(block({ tipo: 'triagem-agente', acao: 'criar' }))) as ChatActionTriagemAgente[]
    expect(card).toMatchObject({ kind: 'triagem-agente', acao: 'criar', agente: null, tarefa: null, avisos: [], status: 'proposed' })
    expect(card?.permissoes).toContain('Pode ler o funil')
    expect(card?.instrucoesPreview).toBe(`${TRIAGEM_TEMPLATE.instructions.slice(0, 140)}…`)
    expect(card?.instrucoesPreview).toHaveLength(141)
  })

  it('com agente: o "criar" vira "editar" com `ja-existe`; o interruptor desligado só avisa', async () => {
    const [existe] = (await cartoes(block({ tipo: 'triagem-agente', acao: 'criar', esperaSeg: 45 }), resolver({ agent: agente(), task: tarefa() }))) as ChatActionTriagemAgente[]
    expect(existe).toMatchObject({ acao: 'editar', avisos: ['ja-existe'], agente: { id: 'ag-1', nome: 'Triagem do WhatsApp', modelo: 'haiku' }, tarefa: { id: 't-1', esperaSeg: 30, grupos: false, enabled: true }, pedido: { esperaSeg: 45, grupos: null, instrucoes: null } })
    const desligado = { ...STATUS, ativo: false, motivo: 'desligado' as const }
    const [criar] = (await cartoes(block({ tipo: 'triagem-agente', acao: 'criar' }), resolver({ status: desligado }))) as ChatActionTriagemAgente[]
    expect(criar).toMatchObject({ acao: 'criar', avisos: ['desligado'] })
    const [pausar] = (await cartoes(block({ tipo: 'triagem-agente', acao: 'pausar' }))) as ChatActionTriagemAgente[]
    expect(pausar?.avisos).toEqual(['sem-agente'])
    // "editar" sem nada a mudar não vira cartão.
    expect(await cartoes(block({ tipo: 'triagem-agente', acao: 'editar' }), resolver({ agent: agente(), task: tarefa() }))).toEqual([])
  })
})

describe('CA3: o clique no cartão do agente', () => {
  it('criar chama o modelo pronto uma vez só, mesmo com dois cliques; grava "Agente de triagem criado"', async () => {
    const [card] = await cartoes(block({ tipo: 'triagem-agente', acao: 'criar' }))
    const store = createFileChatStore({ dir })
    await store.save(chatWith([card as ChatAction]))
    const { deps } = fakeTriagem({ agent: null, task: null })
    const actions = createChatActions({ store, timeZone: () => SP, now: () => NOW, triagem: deps })
    const [first, second] = await Promise.all([actions.triagem(ref('a1')), actions.triagem(ref('a1'))])
    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, error: 'done' })
    expect(await actions.triagem(ref('a1'))).toEqual({ ok: false, error: 'done' })
    expect(deps.createFromTemplate).toHaveBeenCalledTimes(1)
    expect((await store.get('c1'))?.messages[1]?.actions?.[0]).toMatchObject({ status: 'done', result: 'Agente de triagem criado' })
  })

  it('pausar e retomar mexem no `enabled` da tarefa; editar com 45 s grava 45 na tarefa e só ela', async () => {
    const using = resolver({ agent: agente(), task: tarefa() })
    const [pausar] = await cartoes(block({ tipo: 'triagem-agente', acao: 'pausar' }), using)
    const [retomar] = await cartoes(block({ tipo: 'triagem-agente', acao: 'retomar' }), using)
    const [editar] = await cartoes(block({ tipo: 'triagem-agente', acao: 'editar', esperaSeg: 45 }), using)
    const store = createFileChatStore({ dir })
    await store.save(chatWith([{ ...(pausar as ChatAction), id: 'p' }, { ...(retomar as ChatAction), id: 'r' }, { ...(editar as ChatAction), id: 'e' }]))
    const { state, deps } = fakeTriagem({ agent: agente(), task: tarefa() })
    const actions = createChatActions({ store, timeZone: () => SP, now: () => NOW, triagem: deps })
    expect((await actions.triagem(ref('p'))).ok).toBe(true)
    expect(state.task?.enabled).toBe(false)
    expect((await actions.triagem(ref('r'))).ok).toBe(true)
    expect(state.task?.enabled).toBe(true)
    expect((await actions.triagem(ref('e'))).ok).toBe(true)
    expect(state.task?.schedule).toEqual({ kind: 'whatsapp-message', esperaSeg: 45, grupos: false })
    expect(deps.saveTask.mock.calls[0]?.[0]).toMatchObject({ id: 't-1', name: 'Triagem do WhatsApp', enabled: true, email: null })
    expect(deps.saveAgent).not.toHaveBeenCalled()
    expect(deps.createFromTemplate).not.toHaveBeenCalled()
    const saved = (await store.get('c1'))?.messages[1]?.actions ?? []
    expect(saved.map((action) => action.result)).toEqual(['Agente de triagem pausado', 'Agente de triagem retomado', 'Agente de triagem atualizado'])
  })

  it('criar com instruções aplica depois de criar; pausar sem agente fica "failed" sem chamar nada', async () => {
    const [criar] = await cartoes(block({ tipo: 'triagem-agente', acao: 'criar', instrucoes: 'Só urgente quando falar de prazo.', grupos: true }))
    const [pausar] = await cartoes(block({ tipo: 'triagem-agente', acao: 'pausar' }))
    const store = createFileChatStore({ dir })
    await store.save(chatWith([{ ...(criar as ChatAction), id: 'c' }, { ...(pausar as ChatAction), id: 'p' }]))
    const vazio = fakeTriagem({ agent: null, task: null })
    const semAgente = createChatActions({ store, timeZone: () => SP, now: () => NOW, triagem: vazio.deps })
    expect((await semAgente.triagem(ref('p'))).ok).toBe(true)
    expect((await store.get('c1'))?.messages[1]?.actions?.[1]).toMatchObject({ status: 'failed', error: 'Não há agente de triagem. Peça para criar o agente primeiro.' })
    expect(vazio.deps.toggleTask).not.toHaveBeenCalled()
    expect((await semAgente.triagem(ref('c'))).ok).toBe(true)
    expect(vazio.state.agent?.instructions).toBe('Só urgente quando falar de prazo.')
    expect(vazio.state.task?.schedule).toEqual({ kind: 'whatsapp-message', esperaSeg: 30, grupos: true })
    expect((await store.get('c1'))?.messages[1]?.actions?.[0]).toMatchObject({ status: 'done', result: 'Agente de triagem criado' })
  })
})

describe('CA4: o clique no cartão da etiqueta', () => {
  it('aplica pelo `set` da triagem com os eixos pedidos; "nenhum" vira âmbito `null`; conversa inexistente não grava', async () => {
    const [aplicar] = (await cartoes(block({ tipo: 'triagem-etiqueta', chatId: ANA, urgente: true, ambito: 'profissional' }))) as ChatActionTriagemEtiqueta[]
    expect(aplicar).toMatchObject({ kind: 'triagem-etiqueta', chat: { id: ANA, name: 'Ana Souza', kind: 'person' }, antes: null, depois: { urgente: true, ambito: 'profissional' }, avisos: [] })
    const [limpar] = await cartoes(block({ tipo: 'triagem-etiqueta', chatId: ANA, ambito: 'nenhum' }))
    const [ninguem] = (await cartoes(block({ tipo: 'triagem-etiqueta', chatId: NINGUEM, urgente: true }))) as ChatActionTriagemEtiqueta[]
    expect(ninguem).toMatchObject({ chat: null, avisos: ['conversa-nao-encontrada'] })
    const store = createFileChatStore({ dir })
    await store.save(chatWith([{ ...(aplicar as ChatAction), id: 'a' }, { ...(limpar as ChatAction), id: 'l' }, { ...(ninguem as ChatAction), id: 'n' }]))
    const { deps } = fakeTriagem({ agent: null, task: null })
    const actions = createChatActions({ store, timeZone: () => SP, now: () => NOW, triagem: deps })
    expect((await actions.triagem(ref('a'))).ok).toBe(true)
    expect(deps.set).toHaveBeenLastCalledWith(ANA, { urgente: true, ambito: 'profissional' })
    expect((await actions.triagem(ref('l'))).ok).toBe(true)
    expect(deps.set).toHaveBeenLastCalledWith(ANA, { ambito: null })
    expect((await actions.triagem(ref('n'))).ok).toBe(true)
    expect(deps.set).toHaveBeenCalledTimes(2)
    const saved = (await store.get('c1'))?.messages[1]?.actions ?? []
    expect(saved[0]).toMatchObject({ status: 'done', result: 'Etiqueta aplicada: Urgente · Profissional' })
    expect(saved[1]).toMatchObject({ status: 'done', result: 'Etiqueta limpa' })
    expect(saved[2]).toMatchObject({ status: 'failed', error: 'Essa conversa não está no WhatsApp conectado.' })
  })
})

describe('CA5: o histórico e o esquema gravado', () => {
  it('descreve os dois tipos; o esquema aceita os dois e recusa tipo desconhecido', async () => {
    const [agenteCard] = await cartoes(block({ tipo: 'triagem-agente', acao: 'criar', esperaSeg: 45 }))
    const [etiqueta] = await cartoes(block({ tipo: 'triagem-etiqueta', chatId: ANA, urgente: true, ambito: 'profissional' }))
    const history = actionsHistory([agenteCard as ChatAction, etiqueta as ChatAction])
    expect(history).toContain('- criar o agente de triagem do WhatsApp com espera de 45 s (esperando o clique)')
    expect(history).toContain('- etiquetar a conversa Ana Souza como Urgente · Profissional (esperando o clique)')
    expect(chatActionSchema.safeParse(agenteCard).success).toBe(true)
    expect(chatActionSchema.safeParse(etiqueta).success).toBe(true)
    expect(chatActionSchema.safeParse({ ...etiqueta, kind: 'triagem-apagar' }).success).toBe(false)
  })
})

describe('CA6: a etiqueta no CONVERSAS-WHATSAPP.md', () => {
  const message = (id: string, chatId: string, at: number, patch: Partial<WhatsAppMessage> = {}): WhatsAppMessage => ({ id, chatId, author: 'Ana Souza', fromMe: false, at, type: 'text', text: `mensagem ${id}`, media: null, ...patch })
  const ana: WhatsAppChat = { id: ANA, name: 'Ana Souza', kind: 'person', unread: 1, lastMessage: message('a1', ANA, NOW - 60_000) }
  const bruno: WhatsAppChat = { id: '5511922220000@s.whatsapp.net', name: 'Bruno Lima', kind: 'person', unread: 0, lastMessage: message('b1', '5511922220000@s.whatsapp.net', NOW - 120_000, { fromMe: true }) }
  const urgente = aplicarManual(null, { urgente: true, ambito: 'profissional' }, NOW)

  it('a linha leva a etiqueta antes do arquivo ("—" sem etiqueta)', () => {
    const reply = { lastFrom: 'Ana Souza', lastAt: NOW, pending: true }
    expect(overviewLine(ana, reply, 'x.md', urgente)).toContain(' · etiqueta: Urgente · Profissional · arquivo: x.md')
    expect(overviewLine(ana, reply, 'x.md')).toContain(' · etiqueta: — · arquivo: x.md')
  })

  it('o cabeçalho conta as urgentes e as pendentes e explica os dois campos', async () => {
    const client: Pick<BridgeClient, 'messages' | 'chats'> = {
      chats: () => Promise.resolve([ana, bruno]),
      messages: (chatId) => Promise.resolve(chatId === ANA ? [message('a1', ANA, NOW - 60_000)] : [message('b1', bruno.id, NOW - 120_000, { fromMe: true })]),
    }
    await exportRecentWith(client, dir, NOW, undefined, undefined, { [ANA]: urgente })
    const overview = readFileSync(join(dir, 'CONVERSAS-WHATSAPP.md'), 'utf8')
    expect(overview).toContain('Urgentes: 1 · Pendentes de resposta: 1 de 2')
    expect(overview).toContain('"Etiqueta" é a da triagem do WhatsApp')
    expect(overview).toContain('"Pendente de resposta: sim"')
    expect(overview).toContain('· etiqueta: Urgente · Profissional · arquivo:')
    expect(overview).toContain('· etiqueta: — · arquivo:')
    // Sem as etiquetas: todas com "—" e nenhuma urgente.
    await exportRecentWith(client, dir, NOW)
    expect(readFileSync(join(dir, 'CONVERSAS-WHATSAPP.md'), 'utf8')).toContain('Urgentes: 0 · Pendentes de resposta: 1 de 2')
  })
})

describe('CA7: a seção da triagem no AUTOMACOES.md', () => {
  it('ativo, com o gatilho, as triagens do dia e as urgentes; sem agente, diz isso e como criar', () => {
    const md = automationsMarkdown({ agents: [], tasks: [], runs: [], triagem: { status: STATUS, urgentes: 2, esperaSeg: 30, grupos: false } }, SP)
    expect(md).toContain('\n## Triagem do WhatsApp\n')
    expect(md).toContain('- agente: Triagem do WhatsApp')
    expect(md).toContain('- estado: ativo')
    expect(md).toContain('- espera: 30 s depois da última mensagem · grupos: não')
    expect(md).toContain('- triagens hoje: 12 de 300')
    expect(md).toContain('- urgentes agora: 2')
    expect(md).toContain('Para criar ou mudar o agente, proponha `triagem-agente`.')
    const sem = automationsMarkdown({ agents: [], tasks: [], runs: [], triagem: { status: { ...STATUS, ativo: false, motivo: 'sem-agente', agenteNome: null, tarefaId: null }, urgentes: 0, esperaSeg: null, grupos: null } }, SP)
    expect(sem).toContain('- estado: sem agente')
    expect(sem).toContain('Para criar ou mudar o agente, proponha `triagem-agente`.')
    const desligada = automationsMarkdown({ agents: [], tasks: [], runs: [], triagem: { status: { ...STATUS, ativo: false, motivo: 'desligado' }, urgentes: 0, esperaSeg: 30, grupos: true } }, SP)
    expect(desligada).toContain('- estado: desligada nas Configurações')
    // Sem a triagem no retrato (os testes antigos), a seção não sai.
    expect(automationsMarkdown({ agents: [], tasks: [], runs: [] }, SP)).not.toContain('Triagem do WhatsApp')
  })
})

describe('CA9: o "Abrir" de Notificações e das abas do WhatsApp; os cartões', () => {
  it('notificacoes vira cartão; whatsapp aceita a aba (sem conversa) e continua aceitando a conversa', async () => {
    const [notificacoes] = await cartoes(block({ tipo: 'abrir', tela: 'notificacoes' }))
    expect(notificacoes).toMatchObject({ kind: 'abrir', screen: 'notificacoes', target: null, label: 'Abrir Notificações' })
    const [urgentes] = await cartoes(block({ tipo: 'abrir', tela: 'whatsapp', alvo: 'urgentes' }))
    expect(urgentes).toMatchObject({ screen: 'whatsapp', target: 'urgentes', label: 'Abrir WhatsApp › Urgentes' })
    const [conversa] = await cartoes(block({ tipo: 'abrir', tela: 'whatsapp', alvo: ANA }))
    expect(conversa).toMatchObject({ screen: 'whatsapp', target: ANA, label: 'Abrir a conversa com Ana Souza' })
    expect(await cartoes(block({ tipo: 'abrir', tela: 'whatsapp', alvo: 'todas' }))).toEqual([])
    expect(whatsappOpenState('urgentes')).toEqual({ aba: 'urgentes' })
    expect(whatsappOpenState(ANA)).toEqual({ chatId: ANA })
    expect(whatsappOpenState(null)).toEqual({})
  })

  it('o cartão navega para /notificacoes e para a aba; os dois cartões da triagem têm os botões e o tipo', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/renderer/src/features/chat/ActionCards.tsx'), 'utf8')
    expect(source).toContain("case 'notificacoes':\n        void navigate(ROUTE_PATHS.notificacoes)")
    expect(source).toContain('void navigate(ROUTE_PATHS.whatsapp, { state: whatsappOpenState(action.target) })')
    expect(source).toContain('data-chat-action-kind="triagem-agente"')
    expect(source).toContain('data-chat-action-kind="triagem-etiqueta"')
    for (const label of ["label: 'Criar agente'", "label: 'Salvar'", "label: 'Pausar'", "label: 'Retomar'", '>\n            Aplicar\n']) expect(source).toContain(label)
    // O cartão da triagem nunca envia mensagem.
    const triagem = source.slice(source.indexOf('// --- Contrato 163'), source.indexOf('/** O cartão de uma ação, pelo tipo. */'))
    expect(triagem).not.toMatch(/whatsappSend|whatsapp-send|agentSend/)
  })
})

describe('devolução do 163: "já existia" e a pausa geral dos agendamentos', () => {
  it('o "criar" de um agente que já existe, sem nada a mudar (ou com os mesmos valores), não diz "atualizado"', async () => {
    const using = resolver({ agent: agente(), task: tarefa() })
    const [igual] = (await cartoes(block({ tipo: 'triagem-agente', acao: 'criar' }), using)) as ChatActionTriagemAgente[]
    expect(igual).toMatchObject({ acao: 'editar', avisos: ['ja-existe'], pedido: { instrucoes: null, esperaSeg: null, grupos: null } })
    const [mesmo] = await cartoes(block({ tipo: 'triagem-agente', acao: 'editar', esperaSeg: 30 }), using)
    const store = createFileChatStore({ dir })
    await store.save(chatWith([{ ...(igual as ChatAction), id: 'i' }, { ...(mesmo as ChatAction), id: 'm' }]))
    const { deps } = fakeTriagem({ agent: agente(), task: tarefa() })
    const actions = createChatActions({ store, timeZone: () => SP, now: () => NOW, triagem: deps })
    expect((await actions.triagem(ref('i'))).ok).toBe(true)
    expect((await actions.triagem(ref('m'))).ok).toBe(true)
    expect(deps.saveAgent).not.toHaveBeenCalled()
    expect(deps.saveTask).not.toHaveBeenCalled()
    expect(deps.createFromTemplate).not.toHaveBeenCalled()
    const saved = (await store.get('c1'))?.messages[1]?.actions ?? []
    expect(saved.map((action) => action.result)).toEqual(['O agente de triagem já existia; nada mudou.', 'O agente de triagem já existia; nada mudou.'])
    const source = readFileSync(join(import.meta.dirname, '../src/renderer/src/features/chat/ActionCards.tsx'), 'utf8')
    expect(source).toContain('Abrir agente')
  })

  it('retomar com os agendamentos pausados avisa no cartão e no resultado', async () => {
    const pausado = { ...STATUS, ativo: false, motivo: 'pausado' as const }
    const [retomar] = (await cartoes(block({ tipo: 'triagem-agente', acao: 'retomar' }), resolver({ status: pausado, agent: agente(), task: tarefa() }))) as ChatActionTriagemAgente[]
    expect(retomar?.avisos).toEqual(['agendamentos-pausados'])
    // A tarefa desligada (o motivo do "pausado" é ela) não é a pausa geral.
    const [soTarefa] = (await cartoes(block({ tipo: 'triagem-agente', acao: 'retomar' }), resolver({ status: pausado, agent: agente(), task: tarefa({ enabled: false }) }))) as ChatActionTriagemAgente[]
    expect(soTarefa?.avisos).toEqual([])
    const store = createFileChatStore({ dir })
    await store.save(chatWith([{ ...(retomar as ChatAction), id: 'r' }, { ...(soTarefa as ChatAction), id: 's' }]))
    const geral = fakeTriagem({ agent: agente(), task: tarefa({ enabled: false }) }, true)
    expect((await createChatActions({ store, timeZone: () => SP, now: () => NOW, triagem: geral.deps }).triagem(ref('r'))).ok).toBe(true)
    expect(geral.state.task?.enabled).toBe(true)
    const livre = fakeTriagem({ agent: agente(), task: tarefa({ enabled: false }) })
    expect((await createChatActions({ store, timeZone: () => SP, now: () => NOW, triagem: livre.deps }).triagem(ref('s'))).ok).toBe(true)
    const saved = (await store.get('c1'))?.messages[1]?.actions ?? []
    expect(saved.map((action) => action.result)).toEqual(['Agente de triagem retomado; os agendamentos continuam pausados.', 'Agente de triagem retomado'])
    const source = readFileSync(join(import.meta.dirname, '../src/renderer/src/features/chat/ActionCards.tsx'), 'utf8')
    expect(source).toContain('Os agendamentos estão pausados; retome-os nas Automações.')
  })
})
