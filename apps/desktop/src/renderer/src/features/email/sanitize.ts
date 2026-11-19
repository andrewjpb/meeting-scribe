// Sanitização do HTML de um email (contrato 43, CA2), sem biblioteca e sem DOM: o HTML que chegou é lido marca por marca
// e um HTML novo é escrito só com o que está na lista de permitidos. Nada da entrada passa direto: o texto é escapado,
// cada marca é reescrita com o nome dela e só os atributos de texto e layout básicos (sem `style`, sem cor, sem `on*`).
// `script`, `style`, `iframe`, `form`, `object`, `svg` e afins saem com o conteúdo. Links só `http(s)` e `mailto:`
// (o clique passa pela confirmação da tela). Imagem só `data:image/…` ou, depois de "Carregar imagens", a data URL que
// o main baixou; a remota bloqueada vira o texto alternativo e entra em `blocked`. Testado em
// test/renderer/email-sanitize.test.ts.

/** Saem com tudo o que está dentro. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'head', 'title', 'template', 'noscript',
  'svg', 'math', 'select', 'textarea', 'button', 'canvas', 'audio', 'video', 'xml', 'noembed', 'noframes', 'xmp', 'plaintext',
])
/** Saem sozinhas, sem conteúdo. */
const DROP_VOID = new Set(['meta', 'link', 'base', 'input', 'param', 'source', 'track', 'area', 'keygen'])
const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr'])
/** Permitidas (algumas trocadas por uma equivalente sem estilo). */
const ALLOWED = new Set([
  'a', 'abbr', 'address', 'article', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark',
  'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u',
  'ul', 'wbr',
])
const RENAMED: Record<string, string> = { font: 'span', center: 'div', strike: 's', big: 'span', tt: 'code', blink: 'span', marquee: 'div' }

const NUMBER = /^\d{1,4}%?$/
const ALIGN = /^(left|right|center|justify)$/i
const VALIGN = /^(top|middle|bottom|baseline)$/i
/** Atributos permitidos por marca (e os que valem em todas). */
const ATTRIBUTES: Record<string, Record<string, RegExp | 'url'>> = {
  '*': { title: /^[\s\S]{0,500}$/, dir: /^(ltr|rtl|auto)$/i },
  a: { href: 'url' },
  img: { src: 'url', alt: /^[\s\S]{0,500}$/, width: NUMBER, height: NUMBER },
  table: { width: NUMBER, align: ALIGN, cellpadding: /^\d{1,3}$/, cellspacing: /^\d{1,3}$/ },
  td: { colspan: /^\d{1,3}$/, rowspan: /^\d{1,3}$/, align: ALIGN, valign: VALIGN, width: NUMBER },
  th: { colspan: /^\d{1,3}$/, rowspan: /^\d{1,3}$/, align: ALIGN, valign: VALIGN, width: NUMBER },
  tr: { align: ALIGN, valign: VALIGN },
  col: { span: /^\d{1,3}$/, width: NUMBER },
  colgroup: { span: /^\d{1,3}$/ },
  p: { align: ALIGN },
  div: { align: ALIGN },
  h1: { align: ALIGN },
  h2: { align: ALIGN },
  h3: { align: ALIGN },
  ol: { start: /^\d{1,6}$/, type: /^[1aAiI]$/ },
  blockquote: { cite: 'url' },
}

/**
 * Busca só nas chaves do próprio objeto: um nome vindo do email (`constructor`, `__proto__`, `toString`) nunca cai no
 * protótipo.
 */
function own<T>(table: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')' }

/** Desfaz as entidades numéricas e as poucas nomeadas que importam para conferir um endereço. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,10});?/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : ''
    }
    return own(NAMED, code.toLowerCase()) ?? match
  })
}

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Texto: escapa `<`, `>` e o `&` solto (entidade bem formada fica: o navegador a mostra como texto, nunca como marca). */
const escapeText = (value: string): string => value.replace(/&(?!(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Endereço de link aceito: `http(s)` e `mailto:`; qualquer outro esquema (`javascript:`, `data:`, `vbscript:`) não. */
export function safeLinkUrl(raw: string): string | null {
  const value = [...decodeEntities(raw)].filter((char) => char.charCodeAt(0) > 0x20 && !(char.charCodeAt(0) >= 0x7f && char.charCodeAt(0) <= 0x9f)).join('')
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).href
    } catch {
      return null
    }
  }
  if (/^mailto:/i.test(value)) return value.length <= 2048 ? value : null
  return null
}

/** Imagem embutida aceita: só `data:image/` de tipos de imagem comuns (SVG não). */
const isDataImage = (value: string): boolean => /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(value)

export interface SanitizeOptions {
  /** Depois de "Carregar imagens": endereço remoto → data URL baixada pelo main (ou `null`, que falhou). */
  images?: Readonly<Record<string, string | null>> | undefined
}

