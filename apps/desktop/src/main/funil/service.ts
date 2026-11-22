// Serviço do funil de vendas (contrato 110, D3): as gravações pelo store, as sugestões de contato (R11, R12), a linha
// do tempo (R8 a R10, R29), a última interação de cada oportunidade (R7) e a importação de contatos (R13 a R16).
// Os outros domínios entram só pelas dependências e só pelos caches que os serviços já mantêm (`email.cached()`,
// `whatsapp.chats()`, `meetings.list()`, `summaries.get()`): nenhum arquivo de e-mail ou WhatsApp é aberto aqui,
// nada é escrito neles e não há timer. Sugestões e linha do tempo são calculadas quando o canal delas é chamado;
// `ultimas` só em `view()` e depois de cada gravação bem-sucedida (para o `onChange`). Domínio desligado ou com
// falha vale lista vazia.
//
// Contrato 124 (D8): as tarefas entram só por `deps.tarefas` (closures do `index.ts`, sem dependência circular). A view
// traz o próximo passo derivado delas (`proximosPassos`), o passo que chega em `oportunidadeSave` vira tarefa, o
// evento `tarefa` (R10) é gravado por `registrarTarefa` e a linha do tempo mostra as tarefas (R18). Título de tarefa
// nunca vai ao log.
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { EmailMessage } from '../../shared/email'
import type { Meeting } from '../../shared/meetings'
import {
  FUNIL_ERRO_TEXTO,
  FUNIL_EXPIRADO_TEXTO,
  type ContatoInput,
  type ContatoOrigem,
  type EmpresaInput,
  type EtapaInput,
  type FunilActionResult,
  type FunilImportAbrirResult,
  type FunilImportConfirmarResult,
  type FunilResult,
  type FunilState,
  type FunilTimelineResult,
  type FunilView,
  type ItemLinhaDoTempo,
  type OportunidadeInput,
  type ProximoPassoDerivado,
  type Sugestao,
} from '../../shared/funil'
import { aplicarMapeamento, IMPORT_BYTES_MAX, lerArquivo, type CampoImport, type EntradaImport, type LeituraImport } from '../../shared/funil-import'
import { sugestoesDeContato } from '../../shared/funil-sugestoes'
import { timelineDaOportunidade, timelineDoContato, ultimasInteracoes } from '../../shared/funil-timeline'
import { TAREFA_TITULO_MAX, TAREFAS_FALHOU_TEXTO, type EventoOportunidade, type Tarefa, type TarefaInput, type TarefaSalvar, type TarefasActionResult } from '../../shared/tarefas'
import { diaValido, proximaDaOportunidade } from '../../shared/tarefas-logic'
import type { WhatsAppChat, WhatsAppMe } from '../../shared/whatsapp'
import type { MeetingsStore } from '../meetings/store'
import type { SummaryStore } from '../meetings/summaries'
import type { FunilStore } from './store'

/** Colunas fixas da prévia do vCard (não há mapeamento a escolher, R15). */
export const VCARD_COLUNAS = ['Nome', 'E-mail', 'Telefone', 'Empresa', 'Cargo']
const VCARD_MAPEAMENTO: CampoImport[] = ['nome', 'email', 'telefone', 'empresa', 'cargo']
/** Uma linha do `overview` do resumo na linha do tempo (R29). */
const RESUMO_MAX = 240

export interface FunilServiceDeps {
  store: FunilStore
  meetings: Pick<MeetingsStore, 'list'>
  summaries: Pick<SummaryStore, 'get'>
  /** O cache de cada conta (INBOX e enviados guardados), sem ir ao servidor. */
  email: { cached(): Promise<{ status: { account: { address: string } }; inbox: EmailMessage[]; sent: EmailMessage[] }[]> }
  whatsapp: { chats(): Promise<WhatsAppChat[]>; me(): WhatsAppMe | null }
  /** O diálogo "Importar contatos"; `null` cancela. */
  chooseImportFile: () => Promise<string | null>
  /** Depois de cada gravação de `funil.json` (e quando as tarefas mudam, por `notificarTarefas`). */
  onChange: (view: FunilView) => void
  /** Contrato 124 (D8): as tarefas pelo serviço delas; o funil nunca abre `tarefas.json`. */
  tarefas: { todas(): Promise<Tarefa[]>; criar(input: TarefaInput): Promise<TarefasActionResult>; salvar(request: TarefaSalvar): Promise<TarefasActionResult> }
  now?: () => number
  newId?: () => string
  log?: (message: string) => void
}

