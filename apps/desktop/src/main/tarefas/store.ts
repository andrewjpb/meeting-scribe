// Tarefas (contrato 121, D1): o store de `userData/tarefas.json`, no padrão de `funil/store.ts`. Fila serial,
// temporário + `rename`, `0o600`, cache em memória; cada mutação grava o arquivo inteiro e devolve `TarefasResult`.
// Antes da primeira gravação de cada dia, cópia `tarefas.json.bak-<AAAA-MM-DD>` (as 7 mais recentes). Arquivo
// inválido vira `tarefas.json.corrupt-<stamp>` e a lista parte vazia. O log leva só ids e contagens, nunca título,
// detalhe ou texto de origem (R36). Sem Electron.
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  TAREFA_DETALHE_MAX,
  TAREFA_HISTORICO_MAX,
  TAREFA_TITULO_MAX,
  TAREFAS_BACKUPS_MAX,
  TAREFAS_FILE,
  TAREFAS_IGNORADOS_MAX,
  TAREFAS_MAX,
  TAREFAS_VERSION,
  type EventoTarefa,
  type EventoTarefaTipo,
  type SugestaoIgnorada,
  type Tarefa,
  type TarefaNova,
  type TarefaPatch,
  type TarefasArquivo,
  type TarefasErro,
  type TarefasResult,
  type TarefaStatus,
} from '../../shared/tarefas'
import { diaValido } from '../../shared/tarefas-logic'
import { tarefasArquivoSchema } from '../../shared/tarefas-schema'

export interface TarefasStore {
  /** Cópia do estado; arquivo ausente vale a lista vazia (sem gravar). */
  read(): Promise<TarefasResult<TarefasArquivo>>
  criar(nova: TarefaNova): Promise<TarefasResult<Tarefa>>
  /** Uma escrita só; uma entrada fora do formato e nada é gravado. */
  criarVarias(novas: readonly TarefaNova[]): Promise<TarefasResult<Tarefa[]>>
  /** Edição parcial; eventos `prazo`, `lembrete`, `responsavel` e `vinculo` só quando o valor muda. */
  salvar(id: string, patch: TarefaPatch): Promise<TarefasResult<Tarefa>>
  /** Feita ↔ cancelada só passando por aberta (`fechada`); o mesmo estado não grava nada. */
  status(id: string, status: TarefaStatus): Promise<TarefasResult<Tarefa>>
  apagar(id: string): Promise<TarefasResult<null>>
  ignorar(chave: string): Promise<TarefasResult<SugestaoIgnorada>>
  /**
   * Grava `lembreteDisparadoEm` nas tarefas pedidas que continuam abertas, com `lembreteEm <= at` e ainda não
   * disparadas; devolve só os ids marcados.
   */
  marcarLembreteDisparado(ids: readonly string[], at: number): Promise<TarefasResult<string[]>>
  marcarAvisoHoje(at: number): Promise<TarefasResult<number>>
  /** Anexa as tarefas migradas e grava `migradoEm = at` na mesma escrita (R35). */
  aplicarMigracao(novas: readonly TarefaNova[], at: number): Promise<TarefasResult<Tarefa[]>>
  /** Desfaz a migração: volta ao estado anterior; `null` apaga o arquivo (ele não existia). */
  reverterMigracao(anterior: TarefasArquivo | null): Promise<TarefasResult<null>>
}

export interface TarefasStoreOptions {
  dir: string
  now?: () => number
  newId?: () => string
  log?: (message: string) => void
}

function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
}

async function atomicWrite(file: string, data: unknown): Promise<void> {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
}

/** `semMudanca`: o pedido já estava atendido; devolve `ok` sem gravar. */
type Passo<T> = { ok: true; value: T; semMudanca?: boolean } | { ok: false; erro: TarefasErro }

const certo = <T>(value: T): Passo<T> => ({ ok: true, value })
const intacto = <T>(value: T): Passo<T> => ({ ok: true, value, semMudanca: true })
const falha = (erro: TarefasErro): { ok: false; erro: TarefasErro } => ({ ok: false, erro })

const codigo = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined)

const DIA = /^\d{4}-\d{2}-\d{2}$/
const BACKUP_PREFIXO = `${TAREFAS_FILE}.bak-`

