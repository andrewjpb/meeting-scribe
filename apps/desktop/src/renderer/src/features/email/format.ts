// Textos e contas do email na tela (contrato 43): a hora da lista, os grupos por dia, a prévia de uma linha, as não
// lidas de cada conta, o nome da conta na barra lateral, os destinatários do composer e o rascunho de Responder,
// Responder a todos e Encaminhar. Sem DOM: testado em test/renderer/email-format.test.ts.
import { EMAIL_SIGNATURE_SEPARATOR, withSignature, type EmailSignature } from '@shared/email-signature'
import { EMAIL_ADDRESS_PATTERN, isInbox, isSent, prefixedSubject, type EmailAccount, type EmailAccountState, type EmailAccountStatus, type EmailAddress, type EmailBody, type EmailMessage, type EmailOutgoingAttachment, type EmailSendError } from '@shared/email'
import { htmlToText } from './sanitize'

const two = (value: number): string => String(value).padStart(2, '0')
const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const WEEKDAYS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.']
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** Hora na lista: "14:05" hoje; "ter." nos últimos 6 dias; "16/11" no ano; "16/11/25" antes. */
export function emailTimeLabel(at: number, now = new Date()): string {
  const date = new Date(at)
  if (sameDay(date, now)) return `${two(date.getHours())}:${two(date.getMinutes())}`
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (at < startOfToday && at >= startOfToday - 6 * 86_400_000) return WEEKDAYS[date.getDay()] ?? ''
  if (date.getFullYear() === now.getFullYear()) return `${two(date.getDate())}/${two(date.getMonth() + 1)}`
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)}`
}

/** Data completa no cabeçalho da leitura: "qua., 19/11/2026 14:05". */
export function emailFullDate(at: number): string {
  const date = new Date(at)
  return `${WEEKDAYS[date.getDay()] ?? ''}, ${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Grupo da lista, como no Outlook: "Hoje", "Ontem", "Esta semana", o mês ("Outubro") ou o mês e o ano. */
export function dayGroupLabel(at: number, now = new Date()): string {
  const date = new Date(at)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (at >= startOfToday) return 'Hoje'
  if (at >= startOfToday - 86_400_000) return 'Ontem'
  if (at >= startOfToday - 6 * 86_400_000) return 'Esta semana'
  const month = MONTHS[date.getMonth()] ?? ''
  const label = `${month.charAt(0).toLocaleUpperCase('pt-BR')}${month.slice(1)}`
  return date.getFullYear() === now.getFullYear() ? label : `${label} de ${date.getFullYear()}`
}

/** As mensagens (já da mais nova para a mais antiga) em grupos seguidos pelo rótulo do dia. */
export function groupByDay<T extends Pick<EmailMessage, 'date'>>(messages: readonly T[], now = new Date()): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = []
  for (const message of messages) {
    const label = dayGroupLabel(message.date, now)
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(message)
    else groups.push({ label, items: [message] })
  }
  return groups
}

/** Nome de quem mandou: o nome, ou o endereço sem nome. */
export function addressLabel(address: EmailAddress | undefined): string {
  if (!address) return 'Remetente desconhecido'
  return (address.name ?? '').replace(/\s+/g, ' ').trim() || address.address
}

/** A linha forte da lista: quem mandou (na Caixa de Entrada) ou para quem foi (em Enviados). */
export function rowTitle(message: Pick<EmailMessage, 'mailbox' | 'from' | 'to'>, account: Pick<EmailAccountStatus, 'sentMailbox'>): string {
  if (isSent(message, account)) return message.to.length ? `Para: ${message.to.map(addressLabel).join(', ')}` : 'Sem destinatário'
  return addressLabel(message.from[0])
}

/** "Fulano <fulano@x>", ou só o endereço. */
export function addressLine(address: EmailAddress): string {
  const name = (address.name ?? '').trim()
  return name && name !== address.address ? `${name} <${address.address}>` : address.address
}

export const PREVIEW_MAX = 200

/** Prévia de uma linha: o começo do texto (ou do HTML sem as marcas), sem as linhas citadas ("> …"). */
export function previewLine(body: Pick<EmailBody, 'text' | 'html'> | null | undefined): string {
  if (!body) return ''
  const source = body.text?.trim() ? body.text : body.html ? htmlToText(body.html) : ''
  const text = source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : text
}

/** Não lidas de uma lista (só a Caixa de Entrada conta). */
export function unreadCount(messages: readonly Pick<EmailMessage, 'seen' | 'mailbox'>[] | undefined): number {
  return (messages ?? []).reduce((total, message) => total + (isInbox(message) && !message.seen ? 1 : 0), 0)
}

/** Não lidas por conta, para a barra lateral: `inboxes` é a Caixa de Entrada carregada de cada conta. */
export function unreadByAccount(inboxes: Readonly<Record<string, readonly Pick<EmailMessage, 'seen' | 'mailbox'>[] | undefined>>): Record<string, number> {
  return Object.fromEntries(Object.entries(inboxes).map(([accountId, messages]) => [accountId, unreadCount(messages)]))
}

