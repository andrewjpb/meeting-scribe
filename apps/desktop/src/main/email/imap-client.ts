// IMAP (contrato 42, R2 da PRD) pelo `imapflow`: só a INBOX e a pasta de enviados. O serviço fala com a interface
// `ImapSession`, que os testes trocam por um cliente falso; aqui fica só a ponte para a biblioteca. A biblioteca é
// carregada na primeira conexão: sem ela, a conta fica com erro e o resto do app segue (N4). Mensagem nova chega pelo
// `EXISTS` do IDLE, que o `imapflow` mantém sozinho enquanto a conexão está parada. Logs da biblioteca desligados:
// nada do protocolo (nem o `LOGIN`) vai a log.
import type { ConnectionOptions } from 'node:tls'
import type { FetchMessageObject, ImapFlow, MessageAddressObject } from 'imapflow'
import { EMAIL_RAW_MAX_BYTES, type EmailAddress, type EmailSecurity } from '../../shared/email'

export interface ImapConfig {
  host: string
  port: number
  security: EmailSecurity
  user: string
  pass: string
  tls?: ConnectionOptions | undefined
}

/** Uma mensagem da INBOX como o servidor descreve (`UID`, `FLAGS`, `ENVELOPE` e o cabeçalho `References`). */
export interface ImapMessage {
  uid: number
  flags: string[]
  date: number
  subject: string
  from: EmailAddress[]
  to: EmailAddress[]
  cc: EmailAddress[]
  messageId: string | null
  inReplyTo: string | null
  references: string[]
}

export interface ImapSession {
  /** `UIDVALIDITY` da INBOX: mudou, os UIDs guardados não valem mais. */
  readonly uidValidity: string
  /** As últimas `limit` mensagens da INBOX. */
  recent(limit: number): Promise<ImapMessage[]>
  /** As mensagens com UID acima de `uid`. */
  since(uid: number): Promise<ImapMessage[]>
  /** A mensagem inteira (RFC 822); `null` se ela sumiu, `too-big` se passa do limite (nem é baixada). */
  source(uid: number): Promise<Buffer | 'too-big' | null>
  /** `UID STORE +FLAGS (\Seen)` (ou `-FLAGS`). */
  setSeen(uid: number, seen: boolean): Promise<void>
  /** Contrato 53: `UID STORE +FLAGS (\Flagged)` (ou `-FLAGS`), a estrela de uma regra. */
  setFlagged(uid: number, flagged: boolean): Promise<void>
  /** `UID STORE +FLAGS (\Deleted)` e `EXPUNGE`. */
  remove(uid: number): Promise<void>
  /** `APPEND` na pasta de enviados (`\Sent`, ou pelo nome); `false` quando o servidor não tem uma. */
  appendSent(raw: Buffer): Promise<boolean>
  /** Contrato 52: o path da pasta de enviados (`\Sent`, ou pelo nome), pelo `LIST`; `null` se o servidor não tem uma. */
  sentPath?(): Promise<string | null>
  /** O IDLE avisou mensagem nova na INBOX. */
  onNew(listener: () => void): void
  /** A conexão caiu (ou o servidor a fechou). */
  onClose(listener: (error: unknown) => void): void
  close(): Promise<void>
}

export type ImapConnect = (config: ImapConfig) => Promise<ImapSession>

const address = (list: MessageAddressObject[] | undefined): EmailAddress[] =>
  (list ?? []).filter((item) => typeof item.address === 'string' && item.address !== '').map((item) => ({ name: item.name ? item.name : null, address: item.address ?? '' }))

/** Os Message-IDs de um cabeçalho `References` (ou `In-Reply-To`). */
export function messageIds(header: string): string[] {
  return [...header.matchAll(/<[^<>\s]{1,250}>/g)].map((match) => match[0]).slice(-50)
}

export function toImapMessage(message: FetchMessageObject): ImapMessage {
  const envelope = message.envelope ?? {}
  const date = envelope.date ? new Date(envelope.date).getTime() : NaN
  const references = message.headers ? messageIds(message.headers.toString('latin1').replace(/\r\n[ \t]+/g, ' ')) : []
  return {
    uid: message.uid,
    flags: [...(message.flags ?? [])],
    date: Number.isFinite(date) ? date : 0,
    subject: envelope.subject ?? '',
    from: address(envelope.from),
    to: address(envelope.to),
    cc: address(envelope.cc),
    messageId: envelope.messageId ?? null,
    inReplyTo: envelope.inReplyTo ?? null,
    references,
  }
}

