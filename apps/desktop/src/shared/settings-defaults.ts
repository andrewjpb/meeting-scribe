// Configurações do app: tipos, padrões (N5 da spec) e a regra de troca de idiomas. O esquema que valida
// o arquivo e o store que grava ficam no main (`main/settings/`); o renderer lê pelo `settingsStore`.
import type { EmailPollMinutes } from './email'

export const LANGUAGE_CODES = ['pt', 'en', 'es', 'ja', 'ko', 'zh'] as const
export const THEME_SETTINGS = ['system', 'light', 'dark'] as const
/** Quem traduz: o LLM Gateway da AssemblyAI (na própria conexão) ou o `claude` instalado na máquina. */
export const TRANSLATION_ENGINES = ['assemblyai', 'claude-cli'] as const
/** Modelos do Claude CLI que o app oferece (aliases do próprio `claude --model`). */
export const CLAUDE_MODELS = ['haiku', 'sonnet'] as const
/** Modelos do chat sobre as reuniões (contrato 15): também aliases do `claude --model`. */
export const CHAT_MODELS = ['haiku', 'sonnet', 'opus'] as const
/**
 * Como o app fala com o Claude na tradução, no resumo e no chat (contrato 17): o agente oficial pelo ACP
 * (padrão) ou a linha de comando `claude -p` dos contratos 05, 08 e 16, que fica de reserva.
 */
export const CLAUDE_TRANSPORTS = ['acp', 'cli'] as const
/** Perfil do agente ACP (contrato 17, CA11): só o Claude por enquanto. */
export const AGENT_PROFILES = ['claude'] as const
/** "Bloquear sozinho depois de … min sem uso" (contrato 22); 0 é nunca. */
export const LOCK_AFTER_MINUTES = [0, 1, 5, 15, 30] as const
/** "Ao fechar a janela" (contrato 23): continua na barra de menus (padrão) ou sai do app. */
export const CLOSE_BEHAVIORS = ['tray', 'quit'] as const
/** "Limite diário de execuções agendadas" (contrato 23, CA10). */
export const DAILY_RUN_LIMIT_OPTIONS = [10, 25, 50, 100, 200] as const
/** "Avisar antes" das reuniões da agenda (contrato 12, CA3), em minutos. */
export const CALENDAR_LEAD_MINUTES = [1, 5, 10] as const
/** Agendas escolhidas por conta; até isto por conta. */
export const CALENDAR_IDS_MAX = 50

export type LanguageCode = (typeof LANGUAGE_CODES)[number]
export type ThemeSetting = (typeof THEME_SETTINGS)[number]
export type TranslationEngine = (typeof TRANSLATION_ENGINES)[number]
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]
export type ChatModel = (typeof CHAT_MODELS)[number]
export type ClaudeTransport = (typeof CLAUDE_TRANSPORTS)[number]
export type AgentProfileId = (typeof AGENT_PROFILES)[number]
export type LockAfterMinutes = (typeof LOCK_AFTER_MINUTES)[number]
export type CloseBehavior = (typeof CLOSE_BEHAVIORS)[number]
export type DailyRunLimitOption = (typeof DAILY_RUN_LIMIT_OPTIONS)[number]
export type CalendarLeadMinutes = (typeof CALENDAR_LEAD_MINUTES)[number]
/** Agendas lidas de cada conta (contrato 12); `null` é só a principal. */
export interface CalendarSelection {
  google: string[] | null
  microsoft: string[] | null
}
/** Nome de cada agente na tela ("Conexão com o Claude"); o perfil do main usa o mesmo. */
export const AGENT_PROFILE_LABELS: Readonly<Record<AgentProfileId, string>> = { claude: 'Claude' }

