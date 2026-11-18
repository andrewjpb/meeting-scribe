// WhatsApp pessoal no app (contrato 24): o que o renderer e o main trocam. O serviço local (`services/
// whatsapp-bridge`, neonize/whatsmeow, cliente NÃO OFICIAL) roda no Mac; o main fala com ele por HTTP em
// 127.0.0.1 com token e o renderer só vê o que está aqui. Nenhuma IA envia mensagem: o envio sai só do clique da
// pessoa em "Enviar", com o token de clique de uso único (`WhatsAppSendRequest.clickToken`).

/** Título e texto da tela de risco, mostrada antes de instalar e antes de cada QR code (CA2). */
export const WHATSAPP_RISK_TITLE = 'Antes de conectar o seu WhatsApp'
export const WHATSAPP_RISK_TEXT =
  'Este recurso usa um cliente não oficial do WhatsApp (neonize/whatsmeow). O WhatsApp pode suspender ou bloquear o seu número, de forma temporária ou definitiva, sem aviso. A LAP não tem como desfazer um bloqueio. Use por sua conta e risco.'
export const WHATSAPP_RISK_CHECKBOX = 'Entendo o risco e quero continuar'
/** Aviso fixo do bloco em Configurações (CA6). A tela "WhatsApp" não repete o aviso desde o contrato 33. */
export const WHATSAPP_FIXED_WARNING = 'Este recurso usa um cliente não oficial do WhatsApp. O WhatsApp pode bloquear o seu número. Use por sua conta e risco.'
export const WHATSAPP_PAIR_HINT = 'Abra o WhatsApp no celular › Aparelhos conectados › Conectar um aparelho'

/** Id de conversa do WhatsApp (`5511…@s.whatsapp.net`, `1203…@g.us`). */
export const WHATSAPP_CHAT_ID_PATTERN = /^[\w.+:-]{1,120}@[\w.-]{1,60}$/

/** Estados do bloco "WhatsApp" (CA2). `pairing`, `connected`, `disconnected` e `banned` vêm do serviço. */
export const WHATSAPP_STATES = ['not-installed', 'installing', 'stopped', 'pairing', 'connected', 'disconnected', 'banned'] as const
export type WhatsAppState = (typeof WHATSAPP_STATES)[number]

/** Estados que o próprio serviço informa em `GET /health`. */
export const WHATSAPP_SERVICE_STATES = ['pairing', 'connected', 'disconnected', 'banned'] as const
export type WhatsAppServiceState = (typeof WHATSAPP_SERVICE_STATES)[number]

/**
 * `python-missing`: não há `python3` no Mac; `python-old`: há, mas é anterior ao 3.10; `install-failed`: o
 * ambiente ou o `pip` falharam; `libmagic`: o neonize não abre sem a `libmagic`; `start-failed`: o serviço não
 * subiu; `service`: o serviço não respondeu; `risk`: ação que exige o aceite do aviso, sem ele.
 */
export const WHATSAPP_ERRORS = ['python-missing', 'python-old', 'install-failed', 'libmagic', 'start-failed', 'service', 'risk'] as const
export type WhatsAppError = (typeof WHATSAPP_ERRORS)[number]

/** Versão mínima do `python3` do sistema. */
export const WHATSAPP_PYTHON_MIN: readonly [number, number] = [3, 10]

export interface WhatsAppMe {
  name: string
  phone: string
}

export interface WhatsAppStatus {
  state: WhatsAppState
  /** Conectado: nome e número da conta. */
  me: WhatsAppMe | null
  /** "Ligar" ou "Instalar" em andamento. */
  busy: 'installing' | 'starting' | 'stopping' | 'logging-out' | 'removing' | null
  error: WhatsAppError | null
  /** Linha curta do andamento da instalação ("Criando o ambiente…", "Baixando do PyPI…"). */
  progress: string | null
  /** Última aceitação do aviso de risco (ISO 8601). */
  riskAcceptedAt: string | null
}

