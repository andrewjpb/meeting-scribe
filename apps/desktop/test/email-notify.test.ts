// Notificações de email (contrato 43, CA4), no desenho das do WhatsApp (contrato 40): título = remetente, corpo = assunto
// (até 140); nunca o email da própria conta; nada com a opção desligada nem com a Caixa de Entrada da conta à vista;
// bloqueado, sem o assunto; rajada de 3 ou mais do mesmo remetente em 5 s vira uma só. Mais as imagens remotas do
// "Carregar imagens" e o nome dos anexos do composer.
import { describe, expect, it } from 'vitest'
import { attachmentName } from '../src/main/email/attach'
import { BURST_WINDOW_MS, createEmailNotifier, emailNoticeBody, NOTICE_BODY_MAX, senderName, shouldNotifyEmail, type EmailNotice, type IncomingEmail } from '../src/main/email/notify'
import { isPrivateAddress, isRemoteImageUrl, loadRemoteImages, readLimited, resolvesPublic } from '../src/main/email/remote-images'
import type { EmailMessage } from '../src/shared/email'

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

const ACCOUNT = { id: '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f', address: 'andrew@lap.example' }

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  id: '1',
  accountId: ACCOUNT.id,
  mailbox: 'INBOX',
  uid: 1,
  seen: false,
  flagged: false,
  answered: false,
  from: [{ name: 'Marina Rocha', address: 'marina@cliente.example' }],
  to: [{ name: null, address: ACCOUNT.address }],
  cc: [],
  subject: 'Proposta revisada',
  date: 0,
  messageId: null,
  inReplyTo: null,
  references: [],
  ...over,
})

const input = (over: Partial<IncomingEmail> = {}): IncomingEmail => ({ message: message(), account: ACCOUNT, enabled: true, viewing: false, locked: false, ...over })

function setup() {
  let now = 1_000_000
  const shown: (EmailNotice & { closed: boolean })[] = []
  const notifier = createEmailNotifier({
    show: (notice) => {
      const entry = { ...notice, closed: false }
      shown.push(entry)
      return { close: () => void (entry.closed = true) }
    },
    appName: () => 'LAP Reuniões',
    now: () => now,
  })
  return { notifier, shown, advance: (ms: number) => void (now += ms), open: () => shown.filter((item) => !item.closed) }
}

describe('quando notificar', () => {
  it('email novo: título o remetente, corpo o assunto', () => {
    const { notifier } = setup()
    expect(notifier.receive(input())).toEqual({ accountId: ACCOUNT.id, id: '1', title: 'Marina Rocha', body: 'Proposta revisada', count: 1 })
  })

  it('nunca o email da própria conta; nada desligado; nada em Enviados', () => {
    const { notifier, shown } = setup()
    expect(notifier.receive(input({ message: message({ from: [{ name: 'Eu', address: 'ANDREW@lap.example' }] }) }))).toBeNull()
    expect(notifier.receive(input({ enabled: false }))).toBeNull()
    expect(notifier.receive(input({ enabled: false, locked: true }))).toBeNull()
    expect(notifier.receive(input({ message: message({ mailbox: 'Sent' }) }))).toBeNull()
    expect(shown).toHaveLength(0)
  })

  it('a Caixa de Entrada da conta aberta na janela em foco não notifica; bloqueado notifica sem o assunto', () => {
    const { notifier } = setup()
    expect(shouldNotifyEmail(input({ viewing: true }))).toBe(false)
    expect(notifier.receive(input({ viewing: true }))).toBeNull()
    expect(notifier.receive(input({ viewing: true, locked: true }))).toEqual({ accountId: ACCOUNT.id, id: '1', title: 'LAP Reuniões', body: 'Email de Marina Rocha', count: 1 })
  })

  it('assunto até 140, vazio vira "(sem assunto)"; sem nome, o endereço', () => {
    expect(emailNoticeBody(message({ subject: 'a'.repeat(300) }))).toHaveLength(NOTICE_BODY_MAX)
    expect(emailNoticeBody(message({ subject: '  ' }))).toBe('(sem assunto)')
    expect(senderName(message({ from: [{ name: null, address: 'avisos@x.example' }] }))).toBe('avisos@x.example')
    expect(senderName(message({ from: [] }))).toBe('Remetente desconhecido')
  })
})

describe('rajadas', () => {
  it('3 do mesmo remetente em 5 s viram "3 emails de Fulano"; as anteriores saem', () => {
    const { notifier, open, advance } = setup()
    notifier.receive(input({ message: message({ id: '1' }) }))
    advance(1000)
    notifier.receive(input({ message: message({ id: '2' }) }))
    advance(1000)
    expect(notifier.receive(input({ message: message({ id: '3' }) }))).toMatchObject({ id: '3', title: 'Marina Rocha', body: '3 emails de Marina Rocha', count: 3 })
    expect(open()).toHaveLength(1)
    expect(notifier.receive(input({ message: message({ id: '4' }) }))?.body).toBe('4 emails de Marina Rocha')
    expect(open()).toHaveLength(1)
  })

  it('outro remetente e depois da janela de 5 s contam à parte; bloqueado a rajada só diz quantos', () => {
    const { notifier, advance } = setup()
    notifier.receive(input())
    notifier.receive(input({ message: message({ id: '2', from: [{ name: 'Paulo', address: 'paulo@x.example' }] }) }))
    advance(BURST_WINDOW_MS + 1)
    expect(notifier.receive(input({ message: message({ id: '3' }) }))?.count).toBe(1)
    notifier.receive(input({ message: message({ id: '4' }) }))
    expect(notifier.receive(input({ message: message({ id: '5' }), locked: true }))).toMatchObject({ title: 'LAP Reuniões', body: '3 emails de Marina Rocha' })
  })
})

