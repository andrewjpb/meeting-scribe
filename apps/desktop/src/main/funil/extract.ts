// Contrato 111 (R38, D7): a passada `funnel-extract`. Lê o resumo salvo da reunião (`overview`, `decisions`, `tasks`),
// os participantes da agenda e, do `funil.json`, as oportunidades abertas e as etapas abertas; uma execução curta do
// Claude (sempre o Haiku, sem ferramenta nenhuma, pasta ACP própria) diz se há venda, e o resultado vai para
// `meetings/<id>.funil.json`. No molde do "Sugerir evento" (`invites/suggest.ts`: o prazo de 30 s que cancela a
// execução) e do ciclo da análise (`meetings/analysis-service.ts`: um por reunião, o mesmo pedido repetido recebe a
// mesma promessa, `settled`, `dispose`). Nunca rejeita: sem venda, fora do formato ou falha, grava `dismissed`. Não lê
// nem escreve o `summary.json` além de `summaries.get`, e nada vai para o `funil.json`. O disparo é do 113.
// Logs só com o resultado, o modelo, o custo e o tempo: nunca o resumo nem a proposta.
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import type { Etapa, FunilState } from '../../shared/funil'
import { normalizarEmail, semAcento } from '../../shared/funil-logic'
import { FUNIL_PROPOSTA_JUSTIFICATIVA_MAX, FUNIL_PROPOSTA_VERSION, type FunilPropostaArquivo, type PropostaOportunidade } from '../../shared/funil-proposta'
import type { FunnelResponse } from '../../shared/funil-proposta-schema'
import { CLAUDE_MODEL_PREFIX, type ClaudeModel } from '../../shared/settings-defaults'
import { funnelInput, funnelParser, funnelSystemPrompt, type FunnelAberta } from '../claude-cli/funnel'
import { runClaudeOneShot, type OneShotEngine } from '../meetings/claude-one-shot'
import type { MeetingsStore } from '../meetings/store'
import type { SummaryStore } from '../meetings/summaries'
import type { FunilProposalStore } from './proposals'
import type { FunilStore } from './store'

/** Pasta vazia do ACP da detecção, dentro de `userData/claude-cwd`. */
export const ACP_FUNNEL_DIR = 'funnel-extract'
/** Sempre o modelo mais rápido, qualquer que seja o das Configurações. */
export const FUNNEL_EXTRACT_MODEL: ClaudeModel = 'haiku'
/** O mesmo prazo do "Sugerir evento": passado ele, a execução é cancelada e grava `failed`. */
export const FUNNEL_EXTRACT_TIMEOUT_MS = 30_000

export const NOTA_OPORTUNIDADE_FECHADA = 'A oportunidade citada não está aberta; proposta como nova.'
export const notaEtapaInexistente = (sugerida: string, usada: string): string => `Etapa sugerida «${sugerida}» não existe; usada «${usada}».`

export interface FunnelExtractDeps extends OneShotEngine {
  locate: () => Promise<ClaudeLocateResult>
  meetings: Pick<MeetingsStore, 'get'>
  summaries: Pick<SummaryStore, 'get'>
  funil: Pick<FunilStore, 'read'>
  proposals: FunilProposalStore
  /** O arquivo `<id>.funil.json` foi gravado (o 113 emite `scribe:funil-proposta-changed`). */
  onChange?: (meetingId: string) => void
  now?: () => number
  timeoutMs?: number
}

export interface FunnelExtractService {
  /** Sem reunião ou sem resumo: `null`, nada gravado. Senão o arquivo gravado. Nunca rejeita. */
  detect(meetingId: string): Promise<FunilPropostaArquivo | null>
  running(meetingId: string): boolean
  /** Espera a detecção em curso da reunião, se houver. */
  settled(meetingId: string): Promise<void>
  /** Sair do app: cancela as execuções em curso, sem gravar nada delas. */
  dispose(): void
}

/** Etapas `aberta` na ordem do quadro. */
export const etapasAbertas = (state: Pick<FunilState, 'etapas'>): Etapa[] => state.etapas.filter((etapa) => etapa.tipo === 'aberta').sort((a, b) => a.ordem - b.ordem)

