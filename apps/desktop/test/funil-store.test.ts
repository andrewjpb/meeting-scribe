// Contrato 107 (funil-vendas, CA1 a CA9): o store de `funil.json`. Normalização e mescla de contatos (R3, R4),
// empresa pelo domínio (R5), quarentena (R2), etapas fixas, mudança de etapa (R6), arquivar (R27), cópia diária
// (R1), limites, fila e posição na coluna.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFunilStore } from '../src/main/funil/store'
import { FUNIL_CONTATOS_MAX, type Contato, type FunilResult, type FunilState } from '../src/shared/funil'
import { etapasPadrao } from '../src/shared/funil-logic'

const DIA_MS = 86_400_000
const NOW = Date.parse('2026-11-20T15:00:00.000Z')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'funil-store-'))
  dirs.push(dir)
  let clock = NOW
  let seq = 0
  const logs: string[] = []
  const store = createFunilStore({ dir, now: () => clock, newId: () => `id-${++seq}`, log: (message) => void logs.push(message) })
  return { dir, file: join(dir, 'funil.json'), store, logs, setNow: (at: number) => void (clock = at) }
}

function ok<T>(result: FunilResult<T>): { value: T; state: FunilState } {
  if (!result.ok) throw new Error(`esperava ok, veio ${result.erro}`)
  return result
}

const etapa = (state: FunilState, nome: string) => {
  const found = state.etapas.find((item) => item.nome === nome)
  if (!found) throw new Error(`sem etapa ${nome}`)
  return found
}

