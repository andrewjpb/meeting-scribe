// Contrato 113 (funil-vendas, R38 a R40, R47): o que acontece com a proposta de IA de uma reunião. O store do funil, o
// serviço do 110 e o store das propostas são os de verdade, numa pasta temporária; a reunião e a extração são falsas
// (nenhum `claude`). Aplicar (CA1 a CA4, CA9), o disparo depois do resumo (CA5), os canais (CA6, CA10) e a reunião
// apagada (CA11).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FunilState, FunilView } from '../src/shared/funil'
import { FUNIL_ERRO_TEXTO } from '../src/shared/funil'
import { FUNIL_PROPOSTA_DECIDIDA_TEXTO, type FunilPropostaArquivo, type FunilPropostaCampos, type PropostaOportunidade } from '../src/shared/funil-proposta'
import { INVOKE_CHANNELS, MAIN_EVENT_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import type { Meeting } from '../src/shared/meetings'
import { DEFAULT_SETTINGS } from '../src/shared/settings-defaults'
import type { Tarefa, TarefaInput, TarefaSalvar, TarefasActionResult } from '../src/shared/tarefas'

// O registro do main com um `ipcMain` falso, como em `funil-service.test.ts`.
const invokeHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => invokeHandlers.set(channel, handler),
    on: () => undefined,
  },
}))

const { createFunilStore } = await import('../src/main/funil/store')
const { createFunilService } = await import('../src/main/funil/service')
const { createFunilProposalStore } = await import('../src/main/funil/proposals')
const { applyProposal, autoDetect, dismissProposal } = await import('../src/main/funil/apply-proposal')
const { registerFunilIpc } = await import('../src/main/funil/ipc')

const ORIGIN = 'scribe://app'
const trusted = { senderFrame: { url: `${ORIGIN}/index.html` } }
const MEETING = 'reuniao-1'
const CANAIS_PROPOSTA = ['scribe:funil-proposta-get', 'scribe:funil-proposta-aplicar', 'scribe:funil-proposta-descartar', 'scribe:funil-proposta-detectar']

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  invokeHandlers.clear()
})

/** Contrato 124: o serviço das tarefas falso, com memória (o funil deduplica o passo pelas tarefas abertas). */
function tarefasFalsas() {
  const lista: Tarefa[] = []
  const criar = vi.fn(async (input: TarefaInput): Promise<TarefasActionResult> => {
    const id = `tarefa-${lista.length + 1}`
    lista.push({
      id,
      titulo: input.titulo,
      detalhe: '',
      status: 'aberta',
      importante: false,
      prazo: input.prazo ?? null,
      lembreteEm: null,
      lembreteDisparadoEm: null,
      responsavel: { tipo: 'eu' },
      origem: input.origem,
      vinculos: { oportunidadeId: input.vinculos?.oportunidadeId ?? null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null },
      historico: [],
      criadaEm: 0,
      atualizadaEm: 0,
      feitaEm: null,
    })
    return { ok: true, id }
  })
  const salvar = vi.fn(async (request: TarefaSalvar): Promise<TarefasActionResult> => {
    const tarefa = lista.find((item) => item.id === request.id)
    if (tarefa && request.prazo !== undefined) tarefa.prazo = request.prazo
    return { ok: true, id: request.id }
  })
  return { lista, criar, salvar, todas: async (): Promise<Tarefa[]> => lista.map((tarefa) => ({ ...tarefa })) }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'funil-proposta-'))
  dirs.push(dir)
  const store = createFunilStore({ dir })
  const views: FunilView[] = []
  // Contrato 124: o próximo passo aplicado vira tarefa pelo serviço das tarefas (falso aqui).
  const tarefas = tarefasFalsas()
  const funil = createFunilService({
    store,
    meetings: { list: async () => [] },
    summaries: { get: async () => null },
    email: { cached: async () => [] },
    whatsapp: { chats: async () => [], me: () => null },
    chooseImportFile: async () => null,
    onChange: (view) => void views.push(view),
    tarefas: { todas: tarefas.todas, criar: tarefas.criar, salvar: tarefas.salvar },
  })
  const proposals = createFunilProposalStore({ meetingsDir: join(dir, 'meetings') })
  const meetings = { get: async (id: string) => (id === MEETING ? ({ id } as unknown as Meeting) : null) }
  return { dir, store, funil, proposals, meetings, views, tarefas, deps: { store, funil, proposals, meetings }, file: join(dir, 'funil.json') }
}

