// Contrato 110 (funil-vendas, CA5 a CA9): o serviço do funil sobre o store real numa pasta temporária, com os
// outros domínios falsos e contados. Gravação e `onChange` (CA5), importação (CA6, R16), custo das leituras (CA7,
// D3), os 16 canais recusados com o app bloqueado (CA8, R47) e o pedido fora do formato (CA9). Contrato 124: o
// próximo passo derivado das tarefas (CA1) e o passo que vira tarefa (CA2), com o serviço das tarefas falso.
import type * as FsPromises from 'node:fs/promises'
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FUNIL_ERRO_TEXTO, FUNIL_FALHOU_TEXTO, FUNIL_LEITURA_FALHOU_TEXTO, type FunilActionResult, type FunilView } from '../src/shared/funil'
import { IMPORT_BYTES_MAX } from '../src/shared/funil-import'
import { INVOKE_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import type { EmailMessage } from '../src/shared/email'
import type { Tarefa, TarefaInput, TarefaSalvar, TarefasActionResult } from '../src/shared/tarefas'
import type { WhatsAppChat } from '../src/shared/whatsapp'

// `readFile` contado: o arquivo grande demais não pode ser lido (CA6).
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof FsPromises>()
  return { ...real, readFile: vi.fn(real.readFile) }
})
// O registro do main com um `ipcMain` falso, como em `lock-ipc.test.ts` (CA9).
const invokeHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => invokeHandlers.set(channel, handler),
    on: () => undefined,
  },
}))

const fsPromises = await import('node:fs/promises')
const { createFunilStore } = await import('../src/main/funil/store')
const { createFunilService } = await import('../src/main/funil/service')
const { registerFunilIpc } = await import('../src/main/funil/ipc')

const DIA_MS = 86_400_000
const NOW = Date.parse('2026-11-20T15:00:00.000Z')
const ORIGIN = 'scribe://app'
const trusted = { senderFrame: { url: `${ORIGIN}/index.html` } }

const CANAIS_FUNIL = [
  'scribe:funil-get',
  'scribe:funil-contato-save',
  'scribe:funil-contato-archive',
  'scribe:funil-empresa-save',
  'scribe:funil-empresa-delete',
  'scribe:funil-oportunidade-save',
  'scribe:funil-oportunidade-move',
  'scribe:funil-oportunidade-delete',
  'scribe:funil-oportunidade-archive',
  'scribe:funil-etapas-save',
  'scribe:funil-evento-add',
  'scribe:funil-sugestoes',
  'scribe:funil-ignorar',
  'scribe:funil-importar-abrir',
  'scribe:funil-importar-confirmar',
  'scribe:funil-timeline',
]

const CSV = [
  'Nome;E-mail;Telefone;Empresa;Cargo',
  'Carla Mendes;carla.mendes@acme.example;(11) 98765-4321;Acme;Diretora comercial',
  'Diego Rocha;diego.rocha@acme.example;;Acme;Comprador',
  'Elisa Prado;;(21) 99876-5432;Prado Consultoria;Sócia',
  'Fábio Lima;fabio.lima@lima.example;(31) 3222-1100;Lima Engenharia;Gerente',
  'Gabriela Sousa;;;Sousa Transportes;Analista',
].join('\n')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const emailMessage = (id: string, address: string, at: number): EmailMessage => ({
  id,
  accountId: 'conta1',
  mailbox: 'INBOX',
  uid: null,
  seen: true,
  flagged: false,
  answered: false,
  from: [{ name: null, address }],
  to: [{ name: null, address: 'eu@minha.example' }],
  cc: [],
  subject: `Assunto ${id}`,
  date: at,
  messageId: null,
  inReplyTo: null,
  references: [],
})

/** Uma tarefa aberta, sem prazo e sem vínculo, com o que vier por cima. */
const tarefa = (parcial: Partial<Tarefa> & { id: string }): Tarefa => ({
  titulo: `Tarefa ${parcial.id}`,
  detalhe: '',
  status: 'aberta',
  importante: false,
  prazo: null,
  lembreteEm: null,
  lembreteDisparadoEm: null,
  responsavel: { tipo: 'eu' },
  origem: { tipo: 'manual' },
  vinculos: { oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null },
  historico: [],
  criadaEm: NOW,
  atualizadaEm: NOW,
  feitaEm: null,
  ...parcial,
})

