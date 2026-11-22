// Contrato 122 (tarefas, CA1 a CA7, CA10 e CA11): o serviço das tarefas sobre o store real numa pasta temporária, com
// os outros domínios falsos e contados. Lembrete padrão (CA1, R11), vínculos da oportunidade (CA2, R9), gancho do
// funil (CA3, R10), lembretes no tick (CA4, R12), "Adicionar" do resumo (CA5, R22, R23), sugestões (CA6, R26), custo
// das leituras (CA7, D3), destino pendente do "Abrir" (CA10) e virada do dia (CA11). Contrato 131 (CA1): a sugestão
// da análise adicionada não volta.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Contato, Etapa, FunilState, Oportunidade } from '../src/shared/funil'
import type { MeetingAnalysis } from '../src/shared/meeting-analysis'
import type { MeetingSummary, SummaryTask } from '../src/shared/meeting-summary'
import type { Meeting } from '../src/shared/meetings'
import { DEFAULT_SETTINGS, type TarefasSettings } from '../src/shared/settings-defaults'
import type { AvisoTarefa, EventoOportunidade, TarefaNova, TarefasActionResult, TarefasView } from '../src/shared/tarefas'
import type { WhatsAppChat } from '../src/shared/whatsapp'
import type { WhatsAppInsights, WhatsAppInsightsCache } from '../src/shared/whatsapp-insights'
import { avisoMostrado, createDestinoPendente } from '../src/main/tarefas/lembretes'
import { createTarefasService, type TarefasServiceDeps } from '../src/main/tarefas/service'
import { createTarefasStore, type TarefasStore } from '../src/main/tarefas/store'

const TZ = 'America/Sao_Paulo'
const DIA_MS = 86_400_000
const NOW = Date.parse('2026-11-22T15:00:00-03:00')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const ETAPAS: Etapa[] = [
  { id: 'e-aberta', nome: 'Proposta', tipo: 'aberta', ordem: 0 },
  { id: 'e-ganho', nome: 'Ganho', tipo: 'ganho', ordem: 1 },
]

function contato(id: string, nome: string, emails: string[] = []): Contato {
  return { id, nome, emails, telefones: [], empresaId: null, cargo: null, notas: '', whatsappChatId: null, origem: 'manual', criadoEm: 0, atualizadoEm: 0, arquivado: false }
}

function oportunidade(id: string, patch: Partial<Oportunidade> = {}): Oportunidade {
  return {
    id,
    titulo: `Oportunidade ${id}`,
    empresaId: null,
    contatoIds: [],
    etapaId: 'e-aberta',
    ordem: 0,
    valor: null,
    previsao: null,
    proximoPasso: null,
    meetingIds: [],
    whatsappChatIds: [],
    emails: [],
    origem: 'manual',
    motivoPerda: null,
    criadoEm: 0,
    atualizadoEm: 0,
    movidoEm: 0,
    fechadoEm: null,
    arquivado: false,
    ...patch,
  }
}

function funilState(patch: Partial<FunilState> = {}): FunilState {
  return { version: 1, contatos: [], empresas: [], oportunidades: [], etapas: ETAPAS, eventos: [], ignorados: [], ultimoAvisoEm: null, ...patch } as FunilState
}

function meeting(id: string, title: string, startedAt: number, attendees: { name: string; email: string }[] = []): Meeting {
  return { id, title, startedAt: new Date(startedAt).toISOString(), durationMs: 60_000, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null, calendar: { attendees } }
}

function summary(meetingId: string, tasks: SummaryTask[]): MeetingSummary {
  return { version: 1, meetingId, createdAt: new Date(NOW).toISOString(), model: 'claude-cli:haiku', overview: 'Resumo.', decisions: [], tasks } as MeetingSummary
}

function analise(meetingId: string, toConfirm: { text: string; owner?: string }[]): MeetingAnalysis {
  return { id: `a-${meetingId}`, meetingId, createdAt: new Date(NOW).toISOString(), atMs: 0, model: 'claude-cli:haiku', costUsd: null, durationMs: null, openQuestions: [], unclearTopics: [], toConfirm, suggestedQuestions: [], answered: [] } as MeetingAnalysis
}

const chat = (id: string, name: string, at: number): WhatsAppChat => ({ id, name, kind: 'person', unread: 0, lastMessage: { at } as WhatsAppChat['lastMessage'] }) as WhatsAppChat