export interface AppSettings {
  translationEnabled: boolean
  translationModel: string
  sourceLanguage: LanguageCode
  targetLanguage: LanguageCode
  echoCancellation: boolean
  /** Some com o trecho do microfone que repete a fala do sistema (eco do alto-falante, contrato 06). */
  removeEcho: boolean
  theme: ThemeSetting
  /** `null` é o padrão do sistema. */
  micDeviceId: string | null
  translationEngine: TranslationEngine
  claudeModel: ClaudeModel
  /** Modelo do chat do "Assistente" (contratos 15 e 25); o caminho do `claude` é o mesmo da tradução. */
  chatModel: ChatModel
  /** Caminho do `claude` escolhido pelo usuário; `null` procura sozinho. */
  claudePath: string | null
  /** "Conexão com o Claude" (contrato 17): vale para tradução, resumo e chat. */
  claudeTransport: ClaudeTransport
  /** Qual agente o ACP sobe (contrato 17, CA11). */
  agentProfile: AgentProfileId
  /** Grava o áudio e a transcrição de cada reunião numa pasta do Mac (contrato 07). */
  saveToFolder: boolean
  /** Pasta escolhida pelo diálogo do main; `null` é `~/Documents/Meeting Scribe`. */
  audioFolder: string | null
  /** Ao encerrar, o `claude` local escreve o resumo, as decisões e as tarefas (contrato 08). */
  summarizeOnStop: boolean
  /**
   * "IA anotando ao vivo" (contrato 30): valor inicial do interruptor "IA anotando" de cada gravação. Ligado, a cada
   * 5 min o Claude local cria e resolve post-its com o trecho novo da conversa.
   */
  liveCards: boolean
  /**
   * "Detalhes com IA no WhatsApp" (contrato 32): ao abrir uma conversa com o painel Detalhes aberto, o Claude local lê
   * as últimas mensagens e escreve o resumo, o humor, as pendências e os compromissos. Desligado, só os gráficos.
   */
  whatsappInsights: boolean
  /**
   * "Corrigir ao enviar no WhatsApp" (contrato 35): no clique em "Enviar", o Claude (sempre o Haiku) corrige a
   * ortografia, a pontuação e a clareza e o texto corrigido sai sem nova confirmação; se falhar, sai o original.
   */
  whatsappAutoCorrect: boolean
  /**
   * "Notificações do WhatsApp" (contrato 40): cada mensagem recebida vira uma notificação do macOS, menos a da conversa
   * aberta na janela em foco. Bloqueado, sem o texto.
   */
  whatsappNotifications: boolean
  /** "Só pessoas (sem grupos)" desligado: as mensagens de grupo também notificam (contrato 40). */
  whatsappNotifyGroups: boolean
  /**
   * Separa os participantes por voz ("Participante A", "B"…). Desligado (padrão desde 15/11/2026), o
   * áudio dos participantes vira "Participantes" e os trechos se dividem só pelas pausas.
   */
  identifySpeakers: boolean
  /**
   * "Quem fala no Meet" (contrato 27): com a extensão do Chrome, cada fala do Meet ganha o nome de quem falou.
   * Desligado, o servidor local para e nada é coletado.
   */
  meetSpeakers: boolean
  /** Nome do app na barra lateral, no título da janela e nos avisos (contrato 09); `null` é "LAP Reuniões". */
  brandName: string | null
  /** Linha abaixo do nome; `null` é "LAP Software" e texto vazio tira a linha. */
  brandSubtitle: string | null
  /** Arquivo do logo próprio em `userData/branding/` (só o nome); `null` é o símbolo da LAP. */
  brandLogo: string | null
  /** Procura versão nova no GitHub ao abrir o app e a cada 6 h (contrato 14). */
  autoCheckUpdates: boolean
  /** Bloqueio (contrato 22): desbloquear também pelo Touch ID, quando o Mac tem. */
  lockUseTouchId: boolean
  /** Bloqueia sozinho depois destes minutos sem uso do app; 0 é nunca. */
  lockAfterMinutes: LockAfterMinutes
  /** Bloqueia quando o Mac bloqueia a tela ou dorme. */
  lockOnSystemLock: boolean
  /** Abre o app já bloqueado. */
  lockOnLaunch: boolean
  /**
   * "Guardar no Google Drive" (contrato 11): depois de cada reunião, o áudio, a transcrição e o resumo vão para a
   * pasta "LAP Reuniões" do Drive. Só vale com a conta Google conectada; por isso o padrão é ligado (o
   * interruptor aparece ligado depois do primeiro login).
   */
  saveToDrive: boolean
  /**
   * Contrato 23: fechar a janela deixa o app só no ícone da barra de menus (sem Dock), com as tarefas agendadas
   * rodando; ou sai do app.
   */
  closeBehavior: CloseBehavior
  /** Abre ao entrar no Mac, direto na barra de menus, sem janela. */
  openAtLogin: boolean
  /** Execuções agendadas por dia; ao passar, tudo pausa e o app avisa. */
  scheduledRunsDailyLimit: DailyRunLimitOption
  /**
   * Contrato 12: notificação antes de cada reunião das agendas Google e Microsoft. Sem conta com a agenda, nada
   * acontece; por isso o padrão é ligado (vale assim que alguma conta libera a agenda).
   */
  calendarAlerts: boolean
  /** "Avisar antes": minutos antes do início. */
  calendarLeadMinutes: CalendarLeadMinutes
  /** "Avisar se a reunião não estiver sendo gravada": 2 min depois do início, e de novo aos 10 min. */
  calendarNotRecordingAlert: boolean
  /** Quais agendas de cada conta o app lê; `null` é a principal. */
  calendarIds: CalendarSelection
  /**
   * Contrato 42: de quantos em quantos minutos as contas POP3 buscam email novo (o IMAP recebe na hora, pelo IDLE). As
   * contas de email ficam no mesmo `settings.json`, fora daqui (`SettingsStore.getEmailAccounts`): a senha cifrada e os
   * endereços nunca chegam ao renderer pelas configurações.
   */
  emailPollMinutes: EmailPollMinutes
  /**
   * "Notificações de email" (contrato 43): cada email novo vira uma notificação do macOS, menos o da conta com a Caixa
   * de Entrada aberta na janela em foco. Bloqueado, sem o assunto.
   */
  emailNotifications: boolean
  /** Contrato 43: as contas de email recolhidas na barra lateral (as outras aparecem abertas, com as pastas). */
  emailCollapsed: string[]
}