function setup(opcoes: { chats?: () => Promise<WhatsAppChat[]>; arquivo?: string | null; criarTarefa?: (input: TarefaInput) => Promise<TarefasActionResult> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'funil-service-'))
  dirs.push(dir)
  let seq = 0
  const store = createFunilStore({ dir, now: () => NOW, newId: () => `id-${++seq}` })
  const views: FunilView[] = []
  let arquivo: string | null = opcoes.arquivo ?? null
  const cached = vi.fn(async () => [{ status: { account: { address: 'eu@minha.example' } }, inbox: [emailMessage('1', 'cliente@x.example', NOW - DIA_MS)], sent: [] }])
  const chats = vi.fn(opcoes.chats ?? (async (): Promise<WhatsAppChat[]> => []))
  const list = vi.fn(async () => [])
  let tarefas: Tarefa[] = []
  const todas = vi.fn(async () => tarefas)
  const criarTarefa = vi.fn(opcoes.criarTarefa ?? (async (): Promise<TarefasActionResult> => ({ ok: true, id: 'tarefa-nova' })))
  const salvarTarefa = vi.fn(async (request: TarefaSalvar): Promise<TarefasActionResult> => ({ ok: true, id: request.id }))
  const service = createFunilService({
    store,
    meetings: { list },
    summaries: { get: async () => null },
    email: { cached },
    whatsapp: { chats, me: () => null },
    chooseImportFile: async () => arquivo,
    onChange: (view) => void views.push(view),
    tarefas: { todas, criar: criarTarefa, salvar: salvarTarefa },
    now: () => NOW,
    newId: () => `token-${++seq}`,
  })
  return {
    dir,
    file: join(dir, 'funil.json'),
    store,
    service,
    views,
    cached,
    chats,
    list,
    todas,
    criarTarefa,
    salvarTarefa,
    setArquivo: (path: string | null) => void (arquivo = path),
    setTarefas: (lista: Tarefa[]) => void (tarefas = lista),
  }
}

const okId = (result: FunilActionResult): string => {
  if (!result.ok || result.id === null) throw new Error(`esperava ok com id: ${JSON.stringify(result)}`)
  return result.id
}

describe('serviço do funil: gravações', () => {
  it('CA5: contatoSave cria e chama onChange uma vez com o contato', async () => {
    const { service, views } = setup()
    const result = await service.contatoSave({ contato: { nome: 'Ana', emails: ['ana@x.example'], telefones: [] }, origem: 'manual' })
    expect(result).toMatchObject({ ok: true, mesclado: false })
    expect(views).toHaveLength(1)
    expect(views[0]?.state.contatos.length).toBe(1)
  })

  it('CA5: erro do store não chama onChange', async () => {
    const { service, views } = setup()
    expect(await service.contatoArchive({ id: 'nao-existe' })).toEqual({ ok: false, erro: 'nao-encontrado', mensagem: FUNIL_ERRO_TEXTO['nao-encontrado'] })
    expect(views).toHaveLength(0)
  })

  it('CA5: arquivar oportunidade aberta devolve nao-fechada com o texto', async () => {
    const { service, views } = setup()
    const id = okId(await service.oportunidadeSave({ oportunidade: { titulo: 'Projeto' } }))
    views.length = 0
    expect(await service.oportunidadeArchive({ id })).toEqual({ ok: false, erro: 'nao-fechada', mensagem: 'Só oportunidade ganha ou perdida pode ser arquivada.' })
    expect(views).toHaveLength(0)
  })

  it('nota, ignorar e etapas passam pelo store e avisam', async () => {
    const { service, views } = setup()
    const id = okId(await service.oportunidadeSave({ oportunidade: { titulo: 'Projeto' } }))
    expect(await service.eventoAdd({ oportunidadeId: id, texto: 'Ligar amanhã' })).toMatchObject({ ok: true })
    expect(await service.ignorar({ chave: 'email:x@x.example' })).toEqual({ ok: true, id: null })
    const etapas = (await service.view()).state.etapas
    expect(await service.etapasSave({ etapas: etapas.map(({ id: etapaId, nome, tipo }) => ({ id: etapaId, nome, tipo })) })).toEqual({ ok: true, id: null })
    expect(views).toHaveLength(4)
    expect(views.at(-1)?.ultimas[id]).toBeTypeOf('number')
  })
})