function insight(chatId: string, minhas: string[]): WhatsAppInsightsCache[string] {
  const result = { chatId, at: 0, createdAt: '', messages: 1, model: 'x', costUsd: null, durationMs: null, resumo: '', pontos: [], humor: { valor: 'neutro', justificativa: '' }, humorDias: [], pendencias: { minhas, deles: [] }, compromissos: [] } as WhatsAppInsights
  return { at: 0, result }
}

interface Fakes {
  funil: FunilState
  meetings: Meeting[]
  summaries: Map<string, MeetingSummary>
  analyses: Map<string, MeetingAnalysis[]>
  insights: WhatsAppInsightsCache
  chats: WhatsAppChat[]
  chatsFalham: boolean
  config: TarefasSettings
}

function setup(options: { dir?: string; fakes?: Partial<Fakes>; store?: (store: TarefasStore) => TarefasStore; onOportunidade?: TarefasServiceDeps['onOportunidade']; now?: () => number } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'tarefas-service-'))
  if (!options.dir) dirs.push(dir)
  const fakes: Fakes = {
    funil: funilState(),
    meetings: [],
    summaries: new Map(),
    analyses: new Map(),
    insights: {},
    chats: [],
    chatsFalham: false,
    config: { ...DEFAULT_SETTINGS.tarefas },
    ...options.fakes,
  }
  const now = options.now ?? (() => NOW)
  const realStore = createTarefasStore({ dir, now })
  const store = options.store ? options.store(realStore) : realStore
  const calls = { funil: 0, meetingsList: 0, meetingsGet: 0, summaries: 0, analyses: 0, insights: 0, chats: 0 }
  const views: TarefasView[] = []
  const avisos: AvisoTarefa[] = []
  const logs: string[] = []
  const service = createTarefasService({
    store,
    funil: { state: () => (calls.funil++, Promise.resolve(structuredClone(fakes.funil))) },
    meetings: {
      list: () => (calls.meetingsList++, Promise.resolve(fakes.meetings)),
      get: (id) => (calls.meetingsGet++, Promise.resolve(fakes.meetings.find((item) => item.id === id) ?? null)),
    },
    summaries: { get: (id) => (calls.summaries++, Promise.resolve(fakes.summaries.get(id) ?? null)) },
    analyses: { list: (id) => (calls.analyses++, Promise.resolve(fakes.analyses.get(id) ?? [])) },
    insights: { read: () => (calls.insights++, Promise.resolve(fakes.insights)) },
    whatsapp: { chats: () => (calls.chats++, fakes.chatsFalham ? Promise.reject(new Error('serviço parado')) : Promise.resolve(fakes.chats)) },
    settings: () => Promise.resolve({ tarefas: fakes.config }),
    timeZone: () => TZ,
    notify: (aviso) => void avisos.push(aviso),
    onChange: (view) => void views.push(view),
    ...(options.onOportunidade ? { onOportunidade: options.onOportunidade } : {}),
    now,
    log: (message) => void logs.push(message),
  })
  return { dir, service, store: realStore, fakes, calls, views, avisos, logs }
}

function okId(result: TarefasActionResult): string {
  if (!result.ok || result.id === null) throw new Error(`esperava ok com id: ${JSON.stringify(result)}`)
  return result.id
}

const tarefaNova = (patch: Partial<TarefaNova> = {}): TarefaNova => ({
  titulo: 'Ligar para a Ana',
  detalhe: '',
  prazo: null,
  lembreteEm: null,
  importante: false,
  responsavel: { tipo: 'eu' },
  origem: { tipo: 'manual' },
  vinculos: { oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null },
  ...patch,
})

async function tarefa(store: TarefasStore, id: string) {
  const state = await store.read()
  if (!state.ok) throw new Error('leitura')
  return state.value.tarefas.find((item) => item.id === id)
}

