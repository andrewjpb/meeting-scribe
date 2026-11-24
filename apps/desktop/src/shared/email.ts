// Email no app (contrato 42): o que o renderer e o main trocam. As contas falam IMAP ou POP3 para receber e SMTP para
// enviar, direto do main (sem serviço à parte). A senha só existe em claro no main, na hora de conectar: no disco vai
// cifrada pelo `safeStorage`, e nenhum canal a devolve. O envio sai só do clique da pessoa em "Enviar", com o token
// de clique de uso único (`EmailSendRequest.clickToken`), como no WhatsApp.
import type { EmailInvite, InviteReplyPartstat } from './invite'

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
  /**
   * Contrato 52: a pasta dos enviados guardados no app (`EmailMessage.mailbox` deles): o path da pasta `\Sent` do
   * servidor (IMAP, depois de conectar) ou `Sent` (POP3, ou servidor sem ela).
   */
  sentMailbox: string
}

export type EmailAddResult = { ok: true; status: EmailAccountStatus } | { ok: false; error: 'invalid' | 'duplicate' | 'encryption' }

export interface EmailAutoconfig {
  /** `preset`: lista embutida (sem rede); `ispdb`: base do Thunderbird; `mx`: provedor reconhecido pelo MX do domínio. */
  source: 'preset' | 'ispdb' | 'mx'
  username: string
  incoming: EmailIncomingServer
  outgoing: EmailServer
}

export interface EmailAddress {
  name: string | null
  address: string
}

/** As duas listas fixas da tela (contrato 43): a Caixa de Entrada e os enviados guardados no app. */
export type EmailFolder = 'inbox' | 'sent'

/** Contrato 52: a Caixa de Entrada, no IMAP e no POP3. */
export const EMAIL_INBOX_MAILBOX = 'INBOX'
/** Contrato 52: a pasta local dos enviados (POP3, ou servidor IMAP sem pasta `\Sent`). */
export const EMAIL_SENT_MAILBOX = 'Sent'