function arquivo(proposta: Partial<PropostaOportunidade> = {}, status: FunilPropostaArquivo['status'] = 'proposed'): FunilPropostaArquivo {
  return {
    version: 1,
    meetingId: MEETING,
    createdAt: '2026-11-20T15:00:00.000Z',
    model: 'claude-haiku',
    status,
    proposta: {
      acao: 'criar',
      titulo: 'Cliente · Portal',
      empresa: 'Cliente',
      contatos: [],
      etapaSugerida: 'Descoberta',
      valor: 3_800_000,
      previsao: '2026-12-15',
      proximoPasso: { texto: 'Enviar proposta', data: '2026-11-25' },
      justificativa: 'Pediram orçamento do portal.',
      ...proposta,
    },
  }
}

const etapa = (state: FunilState, nome: string): string => {
  const achada = state.etapas.find((item) => item.nome === nome)
  if (!achada) throw new Error(`etapa ${nome}`)
  return achada.id
}

function campos(state: FunilState, extra: Partial<FunilPropostaCampos> = {}): FunilPropostaCampos {
  return {
    titulo: 'Cliente · Portal',
    empresa: 'Cliente',
    contatos: [],
    etapaId: etapa(state, 'Descoberta'),
    valor: 3_800_000,
    previsao: '2026-12-15',
    proximoPasso: { texto: 'Enviar proposta', data: '2026-11-25' },
    ...extra,
  }
}

/** Uma oportunidade criada direto no store, na etapa dada. */
async function oportunidade(ctx: ReturnType<typeof setup>, input: { titulo: string; empresaNome?: string; etapa: string; valor?: number | null; meetingIds?: string[] }): Promise<string> {
  const state = await ctx.store.read()
  const result = await ctx.store.saveOportunidade({ titulo: input.titulo, empresaNome: input.empresaNome ?? null, etapaId: etapa(state, input.etapa), valor: input.valor ?? null, meetingIds: input.meetingIds ?? [] })
  if (!result.ok) throw new Error(result.erro)
  return result.value.id
}

