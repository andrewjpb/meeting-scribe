// Esquema zod de `funil.json` (contrato 107). Separado de `funil.ts` para o renderer, que só usa os tipos, não
// carregar o zod. O store valida o arquivo na leitura (inválido vai para quarentena, R2) e o estado antes de
// cada gravação (nada fora do formato chega ao disco).
import { z } from 'zod'
import {
  FUNIL_CONTATOS_MAX,
  FUNIL_EMAILS_MAX,
  FUNIL_EMPRESAS_MAX,
  FUNIL_ETAPA_NOME_MAX,
  FUNIL_EVENTOS_MAX,
  FUNIL_NOME_MAX,
  FUNIL_NOTAS_MAX,
  FUNIL_OPORTUNIDADE_EMAILS_MAX,
  FUNIL_OPORTUNIDADES_MAX,
  FUNIL_TELEFONES_MAX,
  FUNIL_VERSION,
  type FunilState,
} from './funil'

const id = z.string().min(1).max(200)
const at = z.number().finite()
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nome = z.string().min(1).max(FUNIL_NOME_MAX)
const notas = z.string().max(FUNIL_NOTAS_MAX)
const vinculos = z.array(id).max(FUNIL_OPORTUNIDADE_EMAILS_MAX)

const contatoSchema = z.object({
  id,
  nome,
  emails: z.array(z.string().min(3).max(320)).max(FUNIL_EMAILS_MAX),
  telefones: z.array(z.string().min(1).max(40)).max(FUNIL_TELEFONES_MAX),
  empresaId: id.nullable(),
  cargo: z.string().max(FUNIL_NOME_MAX).nullable(),
  notas,
  whatsappChatId: id.nullable(),
  origem: z.enum(['manual', 'importacao', 'reuniao', 'email', 'whatsapp', 'agenda', 'assistente']),
  criadoEm: at,
  atualizadoEm: at,
  arquivado: z.boolean(),
})

const empresaSchema = z.object({
  id,
  nome,
  dominios: z.array(z.string().min(1).max(253)).max(FUNIL_EMAILS_MAX),
  site: z.string().max(2_000).nullable(),
  notas,
  criadoEm: at,
  atualizadoEm: at,
})

const etapaSchema = z.object({
  id,
  nome: z.string().min(1).max(FUNIL_ETAPA_NOME_MAX),
  tipo: z.enum(['aberta', 'ganho', 'perdido']),
  ordem: z.number().int().min(0),
})

const oportunidadeSchema = z.object({
  id,
  titulo: nome,
  empresaId: id.nullable(),
  contatoIds: vinculos,
  etapaId: id,
  ordem: z.number().int().min(0),
  valor: z.number().int().min(0).nullable(),
  previsao: dia.nullable(),
  proximoPasso: z.object({ texto: z.string().min(1).max(FUNIL_NOTAS_MAX), data: dia.nullable() }).nullable(),
  meetingIds: vinculos,
  whatsappChatIds: vinculos,
  emails: z
    .array(z.object({ accountId: id, id: z.string().min(1).max(1_000), assunto: z.string().max(1_000), de: z.string().max(1_000), data: at }))
    .max(FUNIL_OPORTUNIDADE_EMAILS_MAX),
  origem: z.enum(['manual', 'reuniao', 'assistente']),
  motivoPerda: z.string().max(FUNIL_NOTAS_MAX).nullable(),
  criadoEm: at,
  atualizadoEm: at,
  movidoEm: at,
  fechadoEm: at.nullable(),
  arquivado: z.boolean(),
})

const eventoSchema = z.object({
  id,
  oportunidadeId: id,
  at,
  tipo: z.enum(['criada', 'etapa', 'valor', 'proximo-passo', 'nota', 'vinculo', 'ganho', 'perdido', 'reaberta']),
  texto: z.string().max(FUNIL_NOTAS_MAX),
  de: z.string().max(FUNIL_ETAPA_NOME_MAX).exactOptional(),
  para: z.string().max(FUNIL_ETAPA_NOME_MAX).exactOptional(),
})

export const funilStateSchema = z.object({
  version: z.literal(FUNIL_VERSION),
  contatos: z.array(contatoSchema).max(FUNIL_CONTATOS_MAX),
  empresas: z.array(empresaSchema).max(FUNIL_EMPRESAS_MAX),
  oportunidades: z.array(oportunidadeSchema).max(FUNIL_OPORTUNIDADES_MAX),
  etapas: z.array(etapaSchema),
  eventos: z.array(eventoSchema).max(FUNIL_EVENTOS_MAX),
  ignorados: z.array(z.object({ chave: z.string().min(1).max(400), at })),
  ultimoAvisoEm: at.nullable().catch(null),
})

// O tipo escrito à mão e o que o esquema produz têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const stateMatches: Same<z.infer<typeof funilStateSchema>, FunilState> = true
void stateMatches
