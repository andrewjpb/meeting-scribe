// Contrato 121 (tarefas, CA1 a CA3): o store de `tarefas.json`. Título e prazo (R8), estados e histórico (R8, D-10),
// eventos da edição, quarentena, cópia diária e o log sem título (D1, R36), migração e o desfazer.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTarefasStore } from '../src/main/tarefas/store'
import { TAREFA_HISTORICO_MAX, TAREFAS_IGNORADOS_MAX, TAREFAS_MAX, type Tarefa, type TarefaNova, type TarefasArquivo, type TarefasResult } from '../src/shared/tarefas'

const DIA_MS = 86_400_000
const NOW = Date.parse('2026-11-22T15:00:00.000Z')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tarefas-store-'))
  dirs.push(dir)
  let clock = NOW
  let seq = 0
  const logs: string[] = []
  const store = createTarefasStore({ dir, now: () => clock, newId: () => `id-${++seq}`, log: (message) => void logs.push(message) })
  return { dir, file: join(dir, 'tarefas.json'), store, logs, setNow: (at: number) => void (clock = at) }
}

function ok<T>(result: TarefasResult<T>): { value: T; state: TarefasArquivo } {
  if (!result.ok) throw new Error(`esperava ok, veio ${result.erro}`)
  return result
}

const nova = (patch: Partial<TarefaNova> = {}): TarefaNova => ({
  titulo: 'Ligar para a Marina',
  detalhe: '',
  prazo: null,
  lembreteEm: null,
  importante: false,
  responsavel: { tipo: 'eu' },
  origem: { tipo: 'manual' },
  vinculos: { oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null },
  ...patch,
})

