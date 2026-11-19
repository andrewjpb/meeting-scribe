// Servidor de email falso do smoke (contrato 43): uma INBOX IMAP em memória com mensagens inventadas (domínios
// `.example`), o SMTP que só registra o que sairia e as imagens remotas do "Carregar imagens". Nada sai da máquina e
// nenhuma senha de verdade é usada: a senha `SMOKE_EMAIL_WRONG_PASSWORD` faz o servidor recusar o login.
// Contrato 52: as pastas em memória (INBOX, "Enviados", "Arquivo" e as criadas), com `LIST` aninhado pelo delimitador,
// `STATUS`, `MOVE` (ou, com `capabilities.move` desligado, `COPY` + `\Deleted` + `EXPUNGE`), o `COPYUID` (com
// `capabilities.uidplus`), `CREATE`, `RENAME` e `DELETE`. Os comandos ficam em `folderLog`.
// Contrato 53: `STORE \Flagged` na conexão da INBOX, a pasta "Lixeira" (`\Trash`, com `trash: true`) e o registro dos
// comandos da conexão da INBOX (`sessionLog`: as marcas e o `EXPUNGE` do "Apagar").
// Contrato 56: o `UID SEARCH UID` e o `UID SEARCH HEADER Message-ID` da conexão de leitura (`locate`, com o
// `UIDVALIDITY` de verdade da pasta), mensagens postas direto numa pasta (`put`, com `References`/`In-Reply-To`), a
// pasta apagada por fora (`dropFolder`) e a mensagem tirada por fora (`take`).
import type { EmailAddress } from '../../shared/email'
import { ImapFolderError, movedList, type ImapConnect, type ImapFolderConnect, type ImapFolderEntry, type ImapMessage, type ImapReaderConnect, type ImapSession } from './imap-client'
import type { Pop3Connect } from './pop3-client'
import { SmtpError, type OutgoingMail, type SmtpSend, type SmtpVerify } from './smtp-client'

export const SMOKE_EMAIL_ADDRESS = 'andrew.teste@lap.example'
export const SMOKE_EMAIL_PASSWORD = 'senha-de-app-falsa'
export const SMOKE_EMAIL_WRONG_PASSWORD = 'senha-recusada'
/** Imagem remota do email em HTML: o smoke confere que só chega depois de "Carregar imagens". */
export const SMOKE_EMAIL_IMAGE_URL = 'https://cdn.cliente.example/banner.png'
/** PNG de 1×1 em azul da LAP. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQi94BAAHMATKEhtVqAAAAAElFTkSuQmCC', 'base64')

interface Seed {
  from: EmailAddress
  subject: string
  minutesAgo: number
  seen: boolean
  text: string
  html?: string
  cc?: EmailAddress[]
  /** Contrato 43 (CA8 e CA9): anexos (nome e conteúdo em texto). */
  attachments?: { name: string; type: string; content: string }[]
}

/** O anexo da mensagem do Financeiro: o smoke confere que o arquivo salvo tem exatamente isto. */
export const SMOKE_EMAIL_ATTACHMENT = { name: 'notas-novembro.csv', type: 'text/csv', content: 'nota;valor\n1021;1.250,00\n1022;980,50\n' }

const ANDREW: EmailAddress = { name: 'Andrew Teste', address: SMOKE_EMAIL_ADDRESS }

