// Contrato 42, CA2: descobrir os servidores pelo endereço. Presets embutidos sem rede, o XML do ISPDB do Thunderbird
// por um HTTP falso (nenhum pedido sai da máquina) e o ISPDB fora do ar voltando `null` em até 5 s.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { autoconfigure, AUTOCONFIG_TIMEOUT_MS, ISPDB_URL, parseIspdb, presetFor, type AutoconfigFetch } from '../src/main/email/autoconfig'

const ISPDB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="exemplo.com.br">
    <domain>exemplo.com.br</domain>
    <incomingServer type="pop3">
      <hostname>pop.exemplo.com.br</hostname>
      <port>995</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.%EMAILDOMAIN%</hostname>
      <port>143</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILLOCALPART%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.exemplo.com.br</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILLOCALPART%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`

/** HTTP falso: registra a URL e responde o que o teste mandar. */
function fakeFetch(reply: (url: string, signal: AbortSignal) => Promise<{ status: number; text(): Promise<string> }>): AutoconfigFetch & { urls: string[] } {
  const urls: string[] = []
  const fetch = ((url: string, init: { signal: AbortSignal }) => {
    urls.push(url)
    return reply(url, init.signal)
  }) as AutoconfigFetch & { urls: string[] }
  fetch.urls = urls
  return fetch
}

afterEach(() => {
  vi.useRealTimers()
})

describe('autoconfig (contrato 42, CA2)', () => {
  it.each([
    ['fulano@gmail.com', 'imap.gmail.com', 993, 'tls', 'smtp.gmail.com', 465, 'tls'],
    ['fulano@googlemail.com', 'imap.gmail.com', 993, 'tls', 'smtp.gmail.com', 465, 'tls'],
    ['fulano@outlook.com', 'outlook.office365.com', 993, 'tls', 'smtp.office365.com', 587, 'starttls'],
    ['fulano@hotmail.com', 'outlook.office365.com', 993, 'tls', 'smtp.office365.com', 587, 'starttls'],
    ['fulano@live.com', 'outlook.office365.com', 993, 'tls', 'smtp.office365.com', 587, 'starttls'],
    ['fulano@yahoo.com.br', 'imap.mail.yahoo.com', 993, 'tls', 'smtp.mail.yahoo.com', 465, 'tls'],
    ['fulano@icloud.com', 'imap.mail.me.com', 993, 'tls', 'smtp.mail.me.com', 587, 'starttls'],
    ['fulano@uol.com.br', 'imap.uol.com.br', 993, 'tls', 'smtps.uol.com.br', 587, 'starttls'],
    ['fulano@terra.com.br', 'imap.terra.com.br', 993, 'tls', 'smtp.terra.com.br', 587, 'starttls'],
  ])('%s: preset embutido, sem rede', async (address, inHost, inPort, inSecurity, outHost, outPort, outSecurity) => {
    const fetch = fakeFetch(() => Promise.reject(new Error('não devia ir à rede')))
    expect(await autoconfigure(address, { fetch })).toEqual({
      source: 'preset',
      username: address,
      incoming: { protocol: 'imap', host: inHost, port: inPort, security: inSecurity },
      outgoing: { host: outHost, port: outPort, security: outSecurity },
    })
    expect(fetch.urls).toEqual([])
  })

  it('domínio em maiúsculas também acha o preset', () => {
    expect(presetFor('Fulano@GMAIL.com')?.incoming.host).toBe('imap.gmail.com')
  })

  it('fora dos presets: o XML do ISPDB, com host, porta, socketType e usuário mapeados; só o domínio vai à rede', async () => {
    const fetch = fakeFetch(() => Promise.resolve({ status: 200, text: () => Promise.resolve(ISPDB_XML) }))
    expect(await autoconfigure('fulano@exemplo.com.br', { fetch })).toEqual({
      source: 'ispdb',
      username: 'fulano',
      incoming: { protocol: 'imap', host: 'imap.exemplo.com.br', port: 143, security: 'starttls' },
      outgoing: { host: 'smtp.exemplo.com.br', port: 587, security: 'starttls' },
    })
    expect(fetch.urls).toEqual([`${ISPDB_URL}exemplo.com.br`])
    expect(fetch.urls[0]).not.toContain('fulano')
  })

  it('ISPDB só com POP3: usa o POP3; SSL vira tls e plain vira none', () => {
    const xml = `<clientConfig><emailProvider>
      <incomingServer type="pop3"><hostname>pop.so-pop.com</hostname><port>995</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
      <outgoingServer type="smtp"><hostname>smtp.so-pop.com</hostname><port>25</port><socketType>plain</socketType></outgoingServer>
    </emailProvider></clientConfig>`
    expect(parseIspdb(xml, 'ana@so-pop.com')).toEqual({
      source: 'ispdb',
      username: 'ana@so-pop.com',
      incoming: { protocol: 'pop3', host: 'pop.so-pop.com', port: 995, security: 'tls' },
      outgoing: { host: 'smtp.so-pop.com', port: 25, security: 'none' },
    })
  })

  it('XML sem servidor de saída, com porta inválida ou socketType desconhecido: null', () => {
    expect(parseIspdb('<clientConfig/>', 'a@b.com')).toBeNull()
    expect(parseIspdb(ISPDB_XML.replace(/<outgoingServer[\s\S]*<\/outgoingServer>/, ''), 'a@exemplo.com.br')).toBeNull()
    const badPorts = ISPDB_XML.replace(/<port>\d+<\/port>/g, '<port>0</port>')
    expect(parseIspdb(badPorts, 'a@exemplo.com.br')).toBeNull()
    const badSocket = ISPDB_XML.replace(/<socketType>[^<]+<\/socketType>/g, '<socketType>TLS1.3</socketType>')
    expect(parseIspdb(badSocket, 'a@exemplo.com.br')).toBeNull()
  })

  it('ISPDB fora do ar (nunca responde): null em até 5 s, e o pedido é cancelado', async () => {
    vi.useFakeTimers()
    let aborted = false
    const fetch = fakeFetch(
      (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('abortado'))
          })
        }),
    )
    let result: unknown = 'pendente'
    void autoconfigure('fulano@sem-ispdb.com.br', { fetch }).then((value) => (result = value))
    await vi.advanceTimersByTimeAsync(AUTOCONFIG_TIMEOUT_MS - 1)
    expect(result).toBe('pendente')
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBeNull()
    expect(aborted).toBe(true)
    expect(AUTOCONFIG_TIMEOUT_MS).toBeLessThanOrEqual(5_000)
  })

  it('ISPDB recusando a conexão, 404 ou XML estranho: null na hora', async () => {
    expect(await autoconfigure('a@x-offline.com', { fetch: fakeFetch(() => Promise.reject(new TypeError('fetch failed'))) })).toBeNull()
    expect(await autoconfigure('a@x-404.com', { fetch: fakeFetch(() => Promise.resolve({ status: 404, text: () => Promise.resolve('Not found') })) })).toBeNull()
    expect(await autoconfigure('a@x-html.com', { fetch: fakeFetch(() => Promise.resolve({ status: 200, text: () => Promise.resolve('<html>oi</html>') })) })).toBeNull()
  })

  it('endereço fora do formato não vai à rede', async () => {
    const fetch = fakeFetch(() => Promise.reject(new Error('não devia ir à rede')))
    expect(await autoconfigure('sem-arroba', { fetch })).toBeNull()
    expect(await autoconfigure('a@../../etc', { fetch })).toBeNull()
    expect(fetch.urls).toEqual([])
  })
})
