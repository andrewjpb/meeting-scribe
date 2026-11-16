// Campos de texto do bloco "Marca" (funções puras, testadas em test/renderer/brand-fields.test.ts). O que
// a pessoa digita vira a mudança gravada: `undefined` quando nada mudou; o texto do padrão vira `null`.
import { DEFAULT_BRAND_NAME, DEFAULT_BRAND_SUBTITLE } from '@shared/branding'

/** O que o campo mostra: o texto gravado, ou vazio (com o padrão no placeholder). */
export const brandFieldValue = (saved: string | null): string => saved ?? ''

/** Nome do app: vazio ou igual ao padrão volta ao padrão (`null`). */
export function brandNameChange(draft: string, saved: string | null): string | null | undefined {
  const text = draft.trim()
  if (text === brandFieldValue(saved).trim()) return undefined
  return text === '' || text === DEFAULT_BRAND_NAME ? null : text
}

/**
 * O subtítulo aparece preenchido com o padrão ("LAP Software") quando nada foi gravado: assim apagar o
 * campo é o jeito de tirar a linha, inclusive a partir do padrão.
 */
export const subtitleFieldValue = (saved: string | null): string => saved ?? DEFAULT_BRAND_SUBTITLE

/** Subtítulo: vazio tira a linha (`''`); igual ao padrão volta ao padrão (`null`). */
export function brandSubtitleChange(draft: string, saved: string | null): string | null | undefined {
  const text = draft.trim()
  if (text === subtitleFieldValue(saved).trim()) return undefined
  return text === DEFAULT_BRAND_SUBTITLE ? null : text
}