describe('lembrete padrão (CA1, R11)', () => {
  it('nasce do prazo e da hora das Configurações; desligado, nenhum, e o personalizado não acompanha o prazo', async () => {
    const ctx = setup()
    const id = okId(await ctx.service.criar({ titulo: 'Ligar', prazo: '2026-11-25', origem: { tipo: 'manual' } }))
    expect((await tarefa(ctx.store, id))?.lembreteEm).toBe(Date.parse('2026-11-25T09:00:00-03:00'))
    expect(ctx.views).toHaveLength(1)
    expect(ctx.views[0]?.tarefas.map((item) => item.id)).toEqual([id])
    expect(ctx.views[0]?.hoje).toBe('2026-11-22')

    const nenhum = okId(await ctx.service.criar({ titulo: 'Sem aviso', prazo: '2026-11-25', lembrete: 'nenhum', origem: { tipo: 'manual' } }))
    expect((await tarefa(ctx.store, nenhum))?.lembreteEm).toBeNull()

    expect(await ctx.service.salvar({ id, prazo: '2026-11-27' })).toEqual({ ok: true, id })
    expect((await tarefa(ctx.store, id))?.lembreteEm).toBe(Date.parse('2026-11-27T09:00:00-03:00'))

    const personalizado = Date.parse('2026-11-24T14:30:00-03:00')
    const outra = okId(await ctx.service.criar({ titulo: 'Personalizado', prazo: '2026-11-25', lembrete: personalizado, origem: { tipo: 'manual' } }))
    await ctx.service.salvar({ id: outra, prazo: '2026-11-30' })
    expect((await tarefa(ctx.store, outra))?.lembreteEm).toBe(personalizado)

    ctx.fakes.config = { ...ctx.fakes.config, lembrarNoPrazo: false }
    const desligado = okId(await ctx.service.criar({ titulo: 'Desligado', prazo: '2026-11-25', origem: { tipo: 'manual' } }))
    expect((await tarefa(ctx.store, desligado))?.lembreteEm).toBeNull()
  })
})

describe('fila das operações que leem e gravam (devolução do 122)', () => {
  it('dois salvar quase juntos: o lembrete personalizado fica, mesmo com o prazo mudando depois', async () => {
    const ctx = setup()
    const id = okId(await ctx.service.criar({ titulo: 'Ligar', prazo: '2026-11-25', origem: { tipo: 'manual' } }))
    const personalizado = Date.parse('2026-11-24T14:30:00-03:00')
    const [lembrete, prazo] = await Promise.all([ctx.service.salvar({ id, lembrete: personalizado }), ctx.service.salvar({ id, prazo: '2026-11-27' })])
    expect(lembrete).toEqual({ ok: true, id })
    expect(prazo).toEqual({ ok: true, id })
    expect(await tarefa(ctx.store, id)).toMatchObject({ prazo: '2026-11-27', lembreteEm: personalizado })
  })

  it("dois 'Adicionar as minhas' quase juntos criam cada linha uma vez", async () => {
    const ctx = setup({
      fakes: {
        meetings: [meeting('m1', 'Reunião', NOW - DIA_MS)],
        summaries: new Map([['m1', summary('m1', [{ task: 'Enviar a proposta', owner: 'Você', due: null }, { task: 'Revisar o contrato', owner: 'Você', due: null }])]]),
      },
    })
    const [primeiro, segundo] = await Promise.all([ctx.service.adicionarDoResumo({ meetingId: 'm1', indices: 'minhas' }), ctx.service.adicionarDoResumo({ meetingId: 'm1', indices: 'minhas' })])
    expect(primeiro).toMatchObject({ ok: true, criadas: [{ indice: 0 }, { indice: 1 }] })
    expect(segundo).toEqual({ ok: true, criadas: [] })
    expect((await ctx.service.todas()).map((item) => item.titulo).sort()).toEqual(['Enviar a proposta', 'Revisar o contrato'])
  })

  it('o gancho roda fora da fila: o funil pode chamar o serviço de volta sem travar', async () => {
    let ctx: ReturnType<typeof setup> | null = null
    ctx = setup({
      fakes: { funil: funilState({ oportunidades: [oportunidade('op1')] }) },
      onOportunidade: async (evento) => {
        if (evento.acao === 'criada' && ctx) await ctx.service.salvar({ id: evento.tarefaId, importante: true })
      },
    })
    const id = okId(await ctx.service.criar({ titulo: 'Proposta', origem: { tipo: 'manual' }, vinculos: { oportunidadeId: 'op1' } }))
    expect((await tarefa(ctx.store, id))?.importante).toBe(true)
  })
})