const SEEDS: Seed[] = [
  {
    from: { name: 'Marina Rocha', address: 'marina.rocha@cliente.example' },
    cc: [{ name: 'Paulo Nunes', address: 'paulo.nunes@cliente.example' }],
    subject: 'Proposta revisada do projeto de integração',
    minutesAgo: 12,
    seen: false,
    text: 'Olá, Andrew. Segue a proposta revisada com o novo cronograma. Detalhes em https://portal.cliente.example/proposta.',
    html:
      '<html><head><style>p{color:red}</style><script>window.__emailXss = true</script></head><body>' +
      '<p>Olá, Andrew.</p><p>Segue a <b>proposta revisada</b> com o novo cronograma, já com os ajustes que combinamos na reunião de terça.</p>' +
      '<img src="' + SMOKE_EMAIL_IMAGE_URL + '" alt="Logo do cliente" width="240">' +
      '<ul><li>Fase 1: levantamento (2 semanas)</li><li>Fase 2: integração (4 semanas)</li></ul>' +
      '<p>Os detalhes estão no <a href="https://portal.cliente.example/proposta" onclick="window.__emailXss = true">portal do cliente</a>.</p>' +
      '<iframe src="https://cliente.example/rastreio"></iframe><form action="https://cliente.example/f"><input name="x"></form>' +
      '<p>Abraço,<br>Marina</p></body></html>',
  },
  {
    from: { name: 'Financeiro LAP', address: 'financeiro@lap.example' },
    subject: 'Fechamento de novembro: notas para conferir',
    minutesAgo: 95,
    seen: false,
    text: 'Bom dia! As notas fiscais de novembro já estão na pasta compartilhada. Precisamos da conferência até sexta.',
    attachments: [SMOKE_EMAIL_ATTACHMENT],
  },
  {
    from: { name: 'Juliana Prado', address: 'juliana.prado@parceiro.example' },
    subject: 'Re: Agenda da apresentação',
    minutesAgo: 60 * 26,
    seen: true,
    text: 'Pode ser quinta às 15h. Mando o convite.\n\n> Podemos marcar a apresentação na quinta?',
  },
  {
    from: { name: null, address: 'avisos@servidor.example' },
    subject: 'Backup concluído com sucesso',
    minutesAgo: 60 * 50,
    seen: true,
    text: 'O backup diário terminou às 03:12 sem erros.',
  },
]

/**
 * Contrato 45 (CA7): uma mensagem antiga só no servidor, na pasta "Arquivo" (fora da INBOX e do cache do app), para a
 * busca do Assistente achar.
 */
export const SMOKE_EMAIL_ARCHIVED: Seed = {
  from: { name: 'Juliana Prado', address: 'juliana.prado@parceiro.example' },
  subject: 'Contrato de parceria assinado',
  minutesAgo: 60 * 24 * 400,
  seen: true,
  text: 'Segue o contrato de parceria assinado pelas duas partes. Vigência de 24 meses.',
}
export const SMOKE_EMAIL_ARCHIVE_FOLDER = 'Arquivo'

function rfc822(seed: Seed, date: Date, messageId: string): Buffer {
  const address = (item: EmailAddress): string => (item.name ? `"${item.name}" <${item.address}>` : item.address)
  const encode = (value: string): string => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
  const head = [
    `From: ${seed.from.name ? `${encode(seed.from.name)} <${seed.from.address}>` : seed.from.address}`,
    `To: ${address(ANDREW)}`,
    ...(seed.cc ? [`Cc: ${seed.cc.map(address).join(', ')}`] : []),
    `Subject: ${encode(seed.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ]
  const part = (type: string, body: string): string => `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body, 'utf8').toString('base64')}`
  if (seed.attachments?.length) {
    const files = seed.attachments.map((item) => `--m1\r\nContent-Type: ${item.type}; name="${item.name}"\r\nContent-Disposition: attachment; filename="${item.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(item.content, 'utf8').toString('base64')}\r\n`)
    return Buffer.from(`${head.join('\r\n')}\r\nContent-Type: multipart/mixed; boundary="m1"\r\n\r\n--m1\r\n${part('text/plain', seed.text)}\r\n${files.join('')}--m1--\r\n`)
  }
  if (!seed.html) return Buffer.from(`${head.join('\r\n')}\r\n${part('text/plain', seed.text)}\r\n`)
  return Buffer.from(`${head.join('\r\n')}\r\nContent-Type: multipart/alternative; boundary="b1"\r\n\r\n--b1\r\n${part('text/plain', seed.text)}\r\n--b1\r\n${part('text/html', seed.html)}\r\n--b1--\r\n`)
}

/** Contrato 52: uma pasta do servidor falso. */
interface FakeMailbox {
  uidValidity: string
  nextUid: number
  specialUse: string | null
  noselect: boolean
  items: { message: ImapMessage; raw: Buffer }[]
}

