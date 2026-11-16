// Esquema de `settings.json`. Cada campo tem o próprio padrão (N5 da spec): um valor inválido cai no
// padrão daquele campo sem descartar os demais. Mudanças vindas do renderer passam por um esquema
// estrito à parte, que recusa em vez de corrigir e não aceita `translationModel`: o modelo só muda
// pelo seletor, depois de o gateway confirmar que ele responde (`SettingsStore.setTranslationModel`).
// `claudePath` segue a mesma regra: só depois de `claude --version` responder (`setClaudePath`).
// `audioFolder` também fica de fora: só o diálogo nativo do main a escolhe (`setAudioFolder`).
// `brandLogo` idem: só o main grava, depois de conferir e copiar a imagem (`setBrandLogo`).
import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { BRAND_LOGO_PATTERN, BRAND_TEXT_MAX } from '../../shared/branding'
import { CLAUDE_MODELS, DEFAULT_SETTINGS, LANGUAGE_CODES, THEME_SETTINGS, TRANSLATION_ENGINES, type AppSettings, type SettingsPatch } from '../../shared/settings-defaults'

export const SETTINGS_VERSION = 1

/** Id de modelo: até 128 caracteres ASCII imprimíveis, sem espaço. */
export const MODEL_ID_PATTERN = /^[\x21-\x7E]{1,128}$/
export const modelIdSchema = z.string().regex(MODEL_ID_PATTERN)
const deviceId = z.string().min(1).max(512).nullable()
/** Caminho absoluto, sem caractere de controle; o `claude` só é aceito depois de responder `--version`. */
export const CLAUDE_PATH_MAX = 1024
export const claudePathSchema = z
  .string()
  .min(1)
  .max(CLAUDE_PATH_MAX)
  .refine((value) => isAbsolute(value) && ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f))

/** Pasta dos arquivos da reunião: caminho absoluto, mesma regra do caminho do `claude`. */
export const audioFolderSchema = claudePathSchema

/** Sem caractere de controle (quebra de linha inclusive). */
const hasNoControlChar = (value: string): boolean => ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)

/** Nome da marca: aparado, de 1 a 40 caracteres, numa linha só. */
export const brandNameSchema = z.string().trim().min(1).max(BRAND_TEXT_MAX).refine(hasNoControlChar)
/** Subtítulo: aparado, até 40 caracteres, numa linha só; vazio tira o subtítulo. */
export const brandSubtitleSchema = z.string().trim().max(BRAND_TEXT_MAX).refine(hasNoControlChar)
/** Só o nome do arquivo em `userData/branding/`, gerado pelo main. */
export const brandLogoSchema = z.string().regex(BRAND_LOGO_PATTERN)

const D = DEFAULT_SETTINGS

const lenientSchema = z.object({
  translationEnabled: z.boolean().catch(D.translationEnabled),
  translationModel: modelIdSchema.catch(D.translationModel),
  sourceLanguage: z.enum(LANGUAGE_CODES).catch(D.sourceLanguage),
  targetLanguage: z.enum(LANGUAGE_CODES).catch(D.targetLanguage),
  echoCancellation: z.boolean().catch(D.echoCancellation),
  removeEcho: z.boolean().catch(D.removeEcho),
  theme: z.enum(THEME_SETTINGS).catch(D.theme),
  micDeviceId: deviceId.catch(D.micDeviceId),
  translationEngine: z.enum(TRANSLATION_ENGINES).catch(D.translationEngine),
  claudeModel: z.enum(CLAUDE_MODELS).catch(D.claudeModel),
  claudePath: claudePathSchema.nullable().catch(D.claudePath),
  saveToFolder: z.boolean().catch(D.saveToFolder),
  audioFolder: audioFolderSchema.nullable().catch(D.audioFolder),
  summarizeOnStop: z.boolean().catch(D.summarizeOnStop),
  identifySpeakers: z.boolean().catch(D.identifySpeakers),
  brandName: brandNameSchema.nullable().catch(D.brandName),
  brandSubtitle: brandSubtitleSchema.nullable().catch(D.brandSubtitle),
  brandLogo: brandLogoSchema.nullable().catch(D.brandLogo),
  autoCheckUpdates: z.boolean().catch(D.autoCheckUpdates),
})

const patchSchema = z
  .object({
    translationEnabled: z.boolean(),
    sourceLanguage: z.enum(LANGUAGE_CODES),
    targetLanguage: z.enum(LANGUAGE_CODES),
    echoCancellation: z.boolean(),
    removeEcho: z.boolean(),
    theme: z.enum(THEME_SETTINGS),
    micDeviceId: deviceId,
    translationEngine: z.enum(TRANSLATION_ENGINES),
    claudeModel: z.enum(CLAUDE_MODELS),
    saveToFolder: z.boolean(),
    summarizeOnStop: z.boolean(),
    identifySpeakers: z.boolean(),
    brandName: brandNameSchema.nullable(),
    brandSubtitle: brandSubtitleSchema.nullable(),
    autoCheckUpdates: z.boolean(),
  })
  .partial()
  .strict()

/** Lê o conteúdo do arquivo (já como objeto). Qualquer coisa que não seja objeto vira os padrões. */
export function parseSettings(raw: unknown): AppSettings {
  const fields = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}
  // Campo ausente também cai no padrão: `.catch` cobre `undefined`.
  const settings: AppSettings = lenientSchema.parse(fields)
  // Origem e destino iguais no arquivo: o destino volta ao padrão (ou ao outro idioma, se o padrão colidir).
  if (settings.sourceLanguage === settings.targetLanguage) {
    settings.targetLanguage = settings.sourceLanguage === D.targetLanguage ? D.sourceLanguage : D.targetLanguage
  }
  return settings
}

/** Valida uma mudança vinda do renderer; campo desconhecido ou valor inválido lança erro. */
export function parseSettingsPatch(raw: unknown): SettingsPatch {
  const parsed = patchSchema.parse(raw)
  const patch: SettingsPatch = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) Object.assign(patch, { [key]: value })
  }
  return patch
}
