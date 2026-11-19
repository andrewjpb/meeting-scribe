// Email no app (contrato 42): o que o renderer e o main trocam. As contas falam IMAP ou POP3 para receber e SMTP para
// enviar, direto do main (sem serviço à parte). A senha só existe em claro no main, na hora de conectar: no disco vai
// cifrada pelo `safeStorage`, e nenhum canal a devolve. O envio sai só do clique da pessoa em "Enviar", com o token
// de clique de uso único (`EmailSendRequest.clickToken`), como no WhatsApp.

export const EMAIL_PROTOCOLS = ['imap', 'pop3'] as const
export type EmailProtocol = (typeof EMAIL_PROTOCOLS)[number]
/** `tls`: TLS desde o começo (993, 995, 465); `starttls`: sobe para TLS no meio, e recusa se o servidor não oferecer. */
export const EMAIL_SECURITY = ['tls', 'starttls', 'none'] as const
export type EmailSecurity = (typeof EMAIL_SECURITY)[number]

/** Endereço de email, conferido no main antes de qualquer conexão. */
export const EMAIL_ADDRESS_PATTERN = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/
/** Servidor: nome ou IPv4, sem esquema nem porta. */
export const EMAIL_HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/
/** Id de conta (gerado pelo main). */
export const EMAIL_ACCOUNT_ID_PATTERN = /^[0-9a-f-]{36}$/
/** INBOX: as últimas 200 mensagens (IMAP) ou as 200 mais novas baixadas (POP3). */
export const EMAIL_INBOX_MAX = 200
/** Enviados guardados no app, por conta. */
export const EMAIL_SENT_MAX = 200
export const EMAIL_SUBJECT_MAX = 998
export const EMAIL_TEXT_MAX = 200_000
export const EMAIL_RECIPIENTS_MAX = 50
/** Uma mensagem acima disto não é baixada (nem pelo IMAP, nem pelo POP3). */
export const EMAIL_RAW_MAX_BYTES = 25 * 1024 * 1024
/** O token de clique do "Enviar" vale por 10 s, como o do WhatsApp. */
export const EMAIL_CLICK_TTL_MS = 10_000
/** "Buscar emails novos a cada": só nas contas POP3 (o IMAP recebe na hora, pelo IDLE). */
export const EMAIL_POLL_MINUTES = [1, 5, 15, 30, 60] as const
export type EmailPollMinutes = (typeof EMAIL_POLL_MINUTES)[number]

export interface EmailServer {
  host: string
  port: number
  security: EmailSecurity
}

export interface EmailIncomingServer extends EmailServer {
  protocol: EmailProtocol
}

/** "Adicionar conta": o que a tela manda. `username` vazio é o próprio endereço. */
export interface EmailAccountInput {
  address: string
  password: string
  name?: string | undefined
  username?: string | undefined
  incoming: EmailIncomingServer
  outgoing: EmailServer
  /** Só POP3: apagar do servidor depois de baixar. Desligado por padrão (a mensagem fica no servidor). */
  deleteFromServer?: boolean | undefined
}

/** A conta como o renderer vê: sem a senha, nem cifrada. */
export interface EmailAccount {
  id: string
  address: string
  /** Nome no "De:"; `null` é só o endereço. */
  name: string | null
  username: string
  incoming: EmailIncomingServer
  outgoing: EmailServer
  deleteFromServer: boolean
}

/** `offline`: ainda não conectou (ou foi desligada); `error`: a última tentativa falhou (`error` diz por quê). */
export const EMAIL_ACCOUNT_STATES = ['offline', 'connecting', 'connected', 'error'] as const
export type EmailAccountState = (typeof EMAIL_ACCOUNT_STATES)[number]

export interface EmailAccountStatus {
  account: EmailAccount
  state: EmailAccountState
  /** Mensagem curta para a tela; nunca leva senha nem resposta do servidor. */
  error: string | null
}

export type EmailAddResult = { ok: true; status: EmailAccountStatus } | { ok: false; error: 'invalid' | 'duplicate' | 'encryption' }

export interface EmailAutoconfig {
  /** `preset`: lista embutida (sem rede); `ispdb`: base do Thunderbird. */
  source: 'preset' | 'ispdb'
  username: string
  incoming: EmailIncomingServer
  outgoing: EmailServer
}

export interface EmailAddress {
  name: string | null
  address: string
}

export type EmailFolder = 'inbox' | 'sent'