export interface EmailMessage {
  /**
   * IMAP: o UID na INBOX; POP3: o UIDL do servidor; enviados: o Message-ID. Contrato 52: numa outra pasta aberta, o id de
   * `serverMessageId` (a pasta, o `UIDVALIDITY` e o UID).
   */
  id: string
  accountId: string
  /** Contrato 52: o path IMAP da pasta (`INBOX`, `Enviados`, `Projetos/ABF`…); no POP3, `INBOX` ou `Sent`. */
  mailbox: string
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

/** Contrato 52: a mensagem é da Caixa de Entrada (o nome `INBOX` vale em qualquer caixa, RFC 3501). */
export function isInbox(message: Pick<EmailMessage, 'mailbox'>): boolean {
  return message.mailbox.toUpperCase() === EMAIL_INBOX_MAILBOX
}

/**
 * Contrato 173: o caminho da Caixa de Entrada na listagem da conta: a pasta de uso `\Inbox`, senão a de caminho `INBOX`
 * (sem diferenciar maiúscula); `null` sem nenhuma. No Zoho ela vem como "Caixa de entrada", e não há pasta `INBOX`.
 */
export function inboxFolderPath(folders: readonly { path: string; specialUse?: string | null; noselect?: boolean }[]): string | null {
  const usable = folders.filter((folder) => !folder.noselect)
  return (usable.find((folder) => folder.specialUse === '\\Inbox') ?? usable.find((folder) => folder.path.toUpperCase() === EMAIL_INBOX_MAILBOX))?.path ?? null
}

/** Contrato 52: a mensagem é da pasta de enviados da conta (`EmailAccountStatus.sentMailbox`). */
export function isSent(message: Pick<EmailMessage, 'mailbox'>, account: Pick<EmailAccountStatus, 'sentMailbox'>): boolean {
  return message.mailbox === account.sentMailbox
}

// Contrato 52: as pastas da conta. No IMAP, o `LIST` com o `STATUS (MESSAGES UNSEEN)` de cada pasta, em árvore pelo
// delimitador; no POP3, só a Caixa de Entrada e os enviados do app (não há pastas no servidor).

/** As mais recentes de uma pasta aberta, como a INBOX. */
export const EMAIL_FOLDER_MESSAGES_MAX = 200
/** UIDs num "Mover" só. */
export const EMAIL_MOVE_MAX = 500
/** Nome de pasta (criar e renomear). */
export const EMAIL_FOLDER_NAME_MAX = 100
/** Path de pasta aceito nos pedidos. */
export const EMAIL_FOLDER_PATH_MAX = 1000
/** Pasta aberta que não é a INBOX: relida a cada 5 min enquanto a tela diz que está aberta. */
export const EMAIL_FOLDER_REFRESH_MS = 5 * 60_000
/** Pastas especiais: não se renomeiam nem se apagam (nem a INBOX). */
export const EMAIL_PROTECTED_SPECIAL_USE = ['\\Sent', '\\Trash', '\\Junk', '\\Drafts', '\\Archive', '\\All', '\\Flagged'] as const

export interface EmailFolderNode {
  path: string
  /** A última parte do path. */
  name: string
  /** O delimitador do `LIST` (`/`, `.`), ou `null` (pasta sem hierarquia, POP3). */
  delimiter: string | null
  /** `\Sent`, `\Trash`, `\Junk`…, ou `null`. */
  specialUse: string | null
  /** `\Noselect`: aparece na árvore, mas não abre (nem recebe mensagem). */
  noselect: boolean
  /** Do `STATUS`; `null` quando o servidor não disse (ou pasta `\Noselect`). */
  unseen: number | null
  total: number | null
  children: EmailFolderNode[]
}

/**
 * `missing`: conta (ou pasta) inexistente; `pop3`: conta POP3 (sem pastas no servidor); `protected`: INBOX ou pasta
 * especial; `invalid`: pedido fora do formato (ou apagar pasta com conteúdo sem `force`); `unavailable`: sem conexão
 * com o servidor; `server`: o servidor recusou o comando; `unsupported`: o servidor não tem como mover sem risco (sem
 * `MOVE` e sem `UIDPLUS`, o `EXPUNGE` apagaria outras mensagens). No mover, `invalid` também é o `UIDVALIDITY` da origem
 * que mudou (os UIDs são de outra pasta): nada foi movido.
 */
export type EmailFolderError = 'missing' | 'pop3' | 'protected' | 'invalid' | 'unavailable' | 'server' | 'unsupported'
export interface EmailFolderFailure {
  ok: false
  error: EmailFolderError
  /** Só no apagar sem `force`: o que a pasta ainda tem. */
  contents?: { messages: number; folders: number } | undefined
}

export type EmailFoldersResult = { ok: true; folders: EmailFolderNode[]; pop3: boolean } | EmailFolderFailure
export type EmailOpenFolderResult = { ok: true; messages: EmailMessage[] } | EmailFolderFailure
/** `toUid`: o UID na pasta de destino (`COPYUID` do servidor), ou `null` se ele não disse. */
export type EmailMoveResult = { ok: true; moved: { fromUid: number; toUid: number | null }[] } | EmailFolderFailure
export type EmailFolderPathResult = { ok: true; path: string } | EmailFolderFailure
export type EmailFolderDeleteResult = { ok: true } | EmailFolderFailure

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
  /**
   * Contrato 61 (convites-agenda, D4): o convite lido no mesmo parse do corpo. Ausente: corpo guardado antes do 61 (é
   * relido uma vez, N12); `null`: já lido, sem convite (ou ilegível).
   */
  invite?: EmailInvite | null
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

/**
 * Contrato 61: "Aceitar", "Talvez" e "Recusar" de um convite. O REPLY vai só ao organizador, só com o token de clique do
 * email (`scribe:email-click`), e não fica em Enviados. `id` é o `EmailMessage.id` da mensagem do convite, cujo corpo já
 * foi aberto (a resposta sai do `invite` guardado nele).
 */
export interface InviteReplySendRequest {
  accountId: string
  id: string
  partstat: InviteReplyPartstat
  clickToken: string
}

/**
 * `no-invite`: o corpo guardado não tem convite; `not-request`: CANCEL ou REPLY (não se respondem); `busy`: o mesmo
 * convite já está sendo respondido; `no-organizer`, `not-invited` (N5) e `malformed`: do `buildReply`; o resto, como no
 * `EmailSendError`.
 */
export type InviteReplySendError = 'click' | 'invalid' | 'account' | 'not-found' | 'no-invite' | 'not-request' | 'busy' | 'no-organizer' | 'not-invited' | 'malformed' | 'auth' | 'connection' | 'rejected' | 'failed'

/** Contrato 61 (CA12): o REPLY saiu. JSON puro; `uid`, `recurrenceId`, `sequence` e `dtstamp` são os do convite respondido. */
export interface InviteRepliedEvent {
  accountId: string
  /** `EmailMessage.id` da mensagem do convite. */
  messageId: string
  mailbox: string
  uid: string
  recurrenceId: string | null
  sequence: number
  dtstamp: string | null
  partstat: InviteReplyPartstat
  /** Hora do envio. */
  respondedAt: number
  /** Message-ID do REPLY, com `<` e `>`. */
  replyMessageId: string
}

export type InviteReplySendResult = { ok: true; messageId: string; reply: InviteRepliedEvent } | { ok: false; error: InviteReplySendError }

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

/** "Re: Assunto" sem repetir o prefixo ("Re:", "RE:", "Res:", "Enc:", "Fwd:" de quem respondeu antes ficam). */
export function prefixedSubject(prefix: 'Re:' | 'Enc:', subject: string): string {
  const clean = subject.replace(/[\r\n]+/g, ' ').trim()
  const already = prefix === 'Re:' ? /^(re|res)\s*:/i : /^(enc|fwd?|tr)\s*:/i
  return already.test(clean) ? clean : `${prefix} ${clean}`.trim()
}

// Contrato 45: o email no Assistente, no desenho do WhatsApp (contrato 25). A cada pergunta, o cache local do contrato
// 42 vira o `EMAILS.md` (uma linha por mensagem recebida, com a conta, a idade e "pendente de resposta") e um `.md` por
// mensagem com o corpo já baixado. Nada vai ao servidor dentro da pergunta.

/** Uma linha por mensagem recebida nos últimos dias, de todas as contas. */
export const EMAIL_OVERVIEW_FILE = 'EMAILS.md'
/** Um arquivo por mensagem com o corpo já baixado: `Email - <assunto> - <referência>.md`. */
export const EMAIL_EXPORT_PREFIX = 'Email - '
/** Mensagens recebidas nos últimos 30 dias entram no `EMAILS.md`. */
export const EMAIL_RECENT_DAYS = 30
/** Linhas do `EMAILS.md` por conta (as mais recentes). */
export const EMAIL_RECENT_PER_ACCOUNT_MAX = 150
/** Arquivos de mensagem na pasta (as pendentes primeiro, depois as mais recentes). */
export const EMAIL_EXPORT_BODIES_MAX = 60
/** Corpo de cada arquivo de mensagem, em caracteres. */
export const EMAIL_EXPORT_TEXT_MAX = 8_000
/**
 * Referência de uma mensagem para o Assistente: curta, sem os caracteres do UIDL ou do Message-ID, e a mesma em toda
 * pergunta (o hash da conta e do id). O cartão é montado pelo main a partir dela, com o que está no cache.
 */
export const EMAIL_REF_PATTERN = /^em-[0-9a-f]{12}$/