describe('ordem do gancho e do onChange (contrato 124)', () => {
  it('com tarefa ligada, o onChange só sai depois de o gancho terminar, com o estado relido (inclui a gravação feita no gancho)', async () => {
    const ordem: string[] = []
    let ctx: ReturnType<typeof setup> | null = null
    ctx = setup({
      fakes: { funil: funilState({ oportunidades: [oportunidade('op1')] }) },
      onOportunidade: async (evento) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        ordem.push(`gancho ${evento.acao} com ${ctx?.views.length ?? -1} avisos`)
      },
    })
    const id = okId(await ctx.service.criar({ titulo: 'Proposta', origem: { tipo: 'manual' }, vinculos: { oportunidadeId: 'op1' } }))
    expect(ordem).toEqual(['gancho criada com 0 avisos'])
    expect(ctx.views).toHaveLength(1)
    expect(ctx.views[0]?.tarefas.map((item) => item.id)).toEqual([id])

    okId(await ctx.service.salvar({ id, prazo: '2026-11-30' }))
    okId(await ctx.service.status({ id, status: 'feita' }))
    expect(ordem).toEqual(['gancho criada com 0 avisos', 'gancho prazo com 1 avisos', 'gancho feita com 2 avisos'])
    expect(ctx.views).toHaveLength(3)
    expect(ctx.views[2]?.tarefas[0]?.status).toBe('feita')
  })

  it('sem tarefa ligada a oportunidade, o onChange sai como antes (um por gravação) e o gancho não é chamado', async () => {
    const chamadas: string[] = []
    const ctx = setup({ onOportunidade: async () => void chamadas.push('gancho') })
    okId(await ctx.service.criar({ titulo: 'Solta', origem: { tipo: 'manual' } }))
    expect(ctx.views).toHaveLength(1)
    expect(chamadas).toEqual([])
  })
})

describe('vínculos da oportunidade (CA2, R9)', () => {
  it('a oportunidade traz contatos e empresa; o contato traz a oportunidade só se tiver exatamente uma aberta', async () => {
    const ctx = setup({
      fakes: {
        funil: funilState({
          contatos: [contato('c1', 'Ana'), contato('c2', 'Bia'), contato('c3', 'Caio'), contato('c4', 'Duda')],
          oportunidades: [
            oportunidade('op1', { contatoIds: ['c1', 'c2'], empresaId: 'emp1' }),
            oportunidade('op2', { contatoIds: ['c3'] }),
            // Fechada e arquivada não contam para o contato.
            oportunidade('op-ganha', { contatoIds: ['c3'], etapaId: 'e-ganho' }),
            oportunidade('op-arquivada', { contatoIds: ['c3'], arquivado: true }),
            oportunidade('op3', { contatoIds: ['c4'] }),
            oportunidade('op4', { contatoIds: ['c4'] }),
          ],
        }),
      },
    })
    const ligada = okId(await ctx.service.criar({ titulo: 'Proposta', origem: { tipo: 'manual' }, vinculos: { oportunidadeId: 'op1' } }))
    expect((await tarefa(ctx.store, ligada))?.vinculos).toMatchObject({ oportunidadeId: 'op1', contatoIds: ['c1', 'c2'], empresaId: 'emp1' })

    const doContato = okId(await ctx.service.criar({ titulo: 'Ligar', origem: { tipo: 'manual' }, vinculos: { contatoIds: ['c3'] } }))
    expect((await tarefa(ctx.store, doContato))?.vinculos.oportunidadeId).toBe('op2')

    const ambiguo = okId(await ctx.service.criar({ titulo: 'Ligar', origem: { tipo: 'manual' }, vinculos: { contatoIds: ['c4'] } }))
    expect((await tarefa(ctx.store, ambiguo))?.vinculos).toMatchObject({ oportunidadeId: null, contatoIds: ['c4'] })
  })
})