/**
 * Mudança que o renderer pode pedir. `translationModel` fica de fora: só o seletor, depois de o gateway
 * confirmar. `claudePath` também: só o main grava, depois de `claude --version` responder naquele caminho.
 * `audioFolder` só muda pelo diálogo nativo do main: o renderer não escolhe onde o app escreve.
 * `brandLogo` também: só o main grava, depois de conferir e copiar a imagem escolhida no diálogo.
 */
export type SettingsPatch = Partial<Omit<AppSettings, 'translationModel' | 'claudePath' | 'audioFolder' | 'brandLogo'>>

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  translationEnabled: true,
  translationModel: 'qwen3.5-4b-32k-fast',
  sourceLanguage: 'pt',
  targetLanguage: 'en',
  echoCancellation: false,
  removeEcho: true,
  theme: 'system',
  micDeviceId: null,
  translationEngine: 'assemblyai',
  claudeModel: 'haiku',
  chatModel: 'sonnet',
  claudePath: null,
  claudeTransport: 'acp',
  agentProfile: 'claude',
  saveToFolder: true,
  audioFolder: null,
  summarizeOnStop: true,
  liveCards: false,
  whatsappInsights: true,
  whatsappAutoCorrect: false,
  whatsappNotifications: true,
  whatsappNotifyGroups: true,
  identifySpeakers: false,
  meetSpeakers: true,
  brandName: null,
  brandSubtitle: null,
  brandLogo: null,
  autoCheckUpdates: true,
  lockUseTouchId: false,
  lockAfterMinutes: 0,
  lockOnSystemLock: true,
  lockOnLaunch: false,
  saveToDrive: true,
  closeBehavior: 'tray',
  openAtLogin: false,
  scheduledRunsDailyLimit: 50,
  calendarAlerts: true,
  calendarLeadMinutes: 5,
  calendarNotRecordingAlert: true,
  calendarIds: Object.freeze({ google: null, microsoft: null }) as CalendarSelection,
  emailPollMinutes: 5,
  emailNotifications: true,
  emailCollapsed: Object.freeze([]) as unknown as string[],
})

/** Prefixo do modelo gravado na reunião quando a tradução veio do Claude CLI (`claude-cli:haiku`). */
export const CLAUDE_MODEL_PREFIX = 'claude-cli:'

/** Modelo que de fato traduz: o do gateway ou `claude-cli:<modelo>`. */
export function effectiveTranslationModel(settings: Pick<AppSettings, 'translationEngine' | 'translationModel' | 'claudeModel'>): string {
  return settings.translationEngine === 'claude-cli' ? `${CLAUDE_MODEL_PREFIX}${settings.claudeModel}` : settings.translationModel
}

/**
 * Aplica uma mudança. Origem e destino nunca ficam iguais: escolher para um lado o idioma que está do
 * outro troca os dois.
 */
export function applySettingsPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  const next: AppSettings = { ...current, ...patch }
  if (next.sourceLanguage === next.targetLanguage) {
    if (patch.sourceLanguage !== undefined && patch.targetLanguage === undefined) next.targetLanguage = current.sourceLanguage
    else if (patch.targetLanguage !== undefined && patch.sourceLanguage === undefined) next.sourceLanguage = current.targetLanguage
  }
  return next
}
