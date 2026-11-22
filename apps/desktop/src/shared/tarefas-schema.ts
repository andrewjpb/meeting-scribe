// Esquema zod de `tarefas.json` (contrato 121). Separado de `tarefas.ts` para o renderer, que só usa os tipos, não
// carregar o zod. O store valida o arquivo na leitura (inválido vai para quarentena) e o estado antes de cada
// gravação (nada fora do formato chega ao disco).
import { z } from 'zod'
import {
  TAREFA_DETALHE_MAX,
  TAREFA_HISTORICO_MAX,
  TAREFA_TITULO_MAX,
  TAREFAS_IGNORADOS_MAX,
  TAREFAS_MAX,
  TAREFAS_VERSION,
  type TarefasArquivo,
} from './tarefas'
import { diaValido } from './tarefas-logic'

const id = z.string().min(1).max(200)
const at = z.number().finite()
const dia = z.string().refine(diaValido, 'data inválida')
const texto = z.string().max(1_000)

const responsavelSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('eu') }),
  z.object({ tipo: z.literal('contato'), contatoId: id }),
  z.object({ tipo: z.literal('nome'), nome: z.string().trim().min(1).max(TAREFA_TITULO_MAX) }),
])

const origemSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('reuniao'), meetingId: id, texto }),
  z.object({ tipo: z.literal('analise'), meetingId: id, texto }),
  z.object({ tipo: z.literal('funil'), oportunidadeId: id }),
  z.object({ tipo: z.literal('email'), accountId: id, id: z.string().min(1).max(1_000), assunto: texto }),
  z.object({ tipo: z.literal('whatsapp'), chatId: id, texto: texto.exactOptional() }),
  z.object({ tipo: z.literal('assistente') }),
  z.object({ tipo: z.literal('automacao'), agentId: id }),
  z.object({ tipo: z.literal('manual') }),
  z.object({ tipo: z.literal('migracao'), de: z.enum(['proximo-passo', 'lembrete']) }),
])

const vinculosSchema = z.object({
  oportunidadeId: id.nullable(),
  contatoIds: z.array(id).max(200),
  empresaId: id.nullable(),
  meetingId: id.nullable(),
  email: z.object({ accountId: id, id: z.string().min(1).max(1_000), assunto: texto, mailbox: texto.nullable() }).nullable(),
  whatsappChatId: id.nullable(),
})

const eventoSchema = z.object({
  tipo: z.enum(['criada', 'prazo', 'lembrete', 'feita', 'reaberta', 'cancelada', 'vinculo', 'responsavel']),
  em: at,
  detalhe: z.string().max(200).exactOptional(),
})

const tarefaSchema = z.object({
  id,
  titulo: z.string().trim().min(1).max(TAREFA_TITULO_MAX),
  detalhe: z.string().max(TAREFA_DETALHE_MAX),
  status: z.enum(['aberta', 'feita', 'cancelada']),
  importante: z.boolean(),
  prazo: dia.nullable(),
  lembreteEm: at.nullable(),
  lembreteDisparadoEm: at.nullable(),
  responsavel: responsavelSchema,
  origem: origemSchema,
  vinculos: vinculosSchema,
  historico: z.array(eventoSchema).max(TAREFA_HISTORICO_MAX),
  criadaEm: at,
  atualizadaEm: at,
  feitaEm: at.nullable(),
})

export const tarefasArquivoSchema = z.object({
  version: z.literal(TAREFAS_VERSION),
  tarefas: z.array(tarefaSchema).max(TAREFAS_MAX),
  ignorados: z.array(z.object({ chave: z.string().min(1).max(400), em: at })).max(TAREFAS_IGNORADOS_MAX),
  migradoEm: at.nullable(),
  ultimoAvisoHojeEm: at.nullable(),
})

// O tipo escrito à mão e o que o esquema produz têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const arquivoMatches: Same<z.infer<typeof tarefasArquivoSchema>, TarefasArquivo> = true
void arquivoMatches