describe('gancho do funil (CA3, R10, D-15)', () => {
  it('criar, concluir e mudar o prazo chamam; título, reabrir e cancelar não; a falha não muda o resultado', async () => {
    const eventos: EventoOportunidade[] = []
    const ctx = setup({ fakes: { funil: funilState({ oportunidades: [oportunidade('op1')] }) }, onOportunidade: (evento) => (eventos.push(evento), Promise.resolve()) })
    const id = okId(await ctx.service.criar({ titulo: 'Proposta', origem: { tipo: 'funil', oportunidadeId: 'op1' }, vinculos: { oportunidadeId: 'op1' } }))
    expect(eventos).toEqual([{ oportunidadeId: 'op1', tarefaId: id, acao: 'criada', titulo: 'Proposta' }])

    await ctx.service.salvar({ id, titulo: 'Proposta revisada' })
    expect(eventos).toHaveLength(1)
    await ctx.service.salvar({ id, prazo: '2026-11-30' })
    expect(eventos.map((evento) => evento.acao)).toEqual(['criada', 'prazo'])
    await ctx.service.status({ id, status: 'feita' })
    expect(eventos.map((evento) => evento.acao)).toEqual(['criada', 'prazo', 'feita'])
    await ctx.service.status({ id, status: 'aberta' })
    await ctx.service.status({ id, status: 'cancelada' })
    await ctx.service.status({ id, status: 'aberta' })
    expect(eventos).toHaveLength(3)

    // Sem oportunidade, nenhuma chamada.
    const solta = okId(await ctx.service.criar({ titulo: 'Solta', origem: { tipo: 'manual' } }))
    await ctx.service.status({ id: solta, status: 'feita' })
    expect(eventos).toHaveLength(3)

    const rejeita = setup({ fakes: { funil: funilState({ oportunidades: [oportunidade('op1')] }) }, onOportunidade: () => Promise.reject(new Error('funil travado')) })
    const criada = await rejeita.service.criar({ titulo: 'Proposta', origem: { tipo: 'manual' }, vinculos: { oportunidadeId: 'op1' } })
    expect(criada).toMatchObject({ ok: true })
    expect(await rejeita.service.status({ id: okId(criada), status: 'feita' })).toEqual({ ok: true, id: okId(criada) })
    expect(rejeita.logs.some((linha) => linha.includes('Proposta'))).toBe(false)
  })
})

describe('lembretes no tick (CA4, R12)', () => {
  it('marca antes de avisar, uma vez por tarefa; feita não avisa; a marcação falhando não avisa nem lança', async () => {
    const at = NOW
    const ctx = setup()
    const aberta = await ctx.store.criar(tarefaNova({ titulo: 'Ligar para a Ana', lembreteEm: at - 60_000 }))
    const feita = await ctx.store.criar(tarefaNova({ titulo: 'Já feita', lembreteEm: at - 60_000 }))
    if (!aberta.ok || !feita.ok) throw new Error('criação')
    await ctx.store.status(feita.value.id, 'feita')

    await ctx.service.dispararLembretes(at)
    expect(ctx.avisos).toEqual([{ title: 'Tarefa', body: 'Ligar para a Ana', tarefaId: aberta.value.id }])
    expect((await tarefa(ctx.store, aberta.value.id))?.lembreteDisparadoEm).toBe(at)
    expect((await tarefa(ctx.store, feita.value.id))?.lembreteDisparadoEm).toBeNull()
    expect(ctx.views).toHaveLength(1)

    await ctx.service.dispararLembretes(at + 30_000)
    expect(ctx.avisos).toHaveLength(1)

    for (const falha of ['recusa', 'exceção'] as const) {
      const quebrado = setup({
        store: (store) => ({
          ...store,
          marcarLembreteDisparado: () => (falha === 'recusa' ? Promise.resolve({ ok: false, erro: 'invalido' } as const) : Promise.reject(new Error('disco cheio'))),
        }),
      })
      await quebrado.store.criar(tarefaNova({ titulo: 'Segredo', lembreteEm: at - 60_000 }))
      await expect(quebrado.service.dispararLembretes(at)).resolves.toBeUndefined()
      expect(quebrado.avisos).toHaveLength(0)
      expect(quebrado.logs.some((linha) => linha.includes('Segredo'))).toBe(false)
    }

    const aviso: AvisoTarefa = { title: 'Tarefa', body: 'Ligar para a Ana', tarefaId: 't1' }
    expect(avisoMostrado(aviso, true, 'LAP')).toEqual({ title: 'LAP', body: 'Você tem uma tarefa com lembrete', tarefaId: 't1' })
    expect(avisoMostrado(aviso, false, 'LAP')).toEqual(aviso)
  })
})

