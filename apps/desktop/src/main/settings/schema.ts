// Esquema de `settings.json`. Cada campo tem o próprio padrão (N5 da spec): um valor inválido cai no
// padrão daquele campo sem descartar os demais. Mudanças vindas do renderer passam por um esquema
// estrito à parte, que recusa em vez de corrigir e não aceita `translationModel`: o modelo só muda
// pelo seletor, depois de o gateway confirmar que ele responde (`SettingsStore.setTranslationModel`).
// `claudePath` segue a mesma regra: só depois de `claude --version` responder (`setClaudePath`).
// `audioFolder` também fica de fora: só o diálogo nativo do main a escolhe (`setAudioFolder`).
// `brandLogo` idem: só o main grava, depois de conferir e copiar a imagem (`setBrandLogo`).
// As contas de email (contrato 42) ficam no mesmo arquivo, ao lado de `settings`, com a senha cifrada: só o main grava
// (`setEmailAccounts`) e o renderer não as recebe junto com as configurações. As assinaturas (contrato 54) também, em
// `emailSignatures`, por id de conta, e as regras (contrato 53), em `emailRules`.
import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { BRAND_LOGO_PATTERN, BRAND_TEXT_MAX } from '../../shared/branding'
import { EMAIL_SIGNATURE_MAX, type EmailSignature } from '../../shared/email-signature'
import { EMAIL_RULES_MAX, emailRuleSchema, type EmailRule } from '../../shared/email-rules'
import { CLAUDE_CONNECTOR_NAME_MAX, CLAUDE_CONNECTORS_MAX, MCP_TOOL_NAME_MAX, MCP_TOOL_POLICIES, MCP_TOOLS_MAX, type ClaudeConnectorPrefs } from '../../shared/mcp'
import { EMAIL_ACCOUNT_ID_PATTERN, EMAIL_ADDRESS_PATTERN, EMAIL_FOLDER_PATH_MAX, EMAIL_HOST_PATTERN, EMAIL_POLL_MINUTES, EMAIL_PROTOCOLS, EMAIL_SECURITY, type EmailAccount } from '../../shared/email'
import { AGENT_PROFILES, CALENDAR_IDS_MAX, CALENDAR_LEAD_MINUTES, CHAT_MODELS, CLAUDE_MODELS, CLAUDE_TRANSPORTS, CLOSE_BEHAVIORS, DAILY_RUN_LIMIT_OPTIONS, DEFAULT_SETTINGS, EMAIL_DASHBOARD_MODELS, FUNIL_DIAS_ESFRIAR_MAX, FUNIL_DIAS_ESFRIAR_MIN, INICIO_TELAS, LANGUAGE_CODES, LOCK_AFTER_MINUTES, TAREFAS_HORA_RE, THEME_SETTINGS, TRANSLATION_ENGINES, type AppSettings, type SettingsPatch } from '../../shared/settings-defaults'
// 73: comentários
import { REDES_POLL_MINUTES } from '../../shared/settings-defaults'
// fim 73

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

/** Contrato 62 (R9): a agenda padrão dos convites, um id do Calendário do Mac, sem caractere de controle. */
const inviteCalendarIdSchema = z.string().min(1).max(1024).refine(hasNoControlChar)

/** Contrato 43: as contas de email recolhidas na barra lateral (só ids de conta). */
const emailCollapsedSchema = z.array(z.string().regex(EMAIL_ACCOUNT_ID_PATTERN)).max(50)

/** Contrato 55: um path de pasta de email (sem quebra de linha nem caractere nulo), como o do mover. */
const emailFolderPath = z
  .string()
  .min(1)
  .max(EMAIL_FOLDER_PATH_MAX)
  .refine((value) => !/[\r\n\0]/.test(value))
/** Contrato 55: as subárvores recolhidas na barra lateral, `<conta>\n<path>`. */
const emailFoldersCollapsedSchema = z
  .array(
    z
      .string()
      .max(EMAIL_FOLDER_PATH_MAX + 40)
      .refine((value) => {
        const at = value.indexOf('\n')
        return at !== -1 && EMAIL_ACCOUNT_ID_PATTERN.test(value.slice(0, at)) && emailFolderPath.safeParse(value.slice(at + 1)).success
      }),
  )
  .max(500)
/** Contrato 55: as até 3 pastas recentes do "Mover", por conta. */
const emailRecentFoldersSchema = z.record(z.string().regex(EMAIL_ACCOUNT_ID_PATTERN), z.array(emailFolderPath).max(3)).refine((value) => Object.keys(value).length <= 50)

/**
 * Contrato 57: os conectores do claude.ai, pelo nome (uma linha, sem caractere de controle), com a política de cada
 * ferramenta pelo nome como o Claude a chama (`mcpToolKey`).
 */