describe('applyProposal', () => {
  it('CA1: criar mescla o contato existente, liga a reunião, acha ou cria a empresa e grava accepted', async () => {
    const ctx = setup()
    const existente = await ctx.store.saveContato({ nome: 'Marina R.', emails: ['marina.rocha@cliente.example'], telefones: [] }, 'manual')
    if (!existente.ok) throw new Error(existente.erro)
    const contatos = [
      { nome: 'Marina Rocha', email: 'marina.rocha@cliente.example' },
      { nome: 'Sem Email', email: null },
    ]
    await ctx.proposals.save(arquivo({ contatos }))
    const state = await ctx.store.read()

    const result = await applyProposal(ctx.deps, { meetingId: MEETING, campos: campos(state, { contatos }) })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const depois = await ctx.store.read()
    expect(depois.contatos).toHaveLength(1)
    expect(depois.contatos[0]?.id).toBe(existente.value.contato.id)
    const op = depois.oportunidades.find((item) => item.id === result.oportunidadeId)
    expect(op).toMatchObject({ origem: 'reuniao', meetingIds: [MEETING], contatoIds: [existente.value.contato.id] })
    const empresa = depois.empresas.find((item) => item.nome === 'Cliente')
    expect(empresa).toBeDefined()
    expect(op?.empresaId).toBe(empresa?.id)
    expect(await ctx.proposals.get(MEETING)).toMatchObject({ status: 'accepted', oportunidadeId: result.oportunidadeId })
    // As gravações passaram pelo serviço: o `scribe:funil-changed` saiu.
    expect(ctx.views.length).toBeGreaterThan(0)
  })

  it('CA2: atualizar move de etapa com o evento, troca o próximo passo, liga a reunião e mantém o valor com null', async () => {
    const ctx = setup()
    const id = await oportunidade(ctx, { titulo: 'Cliente · Portal', empresaNome: 'Cliente', etapa: 'Descoberta', valor: 1_000_000 })
    await ctx.proposals.save(arquivo({ acao: 'atualizar', oportunidadeId: id }))
    const state = await ctx.store.read()
    const passo = { texto: 'Reunião com o jurídico', data: '2026-12-02' }

    const result = await applyProposal(ctx.deps, { meetingId: MEETING, campos: campos(state, { etapaId: etapa(state, 'Proposta'), valor: null, proximoPasso: passo }) })

    expect(result).toEqual({ ok: true, oportunidadeId: id })
    const depois = await ctx.store.read()
    const op = depois.oportunidades.find((item) => item.id === id)
    expect(op?.etapaId).toBe(etapa(depois, 'Proposta'))
    // Contrato 124: o passo não é gravado na oportunidade; vira tarefa ligada a ela.
    expect(op).not.toHaveProperty('proximoPasso')
    expect(ctx.tarefas.criar).toHaveBeenCalledTimes(1)
    expect(ctx.tarefas.criar.mock.calls[0]?.[0]).toMatchObject({ titulo: 'Reunião com o jurídico', prazo: '2026-12-02', origem: { tipo: 'funil', oportunidadeId: id } })
    expect(op?.meetingIds).toContain(MEETING)
    expect(op?.valor).toBe(1_000_000)
    expect(depois.eventos.filter((evento) => evento.oportunidadeId === id && evento.tipo === 'etapa')).toEqual([expect.objectContaining({ de: 'Descoberta', para: 'Proposta' })])
    expect(await ctx.proposals.get(MEETING)).toMatchObject({ status: 'accepted', oportunidadeId: id })
  })

  it('contrato 124: "atualizar" aplicada de novo com o mesmo passo não duplica a tarefa; com outra data, muda o prazo dela', async () => {
    const ctx = setup()
    const id = await oportunidade(ctx, { titulo: 'Cliente · Portal', empresaNome: 'Cliente', etapa: 'Descoberta' })
    const aplicar = async (passo: { texto: string; data: string | null }) => {
      await ctx.proposals.save(arquivo({ acao: 'atualizar', oportunidadeId: id }))
      const state = await ctx.store.read()
      return applyProposal(ctx.deps, { meetingId: MEETING, campos: campos(state, { proximoPasso: passo }) })
    }
    expect(await aplicar({ texto: 'Reunião com o jurídico', data: '2026-12-02' })).toEqual({ ok: true, oportunidadeId: id })
    expect(await aplicar({ texto: 'reunião com o JURÍDICO', data: '2026-12-02' })).toEqual({ ok: true, oportunidadeId: id })
    expect(ctx.tarefas.criar).toHaveBeenCalledTimes(1)
    expect(ctx.tarefas.salvar).not.toHaveBeenCalled()
    expect(await aplicar({ texto: 'Reunião com o jurídico', data: '2026-12-09' })).toEqual({ ok: true, oportunidadeId: id })
    expect(ctx.tarefas.criar).toHaveBeenCalledTimes(1)
    expect(ctx.tarefas.lista.map((tarefa) => [tarefa.titulo, tarefa.prazo, tarefa.vinculos.oportunidadeId])).toEqual([['Reunião com o jurídico', '2026-12-09', id]])
  })

  it('CA3: vincular a uma ganha recusa e deixa proposed; a uma aberta só muda reuniões e contatos', async () => {
    const ctx = setup()
    const ganha = await oportunidade(ctx, { titulo: 'Antiga', etapa: 'Ganho' })
    const aberta = await oportunidade(ctx, { titulo: 'Cliente · Suporte', empresaNome: 'Cliente', etapa: 'Negociação', valor: 500_000, meetingIds: ['outra-reuniao'] })
    const contatos = [{ nome: 'Marina Rocha', email: 'marina.rocha@cliente.example' }]
    await ctx.proposals.save(arquivo({ contatos }))
    const state = await ctx.store.read()
    const pedido = { meetingId: MEETING, campos: campos(state, { contatos, etapaId: etapa(state, 'Proposta'), valor: 9_900_000, titulo: 'Outro título' }) }

    expect(await applyProposal(ctx.deps, { ...pedido, vincularA: ganha })).toMatchObject({ ok: false, erro: 'nao-encontrado' })
    expect((await ctx.proposals.get(MEETING))?.status).toBe('proposed')

    const antes = (await ctx.store.read()).oportunidades.find((item) => item.id === aberta)
    const result = await applyProposal(ctx.deps, { ...pedido, vincularA: aberta })
    expect(result).toEqual({ ok: true, oportunidadeId: aberta })
    const depois = await ctx.store.read()
    const op = depois.oportunidades.find((item) => item.id === aberta)
    const marina = depois.contatos.find((item) => item.emails.includes('marina.rocha@cliente.example'))
    expect(op?.meetingIds).toEqual(['outra-reuniao', MEETING])
    expect(op?.contatoIds).toEqual([marina?.id])
    const semVinculos = ({ meetingIds: _m, contatoIds: _c, atualizadoEm: _a, ...resto }: NonNullable<typeof op>) => resto
    if (!antes || !op) throw new Error('oportunidade sumiu')
    expect(semVinculos(op)).toEqual(semVinculos(antes))
    expect(depois.oportunidades).toHaveLength(2)
    expect(await ctx.proposals.get(MEETING)).toMatchObject({ status: 'accepted', oportunidadeId: aberta })
  })

  it('CA4: proposta já decidida recusa sem mexer no funil; Ignorar grava dismissed', async () => {
    const ctx = setup()
    await oportunidade(ctx, { titulo: 'Qualquer', etapa: 'Contato' })
    await ctx.proposals.save({ ...arquivo({}, 'accepted'), oportunidadeId: 'op-antiga' })
    const antes = readFileSync(ctx.file, 'utf8')
    const state = await ctx.store.read()

    expect(await applyProposal(ctx.deps, { meetingId: MEETING, campos: campos(state, { contatos: [{ nome: 'Ana', email: 'ana@cliente.example' }] }) })).toEqual({
      ok: false,
      erro: 'invalido',
      mensagem: FUNIL_PROPOSTA_DECIDIDA_TEXTO,
    })
    expect(readFileSync(ctx.file, 'utf8')).toBe(antes)
    expect(await dismissProposal(ctx.deps, MEETING)).toEqual({ ok: false, erro: 'invalido' })

    await ctx.proposals.save(arquivo())
    expect(await dismissProposal(ctx.deps, MEETING)).toEqual({ ok: true })
    const descartado = await ctx.proposals.get(MEETING)
    expect(descartado?.status).toBe('dismissed')
    expect(descartado?.erro).toBeUndefined()
    expect(readFileSync(ctx.file, 'utf8')).toBe(antes)
  })

  it('CA9: só os contatos com e-mail entram (o preenchido no cartão conta); os outros viram a nota "Citados na reunião"', async () => {
    const ctx = setup()
    const marina = { nome: 'Marina Rocha', email: 'marina.rocha@cliente.example' }
    const carlos = { nome: 'Carlos Dias', email: null }
    await ctx.proposals.save(arquivo({ contatos: [marina, carlos, { nome: 'Bia Souza', email: null }] }))
    const state = await ctx.store.read()
    const doCartao = [marina, carlos, { nome: 'Bia Souza', email: 'bia@cliente.example' }]

    const result = await applyProposal(ctx.deps, { meetingId: MEETING, campos: campos(state, { contatos: doCartao }) })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const depois = await ctx.store.read()
    expect(depois.contatos.map((item) => [item.nome, item.emails, item.origem]).sort()).toEqual([
      ['Bia Souza', ['bia@cliente.example'], 'reuniao'],
      ['Marina Rocha', ['marina.rocha@cliente.example'], 'reuniao'],
    ])
    expect(depois.contatos.some((item) => item.nome === 'Carlos Dias')).toBe(false)
    const op = depois.oportunidades.find((item) => item.id === result.oportunidadeId)
    expect(op?.contatoIds).toHaveLength(2)
    const notas = depois.eventos.filter((evento) => evento.oportunidadeId === result.oportunidadeId && evento.tipo === 'nota')
    expect(notas.map((evento) => evento.texto)).toEqual(['Citados na reunião: Carlos Dias'])
  })

  it('atualizar uma oportunidade que foi ganha depois da detecção recusa sem reabrir', async () => {
    const ctx = setup()
    const id = await oportunidade(ctx, { titulo: 'Cliente · Portal', empresaNome: 'Cliente', etapa: 'Descoberta' })
    await ctx.proposals.save(arquivo({ acao: 'atualizar', oportunidadeId: id, contatos: [{ nome: 'Ana', email: 'ana@cliente.example' }] }))
    const antes = await ctx.store.read()
    const ganho = await ctx.store.moverOportunidade({ id, etapaId: etapa(antes, 'Ganho'), ordem: 0 })
    if (!ganho.ok) throw new Error(ganho.erro)
    const bytes = readFileSync(ctx.file, 'utf8')

    const result = await applyProposal(ctx.deps, { meetingId: MEETING, campos: campos(antes, { etapaId: etapa(antes, 'Proposta'), contatos: [{ nome: 'Ana', email: 'ana@cliente.example' }] }) })

    expect(result).toEqual({ ok: false, erro: 'nao-encontrado', mensagem: FUNIL_ERRO_TEXTO['nao-encontrado'] })
    expect(readFileSync(ctx.file, 'utf8')).toBe(bytes)
    expect((await ctx.proposals.get(MEETING))?.status).toBe('proposed')
  })

  it('sem arquivo: nao-encontrado; erro do funil deixa o arquivo proposed', async () => {
    const ctx = setup()
    const state = await ctx.store.read()
    expect(await applyProposal(ctx.deps, { meetingId: MEETING, campos: campos(state) })).toEqual({ ok: false, erro: 'nao-encontrado', mensagem: FUNIL_ERRO_TEXTO['nao-encontrado'] })
    await ctx.proposals.save(arquivo())
    expect(await applyProposal(ctx.deps, { meetingId: MEETING, campos: campos(state, { etapaId: 'etapa-que-nao-existe' }) })).toMatchObject({ ok: false, erro: 'nao-encontrado' })
    expect((await ctx.proposals.get(MEETING))?.status).toBe('proposed')
    expect((await ctx.store.read()).oportunidades).toHaveLength(0)
  })
})

