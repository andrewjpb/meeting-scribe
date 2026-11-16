// Marca escolhida em Configurações (contrato 09): nome, subtítulo e logo que o app mostra por dentro
// (barra lateral, título da janela, avisos, painel "Sobre"). O nome do pacote (`app.setName`, que fixa o
// `userData` e o Chaveiro) não muda; o nome no Finder, no Dock e no menu vem do empacotamento.
import type { AppSettings } from './settings-defaults'

export const DEFAULT_BRAND_NAME = 'LAP Reuniões'
export const DEFAULT_BRAND_SUBTITLE = 'LAP Software'
/** Nome e subtítulo: até 40 caracteres. */
export const BRAND_TEXT_MAX = 40
/** Nome do arquivo do logo em `userData/branding/`; nada além disso é lido. */
export const BRAND_LOGO_PATTERN = /^logo-[a-f0-9]{8,64}\.png$/
/** Imagem escolhida: até 2 MB. */
export const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024
/** O logo é guardado com no máximo 512 px no lado maior. */
export const BRAND_LOGO_MAX_SIDE = 512
export const BRAND_LOGO_INVALID_MESSAGE = 'Não deu para usar esta imagem. Use PNG ou JPG de até 2 MB.'

/** O que o renderer recebe: textos prontos e o logo como data URL PNG, nunca um caminho. */
export interface BrandingInfo {
  name: string
  /** Texto vazio: sem subtítulo. */
  subtitle: string
  logoDataUrl: string | null
}

/** Resultado de "Escolher imagem…". */
export type BrandLogoChoice = 'chosen' | 'canceled' | 'invalid'

/** Nome e subtítulo que valem, com os padrões no lugar de `null`. */
export function brandTexts(settings: Pick<AppSettings, 'brandName' | 'brandSubtitle'>): { name: string; subtitle: string } {
  return { name: settings.brandName ?? DEFAULT_BRAND_NAME, subtitle: settings.brandSubtitle ?? DEFAULT_BRAND_SUBTITLE }
}
