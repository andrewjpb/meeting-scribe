// Funil de vendas (contrato 111, R38): a proposta de IA de uma reunião, em `userData/meetings/<id>.funil.json`. A
// passada `funnel-extract` lê o resumo e diz se há venda; o arquivo guarda a proposta (ou a falta dela) até a pessoa
// aceitar ou descartar. Só os tipos e os limites: o zod fica em `funil-proposta-schema.ts`, que a tela não importa.
import type { ProximoPasso } from './funil'

export const FUNIL_PROPOSTA_VERSION = 1
export const FUNIL_PROPOSTA_TITULO_MAX = 200
export const FUNIL_PROPOSTA_CONTATOS_MAX = 20
export const FUNIL_PROPOSTA_JUSTIFICATIVA_MAX = 500

export type FunilPropostaStatus = 'proposed' | 'accepted' | 'dismissed'

/** Pessoa do lado do cliente citada na reunião; o e-mail vem dos participantes da agenda, quando há. */
export interface PropostaContato {
  nome: string
  email: string | null
}

/** O que a IA propõe: criar uma oportunidade ou atualizar uma aberta (`oportunidadeId` só com `atualizar`). */
export interface PropostaOportunidade {
  acao: 'criar' | 'atualizar'
  oportunidadeId?: string
  titulo: string
  empresa: string | null
  contatos: PropostaContato[]
  /** Nome de uma etapa aberta do funil. */
  etapaSugerida: string
  /** Centavos de BRL, inteiro `>= 0` (o modelo responde em reais). */
  valor: number | null
  /** `AAAA-MM-DD`. */
  previsao: string | null
  proximoPasso: ProximoPasso | null
  justificativa: string
}

/**
 * O arquivo `meetings/<id>.funil.json`. `proposta: null` com `dismissed`: não havia venda (sem `erro`), a resposta veio
 * fora do formato (`format`) ou o motor falhou (`failed`). `oportunidadeId`: a oportunidade criada ou atualizada ao aceitar.
 */
export interface FunilPropostaArquivo {
  version: typeof FUNIL_PROPOSTA_VERSION
  meetingId: string
  /** ISO 8601. */
  createdAt: string
  model: string
  status: FunilPropostaStatus
  proposta: PropostaOportunidade | null
  oportunidadeId?: string
  erro?: 'format' | 'failed'
}