const QUERY = { uid: true, flags: true, envelope: true, headers: ['references'] }
const SENT_NAMES = /^(sent|sent items|sent messages|sent mail|enviados|itens enviados|mensagens enviadas)$/i

/** A pasta de enviados do `LIST`: a marcada `\Sent` ou, sem ela, a que tem o nome de enviados. */
function findSent<T extends { name: string; specialUse?: string | undefined }>(boxes: readonly T[]): T | undefined {
  return boxes.find((box) => box.specialUse === '\\Sent') ?? boxes.find((box) => SENT_NAMES.test(box.name))
}

export const connectImap: ImapConnect = async (config) => {
  const { ImapFlow: Client } = await import('imapflow')
  const client: ImapFlow = new Client({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    // `starttls`: sem o STARTTLS do servidor, não conecta (a senha não vai em texto puro).
    doSTARTTLS: config.security === 'starttls' ? true : config.security === 'none' ? false : undefined,
    auth: { user: config.user, pass: config.pass },
    logger: false,
    ...(config.tls ? { tls: config.tls } : {}),
  })
  // Sem ouvinte, um `error` derrubaria o processo.
  client.on('error', () => undefined)
  let inbox: Awaited<ReturnType<ImapFlow['mailboxOpen']>>
  try {
    await client.connect()
    inbox = await client.mailboxOpen('INBOX')
  } catch (error) {
    // Sem a INBOX a sessão não serve: fecha já, senão cada nova tentativa deixaria uma conexão aberta.
    client.close()
    throw error
  }
  const fetchRange = async (range: string, byUid: boolean): Promise<ImapMessage[]> =>
    (await client.fetchAll(range, QUERY, { uid: byUid })).map(toImapMessage).sort((a, b) => a.uid - b.uid)

  return {
    uidValidity: String(inbox.uidValidity),

    async recent(limit) {
      const exists = client.mailbox ? client.mailbox.exists : 0
      if (exists === 0) return []
      return fetchRange(`${Math.max(1, exists - limit + 1)}:*`, false)
    },

    async since(uid) {
      // `N:*` sempre devolve a última, mesmo com UID menor: o filtro tira.
      return (await fetchRange(`${uid + 1}:*`, true)).filter((message) => message.uid > uid)
    },

    async source(uid) {
      const found = await client.fetchOne(String(uid), { uid: true, size: true }, { uid: true })
      if (!found) return null
      if ((found.size ?? 0) > EMAIL_RAW_MAX_BYTES) return 'too-big'
      // O `source` do `imapflow` vai como `BODY.PEEK[]` (conferido na 2.12.1): baixar (a leitura, a condição de corpo de
      // uma regra) não marca como lida no servidor.
      const full = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
      return full && full.source ? full.source : null
    },

    async setSeen(uid, seen) {
      if (seen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
      else await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true })
    },

    async setFlagged(uid, flagged) {
      if (flagged) await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true })
      else await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true })
    },

    async remove(uid) {
      // O `imapflow` marca `\Deleted` e faz o `UID EXPUNGE` (ou `EXPUNGE`) dessa mensagem.
      await client.messageDelete(String(uid), { uid: true })
    },

    async appendSent(raw) {
      const sent = findSent(await client.list())
      if (!sent) return false
      return (await client.append(sent.path, raw, ['\\Seen'])) !== false
    },

    async sentPath() {
      return findSent(await client.list())?.path ?? null
    },

    onNew(listener) {
      client.on('exists', (event: { path: string; count: number; prevCount: number }) => {
        if (event.path === 'INBOX' && event.count > event.prevCount) listener()
      })
    },

    onClose(listener) {
      client.on('close', () => listener(null))
    },

    async close() {
      await client.logout().catch(() => client.close())
    },
  }
}

// Contrato 45 (CA7): a busca do Assistente além do cache. Uma conexão à parte (a da INBOX fica no IDLE), que abre cada
// pasta só para leitura (`EXAMINE`, `readOnly`): nenhuma flag muda. O corpo vem por `BODY.PEEK[]` (o `source` do
// `imapflow`), que também não marca como lida. Nada daqui grava no cache.

/** Uma pasta do `LIST` que dá para abrir. */
export interface ImapFolder {
  path: string
  name: string
  /** `\Sent`, `\Trash`, `\Junk`…, ou `null`. */
  specialUse: string | null
}

/** Os critérios da busca, juntos (todos valem). `text` procura no cabeçalho e no corpo. */
export interface ImapSearchQuery {
  from?: string | undefined
  to?: string | undefined
  subject?: string | undefined
  text?: string | undefined
  since?: Date | undefined
  before?: Date | undefined
}