describe('autoDetect', () => {
  function fakes(options: { ligado?: boolean; running?: boolean; existente?: FunilPropostaArquivo | null } = {}) {
    const detect = vi.fn(async () => null)
    return {
      detect,
      deps: (smoke: boolean) => ({
        settings: async () => ({ funil: { ...DEFAULT_SETTINGS.funil, detectarNasReunioes: options.ligado ?? true } }),
        proposals: { get: async () => options.existente ?? null },
        extract: { detect, running: () => options.running ?? false },
        smoke,
      }),
    }
  }

  it('CA5: só dispara fora do smoke, ligado, sem arquivo e sem detecção em curso', async () => {
    const smoke = fakes()
    expect(await autoDetect(smoke.deps(true), MEETING)).toBe(false)
    expect(smoke.detect).not.toHaveBeenCalled()

    const desligado = fakes({ ligado: false })
    expect(await autoDetect(desligado.deps(false), MEETING)).toBe(false)
    expect(desligado.detect).not.toHaveBeenCalled()

    const ligado = fakes()
    expect(await autoDetect(ligado.deps(false), MEETING)).toBe(true)
    expect(ligado.detect).toHaveBeenCalledTimes(1)
    expect(ligado.detect).toHaveBeenCalledWith(MEETING)

    const descartado = fakes({ existente: { ...arquivo(), status: 'dismissed', proposta: null } })
    expect(await autoDetect(descartado.deps(false), MEETING)).toBe(false)
    expect(descartado.detect).not.toHaveBeenCalled()

    const rodando = fakes({ running: true })
    expect(await autoDetect(rodando.deps(false), MEETING)).toBe(false)
    expect(rodando.detect).not.toHaveBeenCalled()
  })
})