describe('imagens remotas e anexos', () => {
  it('só http(s) com nome de servidor público, já normalizado (o ponto final não engana)', () => {
    expect(isRemoteImageUrl('https://cdn.cliente.example/a.png')).toBe(true)
    expect(isRemoteImageUrl('http://cdn.cliente.example/a.png')).toBe(true)
    const refused = [
      'file:///etc/passwd',
      'https://localhost/a.png',
      'https://localhost./a.png',
      'https://LOCALHOST../a.png',
      'http://127.0.0.1/a',
      'http://[::1]/a',
      'http://10.0.0.5/a',
      'https://impressora.local/a',
      'https://foo.local./a',
      'http://metadata.google.internal./a',
      'http://roteador.lan/a',
      'http://nas.home/a',
      'http://x.localhost/a',
      'https://user:pw@x.example/a',
      'https://intranet/a',
      'javascript:alert(1)',
    ]
    for (const url of refused) expect(`${url}: ${isRemoteImageUrl(url)}`).toBe(`${url}: false`)
  })

  it('o nome é resolvido antes: qualquer endereço privado, loopback, link-local, CGNAT, ULA ou IPv4 em IPv6 recusa', async () => {
    const answers: Record<string, string[]> = {
      'cdn.cliente.example': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
      '127.0.0.1.nip.io': ['127.0.0.1'],
      'misto.example': ['93.184.216.34', '10.1.2.3'],
      'cgnat.example': ['100.64.0.9'],
      'link.example': ['169.254.169.254'],
      'ula.example': ['fd12:3456::1'],
      'v6link.example': ['fe80::1'],
      'mapeado.example': ['::ffff:192.168.0.1'],
      'vazio.example': [],
    }
    const lookup = async (host: string) => (answers[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
    expect(await resolvesPublic('cdn.cliente.example.', lookup)).toBe(true)
    for (const host of ['127.0.0.1.nip.io', 'misto.example', 'cgnat.example', 'link.example', 'ula.example', 'v6link.example', 'mapeado.example', 'vazio.example']) {
      expect(`${host}: ${await resolvesPublic(host, lookup)}`).toBe(`${host}: false`)
    }
    for (const address of ['0.1.2.3', '172.20.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '::', '::1', '64:ff9b::1.2.3.4']) expect(`${address}: ${isPrivateAddress(address)}`).toBe(`${address}: true`)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    const asked: string[] = []
    const image = async (url: string) => {
      asked.push(url)
      return { type: 'image/png', bytes: new Uint8Array([1]) }
    }
    const result = await loadRemoteImages({ urls: ['https://127.0.0.1.nip.io/a.png', 'https://cdn.cliente.example/a.png'] }, image, lookup)
    expect(asked).toEqual(['https://cdn.cliente.example/a.png'])
    expect(result['https://127.0.0.1.nip.io/a.png']).toBeNull()
  })

  it('a resposta é lida aos pedaços e cortada ao passar do limite', async () => {
    const stream = (sizes: number[]) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const size of sizes) controller.enqueue(new Uint8Array(size))
          controller.close()
        },
      })
    expect((await readLimited(stream([3, 4]), 10))?.byteLength).toBe(7)
    expect(await readLimited(stream([6, 6]), 10)).toBeNull()
    expect(await readLimited(null)).toBeNull()
  })

  it('devolve data URL só de imagem dentro do limite; o resto volta null; endereço recusado nem é pedido', async () => {
    const asked: string[] = []
    const result = await loadRemoteImages({ urls: ['https://a.example/ok.png', 'https://a.example/page', 'https://a.example/big.png', 'https://a.example/fail.png', 'http://127.0.0.1/x.png'] }, async (url) => {
      asked.push(url)
      if (url.endsWith('ok.png')) return { type: 'image/png', bytes: new Uint8Array([1, 2]) }
      if (url.endsWith('page')) return { type: 'text/html', bytes: new Uint8Array([1]) }
      if (url.endsWith('big.png')) return { type: 'image/png', bytes: new Uint8Array(6 * 1024 * 1024) }
      throw new Error('fora')
    }, publicLookup)
    expect(result).toEqual({ 'https://a.example/ok.png': 'data:image/png;base64,AQI=', 'https://a.example/page': null, 'https://a.example/big.png': null, 'https://a.example/fail.png': null })
    expect(asked).not.toContain('http://127.0.0.1/x.png')
    expect(await loadRemoteImages({ urls: 'x' }, async () => null, publicLookup)).toEqual({})
  })

  it('o nome do anexo é o do arquivo, sem caractere de controle e no limite, com a extensão', () => {
    expect(attachmentName('/Users/a/Documentos/Proposta final.pdf')).toBe('Proposta final.pdf')
    expect(attachmentName('/tmp/a\u0007b.txt')).toBe('ab.txt')
    const long = attachmentName(`/tmp/${'x'.repeat(400)}.xlsx`)
    expect(long).toHaveLength(200)
    expect(long.endsWith('.xlsx')).toBe(true)
  })
})