/** As oportunidades não arquivadas em etapa aberta, com os nomes resolvidos para o pedido. */
export function oportunidadesAbertas(state: FunilState): FunnelAberta[] {
  const etapas = new Map(etapasAbertas(state).map((etapa) => [etapa.id, etapa]))
  const empresas = new Map(state.empresas.map((empresa) => [empresa.id, empresa.nome]))
  const contatos = new Map(state.contatos.map((contato) => [contato.id, contato.nome]))
  return state.oportunidades
    .filter((op) => !op.arquivado && etapas.has(op.etapaId))
    .map((op) => ({
      id: op.id,
      titulo: op.titulo,
      empresa: op.empresaId !== null ? (empresas.get(op.empresaId) ?? null) : null,
      contatos: op.contatoIds.flatMap((contatoId) => contatos.get(contatoId) ?? []),
      etapa: etapas.get(op.etapaId)?.nome ?? '',
    }))
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()
const chaveEtapa = (nome: string): string => semAcento(oneLine(nome)).toLowerCase()

/**
 * R38: a resposta válida vira a proposta do arquivo. `atualizar` com id que não existe ou não está aberto vira `criar`
 * sem id; `etapaSugerida` sem etapa aberta de mesmo nome (sem acento e sem maiúscula) vira a primeira aberta; cada caso
 * acrescenta uma linha à `justificativa` (o texto do modelo encolhe para caber). Valor em reais vira centavos.
 */
export function normalizarProposta(resposta: NonNullable<FunnelResponse['proposta']>, state: FunilState): PropostaOportunidade {
  const notas: string[] = []
  const abertas = new Set(oportunidadesAbertas(state).map((op) => op.id))
  let acao = resposta.acao
  let oportunidadeId: string | undefined = acao === 'atualizar' ? (resposta.oportunidadeId ?? undefined) : undefined
  if (acao === 'atualizar' && (oportunidadeId === undefined || !abertas.has(oportunidadeId))) {
    acao = 'criar'
    oportunidadeId = undefined
    notas.push(NOTA_OPORTUNIDADE_FECHADA)
  }
  const sugerida = oneLine(resposta.etapaSugerida)
  const etapas = etapasAbertas(state)
  const igual = etapas.find((etapa) => chaveEtapa(etapa.nome) === chaveEtapa(sugerida))
  const primeira = etapas[0]
  let etapaSugerida = igual?.nome ?? sugerida
  if (!igual && primeira) {
    etapaSugerida = primeira.nome
    notas.push(notaEtapaInexistente(sugerida, primeira.nome))
  }
  const extra = notas.join('\n')
  const espaco = FUNIL_PROPOSTA_JUSTIFICATIVA_MAX - (extra ? extra.length + 1 : 0)
  const base = resposta.justificativa.trim().slice(0, Math.max(0, espaco)).trim()
  return {
    acao,
    ...(oportunidadeId !== undefined ? { oportunidadeId } : {}),
    titulo: oneLine(resposta.titulo),
    empresa: resposta.empresa !== null ? oneLine(resposta.empresa) : null,
    contatos: resposta.contatos.map((contato) => ({ nome: oneLine(contato.nome), email: contato.email !== null ? normalizarEmail(contato.email) : null })),
    etapaSugerida,
    valor: resposta.valor !== null ? Math.round(resposta.valor * 100) : null,
    previsao: resposta.previsao,
    proximoPasso: resposta.proximoPasso !== null ? { texto: resposta.proximoPasso.texto, data: resposta.proximoPasso.data } : null,
    justificativa: [base, extra].filter(Boolean).join('\n'),
  }
}

type Outcome = { ok: true; resposta: FunnelResponse } | { ok: false; erro: 'format' | 'failed' }

interface Job {
  abort: AbortController
  done: Promise<FunilPropostaArquivo | null>
}

export function createFunnelExtractService(deps: FunnelExtractDeps): FunnelExtractService {
  const now = deps.now ?? Date.now
  const timeoutMs = deps.timeoutMs ?? FUNNEL_EXTRACT_TIMEOUT_MS
  const jobs = new Map<string, Job>()
  let disposed = false
  const failed: Outcome = { ok: false, erro: 'failed' }

  /** Achar o `claude` e a execução, como no `invites/suggest.ts`. */
  async function call(input: string, signal: AbortSignal): Promise<Outcome> {
    const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
    if (!found.ok || signal.aborted) return failed
    const { result, model } = await runClaudeOneShot(deps, {
      claudePath: found.path,
      purpose: 'funnel-extract',
      model: FUNNEL_EXTRACT_MODEL,
      acpDir: ACP_FUNNEL_DIR,
      systemPrompt: funnelSystemPrompt(),
      parse: funnelParser,
      input,
      label: 'detecção de oportunidade',
      timeoutMs,
      signal,
    })
    if (signal.aborted) return failed
    if (!result.ok) return result.error === 'format' ? { ok: false, erro: 'format' } : failed
    deps.log?.(`[funil] detecção pronta (modelo ${model}, custo ${result.costUsd ?? '?'} US$, ${result.durationMs ?? '?'} ms)`)
    return { ok: true, resposta: result.content }
  }

  /** O prazo vale para tudo (achar o `claude` e a execução): passado ele, a execução é cancelada. */
  async function ask(input: string, signal: AbortSignal): Promise<Outcome> {
    const abort = new AbortController()
    const stop = (): void => abort.abort()
    signal.addEventListener('abort', stop, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<Outcome>((resolve) => {
        timer = setTimeout(() => {
          abort.abort()
          resolve(failed)
        }, timeoutMs)
      })
      return await Promise.race([call(input, abort.signal).catch(() => failed), deadline])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
    }
  }

  async function run(meetingId: string, signal: AbortSignal): Promise<FunilPropostaArquivo | null> {
    const meeting = await deps.meetings.get(meetingId).catch(() => null)
    if (!meeting) return null
    const summary = await deps.summaries.get(meetingId).catch(() => null)
    if (!summary) return null
    const state = await deps.funil.read().catch(() => null)
    const outcome: Outcome = state
      ? await ask(
          funnelInput({
            overview: summary.overview,
            decisions: summary.decisions,
            tasks: summary.tasks,
            participantes: meeting.calendar?.attendees ?? [],
            abertas: oportunidadesAbertas(state),
            etapas: etapasAbertas(state).map((etapa) => etapa.nome),
          }),
          signal,
        )
      : failed
    // App saindo: nada é gravado (a próxima abertura pode detectar de novo).
    if (signal.aborted) return null
    // Reunião excluída enquanto rodava: a proposta não fica órfã.
    if (!(await deps.meetings.get(meetingId).catch(() => null))) return null
    const base = { version: FUNIL_PROPOSTA_VERSION, meetingId, createdAt: new Date(now()).toISOString(), model: `${CLAUDE_MODEL_PREFIX}${FUNNEL_EXTRACT_MODEL}` } as const
    const arquivo: FunilPropostaArquivo = !outcome.ok
      ? { ...base, status: 'dismissed', proposta: null, erro: outcome.erro }
      : outcome.resposta.proposta === null || !state
        ? { ...base, status: 'dismissed', proposta: null }
        : { ...base, status: 'proposed', proposta: normalizarProposta(outcome.resposta.proposta, state) }
    try {
      await deps.proposals.save(arquivo)
    } catch {
      deps.log?.('[funil] a proposta da reunião não foi gravada')
      return null
    }
    deps.log?.(`[funil] detecção gravada (${arquivo.status}${arquivo.erro ? `, ${arquivo.erro}` : ''})`)
    deps.onChange?.(meetingId)
    return arquivo
  }

  return {
    detect(meetingId) {
      if (disposed) return Promise.resolve(null)
      // Um por reunião: o mesmo pedido repetido enquanto roda recebe a mesma resposta.
      const current = jobs.get(meetingId)
      if (current) return current.done
      const abort = new AbortController()
      const job: Job = {
        abort,
        done: run(meetingId, abort.signal)
          .catch(() => null)
          .finally(() => {
            if (jobs.get(meetingId) === job) jobs.delete(meetingId)
          }),
      }
      jobs.set(meetingId, job)
      return job.done
    },

    running: (meetingId) => jobs.has(meetingId),

    async settled(meetingId) {
      await jobs.get(meetingId)?.done
    },

    dispose() {
      disposed = true
      for (const job of jobs.values()) job.abort.abort()
    },
  }
}