export interface FakeEmailOptions {
  /** O delimitador do `LIST` (padrão `/`). */
  delimiter?: '/' | '.'
  /** Pastas a mais ao começar (as do meio de um path aninhado entram sozinhas). */
  folders?: { path: string; specialUse?: string; noselect?: boolean }[]
  /** Contrato 53: o servidor tem a pasta "Lixeira" (`\Trash`). Sem isto, não tem Lixeira. */
  trash?: boolean
}

/** Contrato 56: uma mensagem posta direto numa pasta do servidor falso. */
export interface FakePut {
  from: EmailAddress
  to?: EmailAddress[]
  subject: string
  date: number
  messageId?: string | null
  inReplyTo?: string | null
  references?: string[]
  seen?: boolean
  text?: string
}

/** Contrato 53: a Lixeira do servidor falso (com `trash: true`). */
export const SMOKE_EMAIL_TRASH_FOLDER = 'Lixeira'

export interface FakeEmail {
  imap: ImapConnect
  /** Contrato 52: a conexão das pastas. */
  imapFolders: ImapFolderConnect
  /** Contrato 52: o servidor tem `MOVE` e `UIDPLUS` (o `COPYUID`); dá para desligar cada um. */
  capabilities: { move: boolean; uidplus: boolean }
  /** Contrato 52: o próximo comando de pastas com este nome (`MOVE`, `CREATE`, `RENAME`, `DELETE` e, no contrato 53, `STORE` da conexão da INBOX) é recusado. */
  failNext: string | null
  /** Contrato 52: os comandos de pastas que o servidor recebeu (`UID MOVE 1,2 Arquivo`, `CREATE x`…). */
  folderLog: string[]
  /** Contrato 53: os comandos da conexão da INBOX (`UID STORE 5 +FLAGS (\Seen)`, `UID EXPUNGE 5`…). */
  sessionLog: string[]
  /** Contrato 52: a pasta ganha um `UIDVALIDITY` novo (os UIDs guardados deixam de valer). */
  resetUidValidity(path: string): void
  /** Contrato 52: as pastas como estão (path → UIDs e flags). */
  mailboxes(): Record<string, { uids: number[]; unseen: number; specialUse: string | null; noselect: boolean }>
  /** Contrato 56: uma mensagem posta direto na pasta (criada se faltar), sem aviso do IDLE; devolve o UID. */
  put(path: string, input: FakePut): number
  /** Contrato 56: a pasta some do servidor por fora do app (apagada ou renomeada noutro cliente). */
  dropFolder(path: string): void
  /** Contrato 56: a mensagem sai da pasta por fora do app (a pessoa a moveu noutro cliente); devolve a que saiu. */
  take(path: string, uid: number): ImapMessage | null
  /** Contrato 56: os Message-IDs de uma pasta, na ordem dos UIDs. */
  messageIdsIn(path: string): (string | null)[]
  /** Contrato 45 (CA7): a conexão só de leitura da busca do Assistente (INBOX, "Enviados" e "Arquivo"). */
  imapReader: ImapReaderConnect
  /** As buscas e as leituras dessa conexão (o smoke confere que houve e que nada mudou de flag). */
  reader: { searches: number; peeks: number }
  pop3: Pop3Connect
  smtp: SmtpSend
  smtpVerify: SmtpVerify
  /** O que o SMTP falso recebeu (sem anexo em bytes: só nome e tamanho). Contrato 61: o REPLY de convite (`null` nos outros). */
  sent: { to: string[]; cc: string[]; subject: string; text: string; inReplyTo: string | null; attachments: { name: string; size: number }[]; icalEvent: { method: 'REPLY'; filename: string; content: string } | null }[]
  /** `APPEND` na pasta de enviados. */
  appended: number
  /** O SMTP recusa o próximo envio (o composer mantém o rascunho com o aviso). */
  failNextSend: boolean
  /** Contrato 61: posto, o SMTP espera essa promessa antes de registrar em `sent` e de responder (o "Enviando"). */
  smtpHold: (() => Promise<void>) | null
  /** Um email novo na INBOX, avisado pelo "IDLE". */
  deliver(input: { from: EmailAddress; subject: string; text: string; cc?: EmailAddress[]; attachments?: Seed['attachments'] }): Promise<void>
  /** Imagens remotas pedidas pelo "Carregar imagens". */
  imageRequests: string[]
  fetchImage(url: string): Promise<{ type: string; bytes: Uint8Array } | null>
}