/** `AAAA-MM-DD` no fuso da máquina, como o store nomeia a cópia. */
const dia = (at: number): string => {
  const data = new Date(at)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

const backups = (dir: string): string[] => readdirSync(dir).filter((name) => name.startsWith('funil.json.bak-')).sort()

describe('store do funil', () => {
  it('CA1: normaliza e-mail e telefone e mescla o segundo contato sem trocar o nome', async () => {
    const { store } = setup()
    const first = ok(await store.saveContato({ nome: 'Ana', emails: ['Ana@ACME.com.br '], telefones: ['(11) 98765-4321'] }, 'manual'))
    expect(first.state.contatos[0]?.emails).toEqual(['ana@acme.com.br'])
    expect(first.state.contatos[0]?.telefones).toEqual(['+5511987654321'])
    expect(first.value.mesclado).toBe(false)

    const second = ok(await store.saveContato({ nome: 'Ana Souza', emails: ['ana@acme.com.br'], telefones: [] }, 'importacao'))
    expect(second.value.mesclado).toBe(true)
    expect(second.state.contatos).toHaveLength(1)
    expect(second.state.contatos[0]?.nome).toBe('Ana')
    expect(second.state.contatos[0]?.origem).toBe('manual')
  })

  it('CA2: criar com o telefone sem o nono dígito mescla no contato arquivado e desarquiva', async () => {
    const { store } = setup()
    const { value } = ok(await store.saveContato({ nome: 'Bruno', emails: [], telefones: ['+5511987654321'] }, 'manual'))
    ok(await store.arquivarContato(value.contato.id))
    const merged = ok(await store.saveContato({ nome: 'Bruno Lima', emails: ['bruno@cliente.example'], telefones: ['(11) 8765-4321'] }, 'whatsapp'))
    expect(merged.value.mesclado).toBe(true)
    expect(merged.value.contato.id).toBe(value.contato.id)
    expect(merged.value.contato.arquivado).toBe(false)
    expect(merged.value.contato.telefones).toEqual(['+5511987654321'])
    expect(merged.value.contato.emails).toEqual(['bruno@cliente.example'])
    expect(merged.state.contatos).toHaveLength(1)
  })

  it('mescla não copia e-mail nem telefone que já é de outro contato', async () => {
    const { store } = setup()
    const a = ok(await store.saveContato({ nome: 'A', emails: ['a@cliente.example'], telefones: [] }, 'manual')).value.contato
    const b = ok(await store.saveContato({ nome: 'B', emails: [], telefones: ['(11) 98765-4321'] }, 'manual')).value.contato
    const merged = ok(await store.saveContato({ nome: 'A2', emails: ['a@cliente.example', 'a2@cliente.example'], telefones: ['11 8765-4321'] }, 'importacao'))
    expect(merged.value.mesclado).toBe(true)
    expect(merged.value.contato.id).toBe(a.id)
    expect(merged.value.contato.telefones).toEqual([])
    expect(merged.value.contato.emails).toEqual(['a@cliente.example', 'a2@cliente.example'])
    const edited = ok(await store.saveContato({ id: b.id, nome: 'B Silva', emails: [], telefones: ['+5511987654321'] }, 'manual'))
    expect(edited.value.contato.nome).toBe('B Silva')
  })

  it('CA3: e-mail do domínio da empresa liga à empresa; provedor pessoal não liga', async () => {
    const { store } = setup()
    const acme = ok(await store.saveEmpresa({ nome: 'Acme', dominios: ['@ACME.com.br'] })).value
    expect(acme.dominios).toEqual(['acme.com.br'])
    const y = ok(await store.saveContato({ nome: 'Y', emails: ['y@acme.com.br'], telefones: [] }, 'manual')).value.contato
    expect(y.empresaId).toBe(acme.id)
    const z = ok(await store.saveContato({ nome: 'Z', emails: ['y@gmail.com'], telefones: [] }, 'manual')).value.contato
    expect(z.empresaId).toBeNull()
  })

  it('empresa por nome sem acento e sem caixa: acha a existente ou cria (D20)', async () => {
    const { store } = setup()
    const empresa = ok(await store.saveEmpresa({ nome: 'Construtora São João', dominios: [] })).value
    const a = ok(await store.saveContato({ nome: 'A', emails: ['a@gmail.com'], telefones: [], empresaNome: ' construtora sao  joão ' }, 'importacao'))
    expect(a.value.contato.empresaId).toBe(empresa.id)
    const b = ok(await store.saveContato({ nome: 'B', emails: ['b@gmail.com'], telefones: [], empresaNome: 'Nova Ltda' }, 'importacao'))
    expect(b.state.empresas.map((item) => item.nome)).toEqual(['Construtora São João', 'Nova Ltda'])
    expect(await store.deleteEmpresa(empresa.id)).toEqual({ ok: false, erro: 'empresa-em-uso' })
  })

  it('CA4: arquivo inválido vai para quarentena, o estado tem as 6 etapas e o log uma linha', async () => {
    const { dir, file, store, logs } = setup()
    writeFileSync(file, '{quebrado')
    const state = await store.read()
    const corrupt = readdirSync(dir).filter((name) => name.startsWith('funil.json.corrupt-'))
    expect(corrupt).toHaveLength(1)
    expect(readFileSync(join(dir, corrupt[0] ?? ''), 'utf8')).toBe('{quebrado')
    expect(existsSync(file)).toBe(false)
    expect(state.etapas.map((item) => item.nome)).toEqual(['Contato', 'Descoberta', 'Proposta', 'Negociação', 'Ganho', 'Perdido'])
    expect(state.contatos).toEqual([])
    expect(logs).toHaveLength(1)
  })

  it('arquivo ausente: estado vazio com as etapas padrão, sem gravar', async () => {
    const { file, store } = setup()
    const state = await store.read()
    expect(state.etapas).toHaveLength(6)
    expect(state.ultimoAvisoEm).toBeNull()
    expect(existsSync(file)).toBe(false)
  })

  it('CA5: Ganho é fixa, etapa com oportunidade não sai, etapa vazia sai e as abertas renumeram', async () => {
    const { store } = setup()
    const state = await store.read()
    const semGanho = state.etapas.filter((item) => item.tipo !== 'ganho')
    expect(await store.saveEtapas(semGanho)).toEqual({ ok: false, erro: 'etapa-fixa' })
    const ganhoVirouAberta = state.etapas.map((item) => (item.tipo === 'ganho' ? { ...item, tipo: 'aberta' as const } : item))
    expect(await store.saveEtapas(ganhoVirouAberta)).toEqual({ ok: false, erro: 'etapa-fixa' })

    const semContato = state.etapas.filter((item) => item.nome !== 'Contato')
    const op = ok(await store.saveOportunidade({ titulo: 'Portal' })).value
    expect(await store.saveEtapas(semContato)).toEqual({ ok: false, erro: 'etapa-em-uso' })
    ok(await store.deleteOportunidade(op.id))

    const saved = ok(await store.saveEtapas(semContato))
    expect(saved.state.etapas.map((item) => item.nome)).toEqual(['Descoberta', 'Proposta', 'Negociação', 'Ganho', 'Perdido'])
    expect(saved.state.etapas.filter((item) => item.tipo === 'aberta').map((item) => item.ordem)).toEqual([0, 1, 2])
    expect(await store.saveEtapas(saved.state.etapas.filter((item) => item.tipo !== 'aberta'))).toEqual({ ok: false, erro: 'invalido' })
    expect(await store.saveEtapas(saved.state.etapas.map((item) => ({ ...item, nome: item.tipo === 'ganho' ? '' : item.nome })))).toEqual({ ok: false, erro: 'invalido' })
  })

  it('CA6: Perdido sem motivo fecha; voltar para Proposta reabre', async () => {
    const { store, setNow } = setup()
    const state = await store.read()
    const proposta = etapa(state, 'Proposta')
    const perdido = etapa(state, 'Perdido')
    const op = ok(await store.saveOportunidade({ titulo: 'Loja virtual', etapaId: proposta.id, valor: 3_800_000 })).value

    setNow(NOW + 1_000)
    const lost = ok(await store.moverOportunidade({ id: op.id, etapaId: perdido.id, ordem: 0 }))
    expect(lost.value.fechadoEm).toBe(NOW + 1_000)
    expect(lost.value.movidoEm).toBe(NOW + 1_000)
    expect(lost.value.motivoPerda).toBeNull()
    const moved = lost.state.eventos.at(-1)
    expect(moved).toMatchObject({ tipo: 'etapa', de: 'Proposta', para: 'Perdido', oportunidadeId: op.id })

    setNow(NOW + 2_000)
    const reopened = ok(await store.moverOportunidade({ id: op.id, etapaId: proposta.id, ordem: 0 }))
    expect(reopened.value.fechadoEm).toBeNull()
    expect(reopened.value.motivoPerda).toBeNull()
    expect(reopened.state.eventos.at(-1)?.tipo).toBe('reaberta')
    expect(reopened.state.eventos.at(-2)).toMatchObject({ tipo: 'etapa', de: 'Perdido', para: 'Proposta' })

    const ganho = etapa(state, 'Ganho')
    const won = ok(await store.saveOportunidade({ titulo: 'Loja virtual', id: op.id, etapaId: perdido.id, motivoPerda: 'Preço' }))
    expect(won.value.motivoPerda).toBe('Preço')
    expect(won.value.etapaId).toBe(perdido.id)
    expect(ok(await store.moverOportunidade({ id: op.id, etapaId: ganho.id, ordem: 0 })).value.motivoPerda).toBeNull()
  })

  it('CA7: arquivar só oportunidade fechada', async () => {
    const { store } = setup()
    const state = await store.read()
    const op = ok(await store.saveOportunidade({ titulo: 'Portal' })).value
    expect(await store.arquivarOportunidade(op.id)).toEqual({ ok: false, erro: 'nao-fechada' })
    ok(await store.moverOportunidade({ id: op.id, etapaId: etapa(state, 'Ganho').id, ordem: 0 }))
    const archived = ok(await store.arquivarOportunidade(op.id))
    expect(archived.value.arquivado).toBe(true)
    expect(archived.state.oportunidades[0]?.arquivado).toBe(true)
  })

  it('CA8: cópia diária antes da primeira gravação do dia, uma por dia, as 7 mais recentes', async () => {
    const { dir, file, store, setNow } = setup()
    setNow(NOW - DIA_MS)
    ok(await store.setUltimoAviso(1))
    expect(backups(dir)).toEqual([])
    const before = readFileSync(file, 'utf8')

    setNow(NOW)
    ok(await store.setUltimoAviso(2))
    expect(backups(dir)).toEqual([`funil.json.bak-${dia(NOW)}`])
    expect(readFileSync(join(dir, `funil.json.bak-${dia(NOW)}`), 'utf8')).toBe(before)
    expect(statSync(join(dir, `funil.json.bak-${dia(NOW)}`)).mode & 0o777).toBe(0o600)

    setNow(NOW + 60_000)
    ok(await store.setUltimoAviso(3))
    expect(backups(dir)).toEqual([`funil.json.bak-${dia(NOW)}`])
    expect(readFileSync(join(dir, `funil.json.bak-${dia(NOW)}`), 'utf8')).toBe(before)

    // Outro diretório: 7 cópias de dias anteriores e a primeira gravação de um dia novo.
    const other = setup()
    other.setNow(NOW - DIA_MS)
    ok(await other.store.setUltimoAviso(1))
    const old = [7, 6, 5, 4, 3, 2, 1].map((back) => `funil.json.bak-${dia(NOW - back * DIA_MS)}`)
    for (const name of old) writeFileSync(join(other.dir, name), 'antigo', { mode: 0o600 })
    const fresh = createFunilStore({ dir: other.dir, now: () => NOW })
    ok(await fresh.setUltimoAviso(2))
    expect(backups(other.dir)).toEqual([...old.slice(1), `funil.json.bak-${dia(NOW)}`])
  })

  it('CA9: limite de contatos recusa sem mudar o arquivo', async () => {
    const { file, store } = setup()
    const contatos: Contato[] = Array.from({ length: FUNIL_CONTATOS_MAX }, (_, index) => ({
      id: `c-${index}`,
      nome: `Contato ${index}`,
      emails: [`c${index}@cliente.example`],
      telefones: [],
      empresaId: null,
      cargo: null,
      notas: '',
      whatsappChatId: null,
      origem: 'importacao',
      criadoEm: NOW,
      atualizadoEm: NOW,
      arquivado: false,
    }))
    let seq = 0
    const state: FunilState = { version: 1, contatos, empresas: [], oportunidades: [], etapas: etapasPadrao(() => `e-${++seq}`), eventos: [], ignorados: [], ultimoAvisoEm: null }
    writeFileSync(file, JSON.stringify(state), { mode: 0o600 })
    const disk = readFileSync(file, 'utf8')
    expect(await store.saveContato({ nome: 'Mais um', emails: ['novo@cliente.example'], telefones: [] }, 'manual')).toEqual({ ok: false, erro: 'limite' })
    expect(readFileSync(file, 'utf8')).toBe(disk)
    // Mesclar não cresce: continua valendo.
    expect(ok(await store.saveContato({ nome: 'X', emails: ['c1@cliente.example'], telefones: ['11 3333-4444'] }, 'manual')).value.mesclado).toBe(true)
  })

  it('CA9: fila, 0600, editar com e-mail de outro e nova oportunidade no topo de Contato', async () => {
    const { file, store } = setup()
    const a = store.saveContato({ nome: 'A', emails: ['a@cliente.example'], telefones: [] }, 'manual')
    const b = store.saveContato({ nome: 'B', emails: ['b@cliente.example'], telefones: [] }, 'manual')
    const [ra, rb] = await Promise.all([a, b])
    const disk = JSON.parse(readFileSync(file, 'utf8')) as FunilState
    expect(disk.contatos.map((item) => item.nome)).toEqual(['A', 'B'])
    expect(statSync(file).mode & 0o777).toBe(0o600)

    const contatoB = ok(rb).value.contato
    expect(await store.saveContato({ id: contatoB.id, nome: 'B', emails: ['A@cliente.example'], telefones: [] }, 'manual')).toEqual({ ok: false, erro: 'duplicado' })
    expect(ok(ra).value.contato.emails).toEqual(['a@cliente.example'])

    const first = ok(await store.saveOportunidade({ titulo: 'Primeira' })).value
    const second = ok(await store.saveOportunidade({ titulo: 'Segunda', contatoIds: [contatoB.id] }))
    const contato = etapa(second.state, 'Contato')
    expect(second.value.etapaId).toBe(contato.id)
    expect(second.value.ordem).toBe(0)
    expect(second.state.oportunidades.find((item) => item.id === first.id)?.ordem).toBe(1)
    expect(second.state.eventos.filter((item) => item.oportunidadeId === second.value.id).map((item) => item.tipo)).toEqual(['criada'])
    expect(await store.saveOportunidade({ titulo: 'X', contatoIds: ['nao-existe'] })).toEqual({ ok: false, erro: 'nao-encontrado' })
    expect(await store.saveOportunidade({ titulo: 'X', valor: 10.5 })).toEqual({ ok: false, erro: 'invalido' })
    expect(await store.saveOportunidade({ titulo: '' })).toEqual({ ok: false, erro: 'invalido' })
  })

  it('oportunidade: eventos de valor e próximo passo, reunião que não existe e mover dentro da coluna', async () => {
    const { store } = setup()
    const op = ok(await store.saveOportunidade({ titulo: 'Portal', valor: 125_050, proximoPasso: { texto: 'Ligar', data: '2026-11-25' }, meetingIds: ['reuniao-apagada'] }))
    expect(op.state.eventos.map((item) => item.tipo)).toEqual(['criada', 'valor', 'proximo-passo'])
    expect(op.value.meetingIds).toEqual(['reuniao-apagada'])
    const created = ok(await store.saveOportunidade({ titulo: 'Loja' }))
    const other = created.value
    const moved = ok(await store.moverOportunidade({ id: op.value.id, etapaId: op.value.etapaId, ordem: 0 }))
    expect(moved.state.oportunidades.find((item) => item.id === other.id)?.ordem).toBe(1)
    expect(moved.value.ordem).toBe(0)
    // Só posição: nenhum evento novo.
    expect(moved.state.eventos).toHaveLength(created.state.eventos.length)
    const edited = ok(await store.saveOportunidade({ id: op.value.id, titulo: 'Portal', valor: 200_000 }))
    expect(edited.state.eventos.at(-1)).toMatchObject({ tipo: 'valor' })
    const nota = ok(await store.addEvento({ oportunidadeId: op.value.id, tipo: 'nota', texto: ' Citados na reunião: Carlos ' }))
    expect(nota.value.texto).toBe('Citados na reunião: Carlos')
    ok(await store.deleteOportunidade(op.value.id))
    const after = await store.read()
    expect(after.eventos.map((item) => item.oportunidadeId)).toEqual([other.id])
    expect(after.oportunidades.map((item) => [item.id, item.ordem])).toEqual([[other.id, 0]])
  })

  it('importação: uma escrita, cria e mescla pela regra de saveContato', async () => {
    const { store } = setup()
    const result = ok(
      await store.importarContatos(
        [
          { nome: 'Ana', emails: ['ana@acme.com.br'], telefones: [] },
          { nome: 'Ana S.', emails: ['ANA@acme.com.br'], telefones: ['11 98765-4321'] },
          { nome: 'Sem contato', emails: ['sem-arroba'], telefones: [] },
          { nome: 'Caio', emails: [], telefones: ['+55 11 3333-4444'] },
        ],
        'importacao',
      ),
    )
    expect(result.value).toEqual({ criados: 2, atualizados: 1 })
    expect(result.state.contatos.map((item) => [item.nome, item.telefones])).toEqual([
      ['Ana', ['+5511987654321']],
      ['Caio', ['+551133334444']],
    ])
    expect(ok(await store.ignorar('email:x@y.example')).state.ignorados).toHaveLength(1)
    expect(ok(await store.ignorar('email:x@y.example')).state.ignorados).toHaveLength(1)
  })
})