/** O número ao lado de "Caixa de Entrada": nada sem não lidas, "999+" acima disso. */
export function unreadBadge(count: number): string {
  if (count <= 0) return ''
  return count > 999 ? '999+' : String(count)
}

/** Nome da conta na barra lateral: o nome do "De:" ou o endereço; nome repetido em duas contas vira o endereço. */
export function accountLabel(accounts: readonly Pick<EmailAccount, 'id' | 'name' | 'address'>[], account: Pick<EmailAccount, 'id' | 'name' | 'address'>): string {
  const name = account.name?.trim()
  if (!name) return account.address
  const repeated = accounts.some((other) => other.id !== account.id && other.name?.trim().toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))
  return repeated ? account.address : name
}

/** Estado da conta em Configurações. */
export function accountStateLabel(state: EmailAccountState, error: string | null): string {
  switch (state) {
    case 'connected':
      return 'Conectada'
    case 'connecting':
      return 'Conectando…'
    case 'error':
      return error ? `Com problema: ${error}` : 'Com problema'
    case 'offline':
      return 'Desconectada'
  }
}

/** Um destinatário digitado no composer: o endereço e se ele vale. Aceita "Nome <x@y>". */
export interface Recipient {
  address: string
  valid: boolean
}

/** Quebra o que foi digitado (vírgula, ponto e vírgula, espaço ou quebra de linha) em destinatários, sem repetir. */
export function parseRecipients(text: string): Recipient[] {
  const out: Recipient[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/[,;\n]+/)) {
    const bracket = /<([^<>]+)>/.exec(raw)
    const pieces = bracket ? [bracket[1] ?? ''] : raw.split(/\s+/)
    for (const piece of pieces) {
      const address = piece.trim().replace(/^mailto:/i, '')
      if (!address) continue
      const key = address.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ address, valid: address.length <= 254 && EMAIL_ADDRESS_PATTERN.test(address) })
    }
  }
  return out
}

/** Junta destinatários sem repetir (a mesma pessoa em maiúsculas e minúsculas conta uma vez). */
export function mergeRecipients(current: readonly Recipient[], added: readonly Recipient[]): Recipient[] {
  const keys = new Set(current.map((item) => item.address.toLowerCase()))
  return [...current, ...added.filter((item) => !keys.has(item.address.toLowerCase()) && keys.add(item.address.toLowerCase()))]
}

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward'

export interface ComposeDraft {
  accountId: string
  mode: ComposeMode
  to: Recipient[]
  cc: Recipient[]
  subject: string
  text: string
  /** Message-ID da mensagem respondida (o main monta `In-Reply-To` e `References`). */
  inReplyTo: string | null
  /** Anexos locais escolhidos pelo clipe (ficam com o rascunho até enviar ou descartar). */
  attachments: EmailOutgoingAttachment[]
  /** Contrato 43 (CA9): anexos da original que passaram dos limites e ficaram de fora do "Encaminhar". */
  skippedAttachments: string[]
  /** Contrato 55 (CA11): a assinatura da conta entrou no texto ao abrir (o rodapé do composer diz de onde ela vem). */
  signed?: boolean | undefined
}

const recipient = (address: string): Recipient => ({ address, valid: EMAIL_ADDRESS_PATTERN.test(address) })

/** "Re: Assunto" sem repetir o prefixo: em `@shared/email` desde o contrato 45 (o rascunho do Assistente usa o mesmo). */
export { prefixedSubject }

/** O texto citado: "Em qua., 19/11/2026 14:05, Fulano <x@y> escreveu:" e cada linha com "> ". */
export function quoteText(message: Pick<EmailMessage, 'date' | 'from'>, body: Pick<EmailBody, 'text' | 'html'> | null): string {
  const text = body?.text?.trim() ? body.text : body?.html ? htmlToText(body.html) : ''
  const from = message.from[0] ? addressLine(message.from[0]) : 'Remetente desconhecido'
  const quoted = text
    .replace(/\r\n/g, '\n')
    .trimEnd()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
  return `\n\nEm ${emailFullDate(message.date)}, ${from} escreveu:\n${quoted}`
}

/** O bloco do "Encaminhar": cabeçalho da original e o texto dela. */
function forwardText(message: EmailMessage, body: Pick<EmailBody, 'text' | 'html'> | null): string {
  const text = body?.text?.trim() ? body.text : body?.html ? htmlToText(body.html) : ''
  const lines = [
    '',
    '',
    '---------- Mensagem encaminhada ----------',
    `De: ${message.from.map(addressLine).join(', ')}`,
    `Data: ${emailFullDate(message.date)}`,
    `Assunto: ${message.subject}`,
    `Para: ${message.to.map(addressLine).join(', ')}`,
    ...(message.cc.length ? [`Cc: ${message.cc.map(addressLine).join(', ')}`] : []),
    '',
    text.replace(/\r\n/g, '\n').trimEnd(),
  ]
  return lines.join('\n')
}

/**
 * O rascunho de cada ação. Responder: para quem mandou (ou, numa mensagem enviada, para os mesmos destinatários),
 * "Re:" e a citação. Responder a todos: mais os outros de Para e Cc, sem a própria conta. Encaminhar: sem destinatário,
 * "Enc:" e a original inteira (o texto; os anexos não vão).
 */
