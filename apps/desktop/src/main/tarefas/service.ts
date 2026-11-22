// Serviço das tarefas (contrato 122, D3): as gravações pelo store, o lembrete padrão (R11), os vínculos da
// oportunidade (R9), o gancho do funil (R10), a view com os nomes (D5), os lembretes no tick das Automações e a
// virada do dia (R12), as sugestões (R26) e o "Adicionar" do resumo (R22, R23). Os outros domínios entram só pelas
// dependências e só pelos caches que os serviços já mantêm: nenhum arquivo deles é aberto aqui, nada é escrito
// neles e não há timer. Domínio desligado ou com falha vale vazio (ou sem nome). O log leva só ids e contagens,
// nunca título (R36).
import type { FunilState, Oportunidade } from '../../shared/funil'
import type { MeetingAnalysis } from '../../shared/meeting-analysis'
import type { Meeting } from '../../shared/meetings'
import { DEFAULT_SETTINGS, type TarefasSettings } from '../../shared/settings-defaults'
import {
  SUGESTOES_DIAS,
  TAREFA_TITULO_MAX,
  TAREFAS_ERRO_TEXTO,
  type AvisoTarefa,
  type EventoOportunidade,
  type SugestaoTarefa,
  type Tarefa,
  type TarefaInput,
  type TarefaNova,
  type TarefaPatch,
  type TarefasActionResult,
  type TarefasArquivo,
  type TarefasErro,
  type TarefaSalvar,
  type TarefasResult,
  type TarefasResumoResult,
  type TarefaStatus,
  type TarefasView,
  type VinculosTarefa,
} from '../../shared/tarefas'
import { casaComResumo, diaNoFuso, diaValido, lembretePadrao, recalcularLembrete, responsavelDoDono } from '../../shared/tarefas-logic'
import { sugestoesDeTarefa } from '../../shared/tarefas-sugestoes'
import type { WhatsAppChat } from '../../shared/whatsapp'
import type { WhatsAppInsightsCache } from '../../shared/whatsapp-insights'
import type { MeetingsStore } from '../meetings/store'
import type { SummaryStore } from '../meetings/summaries'
import type { TarefasStore } from './store'

const DIA_MS = 86_400_000

export interface TarefasServiceDeps {
  store: TarefasStore
  /** O `funil.json` pelo store do funil (só leitura). */
  funil: { state(): Promise<FunilState> }
  meetings: Pick<MeetingsStore, 'list' | 'get'>
  summaries: Pick<SummaryStore, 'get'>
  analyses: { list(meetingId: string): Promise<MeetingAnalysis[]> }
  /** O cache dos Detalhes das conversas do WhatsApp. */
  insights: { read(): Promise<WhatsAppInsightsCache> }
  whatsapp: { chats(): Promise<WhatsAppChat[]> }
  settings: () => Promise<{ tarefas: TarefasSettings }>
  timeZone: () => string
  /** A notificação "Tarefa" (o `index.ts` troca o texto com o app bloqueado). */
  notify: (aviso: AvisoTarefa) => void
  /** Depois de cada gravação de `tarefas.json` e na virada do dia. */
  onChange: (view: TarefasView) => void
  /** R10: a tarefa ligada a uma oportunidade foi criada, concluída ou mudou de prazo (o funil grava o evento, 124). */
  onOportunidade?: (evento: EventoOportunidade) => Promise<void>
  now?: () => number
  /** Aceito pela forma do contrato; os ids das tarefas saem do store. */
  newId?: () => string
  log?: (message: string) => void
}

export interface TarefasService {
  /** A lista inteira com os nomes (o `scribe:tarefas-get`). */
  view(): Promise<TarefasView>
  /** As tarefas do arquivo, sem nomes (o funil deriva o próximo passo delas, 124). */
  todas(): Promise<Tarefa[]>
  criar(input: TarefaInput): Promise<TarefasActionResult>
  salvar(request: TarefaSalvar): Promise<TarefasActionResult>
  status(request: { id: string; status: TarefaStatus }): Promise<TarefasActionResult>
  apagar(request: { id: string }): Promise<TarefasActionResult>
  /** Calculadas a cada pedido (R26); nada é gravado. */
  sugestoes(): Promise<SugestaoTarefa[]>
  ignorar(request: { chave: string }): Promise<TarefasActionResult>
  adicionarDoResumo(request: { meetingId: string; indices: number[] | 'minhas' }): Promise<TarefasResumoResult>
  /** O tick das Automações (R12): marca e avisa os lembretes vencidos; na virada do dia, reemite a view. Nunca lança. */
  dispararLembretes(at: number): Promise<void>
}