describe('Adicionar do resumo (CA5, R22, R23)', () => {
  const LINHAS: SummaryTask[] = [
    { task: 'Enviar a proposta revisada', owner: 'Você', due: 'sexta', dueIso: '2026-11-28' },
    { task: 'Revisar o contrato', owner: 'Você', due: null },
    { task: 'Mandar a planilha de custos', owner: 'Ana', due: null },
  ]

  function resumoCtx() {
    return setup({
      fakes: {
        meetings: [meeting('m1', 'Reunião com a Acme', NOW - DIA_MS, [{ name: 'Ana', email: 'ana@acme.example' }]), meeting('m2', 'Sem resumo', NOW - DIA_MS)],
        summaries: new Map([['m1', summary('m1', LINHAS)]]),
        funil: funilState({ contatos: [contato('c-ana', 'Ana Souza', ['ana@acme.example'])], oportunidades: [oportunidade('op-acme', { contatoIds: ['c-ana'], empresaId: 'emp-acme', meetingIds: ['m1'] })] }),
      },
    })
  }

  it("'minhas' cria as do Você uma vez, com prazo, responsável, origem e vínculos; índice e responsável do contato", async () => {
    const ctx = resumoCtx()
    const minhas = await ctx.service.adicionarDoResumo({ meetingId: 'm1', indices: 'minhas' })
    if (!minhas.ok) throw new Error('esperava ok')
    expect(minhas.criadas.map((item) => item.indice)).toEqual([0, 1])
    const [primeira, segunda] = await Promise.all(minhas.criadas.map((item) => tarefa(ctx.store, item.id)))
    expect(primeira).toMatchObject({
      titulo: 'Enviar a proposta revisada',
      prazo: '2026-11-28',
      lembreteEm: Date.parse('2026-11-28T09:00:00-03:00'),
      responsavel: { tipo: 'eu' },
      origem: { tipo: 'reuniao', meetingId: 'm1', texto: 'Enviar a proposta revisada' },
      vinculos: { meetingId: 'm1', oportunidadeId: 'op-acme', contatoIds: ['c-ana'], empresaId: 'emp-acme' },
    })
    expect(segunda).toMatchObject({ prazo: null, lembreteEm: null, responsavel: { tipo: 'eu' } })
    expect(ctx.views).toHaveLength(1)

    expect(await ctx.service.adicionarDoResumo({ meetingId: 'm1', indices: 'minhas' })).toEqual({ ok: true, criadas: [] })

    const ana = await ctx.service.adicionarDoResumo({ meetingId: 'm1', indices: [2] })
    if (!ana.ok) throw new Error('esperava ok')
    expect(ana.criadas.map((item) => item.indice)).toEqual([2])
    expect((await tarefa(ctx.store, ana.criadas[0]?.id ?? ''))?.responsavel).toEqual({ tipo: 'contato', contatoId: 'c-ana' })

    // "Gerar de novo": a linha 0 com o mesmo texto continua casada; a nova cria.
    ctx.fakes.summaries.set('m1', summary('m1', [{ task: 'Enviar a proposta revisada', owner: 'Você', due: null }, { task: 'Agendar a visita', owner: 'Você', due: null }]))
    expect(await ctx.service.adicionarDoResumo({ meetingId: 'm1', indices: [0] })).toEqual({ ok: true, criadas: [] })
    const regerado = await ctx.service.adicionarDoResumo({ meetingId: 'm1', indices: 'minhas' })
    expect(regerado).toMatchObject({ ok: true, criadas: [{ indice: 1 }] })

    expect(await ctx.service.adicionarDoResumo({ meetingId: 'm1', indices: [9] })).toMatchObject({ ok: false, erro: 'invalido' })
    expect(await ctx.service.adicionarDoResumo({ meetingId: 'm2', indices: 'minhas' })).toMatchObject({ ok: false, erro: 'nao-encontrado' })
  })

  it('a ligada à oportunidade chama o gancho para cada uma criada', async () => {
    const eventos: EventoOportunidade[] = []
    const ctx = setup({
      fakes: {
        meetings: [meeting('m1', 'Reunião', NOW - DIA_MS)],
        summaries: new Map([['m1', summary('m1', LINHAS)]]),
        funil: funilState({
          oportunidades: [oportunidade('op-velha', { meetingIds: ['m1'], atualizadoEm: 1 }), oportunidade('op-nova', { meetingIds: ['m1'], atualizadoEm: 2 }), oportunidade('op-arquivada', { meetingIds: ['m1'], atualizadoEm: 3, arquivado: true })],
        }),
      },
      onOportunidade: (evento) => (eventos.push(evento), Promise.resolve()),
    })
    await ctx.service.adicionarDoResumo({ meetingId: 'm1', indices: 'minhas' })
    expect(eventos.map((evento) => [evento.oportunidadeId, evento.acao])).toEqual([
      ['op-nova', 'criada'],
      ['op-nova', 'criada'],
    ])
  })
})

