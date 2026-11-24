// Esquema zod da triagem do WhatsApp (contrato 159). Separado de `triagem.ts` para o renderer, que só usa os tipos e
// as regras, não carregar o zod. O main valida com estes esquemas o arquivo `whatsapp/triagem.json`.
import { z } from 'zod'
import { TRIAGEM_AMBITOS, TRIAGEM_MOTIVO_MAX, TRIAGEM_VERSION } from './triagem'
import { WHATSAPP_CHAT_ID_PATTERN } from './whatsapp'

export const triagemChatIdSchema = z.string().regex(WHATSAPP_CHAT_ID_PATTERN)
const ambitoSchema = z.enum(TRIAGEM_AMBITOS)

export const etiquetaSchema = z
  .object({
    urgente: z.boolean(),
    ambito: ambitoSchema.nullable(),
    ambitoFixo: z.boolean(),
    urgenteFixo: z.boolean(),
    origem: z.enum(['agente', 'manual']),
    lastMessageId: z.string().min(1).nullable(),
    motivo: z.string().max(TRIAGEM_MOTIVO_MAX).nullable(),
    at: z.number().int().nonnegative(),
  })
  .strict()

export const triagemFileSchema = z
  .object({
    version: z.literal(TRIAGEM_VERSION),
    etiquetas: z.record(triagemChatIdSchema, etiquetaSchema),
  })
  .strict()
