// O email nas ferramentas do Assistente (contrato 45, CA1 e CA7): `buscar_emails` procura no cache local (INBOX e
// enviados das contas) e, nas contas IMAP, também no servidor (`UID SEARCH` em todas as pastas do `LIST`, abertas só
// para leitura), até 50 resultados; `ler_email` lê o corpo de uma mensagem pela referência: o já baixado, ou (achada no
// servidor) por `BODY.PEEK[]`, sem marcar como lida e sem gravar no cache. POP3: só o que já foi baixado. Com o app
// bloqueado (CA5), nenhuma das duas roda.
//
// As mensagens achadas no servidor ficam lembradas aqui (a referência, a conta, a pasta e o UID), para a leitura e os
// cartões da mesma conversa (o rascunho de resposta, o lembrete) acharem a mensagem sem buscar de novo.
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chmod, rename, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { EMAIL_REF_PATTERN, isInbox, isSent, type EmailAccountStatus, type EmailBody, type EmailBodyResult, type EmailMessage } from '../../shared/email'
import { EMAIL_SEARCH_FILE } from '../chat/sources'
import type { AssistantTool, ToolResult } from '../chat/tools'
import { ageLabel, bodyText, emailAddressLine, emailFileName, emailOneLine, emailRef, emailStamp, isPending, messageMarkdown, type EmailCache } from './export'
import type { ImapSearchQuery } from './imap-client'
import type { EmailServerSearchResult } from './service'

/** Resultados numa busca, somando as contas e o servidor. */
export const EMAIL_SEARCH_MAX = 50
/** Mensagens do servidor lembradas para a leitura e os cartões. */
const SERVER_SEEN_MAX = 500
/** Corpos lidos do cache numa busca por texto. */
const CACHE_TEXT_READS_MAX = 400

export interface EmailToolsDeps {
  cached(): Promise<EmailCache[]>
  body(accountId: string, message: EmailMessage): Promise<EmailBody | null>
  searchServer(accountId: string, query: ImapSearchQuery, limit: number): Promise<EmailServerSearchResult>
  peekServer(accountId: string, mailbox: string, uid: number): Promise<EmailBodyResult>
  locked: () => boolean
  now?: () => number
}

/** Uma mensagem achada: no cache (`mailbox` nulo) ou no servidor (a pasta e o UID). */
export interface EmailFound {
  ref: string
  status: EmailAccountStatus
  message: EmailMessage
  mailbox: string | null
  uid: number | null
  pending: boolean
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\r\n"\\]/.test(value))
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const searchSchema = z
  .object({ de: text(200).optional(), para: text(200).optional(), assunto: text(300).optional(), texto: text(300).optional(), desde: day.optional(), ate: day.optional(), conta: text(320).optional() })
  .refine((value) => Boolean(value.de || value.para || value.assunto || value.texto || value.desde || value.ate))
const readSchema = z.object({ email: z.string().regex(EMAIL_REF_PATTERN) })

const contains = (haystack: string, needle: string | undefined): boolean => !needle || haystack.toLocaleLowerCase('pt-BR').includes(needle.toLocaleLowerCase('pt-BR'))
const addressText = (list: EmailMessage['from']): string => list.map((item) => `${item.name ?? ''} ${item.address}`).join(' ')
const localDay = (value: string, end = false): number => {
  const [year, month, date] = value.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + (end ? 1 : 0)).getTime()
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
  await chmod(file, 0o600)
}

const LOCKED: ToolResult = { file: null, label: 'Email indisponível: o app está bloqueado', note: 'O app está bloqueado: o email não está disponível agora.' }

export interface EmailTools {
  tools: AssistantTool[]
  /** A mensagem de uma referência: a do cache, ou uma achada no servidor nesta sessão do app. */
  find(ref: string): Promise<EmailFound | null>
}

