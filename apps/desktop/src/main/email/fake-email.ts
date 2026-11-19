// Servidor de email falso do smoke (contrato 43): uma INBOX IMAP em memória com mensagens inventadas (domínios
// `.example`), o SMTP que só registra o que sairia e as imagens remotas do "Carregar imagens". Nada sai da máquina e
// nenhuma senha de verdade é usada: a senha `SMOKE_EMAIL_WRONG_PASSWORD` faz o servidor recusar o login.
import type { EmailAddress } from '../../shared/email'
import type { ImapConnect, ImapMessage, ImapReaderConnect, ImapSession } from './imap-client'
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

export interface FakeEmail {
  imap: ImapConnect
  /** Contrato 45 (CA7): a conexão só de leitura da busca do Assistente (INBOX, "Enviados" e "Arquivo"). */
  imapReader: ImapReaderConnect
  /** As buscas e as leituras dessa conexão (o smoke confere que houve e que nada mudou de flag). */
  reader: { searches: number; peeks: number }
  pop3: Pop3Connect
  smtp: SmtpSend
  smtpVerify: SmtpVerify
  /** O que o SMTP falso recebeu (sem anexo em bytes: só nome e tamanho). */
  sent: { to: string[]; cc: string[]; subject: string; text: string; inReplyTo: string | null; attachments: { name: string; size: number }[] }[]
  /** `APPEND` na pasta de enviados. */
  appended: number
  /** O SMTP recusa o próximo envio (o composer mantém o rascunho com o aviso). */
  failNextSend: boolean
  /** Um email novo na INBOX, avisado pelo "IDLE". */
  deliver(input: { from: EmailAddress; subject: string; text: string }): Promise<void>
  /** Imagens remotas pedidas pelo "Carregar imagens". */
  imageRequests: string[]
  fetchImage(url: string): Promise<{ type: string; bytes: Uint8Array } | null>
}

export function createFakeEmail(now: () => number = Date.now): FakeEmail {
  let nextUid = 1
  const inbox: { message: ImapMessage; raw: Buffer }[] = []
  const listeners = new Set<() => void>()
  const add = (seed: Seed, at: number): void => {
    const uid = nextUid++
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
  const boxes = (): Record<string, { message: ImapMessage; raw: Buffer }[]> => ({ INBOX: inbox, Enviados: [], [SMOKE_EMAIL_ARCHIVE_FOLDER]: archived })
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
    reader: { searches: 0, peeks: 0 },
    async imapReader(config) {
      login(config.pass)
      return {
        folders: async () => [
          { path: 'INBOX', name: 'INBOX', specialUse: null },
          { path: 'Enviados', name: 'Enviados', specialUse: '\\Sent' },
          { path: SMOKE_EMAIL_ARCHIVE_FOLDER, name: SMOKE_EMAIL_ARCHIVE_FOLDER, specialUse: '\\Archive' },
        ],
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
        close: async () => undefined,
      }
    },
    sent: [],
    appended: 0,
    failNextSend: false,
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
          const found = inbox.find((item) => item.message.uid === uid)
          if (found) found.message.flags = seen ? [...new Set([...found.message.flags, '\\Seen'])] : found.message.flags.filter((flag) => flag !== '\\Seen')
        },
        remove: async (uid) => {
          const index = inbox.findIndex((item) => item.message.uid === uid)
          if (index >= 0) inbox.splice(index, 1)
        },
        appendSent: async () => {
          fake.appended++
          return true
        },
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
      fake.sent.push({ to: mail.to, cc: mail.cc ?? [], subject: mail.subject, text: mail.text, inReplyTo: mail.inReplyTo, attachments: (mail.attachments ?? []).map((item) => ({ name: item.name, size: item.bytes.byteLength })) })
      return Buffer.from(`Subject: ${mail.subject}\r\n\r\n${mail.text}`)
    },
    async smtpVerify(config) {
      if (config.pass === SMOKE_EMAIL_WRONG_PASSWORD) throw new SmtpError('auth')
    },
    async deliver(input) {
      add({ from: input.from, subject: input.subject, text: input.text, minutesAgo: 0, seen: false }, now())
      for (const listener of listeners) listener()
    },
    async fetchImage(url) {
      fake.imageRequests.push(url)
      return url === SMOKE_EMAIL_IMAGE_URL ? { type: 'image/png', bytes: new Uint8Array(PIXEL) } : null
    },
  }
  return fake
}