describe('canais da proposta', () => {
  function registrar(ctx: ReturnType<typeof setup>, funnel = { detect: vi.fn(async () => null as FunilPropostaArquivo | null), running: vi.fn(() => false) }) {
    const changes: string[] = []
    registerFunilIpc({ appOrigin: ORIGIN, funil: ctx.funil, proposta: { funnel, proposals: ctx.proposals, store: ctx.store, meetings: ctx.meetings, onChange: (meetingId) => void changes.push(meetingId) } })
    const call = async (channel: string, request?: unknown): Promise<unknown> => {
      const handler = invokeHandlers.get(channel)
      if (!handler) throw new Error(`${channel} não registrado`)
      return handler(trusted, request)
    }
    return { changes, call, funnel }
  }

  it('CA6: os quatro canais e o evento existem; os canais são recusados com o app bloqueado', () => {
    expect(INVOKE_CHANNELS.filter((channel) => channel.startsWith('scribe:funil-proposta-')).sort()).toEqual([...CANAIS_PROPOSTA].sort())
    for (const channel of CANAIS_PROPOSTA) expect(WHEN_LOCKED[channel as keyof typeof WHEN_LOCKED]).toBe('refused')
    expect(MAIN_EVENT_CHANNELS).toContain('scribe:funil-proposta-changed')
  })

  it('CA10: get aponta a oportunidade aberta da mesma empresa só com criar', async () => {
    const ctx = setup()
    const { call } = registrar(ctx)
    await ctx.proposals.save(arquivo({ empresa: 'cliente' }))
    expect(await call('scribe:funil-proposta-get', { meetingId: MEETING })).toMatchObject({ detectando: false, duplicata: null })

    await oportunidade(ctx, { titulo: 'Fechada', empresaNome: 'Clíente', etapa: 'Perdido' })
    expect(await call('scribe:funil-proposta-get', { meetingId: MEETING })).toMatchObject({ duplicata: null })

    const aberta = await oportunidade(ctx, { titulo: 'Cliente · Suporte', empresaNome: 'Cliente', etapa: 'Contato' })
    const view = await call('scribe:funil-proposta-get', { meetingId: MEETING })
    expect(view).toMatchObject({ arquivo: { status: 'proposed' }, detectando: false, duplicata: { id: aberta, titulo: 'Cliente · Suporte' } })

    await ctx.proposals.save(arquivo({ acao: 'atualizar', oportunidadeId: aberta }))
    expect(await call('scribe:funil-proposta-get', { meetingId: MEETING })).toMatchObject({ duplicata: null })
  })

  it('pedido fora do formato recebe a recusa tipada, sem lançar e sem gravar', async () => {
    const ctx = setup()
    const { call, changes, funnel } = registrar(ctx)
    await ctx.proposals.save(arquivo())
    expect(await call('scribe:funil-proposta-get', { meetingId: MEETING, extra: 1 })).toEqual({ ok: false, erro: 'invalido', mensagem: FUNIL_ERRO_TEXTO.invalido })
    expect(await call('scribe:funil-proposta-detectar', {})).toEqual({ ok: false, erro: 'invalido', mensagem: FUNIL_ERRO_TEXTO.invalido })
    expect(await call('scribe:funil-proposta-descartar', { meetingId: 7 })).toEqual({ ok: false })
    const state = await ctx.store.read()
    expect(await call('scribe:funil-proposta-aplicar', { meetingId: MEETING, campos: { ...campos(state), apelido: 'x' } })).toEqual({ ok: false, erro: 'invalido', mensagem: FUNIL_ERRO_TEXTO.invalido })
    expect(funnel.detect).not.toHaveBeenCalled()
    expect(changes).toEqual([])
    expect((await ctx.proposals.get(MEETING))?.status).toBe('proposed')
    expect(existsSync(ctx.file)).toBe(false)
  })

  it('dois "aplicar" ao mesmo tempo da mesma reunião criam uma oportunidade só', async () => {
    const ctx = setup()
    const { call, changes } = registrar(ctx)
    await ctx.proposals.save(arquivo())
    const state = await ctx.store.read()
    const pedido = { meetingId: MEETING, campos: campos(state, { contatos: [{ nome: 'Carlos Dias', email: null }] }) }

    const [primeiro, segundo] = await Promise.all([call('scribe:funil-proposta-aplicar', pedido), call('scribe:funil-proposta-aplicar', pedido)])

    expect(primeiro).toMatchObject({ ok: true })
    expect(segundo).toEqual(primeiro)
    const depois = await ctx.store.read()
    expect(depois.oportunidades).toHaveLength(1)
    expect(depois.eventos.filter((evento) => evento.tipo === 'nota').map((evento) => evento.texto)).toEqual(['Citados na reunião: Carlos Dias'])
    expect(changes).toEqual([MEETING])
    // Terminado o primeiro, um novo pedido já encontra a proposta decidida.
    expect(await call('scribe:funil-proposta-aplicar', pedido)).toMatchObject({ ok: false, mensagem: FUNIL_PROPOSTA_DECIDIDA_TEXTO })
  })

  it('e-mail inválido no cartão recusa com o texto dele, antes de gravar', async () => {
    const ctx = setup()
    const { call, changes } = registrar(ctx)
    await ctx.proposals.save(arquivo())
    const state = await ctx.store.read()
    const contatos = [
      { nome: 'Marina Rocha', email: 'marina.rocha@cliente.example' },
      { nome: 'Bia Souza', email: ' bia@cliente ' },
    ]

    expect(await call('scribe:funil-proposta-aplicar', { meetingId: MEETING, campos: campos(state, { contatos }) })).toEqual({ ok: false, erro: 'invalido', mensagem: 'E-mail inválido: bia@cliente' })
    expect(existsSync(ctx.file)).toBe(false)
    expect(changes).toEqual([])
    expect((await ctx.proposals.get(MEETING))?.status).toBe('proposed')
    // Vazio vale como sem e-mail.
    expect(await call('scribe:funil-proposta-aplicar', { meetingId: MEETING, campos: campos(state, { contatos: [{ nome: 'Bia Souza', email: '' }] }) })).toMatchObject({ ok: true })
  })

  it('aplicar e descartar emitem o evento; detectar roda mesmo com arquivo e responde com detectando', async () => {
    const ctx = setup()
    const { call, changes, funnel } = registrar(ctx)
    await ctx.proposals.save(arquivo())
    const state = await ctx.store.read()
    expect(await call('scribe:funil-proposta-aplicar', { meetingId: MEETING, campos: campos(state) })).toMatchObject({ ok: true })
    expect(changes).toEqual([MEETING])

    await ctx.proposals.save(arquivo())
    expect(await call('scribe:funil-proposta-descartar', { meetingId: MEETING })).toEqual({ ok: true })
    expect(changes).toEqual([MEETING, MEETING])
    expect(await call('scribe:funil-proposta-descartar', { meetingId: MEETING })).toEqual({ ok: false })

    const view = await call('scribe:funil-proposta-detectar', { meetingId: MEETING })
    expect(view).toMatchObject({ arquivo: { status: 'dismissed' }, detectando: true })
    expect(funnel.detect).toHaveBeenCalledWith(MEETING)
    // Nada gravado pela detecção (sem resumo): o evento sai assim mesmo, para a tela sair do "Detectando…".
    await vi.waitFor(() => expect(changes).toEqual([MEETING, MEETING, MEETING]))
  })
})

describe('reunião apagada', () => {
  it('CA11: a proposta some com a reunião e o id fica em meetingIds', async () => {
    const ctx = setup()
    const id = await oportunidade(ctx, { titulo: 'Cliente · Portal', etapa: 'Proposta', meetingIds: [MEETING] })
    await ctx.proposals.save(arquivo())
    const caminho = join(ctx.dir, 'meetings', `${MEETING}.funil.json`)
    expect(existsSync(caminho)).toBe(true)

    // O que `scribe:meetings-delete` faz com `deleted === true` (main/index.ts).
    await ctx.proposals.remove(MEETING).catch(() => undefined)

    expect(existsSync(caminho)).toBe(false)
    expect((await ctx.store.read()).oportunidades.find((item) => item.id === id)?.meetingIds).toEqual([MEETING])
  })
})