export interface SanitizedEmail {
  html: string
  /** Endereços `http(s)` das imagens remotas que ficaram de fora (o botão "Carregar imagens" pede estas). */
  blocked: string[]
}

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[^>]*>?|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** O HTML sanitizado, pronto para `innerHTML`. */
export function sanitizeEmailHtml(input: string, options: SanitizeOptions = {}): SanitizedEmail {
  const out: string[] = []
  const blocked: string[] = []
  const open: string[] = []
  let index = 0
  TOKEN.lastIndex = 0
  for (;;) {
    const match = TOKEN.exec(input)
    if (!match) break
    if (match.index > index) out.push(escapeText(input.slice(index, match.index)))
    index = TOKEN.lastIndex
    const rawName = match[1]
    if (!rawName) continue
    const name = rawName.toLowerCase()
    const closing = match[0].startsWith('</')
    if (!closing && DROP_WITH_CONTENT.has(name)) {
      // Pula até o fechamento da mesma marca (ou até o fim, se não fechar).
      const close = input.toLowerCase().indexOf(`</${name}`, index)
      if (close < 0) {
        index = input.length
        break
      }
      const end = input.indexOf('>', close)
      index = end < 0 ? input.length : end + 1
      TOKEN.lastIndex = index
      continue
    }
    if (DROP_VOID.has(name) || DROP_WITH_CONTENT.has(name)) continue
    const tag = own(RENAMED, name) ?? name
    if (!ALLOWED.has(tag)) continue
    if (closing) {
      const at = open.lastIndexOf(tag)
      if (at < 0) continue
      // Fecha também as que ficaram abertas dentro dela (HTML de email nem sempre fecha tudo).
      for (const inner of open.splice(at).reverse()) out.push(`</${inner}>`)
      continue
    }
    const attributes = cleanAttributes(tag, match[2] ?? '', options, blocked)
    if (tag === 'img' && !attributes.some(([attribute]) => attribute === 'src')) {
      // Imagem remota bloqueada (ou sem endereço aceito): fica o texto alternativo no lugar.
      const alt = attributes.find(([attribute]) => attribute === 'alt')?.[1] ?? ''
      out.push(`<span data-email-image-blocked>${escapeText(alt.replace(/&/g, '&amp;') || 'Imagem')}</span>`)
      continue
    }
    out.push(`<${tag}${attributes.map(([attribute, value]) => ` ${attribute}="${escapeAttribute(value)}"`).join('')}>`)
    if (!VOID.has(tag)) open.push(tag)
  }
  if (index < input.length) out.push(escapeText(input.slice(index)))
  for (const inner of open.reverse()) out.push(`</${inner}>`)
  return { html: out.join(''), blocked: [...new Set(blocked)] }
}

/** Os atributos permitidos, com o valor já conferido (ainda sem escapar). */
function cleanAttributes(tag: string, raw: string, options: SanitizeOptions, blocked: string[]): [string, string][] {
  const global = own(ATTRIBUTES, '*')
  const forTag = own(ATTRIBUTES, tag)
  const kept: [string, string][] = []
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? '').toLowerCase()
    const rule = own(forTag, name) ?? own(global, name)
    if (!rule) continue
    const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '').trim()
    if (rule === 'url') {
      if (tag === 'img') {
        const loaded = own(options.images, value)
        if (isDataImage(value)) kept.push(['src', value])
        else if (/^https?:\/\//i.test(value)) {
          if (loaded) kept.push(['src', loaded])
          else blocked.push(value)
        }
        continue
      }
      const url = safeLinkUrl(value)
      if (url) kept.push([name, url])
      continue
    }
    if (rule.test(value)) kept.push([name, value])
  }
  if (tag === 'a' && kept.some(([name]) => name === 'href')) kept.push(['data-email-link', ''])
  return kept
}

/** O HTML como texto (para a prévia, a citação e o "Encaminhar"): sem marcas, blocos em linhas, entidades desfeitas. */
export function htmlToText(input: string): string {
  const withoutDropped = input.replace(/<(script|style|head|title|template|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  const text = withoutDropped
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table|section|article)\s*>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(text.replace(/&(aacute|eacute|iacute|oacute|uacute|atilde|otilde|ccedil|acirc|ecirc|ocirc|agrave);/gi, (match) => own(ENTITY_LETTERS, match.toLowerCase()) ?? match))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const ENTITY_LETTERS: Record<string, string> = {
  '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú', '&atilde;': 'ã', '&otilde;': 'õ', '&ccedil;': 'ç',
  '&acirc;': 'â', '&ecirc;': 'ê', '&ocirc;': 'ô', '&agrave;': 'à',
}

/** Um pedaço do texto puro: texto, ou um link `https?://` que vira clicável. */
export type TextPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; url: string }

/** Texto puro com os links `http(s)` à parte (a pontuação do fim da frase fica fora do link). */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let url = match[0]
    const unbalanced = (value: string): boolean => (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)
    while (/[.,;:!?\]}]$/.test(url) || (url.endsWith(')') && unbalanced(url))) url = url.slice(0, -1)
    const start = match.index
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) })
    const safe = safeLinkUrl(url)
    parts.push(safe ? { kind: 'link', text: url, url: safe } : { kind: 'text', text: url })
    last = start + url.length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