describe('sugestões (CA6, R26)', () => {
  it('reunião, análise e conversa; Ignorar some e fica no arquivo; WhatsApp fora do ar não derruba', async () => {
    const fakes: Partial<Fakes> = {
      meetings: [meeting('m1', 'Reunião com a Acme', NOW - 3 * DIA_MS), meeting('m-velha', 'Velha', NOW - 40 * DIA_MS)],
      summaries: new Map([
        ['m1', summary('m1', [{ task: 'Enviar a proposta', owner: 'Você', due: null }])],
        ['m-velha', summary('m-velha', [{ task: 'Coisa antiga', owner: 'Você', due: null }])],
      ]),
      analyses: new Map([['m1', [analise('m1', [{ text: 'Confirmar o orçamento' }, { text: 'Confirmar a data', owner: 'Ana' }])]]]),
      insights: { 'chat-1': insight('chat-1', ['Mandar o catálogo']) },
      chats: [chat('chat-1', 'Bruno', NOW - 2 * DIA_MS)],
    }
    const ctx = setup({ fakes })
    const lista = await ctx.service.sugestoes()
    expect(lista.map((item) => item.texto).sort()).toEqual(['Confirmar o orçamento', 'Enviar a proposta', 'Mandar o catálogo'])

    const chave = lista.find((item) => item.texto === 'Mandar o catálogo')?.chave ?? ''
    expect(await ctx.service.ignorar({ chave })).toEqual({ ok: true, id: null })
    expect(await ctx.service.sugestoes()).toHaveLength(2)

    const outro = setup({ dir: ctx.dir, fakes })
    expect(await outro.service.sugestoes()).toHaveLength(2)

    const semWhatsApp = setup({ fakes: { ...fakes, chatsFalham: true } })
    const reunioes = await semWhatsApp.service.sugestoes()
    expect(reunioes.map((item) => item.texto).sort()).toEqual(['Confirmar o orçamento', 'Enviar a proposta'])
  })
})

describe('sugestão da análise adicionada (contrato 131, CA1)', () => {
  it('Adicionar cria a tarefa com a origem análise e a sugestão não volta, nem com outro título, nem feita, nem relida', async () => {
    const fakes: Partial<Fakes> = {
      meetings: [meeting('m1', 'Reunião com a Acme', NOW - 3 * DIA_MS)],
      analyses: new Map([['m1', [analise('m1', [{ text: 'Confirmar o orçamento' }, { text: 'Confirmar a data', owner: 'Você' }])]]]),
    }
    const ctx = setup({ fakes })
    const sugestao = (await ctx.service.sugestoes()).find((item) => item.texto === 'Confirmar o orçamento')
    if (sugestao?.origem.tipo !== 'analise') throw new Error('sem a sugestão da análise')
    // O que o "Adicionar" da aba manda (`tarefaDaSugestao`, testada em test/renderer/tarefas-format.test.ts).
    const criada = await ctx.service.criar({ titulo: sugestao.texto, prazo: sugestao.prazo, origem: { tipo: 'analise', meetingId: sugestao.origem.meetingId, texto: sugestao.texto }, vinculos: { meetingId: sugestao.origem.meetingId } })
    if (!criada.ok || criada.id === null) throw new Error('não criou')
    const tarefa = (await ctx.service.todas()).find((item) => item.id === criada.id)
    expect(tarefa?.origem).toEqual({ tipo: 'analise', meetingId: 'm1', texto: 'Confirmar o orçamento' })
    expect(tarefa?.vinculos.meetingId).toBe('m1')
    expect((await ctx.service.view()).nomes.reunioes).toEqual({ m1: 'Reunião com a Acme' })
    expect((await ctx.service.sugestoes()).map((item) => item.texto)).toEqual(['Confirmar a data'])

    // O título mudado não traz a sugestão de volta (a origem guarda o texto); feita também não.
    expect((await ctx.service.salvar({ id: criada.id, titulo: 'Fechar o orçamento com a Acme' })).ok).toBe(true)
    expect((await ctx.service.sugestoes()).map((item) => item.texto)).toEqual(['Confirmar a data'])
    expect((await ctx.service.status({ id: criada.id, status: 'feita' })).ok).toBe(true)
    expect((await ctx.service.sugestoes()).map((item) => item.texto)).toEqual(['Confirmar a data'])
    // Relido do disco por outro serviço (o "recarregar"), continua fora.
    const outro = setup({ dir: ctx.dir, fakes })
    expect((await outro.service.sugestoes()).map((item) => item.texto)).toEqual(['Confirmar a data'])
  })
})