describe('serviço do funil: importação', () => {
  it('CA6: abre, simula sem gravar, importa e recusa o token antigo', async () => {
    const ctx = setup()
    const csv = join(ctx.dir, 'contatos.csv')
    writeFileSync(csv, CSV)
    ctx.setArquivo(csv)
    await ctx.service.contatoSave({ contato: { nome: 'Diego R.', emails: ['diego.rocha@acme.example'], telefones: [] }, origem: 'manual' })

    const antiga = await ctx.service.importarAbrir()
    const aberta = await ctx.service.importarAbrir()
    if (!antiga.ok || !aberta.ok) throw new Error('esperava a leitura')
    expect(aberta).toMatchObject({ tipo: 'csv', arquivo: 'contatos.csv', separador: ';', total: 5, validas: 4, colunas: ['Nome', 'E-mail', 'Telefone', 'Empresa', 'Cargo'], mapeamento: ['nome', 'email', 'telefone', 'empresa', 'cargo'] })
    expect(aberta.previa).toHaveLength(5)

    const antes = readFileSync(ctx.file, 'utf8')
    const simulado = await ctx.service.importarConfirmar({ token: aberta.token, simular: true, mapeamento: ['nome', 'ignorar', 'telefone', 'empresa', 'cargo'] })
    expect(simulado).toEqual({ ok: true, simulado: true, validas: 3, ignorados: 2 })
    expect(readFileSync(ctx.file, 'utf8')).toBe(antes)

    expect(await ctx.service.importarConfirmar({ token: antiga.token })).toMatchObject({ ok: false, erro: 'expirado' })
    ctx.views.length = 0
    expect(await ctx.service.importarConfirmar({ token: aberta.token })).toEqual({ ok: true, simulado: false, criados: 3, atualizados: 1, ignorados: 1 })
    expect(ctx.views).toHaveLength(1)
    const contatos = (await ctx.store.read()).contatos
    expect(contatos).toHaveLength(4)
    expect(contatos.find((item) => item.emails.includes('diego.rocha@acme.example'))?.nome).toBe('Diego R.')
    expect(contatos.filter((item) => item.origem === 'importacao')).toHaveLength(3)
    // Importada, a leitura sai da memória: o mesmo token não importa de novo.
    expect(await ctx.service.importarConfirmar({ token: aberta.token })).toMatchObject({ ok: false, erro: 'expirado' })
  })

  it('CA6: diálogo cancelado dá cancelado', async () => {
    const { service } = setup({ arquivo: null })
    expect(await service.importarAbrir()).toEqual({ ok: false, erro: 'cancelado' })
  })

  it('CA6: 5 MB + 1 byte dá arquivo-grande sem ler o conteúdo', async () => {
    const ctx = setup()
    const grande = join(ctx.dir, 'grande.csv')
    writeFileSync(grande, '')
    truncateSync(grande, IMPORT_BYTES_MAX + 1)
    ctx.setArquivo(grande)
    const readFile = vi.mocked(fsPromises.readFile)
    readFile.mockClear()
    expect(await ctx.service.importarAbrir()).toEqual({ ok: false, erro: 'arquivo-grande' })
    expect(readFile.mock.calls.some(([path]) => path === grande)).toBe(false)
    // O espião conta mesmo: o arquivo pequeno passa por ele.
    const pequeno = join(ctx.dir, 'pequeno.csv')
    writeFileSync(pequeno, CSV)
    ctx.setArquivo(pequeno)
    expect(await ctx.service.importarAbrir()).toMatchObject({ ok: true })
    expect(readFile.mock.calls.some(([path]) => path === pequeno)).toBe(true)
  })

  it('vCard: colunas e mapeamento fixos', async () => {
    const ctx = setup()
    const vcf = join(ctx.dir, 'contatos.vcf')
    writeFileSync(vcf, ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Rui Alves', 'EMAIL:rui@x.example', 'ORG:Alves', 'END:VCARD', 'BEGIN:VCARD', 'VERSION:3.0', 'FN:Sem Contato', 'END:VCARD'].join('\r\n'))
    ctx.setArquivo(vcf)
    const aberta = await ctx.service.importarAbrir()
    expect(aberta).toMatchObject({ ok: true, tipo: 'vcard', separador: null, total: 2, validas: 1, colunas: ['Nome', 'E-mail', 'Telefone', 'Empresa', 'Cargo'], previa: [['Rui Alves', 'rui@x.example', '', 'Alves', '']] })
  })
})

describe('serviço do funil: leituras sob demanda (D3)', () => {
  it('CA7: view e contatoSave leem cada cache no máximo uma vez, sem timer', async () => {
    const ctx = setup()
    await ctx.service.oportunidadeSave({ oportunidade: { titulo: 'Aberta' } })
    ctx.cached.mockClear()
    ctx.chats.mockClear()
    ctx.list.mockClear()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    const view = await ctx.service.view()
    expect(Object.keys(view.ultimas)).toHaveLength(1)
    expect(ctx.cached.mock.calls.length).toBeLessThanOrEqual(1)
    expect(ctx.chats.mock.calls.length).toBeLessThanOrEqual(1)
    expect(ctx.list.mock.calls.length).toBeLessThanOrEqual(1)

    ctx.cached.mockClear()
    ctx.chats.mockClear()
    await ctx.service.contatoSave({ contato: { nome: 'Bia', emails: ['bia@x.example'], telefones: [] }, origem: 'manual' })
    expect(ctx.cached.mock.calls.length).toBeLessThanOrEqual(1)
    expect(ctx.chats.mock.calls.length).toBeLessThanOrEqual(1)

    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(setIntervalSpy).not.toHaveBeenCalled()
  })

  it('CA7: sem oportunidade aberta, view não lê cache nenhum', async () => {
    const ctx = setup()
    await ctx.service.view()
    expect(ctx.cached).not.toHaveBeenCalled()
    expect(ctx.chats).not.toHaveBeenCalled()
  })

  it('CA7: WhatsApp rejeitando não derruba as sugestões', async () => {
    const ctx = setup({ chats: () => Promise.reject(new Error('serviço parado')) })
    await expect(ctx.service.sugestoes()).resolves.toEqual([])
  })

  it('timeline: id desconhecido dá nao-encontrado; o resumo da reunião vem pela primeira linha', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'funil-service-'))
    dirs.push(dir)
    const store = createFunilStore({ dir, now: () => NOW })
    const service = createFunilService({
      store,
      meetings: { list: async () => [{ id: 'm1', title: 'Kickoff', startedAt: new Date(NOW).toISOString(), durationMs: 1, sources: { mic: true, system: false }, audioPath: null, transcriptPath: null, calendar: { attendees: [{ name: 'Ana', email: 'ana@x.example' }] } }] },
      summaries: { get: async () => ({ overview: '\n  Combinaram o escopo.\nSegunda linha' }) as never },
      email: { cached: async () => [] },
      whatsapp: { chats: async () => [], me: () => null },
      chooseImportFile: async () => null,
      onChange: () => undefined,
      tarefas: { todas: async () => [], criar: async () => ({ ok: true, id: null }), salvar: async () => ({ ok: true, id: null }) },
    })
    const id = okId(await service.contatoSave({ contato: { nome: 'Ana', emails: ['ana@x.example'], telefones: [] }, origem: 'manual' }))
    expect(await service.timeline({ tipo: 'oportunidade', id: 'x' })).toEqual({ ok: false, erro: 'nao-encontrado' })
    const timeline = await service.timeline({ tipo: 'contato', id })
    expect(timeline).toMatchObject({ ok: true, itens: [{ tipo: 'reuniao', meetingId: 'm1', resumo: 'Combinaram o escopo.' }] })
  })
})

