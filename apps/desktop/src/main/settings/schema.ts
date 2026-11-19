// Esquema de `settings.json`. Cada campo tem o próprio padrão (N5 da spec): um valor inválido cai no
// padrão daquele campo sem descartar os demais. Mudanças vindas do renderer passam por um esquema
// estrito à parte, que recusa em vez de corrigir e não aceita `translationModel`: o modelo só muda
// pelo seletor, depois de o gateway confirmar que ele responde (`SettingsStore.setTranslationModel`).
// `claudePath` segue a mesma regra: só depois de `claude --version` responder (`setClaudePath`).
// `audioFolder` também fica de fora: só o diálogo nativo do main a escolhe (`setAudioFolder`).
// `brandLogo` idem: só o main grava, depois de conferir e copiar a imagem (`setBrandLogo`).
// As contas de email (contrato 42) ficam no mesmo arquivo, ao lado de `settings`, com a senha cifrada: só o main grava
// (`setEmailAccounts`) e o renderer não as recebe junto com as configurações.
import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { BRAND_LOGO_PATTERN, BRAND_TEXT_MAX } from '../../shared/branding'
import { EMAIL_ACCOUNT_ID_PATTERN, EMAIL_ADDRESS_PATTERN, EMAIL_HOST_PATTERN, EMAIL_POLL_MINUTES, EMAIL_PROTOCOLS, EMAIL_SECURITY, type EmailAccount } from '../../shared/email'
import { AGENT_PROFILES, CALENDAR_IDS_MAX, CALENDAR_LEAD_MINUTES, CHAT_MODELS, CLAUDE_MODELS, CLAUDE_TRANSPORTS, CLOSE_BEHAVIORS, DAILY_RUN_LIMIT_OPTIONS, DEFAULT_SETTINGS, LANGUAGE_CODES, LOCK_AFTER_MINUTES, THEME_SETTINGS, TRANSLATION_ENGINES, type AppSettings, type SettingsPatch } from '../../shared/settings-defaults'

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

/** Minutos do bloqueio automático: só os do seletor (contrato 22). */
const lockAfterMinutesSchema = z.literal(LOCK_AFTER_MINUTES)

/** Agendas escolhidas (contrato 12): ids das APIs, sem caractere de controle; `null` é a principal. */
const calendarIdList = z.array(z.string().min(1).max(1024).refine(hasNoControlChar)).max(CALENDAR_IDS_MAX)
const calendarIdsSchema = z.object({ google: calendarIdList.nullable(), microsoft: calendarIdList.nullable() })

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
  chatModel: z.enum(CHAT_MODELS).catch(D.chatModel),
  claudePath: claudePathSchema.nullable().catch(D.claudePath),
  claudeTransport: z.enum(CLAUDE_TRANSPORTS).catch(D.claudeTransport),
  agentProfile: z.enum(AGENT_PROFILES).catch(D.agentProfile),
  saveToFolder: z.boolean().catch(D.saveToFolder),
  audioFolder: audioFolderSchema.nullable().catch(D.audioFolder),
  summarizeOnStop: z.boolean().catch(D.summarizeOnStop),
  liveCards: z.boolean().catch(D.liveCards),
  whatsappInsights: z.boolean().catch(D.whatsappInsights),
  whatsappAutoCorrect: z.boolean().catch(D.whatsappAutoCorrect),
  whatsappNotifications: z.boolean().catch(D.whatsappNotifications),
  whatsappNotifyGroups: z.boolean().catch(D.whatsappNotifyGroups),
  identifySpeakers: z.boolean().catch(D.identifySpeakers),
  meetSpeakers: z.boolean().catch(D.meetSpeakers),
  brandName: brandNameSchema.nullable().catch(D.brandName),
  brandSubtitle: brandSubtitleSchema.nullable().catch(D.brandSubtitle),
  brandLogo: brandLogoSchema.nullable().catch(D.brandLogo),
  autoCheckUpdates: z.boolean().catch(D.autoCheckUpdates),
  lockUseTouchId: z.boolean().catch(D.lockUseTouchId),
  lockAfterMinutes: lockAfterMinutesSchema.catch(D.lockAfterMinutes),
  lockOnSystemLock: z.boolean().catch(D.lockOnSystemLock),
  lockOnLaunch: z.boolean().catch(D.lockOnLaunch),
  saveToDrive: z.boolean().catch(D.saveToDrive),
  closeBehavior: z.enum(CLOSE_BEHAVIORS).catch(D.closeBehavior),
  openAtLogin: z.boolean().catch(D.openAtLogin),
  scheduledRunsDailyLimit: z.literal(DAILY_RUN_LIMIT_OPTIONS).catch(D.scheduledRunsDailyLimit),
  calendarAlerts: z.boolean().catch(D.calendarAlerts),
  calendarLeadMinutes: z.literal(CALENDAR_LEAD_MINUTES).catch(D.calendarLeadMinutes),
  calendarNotRecordingAlert: z.boolean().catch(D.calendarNotRecordingAlert),
  // Cada conta à parte: uma lista inválida volta à principal sem perder a da outra conta.
  calendarIds: z
    .object({ google: calendarIdList.nullable().catch(null), microsoft: calendarIdList.nullable().catch(null) })
    .catch({ google: null, microsoft: null }),
  emailPollMinutes: z.literal(EMAIL_POLL_MINUTES).catch(D.emailPollMinutes),
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
    chatModel: z.enum(CHAT_MODELS),
    claudeTransport: z.enum(CLAUDE_TRANSPORTS),
    agentProfile: z.enum(AGENT_PROFILES),
    saveToFolder: z.boolean(),
    summarizeOnStop: z.boolean(),
    liveCards: z.boolean(),
    whatsappInsights: z.boolean(),
    whatsappAutoCorrect: z.boolean(),
    whatsappNotifications: z.boolean(),
    whatsappNotifyGroups: z.boolean(),
    identifySpeakers: z.boolean(),
    meetSpeakers: z.boolean(),
    brandName: brandNameSchema.nullable(),
    brandSubtitle: brandSubtitleSchema.nullable(),
    autoCheckUpdates: z.boolean(),
    lockUseTouchId: z.boolean(),
    lockAfterMinutes: lockAfterMinutesSchema,
    lockOnSystemLock: z.boolean(),
    lockOnLaunch: z.boolean(),
    saveToDrive: z.boolean(),
    closeBehavior: z.enum(CLOSE_BEHAVIORS),
    openAtLogin: z.boolean(),
    scheduledRunsDailyLimit: z.literal(DAILY_RUN_LIMIT_OPTIONS),
    calendarAlerts: z.boolean(),
    calendarLeadMinutes: z.literal(CALENDAR_LEAD_MINUTES),
    calendarNotRecordingAlert: z.boolean(),
    calendarIds: calendarIdsSchema.strict(),
    emailPollMinutes: z.literal(EMAIL_POLL_MINUTES),
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

