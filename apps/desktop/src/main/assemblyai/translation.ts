// Tradução avulsa de um trecho (CA9): mesmo modelo e mesma instrução do `llm_gateway`, chamados
// direto em `/v1/chat/completions` quando a resposta da própria conexão não chegou em 5 s.
// Reaproveita o cliente do contrato 03 (401 vira `refused`, 400 de modelo vira `not-allowed`).
// O pedido vem do renderer e é validado aqui antes de qualquer chamada: idiomas da lista, modelo no
// formato de id e texto não vazio com tamanho limitado.
import { z } from 'zod'
import { translationMessage, type TranslateTurnResult } from '../../shared/transcription'
import { LANGUAGE_CODES, type LanguageCode } from '../../shared/settings-defaults'
import { modelIdSchema } from '../settings/schema'
import { GatewayError, type GatewayClient } from './gateway'

/** Um turno longo de fala contínua cabe com folga; acima disso o pedido é recusado. */
export const TRANSLATE_TEXT_MAX = 10_000

const requestSchema = z
  .object({
    text: z
      .string()
      .max(TRANSLATE_TEXT_MAX)
      .refine((value) => value.trim() !== ''),
    source: z.enum(LANGUAGE_CODES),
    target: z.enum(LANGUAGE_CODES),
    model: modelIdSchema,
  })
  .strict()

export interface TranslateTurnRequest {
  text: string
  source: LanguageCode
  target: LanguageCode
  model: string
}

export interface TranslationService {
  /** Pedido fora do formato rejeita (como `scribe:model-select`), sem tocar o gateway. */
  translate(request: unknown): Promise<TranslateTurnResult>
}

export function createTranslationService(gateway: GatewayClient): TranslationService {
  return {
    async translate(request) {
      const parsed = requestSchema.safeParse(request)
      if (!parsed.success) throw new Error('pedido de tradução inválido')
      const { text, source, target, model }: TranslateTurnRequest = parsed.data
      try {
        const result = await gateway.chat({ model, messages: [{ role: 'user', content: translationMessage(source, target, text) }] })
        const translation = result.content.trim()
        if (!translation) return { ok: false, error: 'server' }
        return { ok: true, translation, model: result.model }
      } catch (error) {
        const kind = error instanceof GatewayError ? error.kind : 'server'
        if (kind === 'unauthorized') return { ok: false, error: 'refused' }
        if (kind === 'not-allowed') return { ok: false, error: 'not-allowed' }
        if (kind === 'network' || kind === 'timeout') return { ok: false, error: 'network' }
        return { ok: false, error: 'server' }
      }
    },
  }
}