export interface FunilService {
  /** O funil inteiro e `ultimas` (o `scribe:funil-get`). */
  view(): Promise<FunilView>
  contatoSave(request: { contato: ContatoInput; origem: ContatoOrigem }): Promise<FunilActionResult>
  contatoArchive(request: { id: string }): Promise<FunilActionResult>
  empresaSave(request: { empresa: EmpresaInput }): Promise<FunilActionResult>
  empresaDelete(request: { id: string }): Promise<FunilActionResult>
  oportunidadeSave(request: { oportunidade: OportunidadeInput }): Promise<FunilActionResult>
  oportunidadeMove(request: { id: string; etapaId: string; ordem: number; motivoPerda?: string | null | undefined }): Promise<FunilActionResult>
  oportunidadeDelete(request: { id: string }): Promise<FunilActionResult>
  /** Só ganha ou perdida (R27). */
  oportunidadeArchive(request: { id: string }): Promise<FunilActionResult>
  etapasSave(request: { etapas: EtapaInput[] }): Promise<FunilActionResult>
  /** Nota na oportunidade (`EventoFunil` tipo `nota`). */
  eventoAdd(request: { oportunidadeId: string; texto: string }): Promise<FunilActionResult>
  sugestoes(): Promise<Sugestao[]>
  ignorar(request: { chave: string }): Promise<FunilActionResult>
  /** Diálogo, leitura e prévia; a leitura fica guardada com um `token` novo (abrir outro descarta a anterior). */
  importarAbrir(): Promise<FunilImportAbrirResult>
  importarConfirmar(request: { token: string; mapeamento?: CampoImport[] | undefined; simular?: boolean | undefined }): Promise<FunilImportConfirmarResult>
  timeline(request: { tipo: 'contato' | 'oportunidade'; id: string }): Promise<FunilTimelineResult>
  /** Contrato 124 (R10): o gancho das tarefas grava o evento `tarefa` e avisa a tela; erro do store vira exceção. */
  registrarTarefa(evento: EventoOportunidade): Promise<void>
  /** Contrato 124 (D8): as tarefas mudaram; reemite o `onChange` com a view nova, sem gravar. */
  notificarTarefas(): Promise<void>
}

/** Uma leitura de cada cache (cabe em `FontesTimeline`). */
interface Fontes {
  reunioes: Meeting[]
  emails: EmailMessage[]
  contasEmail: string[]
  whatsapp: WhatsAppChat[]
}

/** Primeira linha não vazia do texto, cortada. */
function primeiraLinha(texto: string): string | null {
  const linha = texto
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item !== '')
  if (!linha) return null
  return linha.length > RESUMO_MAX ? `${linha.slice(0, RESUMO_MAX - 1)}…` : linha
}

const paraContato = (entrada: EntradaImport): ContatoInput => ({ nome: entrada.nome, emails: entrada.emails, telefones: entrada.telefones, empresaNome: entrada.empresaNome, cargo: entrada.cargo })

