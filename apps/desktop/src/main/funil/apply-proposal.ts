// Contrato 113 (R38 a R40): o que acontece com a proposta de IA de uma reunião. `applyProposal` é o "Criar" /
// "Atualizar" / "Vincular a existente…" do cartão; `dismissProposal` é o "Ignorar"; `autoDetect` é o disparo depois
// do resumo (D8). Toda gravação no funil passa pelo serviço do 110 (para o `scribe:funil-changed` chegar às janelas);
// o store entra só para ler. Nada entra no funil sem um pedido `aplicar`: nenhum caminho automático chama
// `applyProposal`.
import { FUNIL_ERRO_TEXTO, FUNIL_FALHOU_TEXTO, type FunilActionResult, type FunilState } from '../../shared/funil'
import { semAcento } from '../../shared/funil-logic'
import {
  FUNIL_PROPOSTA_DECIDIDA_TEXTO,
  notaCitados,
  type FunilPropostaAplicarRequest,
  type FunilPropostaAplicarResult,
  type FunilPropostaArquivo,
  type FunilPropostaView,
} from '../../shared/funil-proposta'
import type { FunilSettings } from '../../shared/settings-defaults'
import type { MeetingsStore } from '../meetings/store'
import type { FunnelExtractService } from './extract'
import type { FunilProposalStore } from './proposals'
import type { FunilService } from './service'
import type { FunilStore } from './store'

export interface ApplyProposalDeps {
  /** Só a leitura: o estado para conferir a oportunidade, os contatos e as etapas. */
  store: Pick<FunilStore, 'read'>
  /** As gravações (contatos, oportunidade, nota), pelo serviço do 110. */
  funil: Pick<FunilService, 'contatoSave' | 'oportunidadeSave' | 'oportunidadeMove' | 'eventoAdd'>
  proposals: FunilProposalStore
  meetings: Pick<MeetingsStore, 'get'>
}

export type DismissProposalResult = { ok: true } | { ok: false; erro: 'invalido' | 'nao-encontrado' }

export interface AutoDetectDeps {
  settings: () => Promise<{ funil: FunilSettings }>
  proposals: Pick<FunilProposalStore, 'get'>
  extract: Pick<FunnelExtractService, 'detect' | 'running'>
  /** `smokeFixtures` presente: a detecção automática não roda (R38). */
  smoke: boolean
}

type Falha = Extract<FunilPropostaAplicarResult, { ok: false }>

const recusa = (erro: Falha['erro'], mensagem: string = erro === 'falhou' ? FUNIL_FALHOU_TEXTO : FUNIL_ERRO_TEXTO[erro]): Falha => ({ ok: false, erro, mensagem })

/** Nome comparável de empresa, como no store: sem acento, sem caixa e com espaços simples (D20). */
const chaveNome = (nome: string): string => semAcento(nome).trim().replace(/\s+/g, ' ').toLowerCase()

const unicos = (lista: readonly string[]): string[] => [...new Set(lista)]

/** E-mail vazio no cartão vale como sem e-mail. */
const emailDe = (email: string | null): string | null => (email !== null && email.trim() !== '' ? email.trim() : null)

/** R39: com `acao: 'criar'`, a primeira oportunidade aberta não arquivada da empresa da proposta. */
export function duplicataDa(arquivo: FunilPropostaArquivo | null, state: FunilState): FunilPropostaView['duplicata'] {
  const proposta = arquivo?.proposta
  if (!proposta || proposta.acao !== 'criar' || proposta.empresa === null) return null
  const chave = chaveNome(proposta.empresa)
  const empresa = state.empresas.find((item) => chaveNome(item.nome) === chave)
  if (!empresa) return null
  const abertas = new Set(state.etapas.filter((etapa) => etapa.tipo === 'aberta').map((etapa) => etapa.id))
  const achada = state.oportunidades.find((op) => op.empresaId === empresa.id && !op.arquivado && abertas.has(op.etapaId))
  return achada ? { id: achada.id, titulo: achada.titulo } : null
}

/** O `id` que o serviço devolveu, ou a recusa com o texto dele. */
function idOuFalha(result: FunilActionResult): { ok: true; id: string | null } | Falha {
  return result.ok ? { ok: true, id: result.id } : { ok: false, erro: result.erro, mensagem: result.mensagem }
}

/**
 * "Criar" / "Atualizar" / "Vincular a existente…" (R39). Exige o arquivo `proposed`; erro do funil em qualquer passo
 * devolve o erro e deixa o arquivo `proposed` (o que já foi gravado antes, como um contato, fica).
 */
