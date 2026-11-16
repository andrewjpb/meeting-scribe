// Configurações do app: tipos, padrões (N5 da spec) e a regra de troca de idiomas. O esquema que valida
// o arquivo e o store que grava ficam no main (`main/settings/`); o renderer lê pelo `settingsStore`.

export const LANGUAGE_CODES = ['pt', 'en', 'es', 'ja', 'ko', 'zh'] as const
export const THEME_SETTINGS = ['system', 'light', 'dark'] as const
/** Quem traduz: o LLM Gateway da AssemblyAI (na própria conexão) ou o `claude` instalado na máquina. */
export const TRANSLATION_ENGINES = ['assemblyai', 'claude-cli'] as const
/** Modelos do Claude CLI que o app oferece (aliases do próprio `claude --model`). */
export const CLAUDE_MODELS = ['haiku', 'sonnet'] as const

export type LanguageCode = (typeof LANGUAGE_CODES)[number]
export type ThemeSetting = (typeof THEME_SETTINGS)[number]
export type TranslationEngine = (typeof TRANSLATION_ENGINES)[number]
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]

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
  /** Caminho do `claude` escolhido pelo usuário; `null` procura sozinho. */
  claudePath: string | null
  /** Grava o áudio e a transcrição de cada reunião numa pasta do Mac (contrato 07). */
  saveToFolder: boolean
  /** Pasta escolhida pelo diálogo do main; `null` é `~/Documents/Meeting Scribe`. */
  audioFolder: string | null
  /** Ao encerrar, o `claude` local escreve o resumo, as decisões e as tarefas (contrato 08). */
  summarizeOnStop: boolean
  /**
   * Separa os participantes por voz ("Participante A", "B"…). Desligado (padrão desde 15/11/2026), o
   * áudio dos participantes vira "Participantes" e os trechos se dividem só pelas pausas.
   */
  identifySpeakers: boolean
  /** Nome do app na barra lateral, no título da janela e nos avisos (contrato 09); `null` é "LAP Reuniões". */
  brandName: string | null
  /** Linha abaixo do nome; `null` é "LAP Software" e texto vazio tira a linha. */
  brandSubtitle: string | null
  /** Arquivo do logo próprio em `userData/branding/` (só o nome); `null` é o símbolo da LAP. */
  brandLogo: string | null
  /** Procura versão nova no GitHub ao abrir o app e a cada 6 h (contrato 14). */
  autoCheckUpdates: boolean
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
  claudePath: null,
  saveToFolder: true,
  audioFolder: null,
  summarizeOnStop: true,
  identifySpeakers: false,
  brandName: null,
  brandSubtitle: null,
  brandLogo: null,
  autoCheckUpdates: true,
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