const mensagem = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const erro = (codigo: TarefasErro): { ok: false; erro: TarefasErro; mensagem: string } => ({ ok: false, erro: codigo, mensagem: TAREFAS_ERRO_TEXTO[codigo] })

const vinculosVazios = (): VinculosTarefa => ({ oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null })

/** Oportunidade aberta (etapa do tipo `aberta`) e não arquivada. */
function aberta(oportunidade: Oportunidade, state: FunilState): boolean {
  if (oportunidade.arquivado) return false
  return state.etapas.find((etapa) => etapa.id === oportunidade.etapaId)?.tipo === 'aberta'
}

const unicos = (ids: readonly string[]): string[] => [...new Set(ids)]

/**
 * O que sai da fila: a resposta e as tarefas ligadas a uma oportunidade que pedem o gancho (R10). Com gancho, `state`
 * é o estado gravado e o aviso da tela (`onChange`) fica para depois dele (contrato 124).
 */
interface NaFila<T> {
  resposta: T
  ligadas: Tarefa[]
  state?: TarefasArquivo | undefined
}

/** Uma promessa encadeada: cada tarefa começa depois que a anterior termina (com sucesso ou não). */
function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
}

export function createTarefasService(deps: TarefasServiceDeps): TarefasService {
  const { store, now = Date.now, log = () => undefined } = deps
  /** Dia local do último tick; `null` até o primeiro (que só registra). */
  let diaDoTick: string | null = null
  /**
   * As operações que leem e depois gravam (criar, salvar, status, "Adicionar do resumo") passam uma de cada vez: dois
   * `salvar` quase juntos não recalculam o lembrete do prazo antigo, e dois "Adicionar as minhas" não duplicam. O
   * gancho do funil roda depois, fora da fila (o funil pode chamar o serviço de volta, D8).
   */
  const fila = serialQueue()

  /** A gravação pede o gancho do funil: alguma tarefa ligada a uma oportunidade e o gancho existe. */
  const pedeGancho = (ligadas: readonly Tarefa[]): boolean => deps.onOportunidade !== undefined && ligadas.some((tarefa) => tarefa.vinculos.oportunidadeId)

  /**
   * Roda na fila e, depois de sair dela, chama o gancho para cada tarefa ligada. Contrato 124: com gancho, o
   * `onChange` só sai depois de todos terminarem (o funil, avisado por ele, já lê o evento `tarefa` gravado), com o
   * estado relido do store (outra gravação pode ter passado pela fila enquanto o gancho rodava).
   */
  async function emFila<T>(acao: EventoOportunidade['acao'], run: () => Promise<NaFila<T>>): Promise<T> {
    const { resposta, ligadas, state } = await fila(run)
    for (const tarefa of ligadas) await gancho(tarefa, acao)
    if (state) {
      const atual = await store.read().catch(() => null)
      await avisar(atual?.ok ? atual.value : state)
    }
    return resposta
  }

  /** Lê um domínio pelo cache; desligado ou com falha vale `vazio`. */
  async function seguro<T>(nome: string, ler: () => Promise<T>, vazio: T): Promise<T> {
    try {
      return await ler()
    } catch (error) {
      log(`[tarefas] ${nome} indisponível: ${mensagem(error)}`)
      return vazio
    }
  }

  async function ler(): Promise<TarefasArquivo> {
    const result = await store.read()
    if (!result.ok) throw new Error(TAREFAS_ERRO_TEXTO[result.erro])
    return result.value
  }

  const configuracoes = (): Promise<TarefasSettings> => seguro('configurações', async () => (await deps.settings()).tarefas, DEFAULT_SETTINGS.tarefas)

  /** Lembrete pedido (R11): ausente ou `'padrao'` sai do prazo e da hora das Configurações; `'nenhum'` não avisa. */
  function lembreteDe(pedido: TarefaInput['lembrete'], prazo: string | null, config: TarefasSettings): number | null {
    if (typeof pedido === 'number') return pedido
    if (pedido === 'nenhum') return null
    return prazo !== null && diaValido(prazo) && config.lembrarNoPrazo ? lembretePadrao(prazo, config.horaLembrete, deps.timeZone()) : null
  }

  /** A view de um estado: cada cache lido no máximo uma vez, e só quando alguma tarefa cita aquele domínio. */
  async function montarView(state: TarefasArquivo, at: number = now()): Promise<TarefasView> {
    const ids = { oportunidades: new Set<string>(), contatos: new Set<string>(), reunioes: new Set<string>(), whatsapp: new Set<string>() }
    for (const tarefa of state.tarefas) {
      const { vinculos, origem, responsavel } = tarefa
      if (vinculos.oportunidadeId) ids.oportunidades.add(vinculos.oportunidadeId)
      if (origem.tipo === 'funil') ids.oportunidades.add(origem.oportunidadeId)
      for (const contatoId of vinculos.contatoIds) ids.contatos.add(contatoId)
      if (responsavel.tipo === 'contato') ids.contatos.add(responsavel.contatoId)
      if (vinculos.meetingId) ids.reunioes.add(vinculos.meetingId)
      if (origem.tipo === 'reuniao' || origem.tipo === 'analise') ids.reunioes.add(origem.meetingId)
      if (vinculos.whatsappChatId) ids.whatsapp.add(vinculos.whatsappChatId)
      if (origem.tipo === 'whatsapp') ids.whatsapp.add(origem.chatId)
    }
    const precisaFunil = ids.oportunidades.size > 0 || ids.contatos.size > 0
    const [funil, reunioes, chats] = await Promise.all([
      precisaFunil ? seguro('funil', () => deps.funil.state(), null) : null,
      ids.reunioes.size ? seguro('reuniões', () => deps.meetings.list(), []) : [],
      ids.whatsapp.size ? seguro('WhatsApp', () => deps.whatsapp.chats(), []) : [],
    ])
    const nomes: TarefasView['nomes'] = { oportunidades: {}, contatos: {}, reunioes: {}, whatsapp: {} }
    for (const oportunidade of funil?.oportunidades ?? []) if (ids.oportunidades.has(oportunidade.id)) nomes.oportunidades[oportunidade.id] = oportunidade.titulo
    for (const contato of funil?.contatos ?? []) if (ids.contatos.has(contato.id)) nomes.contatos[contato.id] = contato.nome
    for (const reuniao of reunioes) if (ids.reunioes.has(reuniao.id)) nomes.reunioes[reuniao.id] = reuniao.title
    for (const chat of chats) if (ids.whatsapp.has(chat.id)) nomes.whatsapp[chat.id] = chat.name
    return { tarefas: state.tarefas, hoje: diaNoFuso(at, deps.timeZone()), nomes }
  }

  /** Depois de gravar: a view nova vai para o `onChange`; uma falha aqui não desfaz a gravação. */
  async function avisar(state: TarefasArquivo, at?: number): Promise<void> {
    try {
      deps.onChange(await montarView(state, at))
    } catch (error) {
      log(`[tarefas] aviso de mudança falhou: ${mensagem(error)}`)
    }
  }

  /** R10: o gancho do funil; a falha só vai ao log. */
  async function gancho(tarefa: Tarefa, acao: EventoOportunidade['acao']): Promise<void> {
    const oportunidadeId = tarefa.vinculos.oportunidadeId
    if (!oportunidadeId || !deps.onOportunidade) return
    try {
      await deps.onOportunidade({ oportunidadeId, tarefaId: tarefa.id, acao, titulo: tarefa.titulo })
    } catch (error) {
      log(`[tarefas] evento do funil da tarefa ${tarefa.id} falhou: ${mensagem(error)}`)
    }
  }

  async function gravar<T>(result: TarefasResult<T>, id: (value: T) => string | null): Promise<TarefasActionResult> {
    if (!result.ok) return erro(result.erro)
    await avisar(result.state)
    return { ok: true, id: id(result.value) }
  }

  /** Uma gravação na fila: sem gancho, avisa a tela aqui mesmo; com gancho, o aviso fica para o `emFila`. */
  async function naFila<T>(result: TarefasResult<T>, id: (value: T) => string | null, ligadas: Tarefa[]): Promise<NaFila<TarefasActionResult>> {
    if (!result.ok) return { resposta: erro(result.erro), ligadas: [] }
    if (!pedeGancho(ligadas)) return { resposta: await gravar(result, id), ligadas }
    return { resposta: { ok: true, id: id(result.value) }, ligadas, state: result.state }
  }

  /**
   * Vínculos ao criar (R9): com oportunidade, os contatos e a empresa dela entram; sem oportunidade e com um contato
   * só, a oportunidade entra (com os contatos e a empresa dela) se ele tiver exatamente uma aberta e não arquivada.
   */
  async function vinculosDe(pedido: Partial<VinculosTarefa> | undefined): Promise<VinculosTarefa> {
    const vazios = vinculosVazios()
    const vinculos: VinculosTarefa = {
      oportunidadeId: pedido?.oportunidadeId ?? vazios.oportunidadeId,
      contatoIds: unicos(pedido?.contatoIds ?? vazios.contatoIds),
      empresaId: pedido?.empresaId ?? vazios.empresaId,
      meetingId: pedido?.meetingId ?? vazios.meetingId,
      email: pedido?.email ?? vazios.email,
      whatsappChatId: pedido?.whatsappChatId ?? vazios.whatsappChatId,
    }
    const contatoUnico = vinculos.contatoIds.length === 1 ? vinculos.contatoIds[0] : undefined
    if (vinculos.oportunidadeId === null && contatoUnico === undefined) return vinculos
    const state = await seguro('funil', () => deps.funil.state(), null)
    if (state === null) return vinculos
    let oportunidade: Oportunidade | undefined
    if (vinculos.oportunidadeId !== null) oportunidade = state.oportunidades.find((item) => item.id === vinculos.oportunidadeId)
    else {
      const doContato = state.oportunidades.filter((item) => item.contatoIds.includes(contatoUnico as string) && aberta(item, state))
      if (doContato.length === 1) oportunidade = doContato[0]
    }
    if (!oportunidade) return vinculos
    return { ...vinculos, oportunidadeId: oportunidade.id, contatoIds: unicos([...vinculos.contatoIds, ...oportunidade.contatoIds]), empresaId: vinculos.empresaId ?? oportunidade.empresaId }
  }

  return {
    async view() {
      return montarView(await ler())
    },

    async todas() {
      return (await ler()).tarefas
    },

    criar: (input) =>
      emFila('criada', async () => {
        const config = await configuracoes()
        const prazo = input.prazo ?? null
        const nova: TarefaNova = {
          titulo: input.titulo,
          detalhe: input.detalhe ?? '',
          prazo,
          lembreteEm: lembreteDe(input.lembrete, prazo, config),
          importante: input.importante ?? false,
          responsavel: input.responsavel ?? { tipo: 'eu' },
          origem: input.origem,
          vinculos: await vinculosDe(input.vinculos),
        }
        const result = await store.criar(nova)
        return naFila(result, (tarefa) => tarefa.id, result.ok ? [result.value] : [])
      }),

    salvar: ({ id, lembrete, ...campos }) =>
      emFila('prazo', async () => {
        const atual = (await ler()).tarefas.find((tarefa) => tarefa.id === id)
        if (!atual) return { resposta: erro('nao-encontrado'), ligadas: [] }
        const config = await configuracoes()
        const patch: TarefaPatch = campos
        const prazoFinal = campos.prazo !== undefined ? campos.prazo : atual.prazo
        if (lembrete !== undefined) patch.lembreteEm = lembreteDe(lembrete, prazoFinal, config)
        else if (campos.prazo !== undefined && campos.prazo !== atual.prazo && (campos.prazo === null || diaValido(campos.prazo))) {
          patch.lembreteEm = recalcularLembrete({ lembreteEm: atual.lembreteEm, prazoAntigo: atual.prazo, prazoNovo: campos.prazo, hora: config.horaLembrete, lembrarNoPrazo: config.lembrarNoPrazo, timeZone: deps.timeZone() })
        }
        const result = await store.salvar(id, patch)
        return naFila(result, (tarefa) => tarefa.id, result.ok && result.value.prazo !== atual.prazo ? [result.value] : [])
      }),

    status: ({ id, status }) =>
      emFila('feita', async () => {
        const antes = (await ler()).tarefas.find((tarefa) => tarefa.id === id)
        const result = await store.status(id, status)
        // Reabrir e cancelar não chamam o gancho (D-15); concluir de novo a que já estava feita também não.
        return naFila(result, (tarefa) => tarefa.id, result.ok && status === 'feita' && antes?.status !== 'feita' ? [result.value] : [])
      }),

    apagar: async ({ id }) => gravar(await store.apagar(id), () => null),

    ignorar: async ({ chave }) => gravar(await store.ignorar(chave), () => null),

    async sugestoes() {
      const at = now()
      const [state, config] = await Promise.all([ler(), configuracoes()])
      const desde = at - SUGESTOES_DIAS * DIA_MS
      // Com as sugestões das reuniões desligadas, nenhuma reunião é lida.
      const lista: Meeting[] = config.sugerirDasReunioes ? await seguro('reuniões', () => deps.meetings.list(), []) : []
      const recentes = lista.filter((reuniao) => {
        const em = Date.parse(reuniao.startedAt)
        return Number.isFinite(em) && em >= desde
      })
      const [reunioes, cache, chats] = await Promise.all([
        Promise.all(
          recentes.map(async (reuniao) => {
            const [resumo, analises] = await Promise.all([seguro('resumo', () => deps.summaries.get(reuniao.id), null), seguro('análises', () => deps.analyses.list(reuniao.id), [])])
            return { id: reuniao.id, titulo: reuniao.title, startedAt: reuniao.startedAt, resumo: resumo?.tasks ?? null, toConfirm: analises.flatMap((analise) => analise.toConfirm) }
          }),
        ),
        seguro('insights do WhatsApp', () => deps.insights.read(), {}),
        seguro('WhatsApp', () => deps.whatsapp.chats(), []),
      ])
      const porId = new Map(chats.map((chat) => [chat.id, chat]))
      const conversas = Object.entries(cache).map(([chatId, { result }]) => {
        const chat = porId.get(chatId)
        return { chatId, nome: chat?.name ?? '', lastAt: chat?.lastMessage?.at ?? null, pendenciasMinhas: result.pendencias.minhas, compromissos: result.compromissos }
      })
      return sugestoesDeTarefa({ reunioes, conversas, tarefas: state.tarefas, ignorados: state.ignorados, sugerirDasReunioes: config.sugerirDasReunioes, hoje: diaNoFuso(at, deps.timeZone()), now: at })
    },

    adicionarDoResumo: ({ meetingId, indices }) =>
      emFila('criada', async (): Promise<NaFila<TarefasResumoResult>> => {
        const resumo = await deps.summaries.get(meetingId)
        if (resumo === null) return { resposta: erro('nao-encontrado'), ligadas: [] }
        const linhas = resumo.tasks
        let pedidos: number[]
        if (indices === 'minhas') pedidos = linhas.flatMap((linha, indice) => (linha.owner === 'Você' ? [indice] : []))
        else {
          if (!Array.isArray(indices) || indices.some((indice) => !Number.isInteger(indice) || indice < 0 || indice >= linhas.length)) return { resposta: erro('invalido'), ligadas: [] }
          pedidos = [...new Set(indices)]
        }
        const state = await ler()
        // A linha que já virou tarefa (pelo texto, R23) fica de fora, sem erro.
        const novas = pedidos.filter((indice) => !state.tarefas.some((tarefa) => casaComResumo(tarefa, meetingId, (linhas[indice] as (typeof linhas)[number]).task)))
        if (!novas.length) return { resposta: { ok: true, criadas: [] }, ligadas: [] }
        const [config, reuniao, funil] = await Promise.all([configuracoes(), seguro('reunião', () => deps.meetings.get(meetingId), null), seguro('funil', () => deps.funil.state(), null)])
        const contatos = (funil?.contatos ?? []).filter((contato) => !contato.arquivado)
        // A oportunidade da reunião (R9): a não arquivada que tem a reunião; mais de uma, a atualizada por último.
        const oportunidade = (funil?.oportunidades ?? []).filter((item) => !item.arquivado && item.meetingIds.includes(meetingId)).sort((a, b) => b.atualizadoEm - a.atualizadoEm)[0]
        const attendees = reuniao?.calendar?.attendees ?? []
        const entradas: TarefaNova[] = novas.map((indice) => {
          const linha = linhas[indice] as (typeof linhas)[number]
          const prazo = linha.dueIso ?? null
          return {
            titulo: linha.task.slice(0, TAREFA_TITULO_MAX),
            detalhe: '',
            prazo,
            lembreteEm: lembreteDe('padrao', prazo, config),
            importante: false,
            responsavel: responsavelDoDono(linha.owner, attendees, contatos),
            origem: { tipo: 'reuniao', meetingId, texto: linha.task },
            vinculos: { ...vinculosVazios(), meetingId, oportunidadeId: oportunidade?.id ?? null, contatoIds: unicos(oportunidade?.contatoIds ?? []), empresaId: oportunidade?.empresaId ?? null },
          }
        })
        const result = await store.criarVarias(entradas)
        if (!result.ok) return { resposta: erro(result.erro), ligadas: [] }
        const comGancho = pedeGancho(result.value)
        if (!comGancho) await avisar(result.state)
        return { resposta: { ok: true, criadas: result.value.map((tarefa, posicao) => ({ indice: novas[posicao] as number, id: tarefa.id })) }, ligadas: result.value, ...(comGancho ? { state: result.state } : {}) }
      }),

    async dispararLembretes(at) {
      try {
        const dia = diaNoFuso(at, deps.timeZone())
        const lido = await store.read()
        if (!lido.ok) {
          log(`[tarefas] lembretes: leitura falhou (${lido.erro})`)
          return
        }
        const anterior = diaDoTick
        diaDoTick = dia
        let avisou = false
        const devidas = lido.value.tarefas.filter((tarefa) => tarefa.status === 'aberta' && tarefa.lembreteEm !== null && tarefa.lembreteEm <= at && tarefa.lembreteDisparadoEm === null)
        if (devidas.length) {
          // Marca antes de avisar: se a marcação falhar, nenhum aviso sai (e o próximo tick tenta de novo).
          const ids = devidas.map((tarefa) => tarefa.id)
          const marcados = await store.marcarLembreteDisparado(ids, at).catch((error: unknown) => {
            log(`[tarefas] lembretes: marcação falhou: ${mensagem(error)}`)
            return null
          })
          if (marcados !== null && !marcados.ok) log(`[tarefas] lembretes: marcação recusada (${marcados.erro})`)
          if (marcados?.ok) {
            const marcadas = new Set(marcados.value)
            for (const tarefa of devidas) {
              if (!marcadas.has(tarefa.id)) continue
              try {
                deps.notify({ title: 'Tarefa', body: tarefa.titulo, tarefaId: tarefa.id })
              } catch (error) {
                log(`[tarefas] aviso da tarefa ${tarefa.id} falhou: ${mensagem(error)}`)
              }
            }
            if (marcadas.size) {
              await avisar(marcados.state, at)
              avisou = true
            }
          }
        }
        // Virada do dia: a tela e o badge passam a usar a data nova mesmo sem gravação. O primeiro tick só registra.
        if (!avisou && anterior !== null && anterior !== dia) await avisar(lido.state, at)
      } catch (error) {
        log(`[tarefas] lembretes falharam: ${mensagem(error)}`)
      }
    },
  }
}