export type WhatsAppChatKind = 'person' | 'group'
export type WhatsAppMessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other'

/** Mídia como metadado (CA3); contrato 37: imagem, vídeo e áudio com `downloadable` baixam só no clique. */
export interface WhatsAppMedia {
  kind: WhatsAppMessageType
  mime: string | null
  size: number | null
  name: string | null
  /** Contrato 37: o serviço guardou as chaves do download (mensagens a partir desta versão). */
  downloadable?: boolean | undefined
  /** Contrato 37: duração do áudio em segundos, quando o WhatsApp informa. */
  seconds?: number | undefined
}

export interface WhatsAppMessage {
  id: string
  chatId: string
  author: string
  fromMe: boolean
  /** Milissegundos desde 1970. */
  at: number
  type: WhatsAppMessageType
  text: string
  media: WhatsAppMedia | null
}

export interface WhatsAppChat {
  id: string
  name: string
  kind: WhatsAppChatKind
  unread: number
  lastMessage: WhatsAppMessage | null
  /** Contrato 25: o número de uma conversa `@lid`, quando o serviço sabe (a de `@s.whatsapp.net` sai do id). */
  phone?: string | undefined
}

/** Resultado da busca: a mensagem e o nome da conversa. */
export interface WhatsAppSearchHit extends WhatsAppMessage {
  chatName: string
}

/** `/pair`: o QR em texto (o app desenha) ou o código de pareamento por número. */
export interface WhatsAppPairing {
  state: WhatsAppState
  qr: string | null
  code: string | null
}

/** Enviar: só com o token de clique (gerado no preload no clique, uso único, 10 s), em todo envio. */
export interface WhatsAppSendRequest {
  chatId: string
  text: string
  clickToken: string
}

export type WhatsAppSendResult = { ok: true; id: string } | { ok: false; error: 'click' | 'state' | 'invalid' | 'failed' }

/** Validade do token de clique do envio. */
export const WHATSAPP_CLICK_TTL_MS = 10_000
/** Texto de uma mensagem enviada pelo app. */
export const WHATSAPP_SEND_TEXT_MAX = 4096

/** "Rascunho com o Claude": a instrução livre, a conversa e, se escolhida, uma reunião como contexto. */
export interface WhatsAppDraftRequest {
  chatId: string
  instruction: string
  meetingId: string | null
}
export const WHATSAPP_DRAFT_INSTRUCTION_MAX = 1000

export type WhatsAppDraftResult = { ok: true; text: string } | { ok: false; error: 'not-found' | 'timeout' | 'failed' | 'agent' | 'chat' }

/** Conversa ligada a uma reunião (CA5): o grupo do projeto, por exemplo. */
export interface WhatsAppMeetingLink {
  chatId: string
  chatName: string
  /** O resumo e a análise usam as mensagens do dia como material (padrão desligado). */
  useInSummary: boolean
}

/** "Assistente" › "Só estas conversas": até 10 conversas no escopo, últimos N dias, até 2 000 mensagens no total. */
export const WHATSAPP_SCOPE_CHATS_MAX = 10
export const WHATSAPP_EXPORT_MESSAGES_MAX = 2000
export const WHATSAPP_SCOPE_DAYS = [7, 30, 90] as const
export const WHATSAPP_DEFAULT_SCOPE_DAYS = 30
/** Prefixo dos arquivos das conversas na pasta de escopo do chat. */
export const WHATSAPP_EXPORT_PREFIX = 'WhatsApp - '
/** Contrato 25 (CA2): o Assistente lê as conversas com mensagem nos últimos 14 dias, até 40 conversas e 3 000 mensagens. */
export const WHATSAPP_RECENT_DAYS = 14
export const WHATSAPP_RECENT_CHATS_MAX = 40
export const WHATSAPP_RECENT_MESSAGES_MAX = 3000
/** Uma linha por conversa recente, com "pendente de resposta". */
export const WHATSAPP_OVERVIEW_FILE = 'CONVERSAS-WHATSAPP.md'