const connectorNameSchema = z.string().min(1).max(CLAUDE_CONNECTOR_NAME_MAX).refine(hasNoControlChar)
const connectorToolSchema = z.string().regex(new RegExp(`^[A-Za-z0-9_-]{1,${MCP_TOOL_NAME_MAX}}$`))
const connectorPrefsSchema = z
  .object({
    enabled: z.boolean(),
    // Contrato 58: já foi ligado alguma vez (o aviso do CA2 só sai na primeira). Opcional: o arquivo antigo carrega igual.
    everEnabled: z.boolean().optional(),
    tools: z.record(connectorToolSchema, z.enum(MCP_TOOL_POLICIES)).refine((tools) => Object.keys(tools).length <= MCP_TOOLS_MAX),
  })
  .strict()
const claudeConnectorsSchema = z.record(connectorNameSchema, connectorPrefsSchema).refine((connectors) => Object.keys(connectors).length <= CLAUDE_CONNECTORS_MAX)
/** No arquivo: um conector fora do formato sai sozinho, sem levar os outros (e sem ligar nada). */
const lenientConnectorsSchema = z
  .record(z.string(), z.unknown())
  .transform((raw) => {
    const connectors: Record<string, ClaudeConnectorPrefs> = {}
    for (const [name, value] of Object.entries(raw).slice(0, CLAUDE_CONNECTORS_MAX)) {
      const parsed = connectorPrefsSchema.safeParse(value)
      if (connectorNameSchema.safeParse(name).success && parsed.success) connectors[name] = parsed.data
    }
    return connectors
  })
  .catch({})

const D = DEFAULT_SETTINGS

/** Contrato 109 (R46): dias para a oportunidade aberta esfriar, inteiro de 1 a 90. */
const funilDiasEsfriarSchema = z.number().int().min(FUNIL_DIAS_ESFRIAR_MIN).max(FUNIL_DIAS_ESFRIAR_MAX)
/** Pelo renderer: os três campos, sempre juntos; qualquer outro valor recusa o pedido inteiro. */
const funilPatchSchema = z.object({ detectarNasReunioes: z.boolean(), diasEsfriar: funilDiasEsfriarSchema, avisarEsfriadas: z.boolean() }).strict()
/** No arquivo: cada campo à parte; um valor inválido volta ao padrão dele sem levar os outros dois. */
const lenientFunilSchema = z
  .object({
    detectarNasReunioes: z.boolean().catch(D.funil.detectarNasReunioes),
    diasEsfriar: funilDiasEsfriarSchema.catch(D.funil.diasEsfriar),
    avisarEsfriadas: z.boolean().catch(D.funil.avisarEsfriadas),
  })
  .catch(() => ({ ...D.funil }))

/** Contrato 128 (R34): hora do lembrete em HH:MM. */
const tarefasHoraSchema = z.string().regex(TAREFAS_HORA_RE)
/** Pelo renderer: os quatro campos, sempre juntos; qualquer outro valor recusa o pedido inteiro. */
const tarefasPatchSchema = z
  .object({ horaLembrete: tarefasHoraSchema, lembrarNoPrazo: z.boolean(), avisoDiario: z.boolean(), sugerirDasReunioes: z.boolean() })
  .strict()
/** No arquivo: cada campo à parte; um valor inválido volta ao padrão dele sem levar os outros. */
const lenientTarefasSchema = z
  .object({
    horaLembrete: tarefasHoraSchema.catch(D.tarefas.horaLembrete),
    lembrarNoPrazo: z.boolean().catch(D.tarefas.lembrarNoPrazo),
    avisoDiario: z.boolean().catch(D.tarefas.avisoDiario),
    sugerirDasReunioes: z.boolean().catch(D.tarefas.sugerirDasReunioes),
  })
  .catch(() => ({ ...D.tarefas }))

/** Contrato 133 (inicio, D13): os cinco blocos da tela Início. */
const inicioBlocosPatchSchema = z
  .object({ agenda: z.boolean(), tarefas: z.boolean(), pendencias: z.boolean(), ultimaReuniao: z.boolean(), automacoes: z.boolean() })
  .strict()
/** Pelo renderer: a tela inicial e os cinco blocos, sempre juntos; qualquer outro valor recusa o pedido inteiro. */
const inicioPatchSchema = z.object({ telaInicial: z.enum(INICIO_TELAS), blocos: inicioBlocosPatchSchema }).strict()
/** No arquivo: cada campo à parte (cada bloco também); um valor inválido volta ao padrão dele sem levar os outros. */
const lenientInicioSchema = z
  .object({
    telaInicial: z.enum(INICIO_TELAS).catch(D.inicio.telaInicial),
    blocos: z
      .object({
        agenda: z.boolean().catch(D.inicio.blocos.agenda),
        tarefas: z.boolean().catch(D.inicio.blocos.tarefas),
        pendencias: z.boolean().catch(D.inicio.blocos.pendencias),
        ultimaReuniao: z.boolean().catch(D.inicio.blocos.ultimaReuniao),
        automacoes: z.boolean().catch(D.inicio.blocos.automacoes),
      })
      .catch(() => ({ ...D.inicio.blocos })),
  })
  .catch(() => ({ telaInicial: D.inicio.telaInicial, blocos: { ...D.inicio.blocos } }))