describe('serviço do funil: próximo passo derivado das tarefas (contrato 124)', () => {
  const ligada = (id: string, oportunidadeId: string, parcial: Partial<Tarefa> = {}): Tarefa =>
    tarefa({ id, vinculos: { oportunidadeId, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null }, ...parcial })

  it('CA1: o passo é a tarefa aberta de menor prazo; feita sai; sem tarefa vale null; fechada e arquivada não têm chave', async () => {
    const ctx = setup()
    const op = okId(await ctx.service.oportunidadeSave({ oportunidade: { titulo: 'Aberta' } }))
    const fechada = okId(await ctx.service.oportunidadeSave({ oportunidade: { titulo: 'Fechada' } }))
    const arquivada = okId(await ctx.service.oportunidadeSave({ oportunidade: { titulo: 'Arquivada' } }))
    const ganho = (await ctx.store.read()).etapas.find((etapa) => etapa.tipo === 'ganho')?.id ?? ''
    okId(await ctx.service.oportunidadeMove({ id: fechada, etapaId: ganho, ordem: 0 }))
    okId(await ctx.service.oportunidadeMove({ id: arquivada, etapaId: ganho, ordem: 0 }))
    okId(await ctx.service.oportunidadeArchive({ id: arquivada }))

    ctx.setTarefas([ligada('t25', op, { prazo: '2026-11-25' }), ligada('t23', op, { prazo: '2026-11-23' }), ligada('tf', fechada, { prazo: '2026-11-01' })])
    let view = await ctx.service.view()
    expect(view.proximosPassos[op]).toEqual({ texto: 'Tarefa t23', data: '2026-11-23', tarefaId: 't23' })
    expect(view.proximosPassos).not.toHaveProperty(fechada)
    expect(view.proximosPassos).not.toHaveProperty(arquivada)

    ctx.setTarefas([ligada('t25', op, { prazo: '2026-11-25' }), ligada('t23', op, { prazo: '2026-11-23', status: 'feita', feitaEm: NOW })])
    view = await ctx.service.view()
    expect(view.proximosPassos[op]).toEqual({ texto: 'Tarefa t25', data: '2026-11-25', tarefaId: 't25' })

    ctx.setTarefas([ligada('t25', op, { prazo: '2026-11-25', status: 'cancelada', feitaEm: NOW })])
    view = await ctx.service.view()
    expect(view.proximosPassos[op]).toBeNull()
    expect(Object.keys(view.proximosPassos)).toEqual([op])
    // Uma leitura das tarefas por view.
    ctx.todas.mockClear()
    await ctx.service.view()
    expect(ctx.todas).toHaveBeenCalledTimes(1)
  })

  it('CA1: as tarefas falhando valem nenhuma (o passo fica null)', async () => {
    const ctx = setup()
    const op = okId(await ctx.service.oportunidadeSave({ oportunidade: { titulo: 'Aberta' } }))
    ctx.todas.mockRejectedValueOnce(new Error('tarefas.json ilegível'))
    expect((await ctx.service.view()).proximosPassos).toEqual({ [op]: null })
  })

  it('CA2: o passo não é gravado na oportunidade e vira uma tarefa ligada a ela', async () => {
    const ctx = setup()
    const result = await ctx.service.oportunidadeSave({ oportunidade: { titulo: 'X', proximoPasso: { texto: 'Ligar', data: '2026-11-30' } } })
    const id = okId(result)
    const gravada = (JSON.parse(readFileSync(ctx.file, 'utf8')) as { oportunidades: Record<string, unknown>[] }).oportunidades.find((item) => item['id'] === id)
    expect(gravada).toBeDefined()
    expect(gravada).not.toHaveProperty('proximoPasso')
    expect(ctx.criarTarefa).toHaveBeenCalledTimes(1)
    expect(ctx.criarTarefa).toHaveBeenCalledWith({ titulo: 'Ligar', prazo: '2026-11-30', lembrete: 'padrao', origem: { tipo: 'funil', oportunidadeId: id }, vinculos: { oportunidadeId: id } })
  })

  it('CA2: a tarefa falhando (erro ou exceção) não muda o resultado da oportunidade; passo null não cria tarefa', async () => {
    const recusa = setup({ criarTarefa: async () => ({ ok: false, erro: 'limite', mensagem: 'cheio' }) })
    expect((await recusa.service.oportunidadeSave({ oportunidade: { titulo: 'X', proximoPasso: { texto: 'Ligar', data: '2026-11-30' } } })).ok).toBe(true)
    const excecao = setup({ criarTarefa: () => Promise.reject(new Error('disco cheio')) })
    expect((await excecao.service.oportunidadeSave({ oportunidade: { titulo: 'X', proximoPasso: { texto: 'Ligar', data: null } } })).ok).toBe(true)
    expect(excecao.criarTarefa).toHaveBeenCalledTimes(1)

    const semPasso = setup()
    expect((await semPasso.service.oportunidadeSave({ oportunidade: { titulo: 'X', proximoPasso: null } })).ok).toBe(true)
    expect((await semPasso.service.oportunidadeSave({ oportunidade: { titulo: 'Y', proximoPasso: { texto: '   ', data: null } } })).ok).toBe(true)
    expect(semPasso.criarTarefa).not.toHaveBeenCalled()
    // Data fora do calendário é recusada antes de gravar.
    expect(await semPasso.service.oportunidadeSave({ oportunidade: { titulo: 'Z', proximoPasso: { texto: 'Ligar', data: '2026-02-30' } } })).toEqual({ ok: false, erro: 'invalido', mensagem: FUNIL_ERRO_TEXTO.invalido })
    expect((await semPasso.store.read()).oportunidades.map((item) => item.titulo)).toEqual(['X', 'Y'])
  })

  it('o mesmo passo de novo não duplica: mesmo título (sem caixa) e prazo não faz nada; prazo diferente atualiza a tarefa aberta', async () => {
    const ctx = setup()
    const op = okId(await ctx.service.oportunidadeSave({ oportunidade: { titulo: 'Aberta' } }))
    ctx.setTarefas([
      ligada('feita', op, { titulo: 'Ligar para a Ana', prazo: '2026-11-01', status: 'feita', feitaEm: NOW }),
      ligada('t1', op, { titulo: 'Ligar para a Ana ', prazo: '2026-11-30' }),
      ligada('outra-op', 'op-x', { titulo: 'Ligar para a Ana', prazo: '2026-11-25' }),
    ])
    expect((await ctx.service.oportunidadeSave({ oportunidade: { id: op, titulo: 'Aberta', proximoPasso: { texto: '  ligar PARA a ana ', data: '2026-11-30' } } })).ok).toBe(true)
    expect(ctx.criarTarefa).not.toHaveBeenCalled()
    expect(ctx.salvarTarefa).not.toHaveBeenCalled()
    expect((await ctx.service.oportunidadeSave({ oportunidade: { id: op, titulo: 'Aberta', proximoPasso: { texto: 'Ligar para a Ana', data: '2026-11-25' } } })).ok).toBe(true)
    expect(ctx.criarTarefa).not.toHaveBeenCalled()
    expect(ctx.salvarTarefa).toHaveBeenCalledExactlyOnceWith({ id: 't1', prazo: '2026-11-25' })
    // Título diferente cria outra.
    expect((await ctx.service.oportunidadeSave({ oportunidade: { id: op, titulo: 'Aberta', proximoPasso: { texto: 'Enviar proposta', data: null } } })).ok).toBe(true)
    expect(ctx.criarTarefa).toHaveBeenCalledTimes(1)
  })

  it('registrarTarefa grava o evento e avisa a tela; oportunidade que sumiu vira exceção; notificarTarefas só reemite a view', async () => {
    const ctx = setup()
    const op = okId(await ctx.service.oportunidadeSave({ oportunidade: { titulo: 'Aberta' } }))
    const antes = ctx.views.length
    await ctx.service.registrarTarefa({ oportunidadeId: op, tarefaId: 't1', acao: 'criada', titulo: 'Ligar' })
    expect(ctx.views.length).toBe(antes + 1)
    expect((await ctx.store.read()).eventos.at(-1)).toMatchObject({ oportunidadeId: op, tipo: 'tarefa', texto: 'Ligar', tarefa: { id: 't1', acao: 'criada' } })
    await expect(ctx.service.registrarTarefa({ oportunidadeId: 'sumiu', tarefaId: 't1', acao: 'feita', titulo: 'Ligar' })).rejects.toThrow(FUNIL_ERRO_TEXTO['nao-encontrado'])
    const conteudo = readFileSync(ctx.file, 'utf8')
    ctx.setTarefas([tarefa({ id: 't1', prazo: '2026-11-21', vinculos: { oportunidadeId: op, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null } })])
    await ctx.service.notificarTarefas()
    expect(ctx.views.at(-1)?.proximosPassos[op]).toMatchObject({ tarefaId: 't1', data: '2026-11-21' })
    expect(readFileSync(ctx.file, 'utf8')).toBe(conteudo)
  })
})