export function composeFrom(mode: Exclude<ComposeMode, 'new'>, message: EmailMessage, body: Pick<EmailBody, 'text' | 'html'> | null, account: Pick<EmailAccount, 'id' | 'address'> & Pick<EmailAccountStatus, 'sentMailbox'>): ComposeDraft {
  const own = account.address.toLowerCase()
  const notOwn = (item: EmailAddress): boolean => item.address.toLowerCase() !== own
  if (mode === 'forward') {
    return { accountId: account.id, mode, to: [], cc: [], subject: prefixedSubject('Enc:', message.subject), text: forwardText(message, body), inReplyTo: null, attachments: [], skippedAttachments: [] }
  }
  const sent = isSent(message, account)
  const primary = sent ? message.to : message.from
  const to = mergeRecipients([], primary.map((item) => recipient(item.address)))
  const others = mode === 'replyAll' ? [...(sent ? [] : message.to), ...message.cc].filter(notOwn) : []
  const cc = mergeRecipients(to, others.map((item) => recipient(item.address))).slice(to.length)
  return { accountId: account.id, mode, to, cc, subject: prefixedSubject('Re:', message.subject), text: quoteText(message, body), inReplyTo: message.messageId, attachments: [], skippedAttachments: [] }
}

export function emptyDraft(accountId: string): ComposeDraft {
  return { accountId, mode: 'new', to: [], cc: [], subject: '', text: '', inReplyTo: null, attachments: [], skippedAttachments: [] }
}

/**
 * Contrato 54 (CA4): o rascunho recém-aberto com a assinatura da conta, se ela vale para o modo. Na mensagem nova, depois
 * do que já veio no texto; em Responder, Responder a todos e Encaminhar, acima da citação. Fica no campo, editável.
 */
export function signedDraft(draft: ComposeDraft, signature: EmailSignature | null): ComposeDraft {
  if (!signature) return draft
  if (draft.mode === 'new') return { ...draft, text: withSignature({ text: draft.text, quote: '' }, signature, 'new').text }
  // O que vem antes da citação é o texto do rascunho: hoje só a assinatura, se ele já foi assinado (assim não duplica).
  const head = `\n\n${EMAIL_SIGNATURE_SEPARATOR}\n${signature.text.replace(/\r\n?/g, '\n').replace(/\s+$/, '')}`
  const text = draft.text.startsWith(head) ? head : ''
  return { ...draft, text: withSignature({ text, quote: draft.text.slice(text.length) }, signature, draft.mode === 'forward' ? 'forward' : 'reply').text }
}

/** Contrato 55 (CA11): a assinatura entra neste rascunho (texto não vazio e o interruptor do tipo ligado). */
export function signatureEntered(signature: EmailSignature | null, mode: ComposeMode): boolean {
  if (!signature?.text.trim()) return false
  return mode === 'new' ? signature.onNew : signature.onReply
}

/**
 * Contrato 54: só o último pedido de rascunho vale. Abrir um rascunho espera o main (o corpo, a assinatura); se nesse
 * meio a pessoa pediu outro rascunho ou abriu outra mensagem, a resposta velha é descartada.
 */
export function createDraftRequests(): { start: () => number; cancel: () => void; current: (token: number) => boolean } {
  let latest = 0
  return {
    start: () => ++latest,
    cancel: () => {
      latest++
    },
    current: (token) => token === latest,
  }
}

/** O rascunho tem algo escrito (fechar pede para descartar). */
export function draftHasContent(draft: ComposeDraft): boolean {
  return draft.to.length > 0 || draft.cc.length > 0 || draft.subject.trim() !== '' || draft.text.trim() !== '' || draft.attachments.length > 0
}

/** Erro do envio na tela (o rascunho fica). */
export function sendErrorText(error: EmailSendError): string {
  switch (error) {
    case 'click':
      return 'O email só sai com o seu clique em "Enviar". Clique de novo.'
    case 'invalid':
      return 'Confira os destinatários, o assunto e o tamanho dos anexos.'
    case 'account':
      return 'A conta não está pronta para enviar. Confira em Configurações › Email.'
    case 'auth':
      return 'O servidor de envio recusou o usuário ou a senha.'
    case 'connection':
      return 'O servidor de envio está fora do ar ou inacessível. Tente de novo.'
    case 'rejected':
      return 'O servidor recusou a mensagem (remetente, destinatário ou conteúdo).'
    case 'failed':
      return 'Não foi possível enviar. Tente de novo.'
  }
}

/** Soma dos anexos do rascunho. */
export const attachmentsSize = (list: readonly EmailOutgoingAttachment[]): number => list.reduce((total, item) => total + item.bytes.byteLength, 0)

/** "1,2 MB", "340 KB", "12 bytes". */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

/** Gmail pede uma "senha de app" (a senha normal não entra por IMAP). */
export function isGmailAddress(address: string): boolean {
  return /@(gmail|googlemail)\.com\s*$/i.test(address)
}
