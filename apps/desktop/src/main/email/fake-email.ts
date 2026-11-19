// Servidor de email falso do smoke (contrato 43): uma INBOX IMAP em memória com mensagens inventadas (domínios
// `.example`), o SMTP que só registra o que sairia e as imagens remotas do "Carregar imagens". Nada sai da máquina e
// nenhuma senha de verdade é usada: a senha `SMOKE_EMAIL_WRONG_PASSWORD` faz o servidor recusar o login.
import type { EmailAddress } from '../../shared/email'
import type { ImapConnect, ImapMessage, ImapSession } from './imap-client'
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

  const login = (pass: string): void => {
    if (pass === SMOKE_EMAIL_WRONG_PASSWORD) throw Object.assign(new Error('falso: login recusado'), { authenticationFailed: true })
  }

  const fake: FakeEmail = {
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