export function createFunilService(deps: FunilServiceDeps): FunilService {
  const { store, now = Date.now, newId = randomUUID, log = () => undefined } = deps
  /** A leitura do último arquivo aberto, esperando o "Importar". */
  let importacao: { token: string; leitura: Extract<LeituraImport, { ok: true }> } | null = null

  /** Lê um domínio pelo cache; desligado ou com falha vale vazio. */
  async function seguro<T>(nome: string, ler: () => Promise<T>, vazio: T): Promise<T> {
    try {
      return await ler()
    } catch (error) {
      log(`[funil] ${nome} indisponível: ${error instanceof Error ? error.message : String(error)}`)
      return vazio
    }
  }

  /** Uma leitura de cada cache, para um pedido. */
  async function fontes(): Promise<Fontes> {
    const [reunioes, contas, chats] = await Promise.all([seguro('reuniões', () => deps.meetings.list(), []), seguro('e-mail', () => deps.email.cached(), []), seguro('WhatsApp', () => deps.whatsapp.chats(), [])])
    return {
      reunioes,
      emails: contas.flatMap((conta) => [...conta.inbox, ...conta.sent]),
      contasEmail: contas.map((conta) => conta.status.account.address),
      whatsapp: chats,
    }
  }

  /** As tarefas do arquivo; falha vale nenhuma. */
  const tarefas = (): Promise<Tarefa[]> => seguro('tarefas', () => deps.tarefas.todas(), [])

  /** D9: o passo de cada oportunidade aberta e não arquivada, pela primeira tarefa aberta ligada a ela. */
  async function proximosPassos(state: FunilState): Promise<Record<string, ProximoPassoDerivado | null>> {
    const abertas = new Set(state.etapas.filter((etapa) => etapa.tipo === 'aberta').map((etapa) => etapa.id))
    const ids = state.oportunidades.filter((oportunidade) => !oportunidade.arquivado && abertas.has(oportunidade.etapaId)).map((oportunidade) => oportunidade.id)
    if (ids.length === 0) return {}
    const porOportunidade = new Map<string, Tarefa[]>()
    for (const tarefa of await tarefas()) {
      const id = tarefa.vinculos.oportunidadeId
      if (id === null || tarefa.status !== 'aberta') continue
      const lista = porOportunidade.get(id)
      if (lista) lista.push(tarefa)
      else porOportunidade.set(id, [tarefa])
    }
    const passos: Record<string, ProximoPassoDerivado | null> = {}
    for (const id of ids) {
      const tarefa = proximaDaOportunidade(porOportunidade.get(id) ?? [], id)
      passos[id] = tarefa ? { texto: tarefa.titulo, data: tarefa.prazo, tarefaId: tarefa.id } : null
    }
    return passos
  }

  async function montarView(state: FunilState): Promise<FunilView> {
    // Sem oportunidade aberta não há o que calcular: nenhum cache é lido.
    if (!state.oportunidades.some((oportunidade) => !oportunidade.arquivado)) return { state, ultimas: {}, proximosPassos: {} }
    const [lidas, passos] = await Promise.all([fontes(), proximosPassos(state)])
    return { state, ultimas: ultimasInteracoes({ ...lidas, state }), proximosPassos: passos }
  }

  /** Depois de gravar: a view nova vai para o `onChange`; uma falha aqui não desfaz a gravação. */
  async function avisar(state: FunilState): Promise<void> {
    try {
      deps.onChange(await montarView(state))
    } catch (error) {
      log(`[funil] aviso de mudança falhou: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function gravar<T>(result: FunilResult<T>, id: (value: T) => string | null, extra?: (value: T) => { mesclado: boolean }): Promise<FunilActionResult> {
    if (!result.ok) return { ok: false, erro: result.erro, mensagem: FUNIL_ERRO_TEXTO[result.erro] }
    await avisar(result.state)
    return { ok: true, id: id(result.value), ...(extra ? extra(result.value) : {}) }
  }

  return {
    async view() {
      return montarView(await store.read())
    },

    contatoSave: async ({ contato, origem }) =>
      gravar(
        await store.saveContato(contato, origem),
        (value) => value.contato.id,
        (value) => ({ mesclado: value.mesclado }),
      ),
    contatoArchive: async ({ id }) => gravar(await store.arquivarContato(id), (contato) => contato.id),
    empresaSave: async ({ empresa }) => gravar(await store.saveEmpresa(empresa), (value) => value.id),
    empresaDelete: async ({ id }) => gravar(await store.deleteEmpresa(id), () => null),
    async oportunidadeSave({ oportunidade }) {
      // D9: o passo não é gravado na oportunidade; com texto, vira uma tarefa ligada a ela depois de gravar. O mesmo
      // passo de novo (a proposta aplicada outra vez, o cartão repetido) não duplica: a tarefa aberta da oportunidade
      // com o mesmo título (aparado, sem caixa) fica, e só o prazo dela muda se vier outro.
      const passo = oportunidade.proximoPasso
      const texto = passo && typeof passo.texto === 'string' ? passo.texto.trim() : ''
      // A data fora do calendário é recusada antes de gravar, como o store fazia com o passo (a tarefa a recusaria).
      if (passo && passo.data != null && !diaValido(passo.data)) return { ok: false, erro: 'invalido', mensagem: FUNIL_ERRO_TEXTO.invalido }
      const result = await gravar(await store.saveOportunidade(oportunidade), (value) => value.id)
      if (!result.ok || !texto || !passo || result.id === null) return result
      const oportunidadeId = result.id
      const titulo = texto.slice(0, TAREFA_TITULO_MAX).trim()
      const prazo = passo.data ?? null
      // Contrato 127 (R17): a resposta diz o que aconteceu com a tarefa (o cartão do Assistente mostra isso).
      try {
        const chave = titulo.toLowerCase()
        const iguais = (await tarefas()).filter((tarefa) => tarefa.status === 'aberta' && tarefa.vinculos.oportunidadeId === oportunidadeId && tarefa.titulo.trim().toLowerCase() === chave)
        const mesma = iguais.find((tarefa) => tarefa.prazo === prazo)
        if (mesma) return { ...result, tarefa: { acao: 'existente', id: mesma.id } }
        const existente = iguais[0]
        const feita = existente
          ? await deps.tarefas.salvar({ id: existente.id, prazo })
          : await deps.tarefas.criar({ titulo, prazo, lembrete: 'padrao', origem: { tipo: 'funil', oportunidadeId }, vinculos: { oportunidadeId } })
        if (!feita.ok) {
          log(`[funil] a tarefa do próximo passo da oportunidade ${oportunidadeId} não foi ${existente ? 'atualizada' : 'criada'} (${feita.erro})`)
          return { ...result, tarefa: { acao: 'falhou', mensagem: feita.mensagem } }
        }
        const id = existente?.id ?? feita.id
        return id ? { ...result, tarefa: { acao: existente ? 'atualizada' : 'criada', id } } : result
      } catch (error) {
        log(`[funil] a tarefa do próximo passo da oportunidade ${oportunidadeId} falhou: ${error instanceof Error ? error.message : String(error)}`)
        return { ...result, tarefa: { acao: 'falhou', mensagem: TAREFAS_FALHOU_TEXTO } }
      }
    },
    oportunidadeMove: async (request) => gravar(await store.moverOportunidade(request), (value) => value.id),
    oportunidadeDelete: async ({ id }) => gravar(await store.deleteOportunidade(id), () => null),
    oportunidadeArchive: async ({ id }) => gravar(await store.arquivarOportunidade(id), (value) => value.id),
    etapasSave: async ({ etapas }) => gravar(await store.saveEtapas(etapas), () => null),
    eventoAdd: async ({ oportunidadeId, texto }) => gravar(await store.addEvento({ oportunidadeId, tipo: 'nota', texto }), (evento) => evento.id),
    ignorar: async ({ chave }) => gravar(await store.ignorar(chave), () => null),

    async sugestoes() {
      const state = await store.read()
      const { reunioes, emails, contasEmail, whatsapp } = await fontes()
      let meuTelefone: string | null
      try {
        meuTelefone = deps.whatsapp.me()?.phone ?? null
      } catch {
        meuTelefone = null
      }
      return sugestoesDeContato({
        reunioes: reunioes.map((reuniao) => ({ id: reuniao.id, startedAt: reuniao.startedAt, attendees: reuniao.calendar?.attendees ?? [] })),
        emails,
        contasEmail,
        whatsapp: whatsapp.map((chat) => ({ id: chat.id, name: chat.name, kind: chat.kind, phone: chat.phone, lastAt: chat.lastMessage?.at ?? null })),
        meuTelefone,
        contatos: state.contatos,
        ignorados: state.ignorados,
        now: now(),
      })
    },

    async importarAbrir() {
      const path = await deps.chooseImportFile()
      if (path === null) return { ok: false, erro: 'cancelado' }
      let leitura: LeituraImport
      try {
        // O tamanho antes de ler: arquivo grande demais nem é aberto.
        if ((await stat(path)).size > IMPORT_BYTES_MAX) return { ok: false, erro: 'arquivo-grande' }
        leitura = lerArquivo(new Uint8Array(await readFile(path)), basename(path))
      } catch (error) {
        log(`[funil] leitura do arquivo de importação falhou: ${error instanceof Error ? error.message : String(error)}`)
        return { ok: false, erro: 'falhou' }
      }
      if (!leitura.ok) return { ok: false, erro: leitura.erro }
      const token = newId()
      importacao = { token, leitura }
      const validas = leitura.total - leitura.ignorados
      if (leitura.tipo === 'csv') {
        return { ok: true, token, arquivo: basename(path), tipo: 'csv', separador: leitura.separador, codificacao: leitura.codificacao, colunas: leitura.colunas, mapeamento: leitura.mapeamento, previa: leitura.previa, total: leitura.total, validas }
      }
      const previa = leitura.previa.map((entrada) => [entrada.nome, entrada.emails.join(', '), entrada.telefones.join(', '), entrada.empresaNome ?? '', entrada.cargo ?? ''])
      return { ok: true, token, arquivo: basename(path), tipo: 'vcard', separador: null, codificacao: leitura.codificacao, colunas: [...VCARD_COLUNAS], mapeamento: [...VCARD_MAPEAMENTO], previa, total: leitura.total, validas }
    },

    async importarConfirmar({ token, mapeamento, simular }) {
      if (importacao === null || importacao.token !== token) return { ok: false, erro: 'expirado', mensagem: FUNIL_EXPIRADO_TEXTO }
      const { leitura } = importacao
      let entradas: EntradaImport[]
      let ignorados: number
      if (leitura.tipo === 'csv') {
        const escolhido = mapeamento ?? leitura.mapeamento
        if (escolhido.length !== leitura.colunas.length) return { ok: false, erro: 'invalido', mensagem: FUNIL_ERRO_TEXTO.invalido }
        ;({ entradas, ignorados } = aplicarMapeamento(leitura.linhas, escolhido))
      } else {
        // vCard: o mapeamento é fixo (R15); o que vier no pedido não muda nada.
        entradas = leitura.entradas
        ignorados = leitura.ignorados
      }
      if (simular) return { ok: true, simulado: true, validas: entradas.length, ignorados }
      const result = await store.importarContatos(entradas.map(paraContato), 'importacao')
      if (!result.ok) return { ok: false, erro: result.erro, mensagem: FUNIL_ERRO_TEXTO[result.erro] }
      importacao = null
      await avisar(result.state)
      const { criados, atualizados } = result.value
      // A entrada que o store recusou (e-mail e telefone que não normalizam) conta como ignorada.
      return { ok: true, simulado: false, criados, atualizados, ignorados: ignorados + (entradas.length - criados - atualizados) }
    },

    async registrarTarefa(evento) {
      const result = await store.registrarTarefa(evento)
      if (!result.ok) throw new Error(FUNIL_ERRO_TEXTO[result.erro])
      await avisar(result.state)
    },

    async notificarTarefas() {
      try {
        deps.onChange(await montarView(await store.read()))
      } catch (error) {
        log(`[funil] aviso das tarefas falhou: ${error instanceof Error ? error.message : String(error)}`)
      }
    },

    async timeline({ tipo, id }) {
      const state = await store.read()
      let resultado
      if (tipo === 'contato') {
        const contato = state.contatos.find((item) => item.id === id)
        if (!contato) return { ok: false, erro: 'nao-encontrado' }
        const [lidas, lista] = await Promise.all([fontes(), tarefas()])
        resultado = timelineDoContato({ ...lidas, tarefas: lista, contato })
      } else {
        const oportunidade = state.oportunidades.find((item) => item.id === id)
        if (!oportunidade) return { ok: false, erro: 'nao-encontrado' }
        const [lidas, lista] = await Promise.all([fontes(), tarefas()])
        resultado = timelineDaOportunidade({ ...lidas, tarefas: lista, oportunidade, contatos: state.contatos, eventos: state.eventos })
      }
      // O resumo só das reuniões da lista, uma leitura por reunião.
      const itens = await Promise.all(
        resultado.itens.map(async (item): Promise<ItemLinhaDoTempo> => {
          if (item.tipo !== 'reuniao' || item.apagada) return item
          const resumo = await seguro('resumo', () => deps.summaries.get(item.meetingId), null)
          return { ...item, resumo: resumo ? primeiraLinha(resumo.overview) : null }
        }),
      )
      return { ok: true, itens, ultimaInteracao: resultado.ultimaInteracao, whatsappChatIds: resultado.whatsappChatIds }
    },
  }
}
