// Email como material de leitura do Assistente (contrato 45), no desenho das conversas do WhatsApp (contrato 25): a
// cada pergunta, o cache local do contrato 42 vira, na pasta da conversa, o `EMAILS.md` (uma linha por mensagem
// recebida nos últimos 30 dias, por conta, com a idade, se foi lida, se está pendente de resposta e o lembrete marcado)
// e um `Email - <assunto> - <referência>.md` por mensagem com o corpo já baixado. Só leitura do store: nada vai ao
// servidor aqui (a busca no servidor do CA7 fica em `assistant-tools.ts`, pedida pelo Assistente). Com o app bloqueado,
// nada é escrito (e a limpeza das fontes tira o que estava lá).
//
// O texto das mensagens é só material: o corpo vai citado ("> "), sem cerca de código (um bloco de ação nunca nasce
// de um email copiado para cá) e sem abrir seção.
import { createHash, randomUUID } from 'node:crypto'
import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  EMAIL_EXPORT_BODIES_MAX,
  EMAIL_EXPORT_PREFIX,
  EMAIL_EXPORT_TEXT_MAX,
  EMAIL_OVERVIEW_FILE,
  EMAIL_RECENT_DAYS,
  EMAIL_RECENT_PER_ACCOUNT_MAX,
  EMAIL_SENT_MAILBOX,
  isSent,
  type EmailAccountStatus,
  type EmailAddress,
  type EmailBody,
  type EmailMessage,
} from '../../shared/email'

const DAY_MS = 86_400_000
const two = (value: number): string => String(value).padStart(2, '0')

/** A referência de uma mensagem para o Assistente (`em-` e 12 hexadecimais), a mesma em toda pergunta. */
export function emailRef(accountId: string, id: string, place = 'cache'): string {
  return `em-${createHash('sha256').update(`${accountId}\n${place}\n${id}`).digest('hex').slice(0, 12)}`
}

/** "19/11 14:05", na hora local: o formato da citação "[Email · <remetente> · dd/mm hh:mm]". */
export function emailStamp(at: number): string {
  const date = new Date(at)
  return `${two(date.getDate())}/${two(date.getMonth() + 1)} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** "19/11/2026 14:05". */
function fullDate(at: number): string {
  const date = new Date(at)
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** "há 12 min", "há 3 h", "há 2 dias". */
export function ageLabel(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 60) return `há ${Math.max(1, minutes)} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
}