/** `AAAA-MM-DD` no fuso da máquina, como o store nomeia a cópia. */
const dia = (at: number): string => {
  const data = new Date(at)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

const backups = (dir: string): string[] => readdirSync(dir).filter((name) => name.startsWith('tarefas.json.bak-')).sort()

describe('store das tarefas', () => {
  it('arquivo ausente vale a lista vazia, sem gravar', async () => {
    const { file, store } = setup()
    const { value } = ok(await store.read())
    expect(value).toEqual({ version: 1, tarefas: [], ignorados: [], migradoEm: null, ultimoAvisoHojeEm: null })
    expect(existsSync(file)).toBe(false)
  })

  it('CA1: criar apara o título, abre a tarefa com o evento criada e grava 0600', async () => {
    const { file, store } = setup()
    const { value, state } = ok(await store.criar(nova({ titulo: '  Ligar  ' })))
    expect(value.titulo).toBe('Ligar')
    expect(value.status).toBe('aberta')
    expect(value.historico).toEqual([{ tipo: 'criada', em: NOW }])
    expect(value).toMatchObject({ id: 'id-1', criadaEm: NOW, atualizadaEm: NOW, feitaEm: null, lembreteDisparadoEm: null })
    expect(state.tarefas).toHaveLength(1)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect((JSON.parse(readFileSync(file, 'utf8')) as TarefasArquivo).tarefas[0]?.titulo).toBe('Ligar')
  })

  it('CA1: título vazio, com 201 caracteres ou prazo que não existe → invalido e o arquivo não muda', async () => {
    const { file, store } = setup()
    ok(await store.criar(nova()))
    const before = readFileSync(file, 'utf8')
    for (const entrada of [nova({ titulo: '' }), nova({ titulo: '   ' }), nova({ titulo: 'a'.repeat(201) }), nova({ prazo: '2026-02-30' }), nova({ prazo: '30/11' }), nova({ detalhe: 'd'.repeat(2001) })]) {
      expect(await store.criar(entrada)).toEqual({ ok: false, erro: 'invalido' })
    }
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(ok(await store.criar(nova({ titulo: 'a'.repeat(200), prazo: '2026-02-28' }))).value.titulo).toHaveLength(200)
  })

  it('criarVarias grava todas de uma vez; uma inválida e nenhuma entra', async () => {
    const { store } = setup()
    const { value, state } = ok(await store.criarVarias([nova({ titulo: 'A' }), nova({ titulo: 'B' })]))
    expect(value.map((t) => t.titulo)).toEqual(['A', 'B'])
    expect(state.tarefas).toHaveLength(2)
    expect(await store.criarVarias([nova({ titulo: 'C' }), nova({ titulo: '' })])).toEqual({ ok: false, erro: 'invalido' })
    expect(ok(await store.read()).value.tarefas).toHaveLength(2)
  })

  it('CA2: feita, reabrir, cancelada terminal, mesmo estado sem escrita, apagar e id inexistente', async () => {
    const { file, store, setNow } = setup()
    const { value: tarefa } = ok(await store.criar(nova()))

    setNow(NOW + 1_000)
    const feita = ok(await store.status(tarefa.id, 'feita')).value
    expect(feita.status).toBe('feita')
    expect(feita.feitaEm).toBe(NOW + 1_000)
    expect(feita.historico.at(-1)).toEqual({ tipo: 'feita', em: NOW + 1_000 })

    // feita → cancelada não passa sem reabrir.
    expect(await store.status(tarefa.id, 'cancelada')).toEqual({ ok: false, erro: 'fechada' })

    setNow(NOW + 2_000)
    const reaberta = ok(await store.status(tarefa.id, 'aberta')).value
    expect(reaberta.feitaEm).toBeNull()
    expect(reaberta.historico.at(-1)).toEqual({ tipo: 'reaberta', em: NOW + 2_000 })

    setNow(NOW + 3_000)
    const cancelada = ok(await store.status(tarefa.id, 'cancelada')).value
    expect(cancelada.feitaEm).toBe(NOW + 3_000)
    expect(cancelada.historico.at(-1)).toEqual({ tipo: 'cancelada', em: NOW + 3_000 })
    expect(await store.status(tarefa.id, 'feita')).toEqual({ ok: false, erro: 'fechada' })

    const antes = statSync(file).mtimeMs
    const conteudo = readFileSync(file, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const mesmo = ok(await store.status(tarefa.id, 'cancelada'))
    expect(mesmo.value.historico).toHaveLength(cancelada.historico.length)
    expect(statSync(file).mtimeMs).toBe(antes)
    expect(readFileSync(file, 'utf8')).toBe(conteudo)

    expect(await store.status('nada', 'feita')).toEqual({ ok: false, erro: 'nao-encontrado' })
    expect(await store.salvar('nada', { titulo: 'x' })).toEqual({ ok: false, erro: 'nao-encontrado' })
    expect(await store.apagar('nada')).toEqual({ ok: false, erro: 'nao-encontrado' })

    expect(ok(await store.apagar(tarefa.id)).state.tarefas).toEqual([])
    expect(ok(await store.read()).value.tarefas).toEqual([])
  })

  it('CA2: com 51 eventos ficam 50, sem o mais antigo', async () => {
    const { store, setNow } = setup()
    const { value: tarefa } = ok(await store.criar(nova()))
    let ultima: Tarefa = tarefa
    for (let i = 1; i <= TAREFA_HISTORICO_MAX; i++) {
      setNow(NOW + i)
      ultima = ok(await store.salvar(tarefa.id, { prazo: dia(NOW + i * DIA_MS) })).value
    }
    expect(ultima.historico).toHaveLength(TAREFA_HISTORICO_MAX)
    expect(ultima.historico.some((evento) => evento.tipo === 'criada')).toBe(false)
    expect(ultima.historico[0]).toEqual({ tipo: 'prazo', em: NOW + 1, detalhe: dia(NOW + DIA_MS) })
  })

  it('salvar grava os eventos só quando o valor muda; lembrete novo zera o disparado', async () => {
    const { file, store, setNow } = setup()
    const { value: tarefa } = ok(await store.criar(nova({ prazo: '2026-11-25', lembreteEm: 1_000 })))
    expect(ok(await store.marcarLembreteDisparado([tarefa.id, 'nada'], NOW + 5)).value).toEqual([tarefa.id])

    setNow(NOW + 10)
    const editada = ok(
      await store.salvar(tarefa.id, {
        titulo: ' Ligar ',
        prazo: '2026-11-25',
        lembreteEm: 2_000,
        responsavel: { tipo: 'nome', nome: 'Ana' },
        vinculos: { oportunidadeId: 'op-1', meetingId: null },
      }),
    ).value
    expect(editada.titulo).toBe('Ligar')
    expect(editada.lembreteEm).toBe(2_000)
    expect(editada.lembreteDisparadoEm).toBeNull()
    expect(editada.vinculos.oportunidadeId).toBe('op-1')
    expect(editada.atualizadaEm).toBe(NOW + 10)
    expect(editada.historico.map((evento) => evento.tipo)).toEqual(['criada', 'lembrete', 'responsavel', 'vinculo'])
    expect(editada.historico.at(-1)).toEqual({ tipo: 'vinculo', em: NOW + 10, detalhe: 'oportunidade' })

    // Nada muda: ok, sem evento e sem escrita.
    const conteudo = readFileSync(file, 'utf8')
    const igual = ok(await store.salvar(tarefa.id, { prazo: '2026-11-25', responsavel: { tipo: 'nome', nome: 'Ana' }, vinculos: { oportunidadeId: 'op-1' } })).value
    expect(igual.historico).toHaveLength(4)
    expect(readFileSync(file, 'utf8')).toBe(conteudo)

    const semPrazo = ok(await store.salvar(tarefa.id, { prazo: null, importante: true })).value
    expect(semPrazo.historico.at(-1)).toEqual({ tipo: 'prazo', em: NOW + 10 })
    expect(semPrazo.importante).toBe(true)

    expect(await store.salvar(tarefa.id, { titulo: '' })).toEqual({ ok: false, erro: 'invalido' })
    expect(await store.salvar(tarefa.id, { prazo: '2026-13-01' })).toEqual({ ok: false, erro: 'invalido' })
    expect(await store.salvar(tarefa.id, { detalhe: 'd'.repeat(2001) })).toEqual({ ok: false, erro: 'invalido' })
  })

  it('marcarLembreteDisparado só marca lembrete aberto, vencido e ainda não disparado', async () => {
    const { file, store } = setup()
    const valendo = ok(await store.criar(nova({ titulo: 'Valendo', lembreteEm: NOW - 10 }))).value
    const futuro = ok(await store.criar(nova({ titulo: 'Futuro', lembreteEm: NOW + 60_000 }))).value
    const semAviso = ok(await store.criar(nova({ titulo: 'Sem aviso' }))).value
    const feita = ok(await store.criar(nova({ titulo: 'Feita', lembreteEm: NOW - 10 }))).value
    ok(await store.status(feita.id, 'feita'))

    const { value, state } = ok(await store.marcarLembreteDisparado([valendo.id, futuro.id, semAviso.id, feita.id], NOW))
    expect(value).toEqual([valendo.id])
    expect(state.tarefas.map((t) => t.lembreteDisparadoEm)).toEqual([NOW, null, null, null])

    // Já disparado: não marca de novo nem grava.
    const conteudo = readFileSync(file, 'utf8')
    expect(ok(await store.marcarLembreteDisparado([valendo.id], NOW + 1)).value).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(conteudo)
  })

  it('o tick leu, a pessoa trocou o lembreteEm e só depois veio a marcação: o aviso novo continua de pé', async () => {
    const { store } = setup()
    const { value: tarefa } = ok(await store.criar(nova({ lembreteEm: NOW - 10 })))
    // O tick lê a tarefa vencida em NOW e notifica; antes de marcar, a pessoa adia o aviso para daqui a 1 h.
    ok(await store.salvar(tarefa.id, { lembreteEm: NOW + 3_600_000 }))
    const marcado = ok(await store.marcarLembreteDisparado([tarefa.id], NOW))
    expect(marcado.value).toEqual([])
    expect(marcado.state.tarefas[0]).toMatchObject({ lembreteEm: NOW + 3_600_000, lembreteDisparadoEm: null })
  })

  it('o log de criada e apagada só sai depois de gravado', async () => {
    const { store, logs } = setup()
    expect(await store.criar(nova({ titulo: '' }))).toEqual({ ok: false, erro: 'invalido' })
    expect(await store.criar(nova({ vinculos: { oportunidadeId: '', contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null } }))).toEqual({ ok: false, erro: 'invalido' })
    expect(await store.criarVarias([nova({ titulo: '' })])).toEqual({ ok: false, erro: 'invalido' })
    expect(logs.filter((linha) => linha.includes('criada'))).toEqual([])
    const { value } = ok(await store.criar(nova()))
    expect(logs).toContain(`[tarefas] criada ${value.id}`)
  })

  it('ignorar não repete a chave; marcarAvisoHoje grava a hora', async () => {
    const { store } = setup()
    expect(ok(await store.ignorar(' reuniao:m1:ligar ')).value).toEqual({ chave: 'reuniao:m1:ligar', em: NOW })
    expect(ok(await store.ignorar('reuniao:m1:ligar')).state.ignorados).toHaveLength(1)
    expect(await store.ignorar('')).toEqual({ ok: false, erro: 'invalido' })
    expect(ok(await store.marcarAvisoHoje(NOW + 1)).state.ultimoAvisoHojeEm).toBe(NOW + 1)
  })

  it('ignorados no limite: sai o mais antigo', async () => {
    const { dir, store } = setup()
    const arquivo: TarefasArquivo = {
      version: 1,
      tarefas: [],
      ignorados: Array.from({ length: TAREFAS_IGNORADOS_MAX }, (_, i) => ({ chave: `k-${i}`, em: i })),
      migradoEm: null,
      ultimoAvisoHojeEm: null,
    }
    writeFileSync(join(dir, 'tarefas.json'), JSON.stringify(arquivo))
    const { state } = ok(await store.ignorar('nova'))
    expect(state.ignorados).toHaveLength(TAREFAS_IGNORADOS_MAX)
    expect(state.ignorados[0]?.chave).toBe('k-1')
    expect(state.ignorados.at(-1)?.chave).toBe('nova')
  })

  it('limite de tarefas recusa sem mudar o arquivo', async () => {
    const { dir, file, store } = setup()
    const base = { ...nova(), id: '', status: 'aberta' as const, lembreteDisparadoEm: null, historico: [], criadaEm: 1, atualizadaEm: 1, feitaEm: null }
    const arquivo: TarefasArquivo = { version: 1, tarefas: Array.from({ length: TAREFAS_MAX }, (_, i) => ({ ...base, id: `t-${i}` })), ignorados: [], migradoEm: null, ultimoAvisoHojeEm: null }
    writeFileSync(join(dir, 'tarefas.json'), JSON.stringify(arquivo))
    const before = readFileSync(file, 'utf8')
    expect(await store.criar(nova())).toEqual({ ok: false, erro: 'limite' })
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('CA3: JSON inválido vai para .corrupt-<n> e a leitura vem vazia', async () => {
    const { dir, file, store, logs } = setup()
    writeFileSync(file, '{quebrado')
    const { value } = ok(await store.read())
    expect(value.tarefas).toEqual([])
    expect(existsSync(file)).toBe(false)
    expect(readdirSync(dir)).toEqual([`tarefas.json.corrupt-${NOW}`])
    expect(readFileSync(join(dir, `tarefas.json.corrupt-${NOW}`), 'utf8')).toBe('{quebrado')
    expect(logs.some((linha) => linha.includes('corrupt'))).toBe(true)
  })

  it('CA3: cópia diária antes da primeira gravação do dia; com 8 cópias ficam as 7 mais recentes', async () => {
    const { dir, file, store, setNow } = setup()
    setNow(NOW - DIA_MS)
    ok(await store.criar(nova()))
    expect(backups(dir)).toEqual([])
    const before = readFileSync(file, 'utf8')

    setNow(NOW)
    ok(await store.criar(nova()))
    expect(backups(dir)).toEqual([`tarefas.json.bak-${dia(NOW)}`])
    expect(readFileSync(join(dir, `tarefas.json.bak-${dia(NOW)}`), 'utf8')).toBe(before)
    expect(statSync(join(dir, `tarefas.json.bak-${dia(NOW)}`)).mode & 0o777).toBe(0o600)

    setNow(NOW + 60_000)
    ok(await store.criar(nova()))
    expect(backups(dir)).toEqual([`tarefas.json.bak-${dia(NOW)}`])

    // Outro diretório: 7 cópias de dias anteriores e a primeira gravação de um dia novo (a 8ª).
    const other = setup()
    other.setNow(NOW - DIA_MS)
    ok(await other.store.criar(nova()))
    const old = [7, 6, 5, 4, 3, 2, 1].map((back) => `tarefas.json.bak-${dia(NOW - back * DIA_MS)}`)
    for (const name of old) writeFileSync(join(other.dir, name), 'antigo', { mode: 0o600 })
    const fresh = createTarefasStore({ dir: other.dir, now: () => NOW })
    ok(await fresh.criar(nova()))
    expect(backups(other.dir)).toEqual([...old.slice(1), `tarefas.json.bak-${dia(NOW)}`])
  })

  it('CA3: o log nunca leva o título, o detalhe nem o texto da origem', async () => {
    const { dir, store, logs } = setup()
    const segredo = 'Pagar o boleto da clínica'
    const { value } = ok(await store.criar(nova({ titulo: segredo, detalhe: `${segredo} detalhe`, origem: { tipo: 'reuniao', meetingId: 'm1', texto: segredo } })))
    ok(await store.criarVarias([nova({ titulo: segredo })]))
    ok(await store.salvar(value.id, { titulo: `${segredo} 2` }))
    ok(await store.status(value.id, 'feita'))
    ok(await store.apagar(value.id))
    writeFileSync(join(dir, 'tarefas.json'), '{')
    const outro = createTarefasStore({ dir, log: (message) => void logs.push(message) })
    ok(await outro.read())
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.join('\n')).not.toContain('boleto')
  })

  it('aplicarMigracao anexa e grava migradoEm; reverterMigracao volta ao anterior ou apaga o arquivo', async () => {
    const { file, store } = setup()
    const existente = ok(await store.criar(nova({ titulo: 'Já existia' }))).state
    const migrado = ok(await store.aplicarMigracao([nova({ titulo: 'Passo', origem: { tipo: 'migracao', de: 'proximo-passo' } })], NOW + 5))
    expect(migrado.state.migradoEm).toBe(NOW + 5)
    expect(migrado.state.tarefas.map((t) => t.titulo)).toEqual(['Já existia', 'Passo'])
    expect(migrado.value[0]?.criadaEm).toBe(NOW + 5)
    expect(await store.aplicarMigracao([nova({ titulo: '' })], NOW)).toEqual({ ok: false, erro: 'invalido' })

    ok(await store.reverterMigracao(existente))
    expect(ok(await store.read()).value).toEqual(existente)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(existente)

    ok(await store.reverterMigracao(null))
    expect(existsSync(file)).toBe(false)
    expect(ok(await store.read()).value.tarefas).toEqual([])
  })
})
