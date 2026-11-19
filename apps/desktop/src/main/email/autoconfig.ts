// Descobrir os servidores de uma conta pelo endereço (contrato 42, R1 da PRD): primeiro a lista embutida dos
// provedores mais comuns (sem rede); depois a base aberta do Thunderbird (ISPDB,
// `https://autoconfig.thunderbird.net/v1.1/<domínio>`), com no máximo 5 s; senão `null`, e a tela cai no manual.
// Só o domínio vai à rede, nunca o endereço inteiro. O `fetch` chega injetado (nos testes, um HTTP falso).
import { EMAIL_ADDRESS_PATTERN, EMAIL_HOST_PATTERN, type EmailAutoconfig, type EmailIncomingServer, type EmailProtocol, type EmailSecurity, type EmailServer } from '../../shared/email'

export const ISPDB_URL = 'https://autoconfig.thunderbird.net/v1.1/'
export const AUTOCONFIG_TIMEOUT_MS = 5_000

export type AutoconfigFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>

interface Preset {
  incoming: EmailIncomingServer
  outgoing: EmailServer
}

const imap = (host: string): EmailIncomingServer => ({ protocol: 'imap', host, port: 993, security: 'tls' })
const smtp = (host: string, port: 465 | 587): EmailServer => ({ host, port, security: port === 465 ? 'tls' : 'starttls' })

const GMAIL: Preset = { incoming: imap('imap.gmail.com'), outgoing: smtp('smtp.gmail.com', 465) }
const OUTLOOK: Preset = { incoming: imap('outlook.office365.com'), outgoing: smtp('smtp.office365.com', 587) }
const YAHOO: Preset = { incoming: imap('imap.mail.yahoo.com'), outgoing: smtp('smtp.mail.yahoo.com', 465) }
const ICLOUD: Preset = { incoming: imap('imap.mail.me.com'), outgoing: smtp('smtp.mail.me.com', 587) }
const UOL: Preset = { incoming: imap('imap.uol.com.br'), outgoing: smtp('smtps.uol.com.br', 587) }
const BOL: Preset = { incoming: imap('imap.bol.com.br'), outgoing: smtp('smtps.bol.com.br', 587) }
const TERRA: Preset = { incoming: imap('imap.terra.com.br'), outgoing: smtp('smtp.terra.com.br', 587) }

/** Presets embutidos, por domínio. O usuário é sempre o endereço inteiro. */
export const EMAIL_PRESETS: Readonly<Record<string, Preset>> = Object.freeze({
  'gmail.com': GMAIL,
  'googlemail.com': GMAIL,
  'outlook.com': OUTLOOK,
  'outlook.com.br': OUTLOOK,
  'hotmail.com': OUTLOOK,
  'hotmail.com.br': OUTLOOK,
  'live.com': OUTLOOK,
  'msn.com': OUTLOOK,
  'yahoo.com': YAHOO,
  'yahoo.com.br': YAHOO,
  'ymail.com': YAHOO,
  'icloud.com': ICLOUD,
  'me.com': ICLOUD,
  'mac.com': ICLOUD,
  'uol.com.br': UOL,
  'bol.com.br': BOL,
  'terra.com.br': TERRA,
})

/** Domínio do endereço, em minúsculas; `null` se o endereço não passar no formato. */
export function addressDomain(address: string): string | null {
  if (!EMAIL_ADDRESS_PATTERN.test(address)) return null
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase()
}

export function presetFor(address: string): EmailAutoconfig | null {
  const domain = addressDomain(address)
  const preset = domain ? EMAIL_PRESETS[domain] : undefined
  if (!preset) return null
  return { source: 'preset', username: address, incoming: { ...preset.incoming }, outgoing: { ...preset.outgoing } }
}

const SOCKET_TYPES: Readonly<Record<string, EmailSecurity>> = { SSL: 'tls', STARTTLS: 'starttls', plain: 'none' }

const decodeXml = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