/** Contrato 37: id de mensagem do WhatsApp (`3EB0…`, `m7` no serviço falso). */
export const WHATSAPP_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_.:+-]{1,200}$/
/** Contrato 37: o maior arquivo que baixa no clique. */
export const WHATSAPP_MEDIA_MAX = 64 * 1024 * 1024
/** Contrato 37: tipos que baixam no clique (documento e figurinha ficam de fora). */
export const WHATSAPP_DOWNLOADABLE_KINDS = ['image', 'video', 'audio'] as const satisfies readonly WhatsAppMessageType[]
/** Contrato 37: texto da transcrição guardado (o resto é cortado). */
export const WHATSAPP_TRANSCRIPT_MAX = 20_000

/** Contrato 37: a mídia de uma mensagem pedida no clique. */
export interface WhatsAppMediaRequest {
  chatId: string
  messageId: string
}

/**
 * `too-big`: acima de 64 MB; `gone`: o WhatsApp não tem mais o arquivo; `unavailable`: sem as chaves do download, o
 * serviço parado ou outra falha.
 */
export type WhatsAppMediaError = 'too-big' | 'gone' | 'unavailable'
export type WhatsAppMediaResult = { ok: true; mime: string; bytes: Uint8Array } | { ok: false; error: WhatsAppMediaError }

/** Contrato 37: transcrever um áudio; com `peek`, só lê o que já foi transcrito (nada é baixado nem enviado). */
export interface WhatsAppTranscribeRequest extends WhatsAppMediaRequest {
  peek?: boolean | undefined
}

/**
 * Além dos da mídia: `not-cached` (o `peek` sem transcrição guardada), `no-key` (sem a chave da AssemblyAI), `key`
 * (chave recusada), `timeout` (passou de 120 s) e `failed`.
 */
export type WhatsAppTranscribeError = WhatsAppMediaError | 'not-cached' | 'no-key' | 'key' | 'timeout' | 'failed'
export type WhatsAppTranscribeResult = { ok: true; text: string } | { ok: false; error: WhatsAppTranscribeError }

/** Mudança vinda do serviço: estado, mensagem nova (com o nome da conversa). */
export type WhatsAppEvent = { type: 'status'; status: WhatsAppStatus } | { type: 'message'; message: WhatsAppMessage; chatName: string }

/** Tamanho legível da mídia: "120 KB", "1,4 MB". */
export function mediaSizeLabel(size: number | null): string | null {
  if (size === null || !Number.isFinite(size) || size < 0) return null
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

const MEDIA_LABELS: Record<WhatsAppMessageType, string> = {
  text: 'texto',
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  document: 'documento',
  sticker: 'figurinha',
  other: 'anexo',
}

/** "imagem · 120 KB" (a tela põe o clipe antes). */
export function mediaLabel(media: WhatsAppMedia): string {
  const size = mediaSizeLabel(media.size)
  const kind = MEDIA_LABELS[media.kind]
  return [media.name ? `${kind} ${media.name}` : kind, size].filter(Boolean).join(' · ')
}

/** Linha do estado no bloco de Configurações (CA2). */
export function whatsappStateLabel(status: Pick<WhatsAppStatus, 'state' | 'me'>): string {
  switch (status.state) {
    case 'not-installed':
      return 'Não instalado'
    case 'installing':
      return 'Instalando…'
    case 'stopped':
      return 'Parado'
    case 'pairing':
      return 'Aguardando pareamento'
    case 'connected':
      return status.me ? `Conectado como ${status.me.name || 'você'} (${status.me.phone})` : 'Conectado'
    case 'disconnected':
      return 'Desconectado'
    case 'banned':
      return 'Número bloqueado pelo WhatsApp'
  }
}

/** O serviço está instalado (a tela "WhatsApp" aparece na barra lateral). */
export const whatsappInstalled = (state: WhatsAppState): boolean => state !== 'not-installed' && state !== 'installing'
