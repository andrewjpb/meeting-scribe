// Contrato 110 (funil-vendas, CA5 a CA9): o serviço do funil sobre o store real numa pasta temporária, com os
// outros domínios falsos e contados. Gravação e `onChange` (CA5), importação (CA6, R16), custo das leituras (CA7,
// D3), os 16 canais recusados com o app bloqueado (CA8, R47) e o pedido fora do formato (CA9).
import type * as FsPromises from 'node:fs/promises'
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FUNIL_ERRO_TEXTO, FUNIL_FALHOU_TEXTO, FUNIL_LEITURA_FALHOU_TEXTO, type FunilActionResult, type FunilView } from '../src/shared/funil'
import { IMPORT_BYTES_MAX } from '../src/shared/funil-import'
import { INVOKE_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import type { EmailMessage } from '../src/shared/email'
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

function setup(opcoes: { chats?: () => Promise<WhatsAppChat[]>; arquivo?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'funil-service-'))
  dirs.push(dir)
  let seq = 0
  const store = createFunilStore({ dir, now: () => NOW, newId: () => `id-${++seq}` })
  const views: FunilView[] = []
  let arquivo: string | null = opcoes.arquivo ?? null
  const cached = vi.fn(async () => [{ status: { account: { address: 'eu@minha.example' } }, inbox: [emailMessage('1', 'cliente@x.example', NOW - DIA_MS)], sent: [] }])
  const chats = vi.fn(opcoes.chats ?? (async (): Promise<WhatsAppChat[]> => []))
  const list = vi.fn(async () => [])
  const service = createFunilService({
    store,
    meetings: { list },
    summaries: { get: async () => null },
    email: { cached },
    whatsapp: { chats, me: () => null },
    chooseImportFile: async () => arquivo,
    onChange: (view) => void views.push(view),
    now: () => NOW,
    newId: () => `token-${++seq}`,
  })
  return { dir, file: join(dir, 'funil.json'), store, service, views, cached, chats, list, setArquivo: (path: string | null) => void (arquivo = path) }
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
    })
    const id = okId(await service.contatoSave({ contato: { nome: 'Ana', emails: ['ana@x.example'], telefones: [] }, origem: 'manual' }))
    expect(await service.timeline({ tipo: 'oportunidade', id: 'x' })).toEqual({ ok: false, erro: 'nao-encontrado' })
    const timeline = await service.timeline({ tipo: 'contato', id })
    expect(timeline).toMatchObject({ ok: true, itens: [{ tipo: 'reuniao', meetingId: 'm1', resumo: 'Combinaram o escopo.' }] })
  })
})

describe('canais do funil', () => {
  beforeAll(() => {
    invokeHandlers.clear()
  })

  it('CA8: os 16 canais existem e são recusados com o app bloqueado', () => {
    const funil = INVOKE_CHANNELS.filter((channel) => channel.startsWith('scribe:funil-'))
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