/** Valor de `<tag>…</tag>` dentro de um bloco do XML. */
const tagValue = (block: string, tag: string): string | null => {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block)
  return match?.[1] !== undefined ? decodeXml(match[1]) : null
}

/** Os `%EMAILADDRESS%`, `%EMAILLOCALPART%` e `%EMAILDOMAIN%` do ISPDB. */
const fill = (value: string, address: string): string => {
  const at = address.lastIndexOf('@')
  return value
    .replace(/%EMAILADDRESS%/g, address)
    .replace(/%EMAILLOCALPART%/g, address.slice(0, at))
    .replace(/%EMAILDOMAIN%/g, address.slice(at + 1).toLowerCase())
}

interface ParsedServer extends EmailServer {
  username: string | null
}

function parseServer(block: string, address: string): ParsedServer | null {
  const host = tagValue(block, 'hostname')
  const port = Number(tagValue(block, 'port'))
  const security = SOCKET_TYPES[tagValue(block, 'socketType') ?? '']
  if (!host || !security || !Number.isInteger(port) || port < 1 || port > 65_535) return null
  const filledHost = fill(host, address).toLowerCase()
  if (!EMAIL_HOST_PATTERN.test(filledHost)) return null
  const username = tagValue(block, 'username')
  return { host: filledHost, port, security, username: username ? fill(username, address) : null }
}

/** Blocos `<incomingServer type="…">` ou `<outgoingServer type="…">`, na ordem do XML. */
function serverBlocks(xml: string, kind: 'incomingServer' | 'outgoingServer'): { type: string; body: string }[] {
  const blocks: { type: string; body: string }[] = []
  const pattern = new RegExp(`<${kind}\\s+type="([a-z0-9]+)"\\s*>([\\s\\S]*?)</${kind}>`, 'g')
  for (const match of xml.matchAll(pattern)) blocks.push({ type: match[1] ?? '', body: match[2] ?? '' })
  return blocks
}

/** Lê o XML do ISPDB: o primeiro servidor IMAP (senão o POP3) e o primeiro SMTP que façam sentido. */
export function parseIspdb(xml: string, address: string): EmailAutoconfig | null {
  const incoming = serverBlocks(xml, 'incomingServer')
  let chosen: { protocol: EmailProtocol; server: ParsedServer } | null = null
  for (const protocol of ['imap', 'pop3'] as const) {
    for (const block of incoming.filter((item) => item.type === protocol)) {
      const server = parseServer(block.body, address)
      if (server) {
        chosen = { protocol, server }
        break
      }
    }
    if (chosen) break
  }
  const outgoing = serverBlocks(xml, 'outgoingServer')
    .filter((item) => item.type === 'smtp')
    .map((item) => parseServer(item.body, address))
    .find((server): server is ParsedServer => server !== null)
  if (!chosen || !outgoing) return null
  const { server } = chosen
  return {
    source: 'ispdb',
    username: server.username ?? address,
    incoming: { protocol: chosen.protocol, host: server.host, port: server.port, security: server.security },
    outgoing: { host: outgoing.host, port: outgoing.port, security: outgoing.security },
  }
}

export interface AutoconfigOptions {
  fetch: AutoconfigFetch
  timeoutMs?: number
}

/** Preset → ISPDB → `null`. Qualquer falha da rede (fora do ar, 404, XML estranho, tempo esgotado) é `null`. */
export async function autoconfigure(address: string, { fetch, timeoutMs = AUTOCONFIG_TIMEOUT_MS }: AutoconfigOptions): Promise<EmailAutoconfig | null> {
  const preset = presetFor(address)
  if (preset) return preset
  const domain = addressDomain(address)
  if (!domain) return null
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, timeoutMs)
  })
  const lookup = (async (): Promise<EmailAutoconfig | null> => {
    const response = await fetch(`${ISPDB_URL}${encodeURIComponent(domain)}`, { signal: controller.signal })
    if (response.status !== 200) return null
    const xml = await response.text()
    return xml.length > 256 * 1024 ? null : parseIspdb(xml, address)
  })().catch(() => null)
  try {
    return await Promise.race([lookup, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