export interface ImapReader {
  /** As pastas do `LIST` que dá para abrir (sem `\Noselect`). */
  folders(): Promise<ImapFolder[]>
  /**
   * `UID SEARCH` numa pasta aberta só para leitura: as `limit` mais recentes, com o envelope, e o `UIDVALIDITY` da pasta
   * (o UID só vale junto com a pasta e ele).
   */
  search(path: string, query: ImapSearchQuery, limit: number): Promise<{ uidValidity: string; messages: ImapMessage[] }>
  /** A mensagem inteira por `BODY.PEEK[]`; `null` se sumiu, `too-big` se passa do limite. */
  peek(path: string, uid: number): Promise<Buffer | 'too-big' | null>
  close(): Promise<void>
}

export type ImapReaderConnect = (config: ImapConfig) => Promise<ImapReader>

export const connectImapReader: ImapReaderConnect = async (config) => {
  const { ImapFlow: Client } = await import('imapflow')
  const client: ImapFlow = new Client({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    doSTARTTLS: config.security === 'starttls' ? true : config.security === 'none' ? false : undefined,
    auth: { user: config.user, pass: config.pass },
    logger: false,
    ...(config.tls ? { tls: config.tls } : {}),
  })
  client.on('error', () => undefined)
  await client.connect()
  let open: { path: string; uidValidity: string } | null = null
  // Sempre `EXAMINE`: a pasta nunca fica aberta para escrita nesta conexão.
  const examine = async (path: string): Promise<string> => {
    if (open?.path === path) return open.uidValidity
    const box = await client.mailboxOpen(path, { readOnly: true })
    open = { path, uidValidity: String(box.uidValidity) }
    return open.uidValidity
  }
  return {
    async folders() {
      const boxes = await client.list()
      return boxes.filter((box) => !box.flags.has('\\Noselect') && !box.flags.has('\\NonExistent')).map((box) => ({ path: box.path, name: box.name, specialUse: box.specialUse ?? null }))
    },

    async search(path, query, limit) {
      const uidValidity = await examine(path)
      const criteria: Record<string, unknown> = {}
      if (query.from) criteria['from'] = query.from
      if (query.to) criteria['to'] = query.to
      if (query.subject) criteria['subject'] = query.subject
      if (query.text) criteria['text'] = query.text
      if (query.since) criteria['since'] = query.since
      if (query.before) criteria['before'] = query.before
      const found = await client.search(Object.keys(criteria).length ? criteria : { all: true }, { uid: true })
      const uids = (Array.isArray(found) ? found : []).sort((a, b) => b - a).slice(0, limit)
      if (!uids.length) return { uidValidity, messages: [] }
      return { uidValidity, messages: (await client.fetchAll(uids.join(','), QUERY, { uid: true })).map(toImapMessage).sort((a, b) => b.uid - a.uid) }
    },

    async peek(path, uid) {
      await examine(path)
      const found = await client.fetchOne(String(uid), { uid: true, size: true }, { uid: true })
      if (!found) return null
      if ((found.size ?? 0) > EMAIL_RAW_MAX_BYTES) return 'too-big'
      const full = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
      return full && full.source ? full.source : null
    },

    async close() {
      await client.logout().catch(() => client.close())
    },
  }
}

// Contrato 52: as pastas da conta, numa conexão à parte para cada pedido (a da INBOX fica no IDLE, com a INBOX
// selecionada): `LIST` com `STATUS (MESSAGES UNSEEN)`, as mais recentes de uma pasta (só leitura, `EXAMINE`), `MOVE` e
// `CREATE`/`RENAME`/`DELETE`. Sem `MOVE` no servidor, o `imapflow` faz `COPY` + `\Deleted` + `UID EXPUNGE` (com
// `UIDPLUS`), e só tira da origem se a cópia deu certo. Sem `MOVE` e sem `UIDPLUS` o mover é recusado: o `EXPUNGE` puro
// apagaria também as outras mensagens marcadas `\Deleted` da pasta. O mover confere antes o `UIDVALIDITY` da origem: os
// UIDs pedidos só valem com o dela.

/** Uma pasta do `LIST`, com o `STATUS` (quando o servidor deu). */
export interface ImapFolderEntry {
  path: string
  name: string
  delimiter: string | null
  specialUse: string | null
  /** `\Noselect` (ou `\NonExistent`): só um nó da árvore. */
  noselect: boolean
  total: number | null
  unseen: number | null
}

/** O resultado do `MOVE`: o UID de destino de cada um (`COPYUID`), ou `null` quando o servidor não disse. */
export interface ImapMoved {
  /** O `UIDVALIDITY` da pasta de destino (do `COPYUID`), ou `null`. */
  uidValidity: string | null
  moved: { fromUid: number; toUid: number | null }[]
}