/** Contrato 155: pelo renderer, os dois campos juntos; qualquer outro valor recusa o pedido inteiro. */
const emailDashboardPatchSchema = z.object({ enabled: z.boolean(), model: z.enum(EMAIL_DASHBOARD_MODELS) }).strict()
/** No arquivo: cada campo à parte; ausente ou inválido volta ao padrão dele sem levar o outro. */
const lenientEmailDashboardSchema = z
  .object({
    enabled: z.boolean().catch(D.emailDashboard.enabled),
    model: z.enum(EMAIL_DASHBOARD_MODELS).catch(D.emailDashboard.model),
  })
  .catch(() => ({ ...D.emailDashboard }))

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
  whatsappTypingSignal: z.boolean().catch(D.whatsappTypingSignal),
  identifySpeakers: z.boolean().catch(D.identifySpeakers),
  meetSpeakers: z.boolean().catch(D.meetSpeakers),
  meetingPrompt: z.boolean().catch(D.meetingPrompt),
  navegadorPlugin: z.boolean().catch(D.navegadorPlugin),
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
  emailNotifications: z.boolean().catch(D.emailNotifications),
  emailCollapsed: emailCollapsedSchema.catch([]),
  inviteCalendarId: inviteCalendarIdSchema.nullable().catch(D.inviteCalendarId),
  inviteAddOnAccept: z.boolean().catch(D.inviteAddOnAccept),
  inviteSuggest: z.boolean().catch(D.inviteSuggest),
  emailFoldersCollapsed: emailFoldersCollapsedSchema.catch([]),
  emailRecentFolders: emailRecentFoldersSchema.catch({}),
  claudeConnectors: lenientConnectorsSchema,
  // 73: comentários
  redesPollMinutes: z.literal(REDES_POLL_MINUTES).catch(D.redesPollMinutes),
  // fim 73
  funil: lenientFunilSchema,
  tarefas: lenientTarefasSchema,
  inicio: lenientInicioSchema,
  emailDashboard: lenientEmailDashboardSchema,
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
    whatsappTypingSignal: z.boolean(),
    identifySpeakers: z.boolean(),
    meetSpeakers: z.boolean(),
    meetingPrompt: z.boolean(),
    navegadorPlugin: z.boolean(),
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
    emailNotifications: z.boolean(),
    emailCollapsed: emailCollapsedSchema,
    inviteCalendarId: inviteCalendarIdSchema.nullable(),
    inviteAddOnAccept: z.boolean(),
    inviteSuggest: z.boolean(),
    emailFoldersCollapsed: emailFoldersCollapsedSchema,
    emailRecentFolders: emailRecentFoldersSchema,
    claudeConnectors: claudeConnectorsSchema,
    // 73: comentários
    redesPollMinutes: z.literal(REDES_POLL_MINUTES),
    // fim 73
    funil: funilPatchSchema,
    tarefas: tarefasPatchSchema,
    inicio: inicioPatchSchema,
    emailDashboard: emailDashboardPatchSchema,
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

/** Contrato 54: a assinatura de uma conta. Quebra de linha e tabulação valem; outro caractere de controle, não. */
export const emailSignatureSchema = z
  .object({
    text: z
      .string()
      .max(EMAIL_SIGNATURE_MAX)
      .refine((value) => ![...value].some((char) => (char.charCodeAt(0) < 0x20 && char !== '\n' && char !== '\t') || char.charCodeAt(0) === 0x7f)),
    onNew: z.boolean(),
    onReply: z.boolean(),
  })
  .strict()

/** Assinaturas do arquivo: a inválida (ou de conta que não está em `accountIds`) sai sozinha, sem levar as outras. */
export function parseEmailSignatures(raw: unknown, accountIds: readonly string[]): Record<string, EmailSignature> {
  const signatures: Record<string, EmailSignature> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return signatures
  for (const [id, value] of Object.entries(raw)) {
    if (!EMAIL_ACCOUNT_ID_PATTERN.test(id) || !accountIds.includes(id)) continue
    const parsed = emailSignatureSchema.safeParse(value)
    if (parsed.success) signatures[id] = parsed.data
  }
  return signatures
}

/**
 * Contrato 53: as regras do arquivo, por conta. A regra inválida (ou de id repetido) sai sozinha, sem levar as outras;
 * conta que não está em `accountIds` sai inteira; passou de 50, o resto fica de fora.
 */
export function parseEmailRules(raw: unknown, accountIds: readonly string[]): Record<string, EmailRule[]> {
  const rules: Record<string, EmailRule[]> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return rules
  for (const [id, value] of Object.entries(raw)) {
    if (!EMAIL_ACCOUNT_ID_PATTERN.test(id) || !accountIds.includes(id) || !Array.isArray(value)) continue
    const list: EmailRule[] = []
    for (const item of value) {
      const parsed = emailRuleSchema.safeParse(item)
      if (parsed.success && list.length < EMAIL_RULES_MAX && !list.some((rule) => rule.id === parsed.data.id)) list.push(parsed.data)
    }
    if (list.length > 0) rules[id] = list
  }
  return rules
}