export function createEmailTools(deps: EmailToolsDeps): EmailTools {
  const now = deps.now ?? Date.now
  const fromServer = new Map<string, EmailFound>()

  const remember = (found: EmailFound): void => {
    fromServer.delete(found.ref)
    fromServer.set(found.ref, found)
    while (fromServer.size > SERVER_SEEN_MAX) {
      const oldest = fromServer.keys().next().value
      if (oldest === undefined) break
      fromServer.delete(oldest)
    }
  }

  /** Todas as mensagens do cache, com a referência e "pendente". */
  async function cacheEntries(): Promise<{ caches: EmailCache[]; entries: EmailFound[] }> {
    const caches = await deps.cached()
    const own = caches.map((cache) => cache.status.account.address)
    const sent = caches.flatMap((cache) => cache.sent)
    const entries = caches.flatMap((cache) =>
      [...cache.inbox, ...cache.sent].map((message) => ({ ref: emailRef(cache.status.account.id, isInbox(message) ? message.id : `sent:${message.id}`), status: cache.status, message, mailbox: null, uid: message.uid, pending: isPending(message, sent, own, cache.status) })),
    )
    return { caches, entries }
  }

  async function find(ref: string): Promise<EmailFound | null> {
    if (!EMAIL_REF_PATTERN.test(ref) || deps.locked()) return null
    const cached = (await cacheEntries()).entries.find((entry) => entry.ref === ref)
    return cached ?? fromServer.get(ref) ?? null
  }

  const searchLine = (found: EmailFound): string =>
    [
      `- ref: ${found.ref}`,
      `conta: ${found.status.account.address}`,
      `onde: ${found.mailbox === null ? (isSent(found.message, found.status) ? 'enviados (no app)' : 'Caixa de Entrada (no app)') : `servidor, pasta ${emailOneLine(found.mailbox)}`}`,
      `de: ${emailAddressLine(found.message.from[0])}`,
      `para: ${found.message.to.map(emailAddressLine).join(', ') || 'ninguém'}`,
      `assunto: "${emailOneLine(found.message.subject || '(sem assunto)').replace(/"/g, "'")}"`,
      `data: ${emailStamp(found.message.date)} (${ageLabel(found.message.date, now())})`,
      found.message.seen ? 'lida' : 'não lida',
      ...(!isSent(found.message, found.status) ? [`pendente de resposta: ${found.pending ? 'sim' : 'não'}`] : []),
      'corpo: peça com ler_email',
    ].join(' · ')

  const search: AssistantTool = {
    name: 'buscar_emails',
    describe:
      'procura emails por remetente, destinatário, assunto, texto ou período em todas as contas: primeiro no que o app já tem e, nas contas IMAP, também no servidor (todas as pastas, só leitura), até 50 resultados, os mais recentes primeiro. Campos (pelo menos um): "de", "para", "assunto", "texto" (palavras do corpo), "desde" e "ate" (AAAA-MM-DD) e "conta" (o endereço de uma conta, opcional). Em conta POP3 só vale o que já foi baixado para o app: diga isso na resposta quando importar.',
    pending: 'Buscando emails',
    step: 'Grep',
    async run(args, folder) {
      if (deps.locked()) return LOCKED
      const parsed = searchSchema.safeParse(args)
      if (!parsed.success) return { file: null, label: 'Busca de emails sem critério', note: 'A busca precisa de pelo menos um critério: "de", "para", "assunto", "texto", "desde" ou "ate".' }
      const query = parsed.data
      const since = query.desde ? localDay(query.desde) : null
      const before = query.ate ? localDay(query.ate, true) : null
      const { caches, entries } = await cacheEntries()
      const accounts = caches.filter((cache) => contains(cache.status.account.address, query.conta))
      const wanted = new Set(accounts.map((cache) => cache.status.account.id))
      // No cache: o envelope (e, com "texto", o corpo já baixado).
      let reads = 0
      const local: EmailFound[] = []
      for (const entry of entries.sort((a, b) => b.message.date - a.message.date)) {
        const message = entry.message
        if (!wanted.has(entry.status.account.id)) continue
        if (!contains(addressText(message.from), query.de) || !contains(addressText([...message.to, ...message.cc]), query.para) || !contains(message.subject, query.assunto)) continue
        if ((since !== null && message.date < since) || (before !== null && message.date >= before)) continue
        if (query.texto) {
          if (reads >= CACHE_TEXT_READS_MAX) continue
          reads++
          const body = await deps.body(entry.status.account.id, message).catch(() => null)
          if (!contains(`${message.subject}\n${body ? bodyText(body) : ''}`, query.texto)) continue
        }
        local.push(entry)
      }
      // No servidor (CA7): as contas IMAP, só leitura.
      const notes: string[] = []
      const remote: EmailFound[] = []
      for (const cache of accounts) {
        if (deps.locked()) return LOCKED
        if (cache.status.account.incoming.protocol !== 'imap') {
          notes.push(`A conta ${cache.status.account.address} é POP3: só entra o que já foi baixado para o app.`)
          continue
        }
        const result = await deps.searchServer(
          cache.status.account.id,
          { from: query.de, to: query.para, subject: query.assunto, text: query.texto, since: since !== null ? new Date(since) : undefined, before: before !== null ? new Date(before) : undefined },
          EMAIL_SEARCH_MAX,
        )
        if (!result.ok) {
          notes.push(`O servidor da conta ${cache.status.account.address} não respondeu à busca: só entra o que o app já tem.`)
          continue
        }
        const own = caches.map((item) => item.status.account.address)
        const sent = caches.flatMap((item) => item.sent)
        if (result.skippedFolders > 0) notes.push(`A conta ${cache.status.account.address} tem mais pastas do que a busca lê: ${result.skippedFolders} pasta(s) ficaram de fora.`)
        for (const hit of result.found) {
          const uid = hit.message.uid
          if (uid === null) continue
          // Só a INBOX do servidor casa com a INBOX do cache (o mesmo UID na mesma pasta): aí vale a referência do cache.
          // Uma mensagem de outra pasta nunca é casada pelo UID: fica com a referência dela (a pasta, o UIDVALIDITY e o UID).
          const cached = hit.mailbox.toUpperCase() === 'INBOX' ? entries.find((entry) => entry.status.account.id === cache.status.account.id && isInbox(entry.message) && entry.message.uid === uid) : undefined
          if (cached) {
            if (!local.includes(cached)) local.push(cached)
            continue
          }
          // A mesma mensagem (o mesmo Message-ID) já está nos resultados pelo cache (a cópia em Enviados): não repete.
          if (hit.message.messageId !== null && local.some((entry) => entry.status.account.id === cache.status.account.id && entry.message.messageId === hit.message.messageId)) continue
          const found: EmailFound = { ref: emailRef(cache.status.account.id, hit.message.id, 'servidor'), status: cache.status, message: hit.message, mailbox: hit.mailbox, uid, pending: hit.specialUse !== '\\Sent' && isPending(hit.message, sent, own, cache.status) }
          remember(found)
          remote.push(found)
        }
      }
      if (deps.locked()) return LOCKED
      const all = [...local, ...remote].sort((a, b) => b.message.date - a.message.date).slice(0, EMAIL_SEARCH_MAX)
      const criteria = [query.de && `de "${query.de}"`, query.para && `para "${query.para}"`, query.assunto && `assunto "${query.assunto}"`, query.texto && `texto "${query.texto}"`, query.desde && `desde ${query.desde}`, query.ate && `até ${query.ate}`, query.conta && `conta ${query.conta}`].filter(Boolean).join(', ')
      const lines = [
        '# Busca de emails',
        '',
        `Critérios: ${criteria}. ${all.length} resultado(s)${all.length === EMAIL_SEARCH_MAX ? ' (o limite: pode haver mais; refine a busca)' : ''}, os mais recentes primeiro. Para o corpo de um resultado, use ler_email com a referência. Cite como [Email · <remetente> · dd/mm hh:mm].`,
        ...(notes.length ? ['', ...notes] : []),
        '',
        ...(all.length ? all.map(searchLine) : ['Nenhum email encontrado.']),
      ]
      await writeAtomic(join(folder, EMAIL_SEARCH_FILE), `${lines.join('\n')}\n`)
      return { file: EMAIL_SEARCH_FILE, label: `Buscando emails (${all.length} achados${remote.length ? `, ${remote.length} no servidor` : ''})` }
    },
  }

  const read: AssistantTool = {
    name: 'ler_email',
    describe:
      'lê o corpo de um email pela referência ("em-…", de EMAILS.md ou da busca). Campo: "email" (a referência). O que não foi baixado vem do servidor só para leitura (não marca como lido). Em conta POP3, só o que já foi baixado.',
    pending: 'Abrindo um email',
    step: 'Read',
    async run(args, folder) {
      if (deps.locked()) return LOCKED
      const parsed = readSchema.safeParse(args)
      if (!parsed.success) return { file: null, label: 'Email não encontrado', note: 'Referência inválida: use a referência "em-…" de EMAILS.md ou da busca.' }
      const found = await find(parsed.data.email)
      if (!found) return { file: null, label: 'Email não encontrado', note: 'Não achei esse email: faça a busca de novo.' }
      let body: EmailBody | null = await deps.body(found.status.account.id, found.message).catch(() => null)
      if (!body && found.mailbox === null && isInbox(found.message) && found.uid !== null && found.status.account.incoming.protocol === 'imap') {
        // Da INBOX, ainda não baixado: do servidor, só leitura (sem gravar no cache).
        const result = await deps.peekServer(found.status.account.id, 'INBOX', found.uid)
        body = result.ok ? result.body : null
      } else if (!body && found.mailbox !== null && found.uid !== null) {
        const result = await deps.peekServer(found.status.account.id, found.mailbox, found.uid)
        body = result.ok ? result.body : null
      }
      if (deps.locked()) return LOCKED
      if (!body) return { file: null, label: 'Email sem corpo disponível', note: found.status.account.incoming.protocol === 'pop3' ? 'Conta POP3: o corpo desse email não está no app.' : 'O servidor não devolveu o corpo desse email agora.' }
      const name = emailFileName(found.message.subject, found.ref)
      await writeAtomic(join(folder, name), messageMarkdown({ ref: found.ref, status: found.status, message: found.message, pending: found.pending, reminder: null }, body, now(), found.mailbox))
      return { file: name, label: `Abrindo o email «${emailOneLine(found.message.subject || '(sem assunto)').slice(0, 60)}»` }
    },
  }

  return { tools: [search, read], find }
}
