// Contrato 54: a assinatura de cada conta de email (R6 da spec email-organizacao). Texto com quebras de linha e links,
// com dois interruptores: "em mensagens novas" (`onNew`) e "em respostas e encaminhamentos" (`onReply`). Ela entra no
// rascunho acima da citação, separada por `-- ` (o separador de assinatura da RFC 3676), e a pessoa pode editar ou apagar
// antes de enviar. Fica no `settings.json`, ao lado das contas (`SettingsStore.getEmailSignatures`); sai com a conta.

/** Caracteres da assinatura. */
export const EMAIL_SIGNATURE_MAX = 2000
/** O separador de assinatura (traço, traço, espaço), numa linha só. */
export const EMAIL_SIGNATURE_SEPARATOR = '-- '

export interface EmailSignature {
  text: string
  /** Entra em "Nova mensagem". */
  onNew: boolean
  /** Entra em "Responder", "Responder a todos" e "Encaminhar". */
  onReply: boolean
}

export const DEFAULT_EMAIL_SIGNATURE: Readonly<EmailSignature> = Object.freeze({ text: '', onNew: true, onReply: true })

/** `missing`: conta inexistente; `invalid`: pedido fora do formato; `storage`: o `settings.json` não pôde ser lido ou gravado. */
export type EmailSignatureResult = { ok: true; signature: EmailSignature } | { ok: false; error: 'missing' | 'invalid' | 'storage' }

export type EmailSignatureKind = 'new' | 'reply' | 'forward'

/** O rascunho: o que a pessoa escreveu (`text`) e a citação ou a original encaminhada (`quote`), que fica embaixo. */
export interface EmailSignatureBody {
  text: string
  quote: string
}

const URL_OR_EMAIL = /(https?:\/\/[^\s<>"']+)|([^\s@<>()[\]\\,;:"'/]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+)/g
const CLOSING: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
const count = (text: string, char: string): number => text.split(char).length - 1

/**
 * Pontuação no fim de um link costuma ser da frase ("veja https://lap.com.br."). O `)`, `]` ou `}` final só sai se
 * estiver sem par no link (`https://pt.wikipedia.org/wiki/Foo_(bar)` fica inteiro; "(veja https://lap.com.br)" perde o `)`).
 */
function trimTrailing(link: string): string {
  let end = link
  for (;;) {
    const last = end.slice(-1)
    const open = CLOSING[last]
    if (last !== '' && '.,;:!?'.includes(last)) end = end.slice(0, -1)
    else if (open !== undefined && count(end, last) > count(end, open)) end = end.slice(0, -1)
    else return end
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const lines = (text: string): string => escapeHtml(text).replace(/\n/g, '<br>')

/** A assinatura em HTML: texto escapado, quebras em `<br>`, `http(s)://` e endereços de email como links. */
function signatureHtml(text: string): string {
  let html = ''
  let last = 0
  for (const match of text.matchAll(URL_OR_EMAIL)) {
    const found = match[0]
    const link = trimTrailing(found)
    const start = match.index
    html += lines(text.slice(last, start))
    const href = match[1] ? link : `mailto:${link}`
    html += `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(link)}</a>`
    last = start + link.length
  }
  html += lines(text.slice(last))
  return `<div class="signature">${html}</div>`
}

const clean = (text: string): string => text.replace(/\r\n?/g, '\n')

/** O bloco `-- \n<assinatura>` já está no texto, inteiro: começando numa linha e terminando no fim de uma linha. */
function hasBlock(text: string, block: string): boolean {
  for (let at = text.indexOf(block); at !== -1; at = text.indexOf(block, at + 1)) {
    const after = text[at + block.length]
    if ((at === 0 || text[at - 1] === '\n') && (after === undefined || after === '\n')) return true
  }
  return false
}

/**
 * O rascunho com a assinatura: no texto, `\n\n-- \n<assinatura>` depois do que a pessoa escreveu e antes da citação; no
 * HTML, o mesmo com a assinatura num `<div class="signature">`. Assinatura vazia, interruptor desligado ou a mesma
 * assinatura já no que a pessoa escreveu: o rascunho como veio. O `html` ainda não é usado: o envio segue só com o
 * texto (contrato 54); a prévia e o editor da assinatura são do contrato 55.
 */
export function withSignature(body: EmailSignatureBody, signature: EmailSignature, kind: EmailSignatureKind): { text: string; html: string } {
  const text = clean(body.text)
  const quote = clean(body.quote)
  const signed = clean(signature.text).replace(/\s+$/, '')
  const enabled = kind === 'new' ? signature.onNew : signature.onReply
  const block = `${EMAIL_SIGNATURE_SEPARATOR}\n${signed}`
  if (!signed.trim() || !enabled || hasBlock(text, block)) return { text: `${text}${quote}`, html: lines(`${text}${quote}`) }
  return { text: `${text}\n\n${block}${quote}`, html: `${lines(`${text}\n\n${EMAIL_SIGNATURE_SEPARATOR}`)}<br>${signatureHtml(signed)}${lines(quote)}` }
}