export function createFakeEmail(now: () => number = Date.now, options: FakeEmailOptions = {}): FakeEmail {
  const delimiter = options.delimiter ?? '/'
  const inboxBox: FakeMailbox = { uidValidity: '1', nextUid: 1, specialUse: null, noselect: false, items: [] }
  const inbox = inboxBox.items
  const listeners = new Set<() => void>()
  const add = (seed: Seed, at: number): void => {
    const uid = inboxBox.nextUid++
    const messageId = `<smoke-${uid}@cliente.example>`
    const date = new Date(at)
    inbox.push({
      message: { uid, flags: seed.seen ? ['\\Seen'] : [], date: date.getTime(), subject: seed.subject, from: [seed.from], to: [ANDREW], cc: seed.cc ?? [], messageId, inReplyTo: null, references: [] },
      raw: rfc822(seed, date, messageId),
    })
  }
  for (const seed of [...SEEDS].reverse()) add(seed, now() - seed.minutesAgo * 60_000)
  // A pasta "Arquivo" do servidor, com UIDs próprios.
  const archivedAt = new Date(now() - SMOKE_EMAIL_ARCHIVED.minutesAgo * 60_000)
  const archived = [
    {
      message: { uid: 7, flags: ['\\Seen'], date: archivedAt.getTime(), subject: SMOKE_EMAIL_ARCHIVED.subject, from: [SMOKE_EMAIL_ARCHIVED.from], to: [ANDREW], cc: [], messageId: '<arquivo-7@parceiro.example>', inReplyTo: null, references: [] },
      raw: rfc822(SMOKE_EMAIL_ARCHIVED, archivedAt, '<arquivo-7@parceiro.example>'),
    },
  ]
  let nextValidity = 10
  const folders = new Map<string, FakeMailbox>([
    ['INBOX', inboxBox],
    ['Enviados', { uidValidity: '1', nextUid: 1, specialUse: '\\Sent', noselect: false, items: [] }],
    [SMOKE_EMAIL_ARCHIVE_FOLDER, { uidValidity: '1', nextUid: 8, specialUse: '\\Archive', noselect: false, items: archived }],
  ])
  /** Cria a pasta (e as do meio do path que faltarem, como o servidor faz). */
  const ensure = (path: string, specialUse: string | null = null, noselect = false): void => {
    const parts = path.split(delimiter)
    for (let index = 1; index <= parts.length; index++) {
      const part = parts.slice(0, index).join(delimiter)
      if (!folders.has(part)) folders.set(part, { uidValidity: String(nextValidity++), nextUid: 1, specialUse: index === parts.length ? specialUse : null, noselect: index === parts.length ? noselect : false, items: [] })
    }
  }
  if (options.trash) ensure(SMOKE_EMAIL_TRASH_FOLDER, '\\Trash')
  for (const folder of options.folders ?? []) ensure(folder.path, folder.specialUse ?? null, folder.noselect ?? false)
  const boxes = (): Record<string, { message: ImapMessage; raw: Buffer }[]> => Object.fromEntries([...folders].map(([path, box]) => [path, box.items]))
  const copyOf = (item: { message: ImapMessage; raw: Buffer }): ImapMessage => ({ ...item.message, flags: [...item.message.flags] })
  const refuse = (command: string): void => {
    if (fake.failNext !== command) return
    fake.failNext = null
    throw new Error(`falso: ${command} recusado`)
  }
  const selectable = (path: string): FakeMailbox => {
    const box = folders.get(path)
    if (!box || box.noselect) throw new Error('falso: pasta inexistente')
    return box
  }
  const matches = (item: { message: ImapMessage; raw: Buffer }, query: Parameters<Awaited<ReturnType<ImapReaderConnect>>['search']>[1]): boolean => {
    const has = (value: string, needle: string | undefined): boolean => !needle || value.toLowerCase().includes(needle.toLowerCase())
    const people = (list: EmailAddress[]): string => list.map((one) => `${one.name ?? ''} ${one.address}`).join(' ')
    return (
      has(people(item.message.from), query.from) &&
      has(people(item.message.to), query.to) &&
      has(item.message.subject, query.subject) &&
      (!query.text || has(`${item.message.subject} ${item.raw.toString('utf8')}`, query.text) || has(Buffer.from(item.raw.toString('utf8').split('\r\n\r\n').slice(1).join(''), 'base64').toString('utf8'), query.text)) &&
      (!query.since || item.message.date >= query.since.getTime()) &&
      (!query.before || item.message.date < query.before.getTime())
    )
  }

  const login = (pass: string): void => {
    if (pass === SMOKE_EMAIL_WRONG_PASSWORD) throw Object.assign(new Error('falso: login recusado'), { authenticationFailed: true })
  }

  const fake: FakeEmail = {
    capabilities: { move: true, uidplus: true },
    failNext: null,
    folderLog: [],
    sessionLog: [],
    resetUidValidity(path) {
      const box = folders.get(path)
      if (box) box.uidValidity = String(nextValidity++)
    },
    mailboxes: () =>
      Object.fromEntries(
        [...folders].map(([path, box]) => [path, { uids: box.items.map((item) => item.message.uid), unseen: box.items.filter((item) => !item.message.flags.includes('\\Seen')).length, specialUse: box.specialUse, noselect: box.noselect }]),
      ),
    put(path, input) {
      ensure(path)
      const box = selectable(path)
      const uid = box.nextUid++
      const messageId = input.messageId === undefined ? `<put-${path.replace(/[^\w]/g, '')}-${uid}@cliente.example>` : input.messageId
      const to = input.to ?? [ANDREW]
      const date = new Date(input.date)
      const seed: Seed = { from: input.from, subject: input.subject, minutesAgo: 0, seen: input.seen ?? true, text: input.text ?? `Mensagem ${uid}.` }
      box.items.push({
        message: { uid, flags: input.seen === false ? [] : ['\\Seen'], date: date.getTime(), subject: input.subject, from: [input.from], to, cc: [], messageId, inReplyTo: input.inReplyTo ?? null, references: input.references ?? [] },
        raw: rfc822(seed, date, messageId ?? ''),
      })
      return uid
    },
    dropFolder(path) {
      if (path !== 'INBOX') folders.delete(path)
    },
    take(path, uid) {
      const box = folders.get(path)
      const index = box ? box.items.findIndex((item) => item.message.uid === uid) : -1
      if (!box || index < 0) return null
      return box.items.splice(index, 1)[0]?.message ?? null
    },
    messageIdsIn: (path) => [...(folders.get(path)?.items ?? [])].sort((a, b) => a.message.uid - b.message.uid).map((item) => item.message.messageId),
    async imapFolders(config) {
      login(config.pass)
      return {
        list: async (): Promise<ImapFolderEntry[]> =>
          [...folders].map(([path, box]) => ({
            path,
            name: path.split(delimiter).pop() ?? path,
            delimiter,
            specialUse: box.specialUse,
            noselect: box.noselect,
            total: box.noselect ? null : box.items.length,
            unseen: box.noselect ? null : box.items.filter((item) => !item.message.flags.includes('\\Seen')).length,
          })),
        recent: async (path, limit) => {
          const box = selectable(path)
          return { uidValidity: box.uidValidity, messages: [...box.items].sort((a, b) => a.message.uid - b.message.uid).slice(-limit).map(copyOf) }
        },
        move: async (from, uids, to, uidValidity) => {
          // Como a conexão de verdade: sem MOVE e sem UIDPLUS nem tenta; UIDVALIDITY diferente, nada muda.
          if (!fake.capabilities.move && !fake.capabilities.uidplus) throw new ImapFolderError('unsupported')
          const source = selectable(from)
          const target = selectable(to)
          if (source.uidValidity !== uidValidity) throw new ImapFolderError('uidvalidity')
          const set = uids.join(',')
          if (fake.capabilities.move) {
            fake.folderLog.push(`UID MOVE ${set} ${to}`)
            refuse('MOVE')
          } else {
            fake.folderLog.push(`UID COPY ${set} ${to}`)
            refuse('COPY')
            fake.folderLog.push(`UID STORE ${set} +FLAGS (\\Deleted)`, `UID EXPUNGE ${set}`)
          }
          const map = new Map<number, number>()
          for (const uid of uids) {
            const index = source.items.findIndex((item) => item.message.uid === uid)
            if (index < 0) continue
            const [item] = source.items.splice(index, 1)
            if (!item) continue
            const toUid = target.nextUid++
            target.items.push({ message: { ...item.message, uid: toUid }, raw: item.raw })
            map.set(uid, toUid)
          }
          // Contrato 56: como no servidor de verdade, o IDLE da INBOX avisa o que chegou a ela por outra conexão.
          if (to === 'INBOX' && map.size) queueMicrotask(() => {
            for (const listener of listeners) listener()
          })
          return movedList(uids, fake.capabilities.uidplus ? map : undefined, fake.capabilities.uidplus ? target.uidValidity : null)
        },
        create: async (path) => {
          fake.folderLog.push(`CREATE ${path}`)
          refuse('CREATE')
          ensure(path)
          return path
        },
        rename: async (path, newPath) => {
          fake.folderLog.push(`RENAME ${path} ${newPath}`)
          refuse('RENAME')
          if (!folders.has(path) || folders.has(newPath)) throw new Error('falso: RENAME impossível')
          // A pasta e as de dentro dela mudam de path; a ordem do `LIST` fica.
          const prefix = `${path}${delimiter}`
          const renamed = [...folders].map(([key, box]): [string, FakeMailbox] => [key === path ? newPath : key.startsWith(prefix) ? `${newPath}${delimiter}${key.slice(prefix.length)}` : key, box])
          folders.clear()
          for (const [key, box] of renamed) folders.set(key, box)
          return newPath
        },
        delete: async (path) => {
          fake.folderLog.push(`DELETE ${path}`)
          refuse('DELETE')
          const box = folders.get(path)
          if (!box || path === 'INBOX') throw new Error('falso: DELETE impossível')
          // Com pastas dentro, ela fica só como nó (`\Noselect`), sem as mensagens (RFC 3501, 6.3.4).
          if ([...folders.keys()].some((key) => key.startsWith(`${path}${delimiter}`))) {
            box.items.splice(0)
            box.noselect = true
          } else folders.delete(path)
        },
        close: async () => undefined,
      }
    },
    reader: { searches: 0, peeks: 0 },
    async imapReader(config) {
      login(config.pass)
      return {
        folders: async () => [...folders].filter(([, box]) => !box.noselect).map(([path, box]) => ({ path, name: path.split(delimiter).pop() ?? path, specialUse: box.specialUse })),
        search: async (path, query, limit) => {
          fake.reader.searches++
          return {
            uidValidity: '1',
            messages: (boxes()[path] ?? [])
              .filter((item) => matches(item, query))
              .sort((a, b) => b.message.uid - a.message.uid)
              .slice(0, limit)
              .map((item) => ({ ...item.message, flags: [...item.message.flags] })),
          }
        },
        // `BODY.PEEK[]`: devolve a mensagem sem mexer nas flags.
        peek: async (path, uid) => {
          fake.reader.peeks++
          return (boxes()[path] ?? []).find((item) => item.message.uid === uid)?.raw ?? null
        },
        // Contrato 56: `EXAMINE` + `UID SEARCH UID` + `UID SEARCH HEADER Message-ID`, com o `UIDVALIDITY` da pasta.
        locate: async (path, uids, messageIds) => {
          const box = selectable(path)
          fake.folderLog.push(`UID SEARCH HEADER Message-ID ${path} (${messageIds.length})`)
          const present = new Set(box.items.map((item) => item.message.uid))
          const byMessageId: Record<string, number[]> = {}
          for (const id of messageIds) byMessageId[id] = box.items.filter((item) => item.message.messageId === id).map((item) => item.message.uid)
          return { uidValidity: box.uidValidity, existing: uids.filter((uid) => present.has(uid)), byMessageId }
        },
        close: async () => undefined,
      }
    },
    sent: [],
    appended: 0,
    failNextSend: false,
    smtpHold: null,
    imageRequests: [],
    async imap(config) {
      login(config.pass)
      const own = new Set<() => void>()
      const session: ImapSession = {
        uidValidity: '1',
        recent: async (limit) => inbox.slice(-limit).map((item) => ({ ...item.message, flags: [...item.message.flags] })),
        since: async (uid) => inbox.filter((item) => item.message.uid > uid).map((item) => ({ ...item.message, flags: [...item.message.flags] })),
        source: async (uid) => inbox.find((item) => item.message.uid === uid)?.raw ?? null,
        setSeen: async (uid, seen) => {
          fake.sessionLog.push(`UID STORE ${uid} ${seen ? '+' : '-'}FLAGS (\\Seen)`)
          refuse('STORE')
          const found = inbox.find((item) => item.message.uid === uid)
          if (found) found.message.flags = seen ? [...new Set([...found.message.flags, '\\Seen'])] : found.message.flags.filter((flag) => flag !== '\\Seen')
        },
        setFlagged: async (uid, flagged) => {
          fake.sessionLog.push(`UID STORE ${uid} ${flagged ? '+' : '-'}FLAGS (\\Flagged)`)
          refuse('STORE')
          const found = inbox.find((item) => item.message.uid === uid)
          if (found) found.message.flags = flagged ? [...new Set([...found.message.flags, '\\Flagged'])] : found.message.flags.filter((flag) => flag !== '\\Flagged')
        },
        remove: async (uid) => {
          fake.sessionLog.push(`UID EXPUNGE ${uid}`)
          const index = inbox.findIndex((item) => item.message.uid === uid)
          if (index >= 0) inbox.splice(index, 1)
        },
        appendSent: async () => {
          fake.appended++
          return true
        },
        sentPath: async () => [...folders].find(([, box]) => box.specialUse === '\\Sent')?.[0] ?? null,
        onNew: (listener) => {
          own.add(listener)
          listeners.add(listener)
        },
        onClose: () => undefined,
        close: async () => {
          for (const listener of own) listeners.delete(listener)
        },
      }
      return session
    },
    async pop3() {
      throw Object.assign(new Error('falso: sem POP3'), { code: 'ECONNREFUSED' })
    },
    async smtp(config, mail: OutgoingMail) {
      login(config.pass)
      if (fake.failNextSend) {
        fake.failNextSend = false
        throw new SmtpError('rejected')
      }
      if (fake.smtpHold) await fake.smtpHold()
      fake.sent.push({
        to: mail.to,
        cc: mail.cc ?? [],
        subject: mail.subject,
        text: mail.text,
        inReplyTo: mail.inReplyTo,
        attachments: (mail.attachments ?? []).map((item) => ({ name: item.name, size: item.bytes.byteLength })),
        icalEvent: mail.icalEvent ? { method: mail.icalEvent.method, filename: mail.icalEvent.filename, content: mail.icalEvent.content } : null,
      })
      return Buffer.from(`Subject: ${mail.subject}\r\n\r\n${mail.text}`)
    },
    async smtpVerify(config) {
      if (config.pass === SMOKE_EMAIL_WRONG_PASSWORD) throw new SmtpError('auth')
    },
    async deliver(input) {
      add({ from: input.from, subject: input.subject, text: input.text, minutesAgo: 0, seen: false, ...(input.cc ? { cc: input.cc } : {}), ...(input.attachments ? { attachments: input.attachments } : {}) }, now())
      for (const listener of listeners) listener()
    },
    async fetchImage(url) {
      fake.imageRequests.push(url)
      return url === SMOKE_EMAIL_IMAGE_URL ? { type: 'image/png', bytes: new Uint8Array(PIXEL) } : null
    },
  }
  return fake
}