/**
 * Contrato 52: o mover não foi feito. `uidvalidity`: a pasta de origem mudou de `UIDVALIDITY` (os UIDs pedidos são de
 * outra); `unsupported`: servidor sem `MOVE` e sem `UIDPLUS`.
 */
export class ImapFolderError extends Error {
  constructor(readonly kind: 'uidvalidity' | 'unsupported') {
    super(kind === 'uidvalidity' ? 'UIDVALIDITY da origem mudou' : 'servidor sem MOVE nem UIDPLUS')
    this.name = 'ImapFolderError'
  }
}

export interface ImapFolderSession {
  list(): Promise<ImapFolderEntry[]>
  /** As últimas `limit` da pasta, aberta só para leitura, com o `UIDVALIDITY` dela. */
  recent(path: string, limit: number): Promise<{ uidValidity: string; messages: ImapMessage[] }>
  /**
   * `UID MOVE` (ou `COPY` + `UID EXPUNGE`) só se o `UIDVALIDITY` da origem é `uidValidity`; erro do servidor vira exceção
   * (`ImapFolderError` quando nem foi tentado), e nada foi tirado da origem.
   */
  move(from: string, uids: readonly number[], to: string, uidValidity: string): Promise<ImapMoved>
  /** `CREATE`; devolve o path criado (o servidor pode pôr o prefixo do namespace). Já existir não é erro. */
  create(path: string): Promise<string>
  /** `RENAME`; devolve o path novo. */
  rename(path: string, newPath: string): Promise<string>
  delete(path: string): Promise<void>
  close(): Promise<void>
}

export type ImapFolderConnect = (config: ImapConfig) => Promise<ImapFolderSession>

/** O mapa do `COPYUID` do `imapflow` na lista do serviço, na ordem dos UIDs pedidos. */
export function movedList(uids: readonly number[], uidMap: ReadonlyMap<number, number> | undefined, uidValidity: bigint | string | null | undefined = null): ImapMoved {
  return { uidValidity: uidValidity === null || uidValidity === undefined ? null : String(uidValidity), moved: uids.map((uid) => ({ fromUid: uid, toUid: uidMap?.get(uid) ?? null })) }
}

export const connectImapFolders: ImapFolderConnect = async (config) => {
  const { ImapFlow: Client } = await import('imapflow')
  const client: ImapFlow = new Client({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    doSTARTTLS: config.security === 'starttls' ? true : config.security === 'none' ? false : undefined,
    auth: { user: config.user, pass: config.pass },
    logger: false,
    ...(config.tls ? { tls: config.tls } : {}),
  })
  client.on('error', () => undefined)
  await client.connect()
  return {
    async list() {
      const boxes = await client.list({ statusQuery: { messages: true, unseen: true } })
      return boxes.map((box) => {
        const noselect = box.flags.has('\\Noselect') || box.flags.has('\\NonExistent')
        return {
          path: box.path,
          name: box.name,
          delimiter: box.delimiter ? box.delimiter : null,
          specialUse: box.specialUse ?? null,
          noselect,
          total: noselect ? null : (box.status?.messages ?? null),
          unseen: noselect ? null : (box.status?.unseen ?? null),
        }
      })
    },

    async recent(path, limit) {
      const box = await client.mailboxOpen(path, { readOnly: true })
      const uidValidity = String(box.uidValidity)
      if (box.exists === 0) return { uidValidity, messages: [] }
      const messages = (await client.fetchAll(`${Math.max(1, box.exists - limit + 1)}:*`, QUERY)).map(toImapMessage).sort((a, b) => a.uid - b.uid)
      return { uidValidity, messages }
    },

    async move(from, uids, to, uidValidity) {
      if (!client.capabilities.has('MOVE') && !client.capabilities.has('UIDPLUS')) throw new ImapFolderError('unsupported')
      const box = await client.mailboxOpen(from)
      if (String(box.uidValidity) !== uidValidity) throw new ImapFolderError('uidvalidity')
      const result = await client.messageMove(uids.join(','), to, { uid: true })
      if (!result) throw new Error('MOVE recusado')
      return movedList(uids, result.uidMap, result.uidValidity)
    },

    async create(path) {
      return (await client.mailboxCreate(path)).path
    },

    async rename(path, newPath) {
      return (await client.mailboxRename(path, newPath)).newPath
    },

    async delete(path) {
      await client.mailboxDelete(path)
    },

    async close() {
      await client.logout().catch(() => client.close())
    },
  }
}
