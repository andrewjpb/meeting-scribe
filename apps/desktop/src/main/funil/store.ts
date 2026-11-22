// Funil de vendas (contrato 107, D1): o store de `userData/funil.json`. Um arquivo só para contatos, empresas,
// oportunidades, etapas e histórico, para que as operações que cruzam entidades sejam atômicas. Gravação como
// `schedules/store.ts`: fila serial, temporário + `rename`, `0o600`; cada mutação grava o arquivo inteiro e devolve
// `FunilResult`. Antes da primeira gravação de cada dia, cópia `funil.json.bak-<AAAA-MM-DD>` (as 7 mais recentes,
// R1). Arquivo inválido vira `funil.json.corrupt-<stamp>` e o funil parte vazio (R2). O log não leva dado de
// contato. Sem Electron.
//
// Contrato 124 (D9 a D11): o próximo passo não é mais gravado (vem das tarefas); `registrarTarefa` grava o evento
// `tarefa` (R10) e os adaptadores da migração R35 (`legado`, `backupMigracao`, `limparLegado`, `restaurarMigracao`)
// ficam aqui, chamados só por `main/tarefas/migracao.ts` pelo `index.ts`.
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FUNIL_BACKUPS_MAX,
  FUNIL_CONTATOS_MAX,
  FUNIL_EMAILS_MAX,
  FUNIL_EMPRESAS_MAX,
  FUNIL_ETAPA_NOME_MAX,
  FUNIL_EVENTOS_MAX,
  FUNIL_FILE,
  FUNIL_NOME_MAX,
  FUNIL_NOTAS_MAX,
  FUNIL_OPORTUNIDADE_EMAILS_MAX,
  FUNIL_OPORTUNIDADES_MAX,
  FUNIL_TELEFONES_MAX,
  FUNIL_VERSION,
  type Contato,
  type ContatoInput,
  type ContatoOrigem,
  type Empresa,
  type EmpresaInput,
  type Etapa,
  type EtapaInput,
  type EventoFunil,
  type EventoFunilTipo,
  type FunilErro,
  type FunilResult,
  type FunilState,
  type Ignorado,
  type Oportunidade,
  type OportunidadeInput,
} from '../../shared/funil'
import { chaveTelefone, ehProvedorPessoal, dominioDe, etapasPadrao, formatarBRL, normalizarEmail, normalizarTelefone, semAcento } from '../../shared/funil-logic'
import { funilStateSchema } from '../../shared/funil-schema'
import type { EventoOportunidade } from '../../shared/tarefas'
import type { PassoLegado } from '../tarefas/migracao'

export interface FunilStore {
  /** Cópia do estado; arquivo ausente vale o funil vazio com as etapas padrão (sem gravar). */
  read(): Promise<FunilState>
  /** Cria (sem `id`) ou edita. Criar com e-mail ou telefone de outro contato mescla nele (R4, `mesclado: true`). */
  saveContato(input: ContatoInput, origem: ContatoOrigem): Promise<FunilResult<{ contato: Contato; mesclado: boolean }>>
  arquivarContato(id: string): Promise<FunilResult<Contato>>
  saveEmpresa(input: EmpresaInput): Promise<FunilResult<Empresa>>
  deleteEmpresa(id: string): Promise<FunilResult<null>>
  saveOportunidade(input: OportunidadeInput): Promise<FunilResult<Oportunidade>>
  /** Muda de etapa e/ou de posição na coluna (R6). */
  moverOportunidade(input: { id: string; etapaId: string; ordem: number; motivoPerda?: string | null | undefined }): Promise<FunilResult<Oportunidade>>
  /** Só em etapa `ganho` ou `perdido` (R27). */
  arquivarOportunidade(id: string): Promise<FunilResult<Oportunidade>>
  /** Apaga a oportunidade e o histórico dela. */
  deleteOportunidade(id: string): Promise<FunilResult<null>>
  saveEtapas(lista: EtapaInput[]): Promise<FunilResult<Etapa[]>>
  addEvento(input: { oportunidadeId: string; tipo: 'nota'; texto: string }): Promise<FunilResult<EventoFunil>>
  ignorar(chave: string): Promise<FunilResult<Ignorado>>
  /** Uma escrita só; cada entrada pela regra de `saveContato` (a que não passa fica de fora). */
  importarContatos(entradas: ContatoInput[], origem: ContatoOrigem): Promise<FunilResult<{ criados: number; atualizados: number }>>
  setUltimoAviso(at: number): Promise<FunilResult<number>>
  /** Contrato 124 (R10): o evento `tarefa` da oportunidade (`texto` = o título) e `atualizadoEm` (conta como interação). */
  registrarTarefa(input: EventoOportunidade): Promise<FunilResult<EventoFunil>>
  /** Migração R35: as oportunidades com `proximoPasso` gravado; `aberta` = etapa aberta e não arquivada. */
  legado(): Promise<PassoLegado[]>
  /** Migração R35: copia `funil.json` para `funil.json.bak-tarefas-<AAAA-MM-DD>` (0600); sem arquivo, nada. */
  backupMigracao(): Promise<void>
  /** Migração R35: tira a chave `proximoPasso` de todas as oportunidades, numa escrita. */
  limparLegado(): Promise<void>
  /** Migração R35: volta `funil.json` da cópia feita por `backupMigracao` e esquece o cache. */
  restaurarMigracao(): Promise<void>
}

