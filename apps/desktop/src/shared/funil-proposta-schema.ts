// Contrato 111: os esquemas zod da detecção de oportunidade, só no main e nos testes. `funnelResponseSchema` é o JSON
// que o modelo devolve (valor em reais, ainda sem as correções da R38); `funilPropostaArquivoSchema` é o arquivo
// `meetings/<id>.funil.json` (valor em centavos), conferido contra o tipo escrito à mão em `funil-proposta.ts`.
import { z } from 'zod'
import { FUNIL_PROPOSTA_CONTATOS_MAX, FUNIL_PROPOSTA_JUSTIFICATIVA_MAX, FUNIL_PROPOSTA_TITULO_MAX, FUNIL_PROPOSTA_VERSION, type FunilPropostaArquivo } from './funil-proposta'

const id = z.string().min(1).max(200)
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const titulo = z.string().trim().min(1).max(FUNIL_PROPOSTA_TITULO_MAX)
const email = z.string().trim().max(320)
const texto = z.string().trim().min(1).max(FUNIL_PROPOSTA_JUSTIFICATIVA_MAX)
const justificativa = z.string().max(FUNIL_PROPOSTA_JUSTIFICATIVA_MAX)
/** Na resposta do modelo, texto vazio (ou só espaços) num campo que aceita `null` vale como `null`. */
const blankToNull = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), schema.nullable())

/**
 * A resposta do modelo: só a chave `proposta`, com estas chaves e estes tipos; qualquer outra coisa é `format`.
 * `oportunidadeId: null` vale como ausente (o modelo costuma escrever o `null` com `criar`); texto vazio nos campos
 * que aceitam `null` vale como `null`.
 */
export const funnelResponseSchema = z
  .object({
    proposta: z
      .object({
        acao: z.enum(['criar', 'atualizar']),
        oportunidadeId: blankToNull(id).optional(),
        titulo,
        empresa: blankToNull(titulo),
        contatos: z
          .array(z.object({ nome: titulo, email: blankToNull(email) }).strict())
          .max(FUNIL_PROPOSTA_CONTATOS_MAX),
        etapaSugerida: titulo,
        /** Reais. */
        valor: z
          .number()
          .finite()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER / 100)
          .nullable(),
        previsao: blankToNull(dia),
        proximoPasso: z.object({ texto, data: blankToNull(dia) }).strict().nullable(),
        justificativa,
      })
      .strict()
      .nullable(),
  })
  .strict()
export type FunnelResponse = z.infer<typeof funnelResponseSchema>

const propostaSchema = z.object({
  acao: z.enum(['criar', 'atualizar']),
  oportunidadeId: id.exactOptional(),
  titulo: z.string().min(1).max(FUNIL_PROPOSTA_TITULO_MAX),
  empresa: z.string().min(1).max(FUNIL_PROPOSTA_TITULO_MAX).nullable(),
  contatos: z
    .array(z.object({ nome: z.string().min(1).max(FUNIL_PROPOSTA_TITULO_MAX), email: z.string().max(320).nullable() }))
    .max(FUNIL_PROPOSTA_CONTATOS_MAX),
  etapaSugerida: z.string().min(1).max(FUNIL_PROPOSTA_TITULO_MAX),
  /** Centavos. */
  valor: z.number().int().min(0).nullable(),
  previsao: dia.nullable(),
  proximoPasso: z.object({ texto: z.string().min(1).max(FUNIL_PROPOSTA_JUSTIFICATIVA_MAX), data: dia.nullable() }).nullable(),
  justificativa,
})

export const funilPropostaArquivoSchema = z.object({
  version: z.literal(FUNIL_PROPOSTA_VERSION),
  meetingId: id,
  createdAt: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  status: z.enum(['proposed', 'accepted', 'dismissed']),
  proposta: propostaSchema.nullable(),
  oportunidadeId: id.exactOptional(),
  erro: z.enum(['format', 'failed']).exactOptional(),
})

// O tipo escrito à mão e o que o esquema produz têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const arquivoMatches: Same<z.infer<typeof funilPropostaArquivoSchema>, FunilPropostaArquivo> = true
void arquivoMatches
