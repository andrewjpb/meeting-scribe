// Markdown simples das respostas do chat (contrato 15, CA4): parágrafos, listas, negrito, itálico, código e
// links. Vira uma árvore de dados que o componente desenha com elementos do React: nenhum HTML do texto chega
// ao DOM. Título vira parágrafo em negrito; citação, parágrafo comum; tabela e imagem ficam como texto.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'code'; text: string }

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const NUMBERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const FENCE = /^\s{0,3}(```|~~~)/
const QUOTE = /^\s{0,3}>\s?(.*)$/

/**
 * Até onde se procura o fecho de uma marca (`]`, `)`, `` ` ``, `**`, `*`). Sem limite, um texto com milhares
 * de `[` sem fecho faria cada um varrer o resto do texto; com ele, o parser fica linear.
 */
const SEARCH_WINDOW = 500

/** `indexOf` só dentro da janela; -1 fora dela. */
function findWithin(text: string, token: string, from: number): number {
  const at = text.slice(from, from + SEARCH_WINDOW + token.length).indexOf(token)
  return at === -1 ? -1 : from + at
}

/** Caracteres que a barra invertida transforma em texto. */
const ESCAPABLE = new Set([...'\\`*_{}[]()#+-.!>|~'])

function pushText(out: Inline[], text: string): void {
  if (!text) return
  const last = out.at(-1)
  if (last?.type === 'text') last.text += text
  else out.push({ type: 'text', text })
}

/** Fecho de `[texto]`, respeitando colchetes dentro dele. */
function closingBracket(text: string, from: number): number {
  let depth = 0
  const limit = Math.min(text.length, from + SEARCH_WINDOW)
  for (let i = from; i < limit; i++) {
    const char = text[i]
    if (char === '\\') i++
    else if (char === '[') depth++
    else if (char === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Texto de uma linha (ou de um parágrafo) em pedaços: negrito, itálico, código e links. */
export function parseInline(text: string, allowLinks = true): Inline[] {
  const out: Inline[] = []
  let i = 0
  while (i < text.length) {
    const char = text[i] as string
    const next = text[i + 1]
    if (char === '\\' && next !== undefined && ESCAPABLE.has(next)) {
      pushText(out, next)
      i += 2
      continue
    }
    if (char === '`') {
      const end = findWithin(text, '`', i + 1)
      if (end > i + 1) {
        out.push({ type: 'code', text: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (char === '*' && next === '*') {
      const end = findWithin(text, '**', i + 2)
      if (end > i + 2) {
        out.push({ type: 'strong', children: parseInline(text.slice(i + 2, end), allowLinks) })
        i = end + 2
        continue
      }
    }
    if (char === '*' && next !== undefined && next !== '*' && !/\s/.test(next)) {
      const end = findWithin(text, '*', i + 1)
      if (end > i + 1 && !/\s/.test(text[end - 1] as string) && text[end + 1] !== '*') {
        out.push({ type: 'em', children: parseInline(text.slice(i + 1, end), allowLinks) })
        i = end + 1
        continue
      }
    }
    if (char === '[' && allowLinks) {
      const close = closingBracket(text, i)
      if (close !== -1 && text[close + 1] === '(') {
        const end = findWithin(text, ')', close + 2)
        const href = end === -1 ? '' : text.slice(close + 2, end).trim()
        if (href && !/\s/.test(href)) {
          out.push({ type: 'link', href, children: parseInline(text.slice(i + 1, close), false) })
          i = end + 1
          continue
        }
      }
    }
    pushText(out, char)
    i++
  }
  return out
}

/** Resposta inteira em blocos. Linha em branco separa parágrafos; quebra simples continua no parágrafo. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = (): void => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) })
    paragraph = []
  }
  const flushList = (): void => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map((item) => parseInline(item)) })
    list = null
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string
    if (FENCE.test(line)) {
      flushParagraph()
      flushList()
      const code: string[] = []
      index++
      while (index < lines.length && !FENCE.test(lines[index] as string)) code.push(lines[index++] as string)
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', children: parseInline(heading[1] ?? '') })
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    const item = bullet ?? numbered
    if (item) {
      flushParagraph()
      const ordered = numbered !== null
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push(item[1] ?? '')
      continue
    }
    // Linha recuada logo depois de um item continua o item.
    if (list && /^\s+\S/.test(line)) {
      const items = list.items
      items[items.length - 1] = `${items[items.length - 1] ?? ''}\n${line.trim()}`
      continue
    }
    flushList()
    const quote = QUOTE.exec(line)
    paragraph.push(quote ? (quote[1] ?? '') : line)
  }
  flushParagraph()
  flushList()
  return blocks
}

/** Link externo que pode virar botão (com confirmação): só `https://` com endereço válido. */
export function isExternalLink(href: string): boolean {
  if (!href.startsWith('https://')) return false
  try {
    return new URL(href).protocol === 'https:'
  } catch {
    return false
  }
}