/** `AAAA-MM-DD` no fuso do Mac. */
function diaLocal(at: number): string {
  const data = new Date(at)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

const instante = (valor: unknown): valor is number => typeof valor === 'number' && Number.isFinite(valor)
const lembreteValido = (valor: unknown): valor is number | null => valor === null || instante(valor)
const prazoValido = (valor: unknown): valor is string | null => valor === null || diaValido(valor)

/** Título aparado de 1 a 200; fora disso, `null`. */
function tituloDe(texto: unknown): string | null {
  const titulo = typeof texto === 'string' ? texto.trim() : ''
  return titulo && titulo.length <= TAREFA_TITULO_MAX ? titulo : null
}

/** Detalhe aparado até 2000; fora disso, `null`. */
function detalheDe(texto: unknown): string | null {
  if (typeof texto !== 'string') return null
  const detalhe = texto.trim()
  return detalhe.length <= TAREFA_DETALHE_MAX ? detalhe : null
}

const iguais = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Acrescenta o evento e descarta os mais antigos acima de 50. */
function registrar(tarefa: Tarefa, tipo: EventoTarefaTipo, em: number, detalhe?: string): void {
  const evento: EventoTarefa = detalhe === undefined ? { tipo, em } : { tipo, em, detalhe }
  tarefa.historico.push(evento)
  if (tarefa.historico.length > TAREFA_HISTORICO_MAX) tarefa.historico.splice(0, tarefa.historico.length - TAREFA_HISTORICO_MAX)
}

export function createTarefasStore({ dir, now = Date.now, newId = randomUUID, log = () => undefined }: TarefasStoreOptions): TarefasStore {
  const file = join(dir, TAREFAS_FILE)
  const serial = serialQueue()
  let cache: TarefasArquivo | null = null
  /** Dia em que a cópia diária já foi conferida. */
  let backupConferido: string | null = null

  const vazio = (): TarefasArquivo => ({ version: TAREFAS_VERSION, tarefas: [], ignorados: [], migradoEm: null, ultimoAvisoHojeEm: null })

  async function load(): Promise<TarefasArquivo> {
    if (cache) return cache
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (codigo(error) !== 'ENOENT') throw error
      cache = vazio()
      return cache
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      parsed = undefined
    }
    const content = tarefasArquivoSchema.safeParse(parsed)
    if (content.success) {
      cache = content.data
      return cache
    }
    // Nunca sobrescrever o inválido: sem o `rename`, a leitura falha e nada é gravado por cima.
    const stamp = now()
    await rename(file, `${file}.corrupt-${stamp}`)
    log(`[tarefas] ${TAREFAS_FILE} inválido; guardado como ${TAREFAS_FILE}.corrupt-${stamp} e a lista parte vazia`)
    cache = vazio()
    return cache
  }

  /** Antes da primeira gravação do dia: copia o arquivo atual para `.bak-<dia>` e deixa só as 7 cópias mais recentes. */
  async function backupDoDia(at: number): Promise<void> {
    const dia = diaLocal(at)
    if (backupConferido === dia) return
    let atual: Buffer
    try {
      atual = await readFile(file)
    } catch (error) {
      if (codigo(error) !== 'ENOENT') throw error
      backupConferido = dia
      return
    }
    try {
      await writeFile(`${file}.bak-${dia}`, atual, { mode: 0o600, flag: 'wx' })
    } catch (error) {
      if (codigo(error) !== 'EEXIST') throw error
    }
    const copias = (await readdir(dir)).filter((nome) => nome.startsWith(BACKUP_PREFIXO) && DIA.test(nome.slice(BACKUP_PREFIXO.length))).sort()
    for (const nome of copias.slice(0, Math.max(0, copias.length - TAREFAS_BACKUPS_MAX))) await rm(join(dir, nome), { force: true })
    backupConferido = dia
  }

  const resultado = <T>(value: T, state: TarefasArquivo): TarefasResult<T> => {
    const out = structuredClone({ value, state })
    return { ok: true, value: out.value, state: out.state }
  }

  /** Lê, muda uma cópia e, se a mudança passa nos limites e no esquema, grava o arquivo inteiro na mesma vez da fila. */
  function mutate<T>(fn: (draft: TarefasArquivo, at: number) => Passo<T>): Promise<TarefasResult<T>> {
    return serial(async () => {
      const atual = await load()
      const draft = structuredClone(atual)
      const at = now()
      const result = fn(draft, at)
      if (!result.ok) return result
      if (result.semMudanca) return resultado(result.value, atual)
      if (draft.tarefas.length > TAREFAS_MAX) return falha('limite')
      const valid = tarefasArquivoSchema.safeParse(draft)
      if (!valid.success) {
        log(`[tarefas] alteração fora do formato (${valid.error.issues[0]?.path.join('.') ?? '?'}); nada gravado`)
        return falha('invalido')
      }
      await mkdir(dir, { recursive: true })
      await backupDoDia(at)
      await atomicWrite(file, draft)
      cache = draft
      return resultado(result.value, draft)
    })
  }

  /** A tarefa nova pronta para entrar no arquivo; `null` quando título, detalhe, prazo ou lembrete não passam. */
  function montar(nova: TarefaNova, at: number): Tarefa | null {
    const titulo = tituloDe(nova.titulo)
    const detalhe = detalheDe(nova.detalhe ?? '')
    if (titulo === null || detalhe === null || !prazoValido(nova.prazo) || !lembreteValido(nova.lembreteEm)) return null
    return {
      id: newId(),
      titulo,
      detalhe,
      status: 'aberta',
      importante: nova.importante === true,
      prazo: nova.prazo,
      lembreteEm: nova.lembreteEm,
      lembreteDisparadoEm: null,
      responsavel: structuredClone(nova.responsavel),
      origem: structuredClone(nova.origem),
      vinculos: structuredClone(nova.vinculos),
      historico: [{ tipo: 'criada', em: at }],
      criadaEm: at,
      atualizadaEm: at,
      feitaEm: null,
    }
  }

  function anexar(draft: TarefasArquivo, novas: readonly TarefaNova[], at: number): Passo<Tarefa[]> {
    if (!Array.isArray(novas)) return falha('invalido')
    const criadas: Tarefa[] = []
    for (const nova of novas) {
      const tarefa = montar(nova, at)
      if (tarefa === null) return falha('invalido')
      criadas.push(tarefa)
    }
    draft.tarefas.push(...criadas)
    return certo(criadas)
  }

  const achar = (draft: TarefasArquivo, id: string): Tarefa | undefined => draft.tarefas.find((tarefa) => tarefa.id === id)

  return {
    read: () =>
      serial(async () => {
        const state = await load()
        return resultado(state, state)
      }),

    criar: async (nova) => {
      const result = await mutate((draft, at) => {
        const criadas = anexar(draft, [nova], at)
        return criadas.ok ? certo(criadas.value[0] as Tarefa) : criadas
      })
      // O log só depois de gravado (limite e esquema já passaram).
      if (result.ok) log(`[tarefas] criada ${result.value.id}`)
      return result
    },

    criarVarias: async (novas) => {
      const result = await mutate((draft, at) => anexar(draft, novas, at))
      if (result.ok) log(`[tarefas] ${result.value.length} criadas de uma vez`)
      return result
    },

    salvar: (id, patch) =>
      mutate((draft, at) => {
        const tarefa = achar(draft, id)
        if (!tarefa) return falha('nao-encontrado')
        if (typeof patch !== 'object' || patch === null) return falha('invalido')
        const antes = structuredClone(tarefa)
        if (patch.titulo !== undefined) {
          const titulo = tituloDe(patch.titulo)
          if (titulo === null) return falha('invalido')
          tarefa.titulo = titulo
        }
        if (patch.detalhe !== undefined) {
          const detalhe = detalheDe(patch.detalhe)
          if (detalhe === null) return falha('invalido')
          tarefa.detalhe = detalhe
        }
        if (patch.prazo !== undefined) {
          if (!prazoValido(patch.prazo)) return falha('invalido')
          tarefa.prazo = patch.prazo
        }
        if (patch.lembreteEm !== undefined) {
          if (!lembreteValido(patch.lembreteEm)) return falha('invalido')
          tarefa.lembreteEm = patch.lembreteEm
        }
        if (patch.importante !== undefined) {
          if (typeof patch.importante !== 'boolean') return falha('invalido')
          tarefa.importante = patch.importante
        }
        if (patch.responsavel !== undefined) tarefa.responsavel = structuredClone(patch.responsavel)
        const vinculos = patch.vinculos
        const mudados: string[] = []
        if (vinculos !== undefined) {
          if (vinculos.oportunidadeId !== undefined) tarefa.vinculos.oportunidadeId = vinculos.oportunidadeId
          if (vinculos.contatoIds !== undefined) tarefa.vinculos.contatoIds = Array.isArray(vinculos.contatoIds) ? [...new Set(vinculos.contatoIds)] : vinculos.contatoIds
          if (vinculos.empresaId !== undefined) tarefa.vinculos.empresaId = vinculos.empresaId
          if (vinculos.meetingId !== undefined) tarefa.vinculos.meetingId = vinculos.meetingId
          if (antes.vinculos.oportunidadeId !== tarefa.vinculos.oportunidadeId) mudados.push('oportunidade')
          if (!iguais(antes.vinculos.contatoIds, tarefa.vinculos.contatoIds)) mudados.push('contatos')
          if (antes.vinculos.empresaId !== tarefa.vinculos.empresaId) mudados.push('empresa')
          if (antes.vinculos.meetingId !== tarefa.vinculos.meetingId) mudados.push('reuniao')
        }
        if (iguais(antes, tarefa)) return intacto(antes)
        if (antes.prazo !== tarefa.prazo) registrar(tarefa, 'prazo', at, tarefa.prazo ?? undefined)
        if (antes.lembreteEm !== tarefa.lembreteEm) {
          tarefa.lembreteDisparadoEm = null
          registrar(tarefa, 'lembrete', at)
        }
        if (!iguais(antes.responsavel, tarefa.responsavel)) registrar(tarefa, 'responsavel', at)
        if (mudados.length) registrar(tarefa, 'vinculo', at, mudados.join(', '))
        tarefa.atualizadaEm = at
        return certo(tarefa)
      }),

    status: (id, status) =>
      mutate((draft, at) => {
        if (status !== 'aberta' && status !== 'feita' && status !== 'cancelada') return falha('invalido')
        const tarefa = achar(draft, id)
        if (!tarefa) return falha('nao-encontrado')
        if (tarefa.status === status) return intacto(tarefa)
        if (tarefa.status !== 'aberta' && status !== 'aberta') return falha('fechada')
        tarefa.status = status
        tarefa.feitaEm = status === 'aberta' ? null : at
        registrar(tarefa, status === 'aberta' ? 'reaberta' : status, at)
        tarefa.atualizadaEm = at
        return certo(tarefa)
      }),

    apagar: async (id) => {
      const result = await mutate((draft) => {
        const indice = draft.tarefas.findIndex((tarefa) => tarefa.id === id)
        if (indice < 0) return falha('nao-encontrado')
        draft.tarefas.splice(indice, 1)
        return certo(null)
      })
      if (result.ok) log(`[tarefas] apagada ${id}`)
      return result
    },

    ignorar: (chave) =>
      mutate((draft, at) => {
        const texto = typeof chave === 'string' ? chave.trim() : ''
        if (!texto || texto.length > 400) return falha('invalido')
        const existente = draft.ignorados.find((item) => item.chave === texto)
        if (existente) return intacto(existente)
        const ignorado: SugestaoIgnorada = { chave: texto, em: at }
        draft.ignorados.push(ignorado)
        // No limite, sai a mais antiga: as sugestões só olham 30 dias para trás.
        if (draft.ignorados.length > TAREFAS_IGNORADOS_MAX) draft.ignorados.splice(0, draft.ignorados.length - TAREFAS_IGNORADOS_MAX)
        return certo(ignorado)
      }),

    marcarLembreteDisparado: (ids, at) =>
      mutate((draft) => {
        if (!Array.isArray(ids) || !instante(at)) return falha('invalido')
        const pedidos = new Set(ids)
        const marcados: string[] = []
        for (const tarefa of draft.tarefas) {
          if (!pedidos.has(tarefa.id)) continue
          // Só o lembrete que ainda está valendo: entre a leitura do tick e a marcação a pessoa pode ter fechado a
          // tarefa ou trocado o `lembreteEm`, e o aviso novo não pode ficar marcado como já disparado.
          if (tarefa.status !== 'aberta' || tarefa.lembreteEm === null || tarefa.lembreteEm > at || tarefa.lembreteDisparadoEm !== null) continue
          tarefa.lembreteDisparadoEm = at
          marcados.push(tarefa.id)
        }
        return marcados.length ? certo(marcados) : intacto(marcados)
      }),

    marcarAvisoHoje: (at) =>
      mutate((draft) => {
        if (!instante(at)) return falha('invalido')
        draft.ultimoAvisoHojeEm = at
        return certo(at)
      }),

    aplicarMigracao: (novas, at) =>
      mutate((draft) => {
        if (!instante(at)) return falha('invalido')
        const result = anexar(draft, novas, at)
        if (!result.ok) return result
        draft.migradoEm = at
        return result
      }),

    reverterMigracao: (anterior) =>
      serial(async () => {
        if (anterior === null) {
          await rm(file, { force: true })
          cache = vazio()
          return resultado(null, cache)
        }
        const valid = tarefasArquivoSchema.safeParse(anterior)
        if (!valid.success) return falha('invalido')
        await mkdir(dir, { recursive: true })
        await atomicWrite(file, valid.data)
        cache = valid.data
        return resultado(null, valid.data)
      }),
  }
}