export interface FunilStoreOptions {
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

type Passo<T> = { ok: true; value: T } | { ok: false; erro: FunilErro }

const certo = <T>(value: T): Passo<T> => ({ ok: true, value })
const falha = (erro: FunilErro): { ok: false; erro: FunilErro } => ({ ok: false, erro })

const codigo = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined)

const DIA = /^\d{4}-\d{2}-\d{2}$/
const BACKUP_PREFIXO = `${FUNIL_FILE}.bak-`
/** Contrato 124: a cópia de antes da migração R35 (`funil.json.bak-tarefas-<AAAA-MM-DD>`), fora da rotação das 7. */
const BACKUP_MIGRACAO_PREFIXO = `${FUNIL_FILE}.bak-tarefas-`
const ACOES_TAREFA: readonly string[] = ['criada', 'feita', 'prazo']

/** `AAAA-MM-DD` no fuso do Mac. */
function diaLocal(at: number): string {
  const data = new Date(at)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

/** Texto aparado; vazio ou ausente vira `null`. */
const opcional = (texto: string | null | undefined): string | null => (typeof texto === 'string' && texto.trim() ? texto.trim() : null)

const unicos = (lista: readonly (string | null)[]): string[] => [...new Set(lista.filter((item): item is string => item !== null))]

/** Normaliza (R3), descarta o que não é telefone e tira os repetidos pela regra do nono dígito. */
function telefonesUnicos(lista: readonly string[]): string[] {
  const vistos = new Set<string>()
  const telefones: string[] = []
  for (const texto of lista) {
    const telefone = typeof texto === 'string' ? normalizarTelefone(texto) : null
    if (telefone === null || vistos.has(chaveTelefone(telefone))) continue
    vistos.add(chaveTelefone(telefone))
    telefones.push(telefone)
  }
  return telefones
}

/** Chaves de busca de um contato: `e:<email>` e `t:<telefone sem o nono dígito>`. */
const chavesDe = (emails: readonly string[], telefones: readonly string[]): string[] => [
  ...emails.map((email) => `e:${email}`),
  ...telefones.map((telefone) => `t:${chaveTelefone(normalizarTelefone(telefone) ?? telefone)}`),
]

/** Nome comparável de empresa: sem acento, sem caixa e com espaços simples (D20). */
const chaveNome = (nome: string): string => semAcento(nome).trim().replace(/\s+/g, ' ').toLowerCase()

/** Índices da mutação em curso (importação de 10 000 linhas não pode comparar cada uma com todos). */
interface Indice {
  contatos: Map<string, Contato>
  empresasPorNome: Map<string, Empresa>
  empresasPorDominio: Map<string, Empresa>
}

function indexar(state: FunilState): Indice {
  const indice: Indice = { contatos: new Map(), empresasPorNome: new Map(), empresasPorDominio: new Map() }
  for (const contato of state.contatos) indexarContato(indice, contato)
  for (const empresa of state.empresas) indexarEmpresa(indice, empresa)
  return indice
}

function indexarContato(indice: Indice, contato: Contato): void {
  for (const chave of chavesDe(contato.emails, contato.telefones)) if (!indice.contatos.has(chave)) indice.contatos.set(chave, contato)
}

function indexarEmpresa(indice: Indice, empresa: Empresa): void {
  const nome = chaveNome(empresa.nome)
  if (!indice.empresasPorNome.has(nome)) indice.empresasPorNome.set(nome, empresa)
  for (const dominio of empresa.dominios) if (!indice.empresasPorDominio.has(dominio)) indice.empresasPorDominio.set(dominio, empresa)
}

/** O que passaria de um limite de "Modelo de dados". */
function excedeLimite(state: FunilState): boolean {
  if (state.contatos.length > FUNIL_CONTATOS_MAX || state.empresas.length > FUNIL_EMPRESAS_MAX) return true
  if (state.oportunidades.length > FUNIL_OPORTUNIDADES_MAX || state.eventos.length > FUNIL_EVENTOS_MAX) return true
  if (state.contatos.some((c) => c.emails.length > FUNIL_EMAILS_MAX || c.telefones.length > FUNIL_TELEFONES_MAX || c.notas.length > FUNIL_NOTAS_MAX)) return true
  if (state.empresas.some((e) => e.dominios.length > FUNIL_EMAILS_MAX || e.notas.length > FUNIL_NOTAS_MAX)) return true
  return state.oportunidades.some((o) => [o.emails, o.contatoIds, o.meetingIds, o.whatsappChatIds].some((lista) => lista.length > FUNIL_OPORTUNIDADE_EMAILS_MAX))
}

const valorValido = (valor: number | null): boolean => valor === null || (Number.isSafeInteger(valor) && valor >= 0)
const diaValido = (dia: string | null): boolean => dia === null || (typeof dia === 'string' && DIA.test(dia))

const unicosEmails = (emails: Oportunidade['emails']): Oportunidade['emails'] => {
  const vistos = new Set<string>()
  return emails.filter((email) => {
    const chave = `${email.accountId}\n${email.id}`
    if (vistos.has(chave)) return false
    vistos.add(chave)
    return true
  })
}

export function createFunilStore({ dir, now = Date.now, newId = randomUUID, log = () => undefined }: FunilStoreOptions): FunilStore {
  const file = join(dir, FUNIL_FILE)
  const serial = serialQueue()
  let cache: FunilState | null = null
  /** Dia em que a cópia diária já foi conferida. */
  let backupConferido: string | null = null
  /** A cópia da migração R35 feita nesta execução (o `restaurarMigracao` volta dela). */
  let copiaMigracao: string | null = null

  const vazio = (): FunilState => ({ version: FUNIL_VERSION, contatos: [], empresas: [], oportunidades: [], etapas: etapasPadrao(newId), eventos: [], ignorados: [], ultimoAvisoEm: null })

  async function load(): Promise<FunilState> {
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
    const content = funilStateSchema.safeParse(parsed)
    if (content.success) {
      cache = content.data
      return cache
    }
    // Nunca sobrescrever o inválido: sem o `rename`, a leitura falha e nada é gravado por cima.
    const stamp = now()
    await rename(file, `${file}.corrupt-${stamp}`)
    log(`[funil] ${FUNIL_FILE} inválido; guardado como ${FUNIL_FILE}.corrupt-${stamp} e o funil parte vazio`)
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
    for (const nome of copias.slice(0, Math.max(0, copias.length - FUNIL_BACKUPS_MAX))) await rm(join(dir, nome), { force: true })
    backupConferido = dia
  }

  /** Lê, muda uma cópia e, se a mudança passa nos limites e no esquema, grava o arquivo inteiro na mesma vez da fila. */
  function mutate<T>(fn: (draft: FunilState, at: number) => Passo<T>): Promise<FunilResult<T>> {
    return serial(async () => {
      const draft = structuredClone(await load())
      const at = now()
      const result = fn(draft, at)
      if (!result.ok) return result
      if (excedeLimite(draft)) return falha('limite')
      const valid = funilStateSchema.safeParse(draft)
      if (!valid.success) {
        log(`[funil] alteração fora do formato (${valid.error.issues[0]?.path.join('.') ?? '?'}); nada gravado`)
        return falha('invalido')
      }
      await mkdir(dir, { recursive: true })
      await backupDoDia(at)
      await atomicWrite(file, draft)
      cache = draft
      const out = structuredClone({ value: result.value, state: draft })
      return { ok: true, value: out.value, state: out.state }
    })
  }

  function evento(draft: FunilState, oportunidadeId: string, at: number, tipo: EventoFunilTipo, texto: string, extra: Pick<EventoFunil, 'de' | 'para' | 'tarefa'> = {}): EventoFunil {
    const novo: EventoFunil = { id: newId(), oportunidadeId, at, tipo, texto, ...extra }
    draft.eventos.push(novo)
    return novo
  }

  /**
   * Empresa pedida pela entrada: `empresaId` precisa existir; `empresaNome` acha pelo nome sem acento e sem caixa ou
   * cria (D20); `empresaId: null` é "sem empresa". `undefined` quando a entrada não diz nada.
   */
  function empresaDaEntrada(
    draft: FunilState,
    indice: Indice,
    input: { empresaId?: string | null | undefined; empresaNome?: string | null | undefined },
    at: number,
  ): Passo<string | null | undefined> {
    if (typeof input.empresaId === 'string') return draft.empresas.some((empresa) => empresa.id === input.empresaId) ? certo(input.empresaId) : falha('nao-encontrado')
    const nome = opcional(input.empresaNome)
    if (nome !== null) {
      if (nome.length > FUNIL_NOME_MAX) return falha('invalido')
      const existente = indice.empresasPorNome.get(chaveNome(nome))
      if (existente) return certo(existente.id)
      const empresa: Empresa = { id: newId(), nome, dominios: [], site: null, notas: '', criadoEm: at, atualizadoEm: at }
      draft.empresas.push(empresa)
      indexarEmpresa(indice, empresa)
      return certo(empresa.id)
    }
    return certo(input.empresaId === null ? null : undefined)
  }

  /** Empresa pelo domínio do primeiro e-mail que não é de provedor pessoal (R5). */
  function empresaPorDominios(indice: Indice, emails: readonly string[]): string | null {
    for (const email of emails) {
      const dominio = dominioDe(email)
      if (!dominio || ehProvedorPessoal(dominio)) continue
      const empresa = indice.empresasPorDominio.get(dominio)
      if (empresa) return empresa.id
    }
    return null
  }

  /** A regra de `saveContato`, sobre o rascunho da mutação. */
  function aplicarContato(draft: FunilState, indice: Indice, input: ContatoInput, origem: ContatoOrigem, at: number): Passo<{ contato: Contato; mesclado: boolean }> {
    if (typeof input.nome !== 'string' || !Array.isArray(input.emails) || !Array.isArray(input.telefones)) return falha('invalido')
    const nome = input.nome.trim()
    if (!nome || nome.length > FUNIL_NOME_MAX) return falha('invalido')
    const emails = unicos(input.emails.map((email) => (typeof email === 'string' ? normalizarEmail(email) : null)))
    const telefones = telefonesUnicos(input.telefones)
    const chaves = chavesDe(emails, telefones)

    if (input.id !== undefined) {
      const contato = draft.contatos.find((item) => item.id === input.id)
      if (!contato) return falha('nao-encontrado')
      const deOutro = (chave: string): boolean => {
        const dono = indice.contatos.get(chave)
        return dono !== undefined && dono !== contato
      }
      if (chaves.some(deOutro)) return falha('duplicado')
      const empresa = empresaDaEntrada(draft, indice, input, at)
      if (!empresa.ok) return empresa
      for (const chave of chavesDe(contato.emails, contato.telefones)) if (indice.contatos.get(chave) === contato) indice.contatos.delete(chave)
      contato.nome = nome
      contato.emails = emails
      contato.telefones = telefones
      indexarContato(indice, contato)
      if (empresa.value !== undefined) contato.empresaId = empresa.value
      else if (contato.empresaId === null) contato.empresaId = empresaPorDominios(indice, emails)
      if (input.cargo !== undefined) contato.cargo = opcional(input.cargo)
      if (input.notas !== undefined) contato.notas = input.notas
      if (input.whatsappChatId !== undefined) contato.whatsappChatId = opcional(input.whatsappChatId)
      contato.atualizadoEm = at
      return certo({ contato, mesclado: false })
    }

    if (emails.length === 0 && telefones.length === 0) return falha('invalido')
    const existente = chaves.map((chave) => indice.contatos.get(chave)).find((contato) => contato !== undefined)
    if (existente) {
      // R4: acrescenta o que falta, nunca troca nome, notas nem campo preenchido; arquivado volta.
      const empresa = existente.empresaId === null ? empresaDaEntrada(draft, indice, input, at) : certo(undefined)
      if (!empresa.ok) return empresa
      // E-mail ou telefone que já é de outro contato fica só com o dono.
      const deOutro = (chave: string): boolean => {
        const dono = indice.contatos.get(chave)
        return dono !== undefined && dono !== existente
      }
      for (const email of emails) {
        if (existente.emails.length >= FUNIL_EMAILS_MAX) break
        if (!existente.emails.includes(email) && !deOutro(`e:${email}`)) existente.emails.push(email)
      }
      for (const telefone of telefones) {
        if (existente.telefones.length >= FUNIL_TELEFONES_MAX) break
        if (!existente.telefones.some((conhecido) => chaveTelefone(conhecido) === chaveTelefone(telefone)) && !deOutro(`t:${chaveTelefone(telefone)}`)) existente.telefones.push(telefone)
      }
      indexarContato(indice, existente)
      existente.empresaId ??= empresa.value ?? empresaPorDominios(indice, existente.emails)
      existente.cargo ??= opcional(input.cargo)
      existente.whatsappChatId ??= opcional(input.whatsappChatId)
      existente.arquivado = false
      existente.atualizadoEm = at
      return certo({ contato: existente, mesclado: true })
    }

    const empresa = empresaDaEntrada(draft, indice, input, at)
    if (!empresa.ok) return empresa
    const contato: Contato = {
      id: newId(),
      nome,
      emails,
      telefones,
      empresaId: empresa.value ?? empresaPorDominios(indice, emails),
      cargo: opcional(input.cargo),
      notas: input.notas ?? '',
      whatsappChatId: opcional(input.whatsappChatId),
      origem,
      criadoEm: at,
      atualizadoEm: at,
      arquivado: false,
    }
    draft.contatos.push(contato)
    indexarContato(indice, contato)
    return certo({ contato, mesclado: false })
  }

  /** Cartões visíveis da coluna, em ordem (arquivada não ocupa lugar). */
  const coluna = (draft: FunilState, etapaId: string): Oportunidade[] =>
    draft.oportunidades.filter((item) => item.etapaId === etapaId && !item.arquivado).sort((a, b) => a.ordem - b.ordem)

  function renumerar(lista: Oportunidade[]): void {
    for (const [ordem, item] of lista.entries()) item.ordem = ordem
  }

  /** Põe a oportunidade na posição `ordem` da coluna e renumera a coluna. */
  function inserir(draft: FunilState, oportunidade: Oportunidade, etapaId: string, ordem: number): void {
    const lista = coluna(draft, etapaId).filter((item) => item !== oportunidade)
    lista.splice(Math.max(0, Math.min(Math.trunc(ordem), lista.length)), 0, oportunidade)
    oportunidade.etapaId = etapaId
    renumerar(lista)
  }

  /** R6: muda de etapa (evento `etapa`, `movidoEm`, `fechadoEm`, `reaberta`) ou só de posição. */
  function mover(draft: FunilState, oportunidade: Oportunidade, destino: Etapa, ordem: number, motivoPerda: string | null | undefined, at: number): void {
    const origem = draft.etapas.find((etapa) => etapa.id === oportunidade.etapaId)
    if (origem?.id === destino.id) {
      if (!oportunidade.arquivado) inserir(draft, oportunidade, destino.id, ordem)
      return
    }
    renumerar(coluna(draft, oportunidade.etapaId).filter((item) => item !== oportunidade))
    const reaberta = destino.tipo === 'aberta' && origem !== undefined && origem.tipo !== 'aberta'
    // Arquivada só existe em etapa fechada (R27): reabrir traz de volta ao kanban.
    if (reaberta) oportunidade.arquivado = false
    if (oportunidade.arquivado) oportunidade.etapaId = destino.id
    else inserir(draft, oportunidade, destino.id, ordem)
    oportunidade.movidoEm = at
    oportunidade.atualizadoEm = at
    const de = origem?.nome ?? ''
    evento(draft, oportunidade.id, at, 'etapa', `${de} → ${destino.nome}`, { de, para: destino.nome })
    if (destino.tipo !== 'aberta') {
      oportunidade.fechadoEm = at
      oportunidade.motivoPerda = destino.tipo === 'perdido' ? opcional(motivoPerda) : null
    } else if (reaberta) {
      oportunidade.fechadoEm = null
      oportunidade.motivoPerda = null
      evento(draft, oportunidade.id, at, 'reaberta', `Reaberta em ${destino.nome}`)
    }
  }

  return {
    read: () => serial(async () => structuredClone(await load())),

    saveContato: (input, origem) => mutate((draft, at) => aplicarContato(draft, indexar(draft), input, origem, at)),

    arquivarContato: (id) =>
      mutate((draft, at) => {
        const contato = draft.contatos.find((item) => item.id === id)
        if (!contato) return falha('nao-encontrado')
        contato.arquivado = true
        contato.atualizadoEm = at
        return certo(contato)
      }),

    saveEmpresa: (input) =>
      mutate((draft, at) => {
        if (typeof input.nome !== 'string' || !Array.isArray(input.dominios)) return falha('invalido')
        const nome = input.nome.trim()
        if (!nome || nome.length > FUNIL_NOME_MAX) return falha('invalido')
        const dominios = unicos(input.dominios.map((dominio) => (typeof dominio === 'string' ? opcional(dominio.slice(dominio.lastIndexOf('@') + 1))?.toLowerCase() ?? null : null)))
        if (input.id === undefined) {
          const empresa: Empresa = { id: newId(), nome, dominios, site: opcional(input.site), notas: input.notas ?? '', criadoEm: at, atualizadoEm: at }
          draft.empresas.push(empresa)
          return certo(empresa)
        }
        const empresa = draft.empresas.find((item) => item.id === input.id)
        if (!empresa) return falha('nao-encontrado')
        empresa.nome = nome
        empresa.dominios = dominios
        if (input.site !== undefined) empresa.site = opcional(input.site)
        if (input.notas !== undefined) empresa.notas = input.notas
        empresa.atualizadoEm = at
        return certo(empresa)
      }),

    deleteEmpresa: (id) =>
      mutate((draft) => {
        if (!draft.empresas.some((empresa) => empresa.id === id)) return falha('nao-encontrado')
        if (draft.contatos.some((contato) => contato.empresaId === id) || draft.oportunidades.some((item) => item.empresaId === id)) return falha('empresa-em-uso')
        draft.empresas = draft.empresas.filter((empresa) => empresa.id !== id)
        return certo(null)
      }),

    saveOportunidade: (input) =>
      mutate((draft, at) => {
        if (typeof input.titulo !== 'string') return falha('invalido')
        const titulo = input.titulo.trim()
        if (!titulo || titulo.length > FUNIL_NOME_MAX) return falha('invalido')
        if (input.valor !== undefined && !valorValido(input.valor)) return falha('invalido')
        if (input.previsao !== undefined && !diaValido(input.previsao)) return falha('invalido')
        // Contrato 124 (D9): `input.proximoPasso` é ignorado aqui; o serviço do funil o transforma em tarefa.
        const contatoIds = input.contatoIds === undefined ? undefined : unicos(input.contatoIds)
        if (contatoIds && !contatoIds.every((id) => draft.contatos.some((contato) => contato.id === id))) return falha('nao-encontrado')
        const empresa = empresaDaEntrada(draft, indexar(draft), input, at)
        if (!empresa.ok) return empresa

        if (input.id === undefined) {
          const etapa =
            input.etapaId === undefined
              ? draft.etapas.filter((item) => item.tipo === 'aberta').sort((a, b) => a.ordem - b.ordem)[0]
              : draft.etapas.find((item) => item.id === input.etapaId)
          if (!etapa) return input.etapaId === undefined ? falha('invalido') : falha('nao-encontrado')
          const valor = input.valor ?? null
          const oportunidade: Oportunidade = {
            id: newId(),
            titulo,
            empresaId: empresa.value ?? null,
            contatoIds: contatoIds ?? [],
            etapaId: etapa.id,
            ordem: 0,
            valor,
            previsao: input.previsao ?? null,
            meetingIds: unicos(input.meetingIds ?? []),
            whatsappChatIds: unicos(input.whatsappChatIds ?? []),
            emails: unicosEmails(input.emails ?? []),
            origem: input.origem ?? 'manual',
            motivoPerda: etapa.tipo === 'perdido' ? opcional(input.motivoPerda) : null,
            criadoEm: at,
            atualizadoEm: at,
            movidoEm: at,
            fechadoEm: etapa.tipo === 'aberta' ? null : at,
            arquivado: false,
          }
          draft.oportunidades.push(oportunidade)
          inserir(draft, oportunidade, etapa.id, 0)
          evento(draft, oportunidade.id, at, 'criada', `Criada em ${etapa.nome}`)
          if (valor !== null) evento(draft, oportunidade.id, at, 'valor', formatarBRL(valor))
          return certo(oportunidade)
        }

        const oportunidade = draft.oportunidades.find((item) => item.id === input.id)
        if (!oportunidade) return falha('nao-encontrado')
        const destino = input.etapaId === undefined || input.etapaId === oportunidade.etapaId ? null : draft.etapas.find((item) => item.id === input.etapaId)
        if (destino === undefined) return falha('nao-encontrado')
        oportunidade.titulo = titulo
        if (empresa.value !== undefined) oportunidade.empresaId = empresa.value
        if (contatoIds) oportunidade.contatoIds = contatoIds
        if (input.valor !== undefined && input.valor !== oportunidade.valor) {
          oportunidade.valor = input.valor
          evento(draft, oportunidade.id, at, 'valor', formatarBRL(input.valor))
        }
        if (input.previsao !== undefined) oportunidade.previsao = input.previsao
        if (input.meetingIds !== undefined) oportunidade.meetingIds = unicos(input.meetingIds)
        if (input.whatsappChatIds !== undefined) oportunidade.whatsappChatIds = unicos(input.whatsappChatIds)
        if (input.emails !== undefined) oportunidade.emails = unicosEmails(input.emails)
        if (input.motivoPerda !== undefined) oportunidade.motivoPerda = opcional(input.motivoPerda)
        oportunidade.atualizadoEm = at
        if (destino) mover(draft, oportunidade, destino, 0, input.motivoPerda, at)
        return certo(oportunidade)
      }),

    moverOportunidade: ({ id, etapaId, ordem, motivoPerda }) =>
      mutate((draft, at) => {
        if (typeof ordem !== 'number' || Number.isNaN(ordem)) return falha('invalido')
        const oportunidade = draft.oportunidades.find((item) => item.id === id)
        const destino = draft.etapas.find((etapa) => etapa.id === etapaId)
        if (!oportunidade || !destino) return falha('nao-encontrado')
        mover(draft, oportunidade, destino, ordem, motivoPerda, at)
        return certo(oportunidade)
      }),

    arquivarOportunidade: (id) =>
      mutate((draft, at) => {
        const oportunidade = draft.oportunidades.find((item) => item.id === id)
        if (!oportunidade) return falha('nao-encontrado')
        const etapa = draft.etapas.find((item) => item.id === oportunidade.etapaId)
        if (!etapa || etapa.tipo === 'aberta') return falha('nao-fechada')
        oportunidade.arquivado = true
        oportunidade.atualizadoEm = at
        renumerar(coluna(draft, etapa.id))
        return certo(oportunidade)
      }),

    deleteOportunidade: (id) =>
      mutate((draft) => {
        const oportunidade = draft.oportunidades.find((item) => item.id === id)
        if (!oportunidade) return falha('nao-encontrado')
        draft.oportunidades = draft.oportunidades.filter((item) => item !== oportunidade)
        draft.eventos = draft.eventos.filter((item) => item.oportunidadeId !== id)
        renumerar(coluna(draft, oportunidade.etapaId))
        return certo(null)
      }),

    saveEtapas: (lista) =>
      mutate((draft) => {
        if (!Array.isArray(lista)) return falha('invalido')
        // Ganho e Perdido: os mesmos ids e tipos, e nenhuma outra etapa final.
        const ganho = draft.etapas.find((etapa) => etapa.tipo === 'ganho')
        const perdido = draft.etapas.find((etapa) => etapa.tipo === 'perdido')
        const ganhoItem = ganho && lista.find((item) => item.id === ganho.id && item.tipo === 'ganho')
        const perdidoItem = perdido && lista.find((item) => item.id === perdido.id && item.tipo === 'perdido')
        if (!ganhoItem || !perdidoItem || lista.filter((item) => item.tipo !== 'aberta').length !== 2) return falha('etapa-fixa')
        const ids = lista.map((item) => item.id).filter((id) => id !== undefined)
        if (new Set(ids).size !== ids.length) return falha('invalido')
        const nomes = lista.map((item) => (typeof item.nome === 'string' ? item.nome.trim() : ''))
        if (nomes.some((nome) => !nome || nome.length > FUNIL_ETAPA_NOME_MAX)) return falha('invalido')
        const abertas = lista.filter((item) => item.tipo === 'aberta')
        if (abertas.length === 0) return falha('invalido')
        if (!ids.every((id) => draft.etapas.some((etapa) => etapa.id === id))) return falha('nao-encontrado')
        const removidas = draft.etapas.filter((etapa) => !ids.includes(etapa.id))
        if (removidas.some((etapa) => draft.oportunidades.some((item) => item.etapaId === etapa.id))) return falha('etapa-em-uso')
        // As abertas na ordem da lista, depois Ganho e Perdido.
        draft.etapas = [...abertas, ganhoItem, perdidoItem].map((item, ordem) => ({ id: item.id ?? newId(), nome: item.nome.trim(), tipo: item.tipo, ordem }))
        return certo(draft.etapas)
      }),

    addEvento: ({ oportunidadeId, tipo, texto }) =>
      mutate((draft, at) => {
        const nota = typeof texto === 'string' ? texto.trim() : ''
        if (tipo !== 'nota' || !nota || nota.length > FUNIL_NOTAS_MAX) return falha('invalido')
        const oportunidade = draft.oportunidades.find((item) => item.id === oportunidadeId)
        if (!oportunidade) return falha('nao-encontrado')
        oportunidade.atualizadoEm = at
        return certo(evento(draft, oportunidadeId, at, 'nota', nota))
      }),

    ignorar: (chave) =>
      mutate((draft, at) => {
        const texto = typeof chave === 'string' ? chave.trim() : ''
        if (!texto || texto.length > 400) return falha('invalido')
        const existente = draft.ignorados.find((item) => item.chave === texto)
        if (existente) return certo(existente)
        const ignorado: Ignorado = { chave: texto, at }
        draft.ignorados.push(ignorado)
        return certo(ignorado)
      }),

    importarContatos: (entradas, origem) =>
      mutate((draft, at) => {
        if (!Array.isArray(entradas)) return falha('invalido')
        const indice = indexar(draft)
        let criados = 0
        let atualizados = 0
        for (const entrada of entradas) {
          const result = aplicarContato(draft, indice, entrada, origem, at)
          if (!result.ok) continue
          if (result.value.mesclado || entrada.id !== undefined) atualizados++
          else criados++
        }
        return certo({ criados, atualizados })
      }),

    setUltimoAviso: (at) =>
      mutate((draft) => {
        if (typeof at !== 'number' || !Number.isFinite(at)) return falha('invalido')
        draft.ultimoAvisoEm = at
        return certo(at)
      }),

    registrarTarefa: ({ oportunidadeId, tarefaId, acao, titulo }) =>
      mutate((draft, at) => {
        if (typeof tarefaId !== 'string' || !tarefaId || tarefaId.length > 200 || !ACOES_TAREFA.includes(acao) || typeof titulo !== 'string') return falha('invalido')
        const oportunidade = draft.oportunidades.find((item) => item.id === oportunidadeId)
        if (!oportunidade) return falha('nao-encontrado')
        oportunidade.atualizadoEm = at
        return certo(evento(draft, oportunidade.id, at, 'tarefa', titulo.slice(0, FUNIL_NOTAS_MAX), { tarefa: { id: tarefaId, acao } }))
      }),

    legado: () =>
      serial(async () => {
        const state = await load()
        const tipos = new Map(state.etapas.map((etapa) => [etapa.id, etapa.tipo]))
        const passos: PassoLegado[] = []
        for (const oportunidade of state.oportunidades) {
          const passo = oportunidade.proximoPasso
          if (!passo) continue
          passos.push({
            oportunidadeId: oportunidade.id,
            texto: passo.texto,
            data: passo.data,
            aberta: !oportunidade.arquivado && tipos.get(oportunidade.etapaId) === 'aberta',
            contatoIds: [...oportunidade.contatoIds],
            empresaId: oportunidade.empresaId,
          })
        }
        return passos
      }),

    backupMigracao: () =>
      serial(async () => {
        let atual: Buffer
        try {
          atual = await readFile(file)
        } catch (error) {
          if (codigo(error) === 'ENOENT') return
          throw error
        }
        const nome = `${BACKUP_MIGRACAO_PREFIXO}${diaLocal(now())}`
        await atomicCopy(nome, atual)
        copiaMigracao = nome
      }),

    limparLegado: async () => {
      const result = await mutate((draft) => {
        for (const oportunidade of draft.oportunidades) delete oportunidade.proximoPasso
        return certo(null)
      })
      if (!result.ok) throw new Error(`limpeza do próximo passo recusada (${result.erro})`)
    },

    restaurarMigracao: () =>
      serial(async () => {
        if (copiaMigracao === null) throw new Error('sem a cópia da migração')
        await atomicCopy(FUNIL_FILE, await readFile(join(dir, copiaMigracao)))
        cache = null
      }),
  }

  /** Grava os bytes em `dir/<nome>` (temporário + `rename`, 0600). */
  async function atomicCopy(nome: string, bytes: Buffer): Promise<void> {
    const destino = join(dir, nome)
    const temp = `${destino}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, bytes, { mode: 0o600 })
    await rename(temp, destino)
  }
}