describe('custo das leituras (CA7, D3)', () => {
  it('view lê cada cache no máximo uma vez; criar não lê análises nem insights; nenhum timer', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const ctx = setup({
      fakes: {
        meetings: [meeting('m1', 'Reunião com a Acme', NOW - DIA_MS)],
        chats: [chat('chat-1', 'Bruno', NOW)],
        funil: funilState({ contatos: [contato('c1', 'Ana')], oportunidades: [oportunidade('op1', { contatoIds: ['c1'] })] }),
      },
    })
    await ctx.store.criar(tarefaNova({ origem: { tipo: 'reuniao', meetingId: 'm1', texto: 'x' }, vinculos: { oportunidadeId: 'op1', contatoIds: ['c1'], empresaId: null, meetingId: 'm1', email: null, whatsappChatId: 'chat-1' } }))
    await ctx.store.criar(tarefaNova({ origem: { tipo: 'whatsapp', chatId: 'chat-1' }, vinculos: { oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: 'm1', email: null, whatsappChatId: 'chat-1' } }))

    const view = await ctx.service.view()
    expect(ctx.calls.meetingsList).toBe(1)
    expect(ctx.calls.chats).toBe(1)
    expect(ctx.calls.funil).toBe(1)
    expect(view.nomes).toEqual({ oportunidades: { op1: 'Oportunidade op1' }, contatos: { c1: 'Ana' }, reunioes: { m1: 'Reunião com a Acme' }, whatsapp: { 'chat-1': 'Bruno' } })

    await ctx.service.criar({ titulo: 'Nova', origem: { tipo: 'manual' }, vinculos: { contatoIds: ['c1'] } })
    expect(ctx.calls.analyses).toBe(0)
    expect(ctx.calls.insights).toBe(0)
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(setIntervalSpy).not.toHaveBeenCalled()
  })

  it('domínio com falha vale sem nome', async () => {
    const ctx = setup({ fakes: { chatsFalham: true } })
    await ctx.store.criar(tarefaNova({ origem: { tipo: 'whatsapp', chatId: 'chat-1' } }))
    expect((await ctx.service.view()).nomes.whatsapp).toEqual({})
  })
})

describe('destino pendente do "Abrir" (CA10, R12, A6)', () => {
  it('desbloqueado envia na hora; bloqueado guarda só o último e envia uma vez ao desbloquear', () => {
    const destino = createDestinoPendente()
    const enviados: (string | null)[] = []
    const enviar = (id: string | null): void => void enviados.push(id)

    destino.abrir('t1', false, enviar)
    expect(enviados).toEqual(['t1'])

    enviados.length = 0
    destino.abrir('t1', true, enviar)
    destino.abrir('t2', true, enviar)
    expect(enviados).toEqual([])
    destino.desbloqueou(enviar)
    expect(enviados).toEqual(['t2'])
    destino.desbloqueou(enviar)
    expect(enviados).toEqual(['t2'])

    enviados.length = 0
    destino.abrir(null, true, enviar)
    destino.desbloqueou(enviar)
    expect(enviados).toEqual([null])
  })
})

describe('virada do dia (CA11, R12)', () => {
  it('no mesmo dia nada; o primeiro tick do dia seguinte reemite a view com o hoje novo', async () => {
    const ctx = setup()
    const manha = Date.parse('2026-11-22T10:00:00-03:00')
    await ctx.service.dispararLembretes(manha)
    await ctx.service.dispararLembretes(manha + 30_000)
    expect(ctx.views).toHaveLength(0)
    await ctx.service.dispararLembretes(Date.parse('2026-11-23T00:01:00-03:00'))
    expect(ctx.views).toHaveLength(1)
    expect(ctx.views[0]?.hoje).toBe('2026-11-23')
    await ctx.service.dispararLembretes(Date.parse('2026-11-23T00:01:30-03:00'))
    expect(ctx.views).toHaveLength(1)
  })
})