export async function applyProposal(deps: ApplyProposalDeps, request: FunilPropostaAplicarRequest): Promise<FunilPropostaAplicarResult> {
  const { meetingId, campos, vincularA } = request
  const arquivo = await deps.proposals.get(meetingId)
  if (!arquivo) return recusa('nao-encontrado')
  if (arquivo.status !== 'proposed') return recusa('invalido', FUNIL_PROPOSTA_DECIDIDA_TEXTO)
  if (!arquivo.proposta) return recusa('nao-encontrado')
  if (!(await deps.meetings.get(meetingId))) return recusa('nao-encontrado')
  const proposta = arquivo.proposta
  let state = await deps.store.read()

  // A oportunidade de `vincularA` ou do `atualizar` é conferida antes de qualquer gravação: ganha ou perdida depois da
  // detecção não é reaberta sem aviso.
  const alvoId = vincularA ?? (proposta.acao === 'atualizar' ? proposta.oportunidadeId : undefined)
  if (alvoId !== undefined) {
    const alvo = state.oportunidades.find((op) => op.id === alvoId)
    const etapa = alvo && state.etapas.find((item) => item.id === alvo.etapaId)
    if (!alvo || alvo.arquivado || etapa?.tipo !== 'aberta') return recusa('nao-encontrado')
  }

  // Contatos com e-mail: cria ou mescla (R4). Sem e-mail, só o nome na nota "Citados na reunião".
  const contatoIds: string[] = []
  const citados: string[] = []
  for (const contato of campos.contatos) {
    const email = emailDe(contato.email)
    if (email === null) {
      citados.push(contato.nome.trim())
      continue
    }
    const salvo = idOuFalha(await deps.funil.contatoSave({ contato: { nome: contato.nome, emails: [email], telefones: [] }, origem: 'reuniao' }))
    if (!salvo.ok) return salvo
    if (salvo.id !== null) contatoIds.push(salvo.id)
  }
  state = await deps.store.read()

  let oportunidadeId: string
  if (vincularA !== undefined) {
    // Só a reunião e os contatos novos; nada mais muda.
    const alvo = state.oportunidades.find((op) => op.id === vincularA)
    if (!alvo) return recusa('nao-encontrado')
    const salvo = idOuFalha(
      await deps.funil.oportunidadeSave({
        oportunidade: { id: alvo.id, titulo: alvo.titulo, contatoIds: unicos([...alvo.contatoIds, ...contatoIds]), meetingIds: unicos([...alvo.meetingIds, meetingId]) },
      }),
    )
    if (!salvo.ok) return salvo
    oportunidadeId = alvo.id
  } else if (proposta.acao === 'atualizar' && proposta.oportunidadeId !== undefined) {
    const alvo = state.oportunidades.find((op) => op.id === proposta.oportunidadeId)
    if (!alvo) return recusa('nao-encontrado')
    // Etapa diferente: o movimento do quadro (R6), com o evento `etapa`.
    if (campos.etapaId !== alvo.etapaId) {
      const movido = idOuFalha(await deps.funil.oportunidadeMove({ id: alvo.id, etapaId: campos.etapaId, ordem: 0 }))
      if (!movido.ok) return movido
    }
    const salvo = idOuFalha(
      await deps.funil.oportunidadeSave({
        oportunidade: {
          id: alvo.id,
          titulo: alvo.titulo,
          contatoIds: unicos([...alvo.contatoIds, ...contatoIds]),
          proximoPasso: campos.proximoPasso,
          ...(campos.valor !== null ? { valor: campos.valor } : {}),
          meetingIds: unicos([...alvo.meetingIds, meetingId]),
        },
      }),
    )
    if (!salvo.ok) return salvo
    oportunidadeId = alvo.id
  } else {
    const salvo = idOuFalha(
      await deps.funil.oportunidadeSave({
        oportunidade: {
          titulo: campos.titulo,
          empresaNome: campos.empresa,
          contatoIds: unicos(contatoIds),
          etapaId: campos.etapaId,
          valor: campos.valor,
          previsao: campos.previsao,
          proximoPasso: campos.proximoPasso,
          meetingIds: [meetingId],
          origem: 'reuniao',
        },
      }),
    )
    if (!salvo.ok) return salvo
    if (salvo.id === null) return recusa('falhou')
    oportunidadeId = salvo.id
  }

  // R39: os citados sem e-mail viram uma nota na oportunidade criada ou atualizada.
  const nomes = citados.filter(Boolean)
  if (vincularA === undefined && nomes.length > 0) {
    const nota = idOuFalha(await deps.funil.eventoAdd({ oportunidadeId, texto: notaCitados(nomes) }))
    if (!nota.ok) return nota
  }

  await deps.proposals.save({ ...arquivo, status: 'accepted', oportunidadeId })
  return { ok: true, oportunidadeId }
}

/** "Ignorar": `proposed` vira `dismissed` (sem `erro`). */
export async function dismissProposal(deps: Pick<ApplyProposalDeps, 'proposals'>, meetingId: string): Promise<DismissProposalResult> {
  const arquivo = await deps.proposals.get(meetingId)
  if (!arquivo) return { ok: false, erro: 'nao-encontrado' }
  if (arquivo.status !== 'proposed') return { ok: false, erro: 'invalido' }
  const { erro: _erro, ...resto } = arquivo
  await deps.proposals.save({ ...resto, status: 'dismissed' })
  return { ok: true }
}

/**
 * Disparo depois do resumo (R38, D8): só fora do smoke, com `funil.detectarNasReunioes` ligado, sem arquivo da reunião e
 * sem detecção em curso. Não espera a detecção; devolve se disparou.
 */
export async function autoDetect(deps: AutoDetectDeps, meetingId: string): Promise<boolean> {
  if (deps.smoke) return false
  if (!(await deps.settings()).funil.detectarNasReunioes) return false
  if ((await deps.proposals.get(meetingId)) !== null) return false
  if (deps.extract.running(meetingId)) return false
  void deps.extract.detect(meetingId)
  return true
}