/** Texto numa linha, sem abrir seção nem cerca de código. */
export function emailOneLine(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/`{3,}/g, "'''")
    .replace(/^#+/, (marks) => marks.replace(/#/g, '＃'))
}

/** "Marina Rocha <marina@x>", ou só o endereço. */
export function emailAddressLine(address: EmailAddress | undefined): string {
  if (!address) return 'remetente desconhecido'
  const name = emailOneLine(address.name ?? '')
  return name && name !== address.address ? `${name} <${address.address}>` : address.address
}

/** Quem mandou: o nome, ou o endereço. */
export function senderName(address: EmailAddress | undefined): string {
  if (!address) return 'Remetente desconhecido'
  return emailOneLine(address.name ?? '') || address.address
}

/** O HTML de um email como texto (só para ler: as marcas saem, as entidades comuns viram letra). */
export function emailHtmlText(html: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return html
    .replace(/<(script|style|head|title|template|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table|section|article)\s*>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, code: string) => {
      if (code.startsWith('#')) {
        const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : ''
      }
      return Object.hasOwn(named, code.toLowerCase()) ? (named[code.toLowerCase()] ?? match) : match
    })
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** O corpo como texto puro (o texto do email, ou o HTML sem as marcas), até o limite. */
export function bodyText(body: Pick<EmailBody, 'text' | 'html'>): string {
  const text = body.text?.trim() ? body.text : body.html ? emailHtmlText(body.html) : ''
  const clean = text.replace(/\r\n/g, '\n').trim()
  return clean.length > EMAIL_EXPORT_TEXT_MAX ? `${clean.slice(0, EMAIL_EXPORT_TEXT_MAX - 1).trimEnd()}…` : clean
}

/**
 * Pendente de resposta (CA6): recebida na INBOX, de outra pessoa (não da própria conta), sem a marca `\Answered` e sem
 * nenhum enviado depois dela que a responda (o `In-Reply-To` ou o `References` com o Message-ID dela). Contrato 52: o
 * enviado é o da pasta de enviados da conta (`account`; sem ela, a pasta local `Sent`).
 */
export function isPending(message: EmailMessage, sent: readonly EmailMessage[], own: readonly string[], account: Pick<EmailAccountStatus, 'sentMailbox'> = { sentMailbox: EMAIL_SENT_MAILBOX }): boolean {
  if (isSent(message, account) || message.answered) return false
  const mine = new Set(own.map((address) => address.toLowerCase()))
  if (message.from.some((item) => mine.has(item.address.toLowerCase()))) return false
  const id = message.messageId
  if (!id) return true
  return !sent.some((reply) => reply.date >= message.date && (reply.inReplyTo === id || reply.references.includes(id)))
}

/** O cache de uma conta, como o serviço do email devolve (`EmailService.cached`). */
export interface EmailCache {
  status: EmailAccountStatus
  inbox: EmailMessage[]
  sent: EmailMessage[]
  /** Contrato 56: o `UIDVALIDITY` da INBOX guardada (IMAP); ausente ou `null` no POP3. */
  uidValidity?: string | null | undefined
}

/** Um lembrete ligado a um email (as tarefas "uma vez" ligadas das Automações): a próxima vez, já em texto. */
export interface EmailReminderMark {
  accountId: string
  messageId: string
  /** CA7: o lembrete de um email só do servidor (nunca casa com a INBOX do cache). */
  mailbox?: string | null | undefined
  /** "qua 20/11 09:00". */
  when: string
}

export interface EmailExportDeps {
  cached(): Promise<EmailCache[]>
  /** O corpo já baixado; `null` se não foi (nunca baixa). */
  body(accountId: string, message: EmailMessage): Promise<EmailBody | null>
  /** Os lembretes de email ainda por vir (CA4: a tarefa aberta aparece nas pendências seguintes). */
  reminders?: () => Promise<EmailReminderMark[]>
  /** CA5: bloqueado, nada do email vai ao Assistente. */
  locked: () => boolean
  now?: () => number
}

/** Uma mensagem recebida no `EMAILS.md`, com o que o Assistente precisa e o cartão lê. */
export interface EmailEntry {
  ref: string
  status: EmailAccountStatus
  message: EmailMessage
  pending: boolean
  reminder: string | null
  file: string | null
}

const STATE_LABELS: Readonly<Record<EmailAccountStatus['state'], string>> = { offline: 'desconectada', connecting: 'conectando', connected: 'conectada', error: 'com problema' }

/** A linha "Email" do `ESTADO.md`: as contas e o estado de cada uma, sem senha nem servidor. */
export function emailStateLabel(statuses: readonly EmailAccountStatus[]): string {
  if (!statuses.length) return 'nenhuma conta'
  return statuses.map((status) => `${status.account.address} (${status.account.incoming.protocol === 'imap' ? 'IMAP' : 'POP3'}, ${STATE_LABELS[status.state]})`).join('; ')
}

/** Nome do arquivo de uma mensagem: `Email - <assunto> - <referência>.md`. */
export function emailFileName(subject: string, ref: string): string {
  const visible = [...subject].filter((char) => char.charCodeAt(0) >= 32).join('')
  const name = visible.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Sem assunto'
  return `${EMAIL_EXPORT_PREFIX}${name} - ${ref}.md`
}

/** As recebidas de cada conta nos últimos 30 dias (até 150 por conta), da mais nova para a mais antiga. */
export function recentEntries(caches: readonly EmailCache[], now: number, reminders: readonly EmailReminderMark[] = []): EmailEntry[] {
  const since = now - EMAIL_RECENT_DAYS * DAY_MS
  const own = caches.map((cache) => cache.status.account.address)
  const sent = caches.flatMap((cache) => cache.sent)
  return caches.flatMap((cache) =>
    [...cache.inbox]
      .filter((message) => message.date >= since)
      .sort((a, b) => b.date - a.date)
      .slice(0, EMAIL_RECENT_PER_ACCOUNT_MAX)
      .map((message) => ({
        ref: emailRef(cache.status.account.id, message.id),
        status: cache.status,
        message,
        pending: isPending(message, sent, own, cache.status),
        reminder: reminders.find((mark) => !mark.mailbox && mark.accountId === cache.status.account.id && mark.messageId === message.id)?.when ?? null,
        file: null,
      })),
  )
}

/** Uma linha do `EMAILS.md`. */
export function overviewLine(entry: EmailEntry, now: number): string {
  const { message } = entry
  return [
    `- ref: ${entry.ref}`,
    `conta: ${entry.status.account.address}`,
    `de: ${emailAddressLine(message.from[0])}`,
    `assunto: "${emailOneLine(message.subject || '(sem assunto)').replace(/"/g, "'")}"`,
    `recebido: ${emailStamp(message.date)} (${ageLabel(message.date, now)})`,
    message.seen ? 'lida' : 'não lida',
    `pendente de resposta: ${entry.pending ? 'sim' : 'não'}`,
    ...(entry.reminder ? [`lembrete marcado: ${entry.reminder}`] : []),
    entry.file ? `arquivo: ${entry.file}` : 'corpo: ainda não baixado (abra no app, ou peça para ler)',
  ].join(' · ')
}