/** Contrato 42: servidor de email (host, porta e segurança). */
export const emailServerSchema = z
  .object({ host: z.string().max(253).regex(EMAIL_HOST_PATTERN), port: z.number().int().min(1).max(65_535), security: z.enum(EMAIL_SECURITY) })
  .strict()
export const emailIncomingSchema = emailServerSchema.extend({ protocol: z.enum(EMAIL_PROTOCOLS) }).strict()
export const emailAddressSchema = z.string().max(254).regex(EMAIL_ADDRESS_PATTERN)
/** Usuário do servidor: uma linha, sem caractere de controle. */
export const emailUsernameSchema = z.string().min(1).max(254).refine(hasNoControlChar)
export const emailNameSchema = z.string().trim().min(1).max(120).refine(hasNoControlChar)

/**
 * Conta de email gravada em `settings.json` (contrato 42), ao lado de `settings`. `password` é o resultado de
 * `safeStorage.encryptString` em base64: a senha em claro nunca vai ao disco. Só o main lê e grava.
 */
const storedEmailAccountSchema = z
  .object({
    id: z.string().regex(EMAIL_ACCOUNT_ID_PATTERN),
    address: emailAddressSchema,
    name: emailNameSchema.nullable(),
    username: emailUsernameSchema,
    incoming: emailIncomingSchema,
    outgoing: emailServerSchema,
    deleteFromServer: z.boolean(),
    password: z.string().min(1).max(8192).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()
export type StoredEmailAccount = EmailAccount & { password: string }

/** Lista do arquivo: conta inválida (ou id repetido) sai sozinha, sem levar as outras. */
export function parseEmailAccounts(raw: unknown): StoredEmailAccount[] {
  if (!Array.isArray(raw)) return []
  const accounts: StoredEmailAccount[] = []
  for (const item of raw.slice(0, 50)) {
    const parsed = storedEmailAccountSchema.safeParse(item)
    if (parsed.success && !accounts.some((account) => account.id === parsed.data.id)) accounts.push(parsed.data)
  }
  return accounts
}

/** Só para o main: confere a lista antes de gravar; uma conta fora do formato lança erro. */
export function checkEmailAccounts(accounts: readonly StoredEmailAccount[]): StoredEmailAccount[] {
  return z.array(storedEmailAccountSchema).max(50).parse(accounts)
}