export interface EmailMessage {
  /** IMAP: o UID na INBOX; POP3: o UIDL do servidor; enviados: o Message-ID. */
  id: string
  accountId: string
  folder: EmailFolder
  /** IMAP: o UID; POP3 e enviados: `null`. */
  uid: number | null
  seen: boolean
  flagged: boolean
  answered: boolean
  from: EmailAddress[]
  to: EmailAddress[]
  cc: EmailAddress[]
  subject: string
  /** Milissegundos desde 1970. */
  date: number
  messageId: string | null
  inReplyTo: string | null
  references: string[]
}

export interface EmailAttachmentInfo {
  filename: string | null
  contentType: string
  size: number
}

/** Corpo já passado pelo `mailparser`. O HTML vem como chegou: quem mostra sanitiza (contrato 43). */
export interface EmailBody {
  text: string | null
  html: string | null
  attachments: EmailAttachmentInfo[]
}

export type EmailBodyResult = { ok: true; body: EmailBody } | { ok: false; error: 'not-found' | 'too-big' | 'unavailable' }

/**
 * Enviar: só com o token de clique que o preload gera no clique em "Enviar" (`ScribeApi.emailSend`). `inReplyTo` é o
 * Message-ID da mensagem respondida (`EmailMessage.messageId`): o main monta `In-Reply-To` e `References`.
 */
export interface EmailSendRequest {
  accountId: string
  to: string[]
  /** Contrato 43: "Responder a todos" e o campo "Cc" do composer. */
  cc?: string[] | undefined
  subject: string
  text: string
  inReplyTo?: string | undefined
  /** Contrato 43: anexos locais, escolhidos no seletor do macOS (`scribe:email-attach-pick`). */
  attachments?: EmailOutgoingAttachment[] | undefined
  clickToken: string
}

/** Contrato 43: um anexo do composer. O tipo sai do nome (o `nodemailer` deduz pela extensão). */
export interface EmailOutgoingAttachment {
  name: string
  bytes: Uint8Array
}

/** Contrato 43: anexos de uma mensagem enviada, somados. */
export const EMAIL_ATTACH_MAX_BYTES = 20 * 1024 * 1024
export const EMAIL_ATTACH_MAX_FILES = 10
export const EMAIL_ATTACH_NAME_MAX = 200

/** Contrato 43: o clipe do composer. `null`: a pessoa cancelou o seletor. */
export type EmailAttachPickResult = { ok: true; attachments: EmailOutgoingAttachment[] } | { ok: false; error: 'too-big' | 'unreadable' } | null

/**
 * Contrato 43: "Testar conexão" com o que está no formulário, sem gravar a conta. `stage` diz qual servidor falhou;
 * `error` é a mesma frase curta do estado da conta (nunca a resposta do servidor nem a senha).
 */
export type EmailTestResult = { ok: true } | { ok: false; stage: 'invalid' | 'incoming' | 'outgoing'; error: string }

/** Contrato 43: as imagens remotas de um email, baixadas pelo main no clique em "Carregar imagens". */
export const EMAIL_REMOTE_IMAGES_MAX = 40
export const EMAIL_REMOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/**
 * `click`: sem clique de verdade; `invalid`: pedido fora do formato; `account`: conta inexistente ou sem senha;
 * `auth`: o SMTP recusou o usuário ou a senha; `connection`: servidor fora do ar, TLS ou tempo esgotado;
 * `rejected`: o servidor recusou o remetente, o destinatário ou a mensagem; `failed`: outro erro.
 */
export type EmailSendError = 'click' | 'invalid' | 'account' | 'auth' | 'connection' | 'rejected' | 'failed'
export type EmailSendResult = { ok: true; messageId: string } | { ok: false; error: EmailSendError }

/** Contrato 43 (CA8 e CA9): um anexo recebido, pela posição dele em `EmailBody.attachments`. */
export interface EmailAttachmentRequest {
  accountId: string
  id: string
  index: number
}

/** "Baixar": salvo onde a pessoa escolheu (`null`: cancelou o diálogo). Nada é aberto nem executado. */
export type EmailAttachmentSaveResult = { ok: true; name: string } | { ok: false; error: 'not-found' | 'unavailable' | 'write' } | null

/**
 * "Encaminhar": os anexos da original, nos limites do envio (20 MB somados, 10 arquivos); os que passam ficam de fora
 * em `skipped`, pelo nome.
 */
export type EmailAttachmentsResult = { ok: true; attachments: EmailOutgoingAttachment[]; skipped: string[] } | { ok: false; error: 'not-found' | 'unavailable' }