/** O `EMAILS.md` inteiro: as contas, e as mensagens de cada uma. */
export function overviewMarkdown(caches: readonly EmailCache[], entries: readonly EmailEntry[], now: number): string {
  const pending = entries.filter((entry) => entry.pending).length
  const lines = [
    `# Emails (recebidos nos últimos ${EMAIL_RECENT_DAYS} dias)`,
    '',
    `Uma linha por mensagem recebida, da mais recente para a mais antiga, por conta: referência · conta · de · assunto · quando chegou e há quanto tempo · lida ou não · pendente de resposta · lembrete marcado (quando há) · arquivo com o corpo. "Pendente de resposta: sim" quer dizer que você não respondeu depois dela. ${pending} de ${entries.length} pendentes. Mensagens mais antigas, pastas que não são a Caixa de Entrada e corpos ainda não baixados: use a ferramenta buscar_emails ou ler_email.`,
  ]
  for (const cache of caches) {
    const own = entries.filter((entry) => entry.status.account.id === cache.status.account.id)
    const protocol = cache.status.account.incoming.protocol === 'imap' ? 'IMAP' : 'POP3'
    lines.push(
      '',
      `## Conta ${cache.status.account.address} (${protocol}, ${STATE_LABELS[cache.status.state]})`,
      '',
      `${own.filter((entry) => !entry.message.seen).length} não lidas · ${own.filter((entry) => entry.pending).length} pendentes de resposta.${protocol === 'POP3' ? ' POP3: só o que já foi baixado para o app.' : ''}`,
      '',
      ...(own.length ? own.map((entry) => overviewLine(entry, now)) : ['Nenhuma mensagem recebida no período.']),
    )
  }
  return `${lines.join('\n')}\n`
}

/** O `.md` de uma mensagem: cabeçalho, estado e o corpo citado. */
export function messageMarkdown(entry: Pick<EmailEntry, 'ref' | 'status' | 'message' | 'pending' | 'reminder'>, body: EmailBody, now: number, place: string | null = null): string {
  const { message } = entry
  const text = bodyText(body)
  const quoted = text ? text.split('\n').map((line) => (line ? `> ${line.replace(/`{3,}/g, "'''")}` : '>')) : ['(sem texto)']
  const lines = [
    `# Email: ${emailOneLine(message.subject || '(sem assunto)')}`,
    '',
    `- Referência: ${entry.ref}`,
    `- Conta: ${entry.status.account.address}`,
    ...(place ? [`- Pasta no servidor: ${emailOneLine(place)}`] : []),
    `- De: ${message.from.map(emailAddressLine).join(', ') || 'remetente desconhecido'}`,
    `- Para: ${message.to.map(emailAddressLine).join(', ') || 'ninguém'}`,
    ...(message.cc.length ? [`- Cc: ${message.cc.map(emailAddressLine).join(', ')}`] : []),
    `- Data: ${fullDate(message.date)} (${ageLabel(message.date, now)})`,
    `- Lida: ${message.seen ? 'sim' : 'não'}`,
    ...(!isSent(message, entry.status) ? [`- Pendente de resposta: ${entry.pending ? 'sim' : 'não'}`] : []),
    ...(entry.reminder ? [`- Lembrete marcado: ${entry.reminder}`] : []),
    ...(body.attachments.length ? [`- Anexos: ${body.attachments.map((item) => emailOneLine(item.filename ?? 'sem nome')).join(', ')}`] : []),
    `- Citar como: [Email · ${senderName(message.from[0])} · ${emailStamp(message.date)}]`,
    '',
    '## Corpo',
    '',
    ...quoted,
  ]
  return `${lines.join('\n')}\n`
}

async function writeIfChanged(file: string, content: string): Promise<void> {
  if ((await readFile(file, 'utf8').catch(() => null)) === content) return
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
  await chmod(file, 0o600)
}

/**
 * O `EMAILS.md` e os arquivos das mensagens com o corpo já baixado (as pendentes primeiro, depois as mais recentes,
 * até 60) na pasta da conversa. Sem conta, ou bloqueado: nada (a limpeza das fontes tira o que havia). Devolve os nomes
 * escritos (o resumo por último).
 */
export async function exportEmail(deps: EmailExportDeps, folder: string): Promise<string[]> {
  if (deps.locked()) return []
  const caches = await deps.cached()
  if (deps.locked() || !caches.length) return []
  const now = (deps.now ?? Date.now)()
  const reminders = (await deps.reminders?.().catch(() => [])) ?? []
  const entries = recentEntries(caches, now, reminders)
  const order = [...entries].sort((a, b) => Number(b.pending) - Number(a.pending) || b.message.date - a.message.date)
  const files: string[] = []
  for (const entry of order) {
    if (files.length >= EMAIL_EXPORT_BODIES_MAX) break
    const body = await deps.body(entry.status.account.id, entry.message).catch(() => null)
    if (!body || deps.locked()) continue
    const name = emailFileName(entry.message.subject, entry.ref)
    await writeIfChanged(join(folder, name), messageMarkdown(entry, body, now))
    entry.file = name
    files.push(name)
  }
  if (deps.locked()) return []
  await writeIfChanged(join(folder, EMAIL_OVERVIEW_FILE), overviewMarkdown(caches, entries, now))
  return [...files, EMAIL_OVERVIEW_FILE]
}