describe('canais do funil', () => {
  beforeAll(() => {
    invokeHandlers.clear()
  })

  it('CA8: os 16 canais existem e são recusados com o app bloqueado', () => {
    // Os da proposta (contrato 113) são conferidos em `funil-proposta.test.ts`.
    const funil = INVOKE_CHANNELS.filter((channel) => channel.startsWith('scribe:funil-') && !channel.startsWith('scribe:funil-proposta-'))
    expect(funil.sort()).toEqual([...CANAIS_FUNIL].sort())
    for (const channel of CANAIS_FUNIL) expect(WHEN_LOCKED[channel as keyof typeof WHEN_LOCKED]).toBe('refused')
  })

  it('CA9: pedido com campo a mais devolve invalido e o store não muda; exceção vira falhou', async () => {
    const ctx = setup()
    invokeHandlers.clear()
    registerFunilIpc({ appOrigin: ORIGIN, funil: ctx.service })
    expect([...invokeHandlers.keys()].sort()).toEqual([...CANAIS_FUNIL].sort())
    const save = invokeHandlers.get('scribe:funil-contato-save')
    if (!save) throw new Error('canal não registrado')

    const fora = await save(trusted, { contato: { nome: 'Ana', emails: ['ana@x.example'], telefones: [] }, origem: 'manual', extra: true })
    expect(fora).toEqual({ ok: false, erro: 'invalido', mensagem: FUNIL_ERRO_TEXTO.invalido })
    const dentro = await save(trusted, { contato: { nome: 'Ana', emails: ['ana@x.example'], telefones: [], apelido: 'Aninha' }, origem: 'manual' })
    expect(dentro).toMatchObject({ ok: false, erro: 'invalido' })
    expect(existsSync(ctx.file)).toBe(false)
    expect((await ctx.store.read()).contatos).toHaveLength(0)
    expect(ctx.views).toHaveLength(0)

    expect(await save(trusted, { contato: { nome: 'Ana', emails: ['ana@x.example'], telefones: [] }, origem: 'manual' })).toMatchObject({ ok: true })
    expect((await ctx.store.read()).contatos).toHaveLength(1)

    invokeHandlers.clear()
    registerFunilIpc({ appOrigin: ORIGIN, funil: { ...ctx.service, contatoSave: () => Promise.reject(new Error('disco cheio')) } })
    const quebrado = invokeHandlers.get('scribe:funil-contato-save')
    expect(await quebrado?.(trusted, { contato: { nome: 'Bia', emails: [], telefones: ['11987654321'] }, origem: 'manual' })).toEqual({ ok: false, erro: 'falhou', mensagem: FUNIL_FALHOU_TEXTO })
    const timeline = invokeHandlers.get('scribe:funil-timeline')
    expect(await timeline?.(trusted, { tipo: 'empresa', id: 'x' })).toEqual({ ok: false, erro: 'invalido' })

    // Leituras com exceção também respondem tipado, e a exceção fica no log.
    const logs: string[] = []
    invokeHandlers.clear()
    registerFunilIpc({ appOrigin: ORIGIN, funil: { ...ctx.service, view: () => Promise.reject(new Error('quebrou')), timeline: () => Promise.reject(new Error('quebrou')) }, log: (message) => void logs.push(message) })
    const falha = { ok: false, erro: 'falhou', mensagem: FUNIL_LEITURA_FALHOU_TEXTO }
    expect(await invokeHandlers.get('scribe:funil-get')?.(trusted)).toEqual(falha)
    expect(await invokeHandlers.get('scribe:funil-timeline')?.(trusted, { tipo: 'contato', id: 'x' })).toEqual(falha)
    expect(logs).toHaveLength(2)
  })
})
