// Planilha `.xlsx` em texto para o Assistente (contrato 166, pastas-assistente D4): leitor próprio, sem dependência nova.
// - O zip é lido pelo diretório central (o fim do arquivo), com `inflateRawSync` (método 8) ou cópia (método 0); zip64,
//   criptografado ou outro método não abre.
// - Do pacote saem só `xl/workbook.xml` (nomes das abas), `xl/_rels/workbook.xml.rels` (aba → arquivo),
//   `xl/sharedStrings.xml` e as abas; o XML é lido por expressões simples, sem DOM.
// - Valores em cache, nunca fórmula: o que a planilha guardou no `<v>` (ou o texto inline) é o que sai.
// - Tudo com teto: bytes descompactados somando todas as partes, textos compartilhados, colunas, caracteres por célula e o
//   orçamento de caracteres da saída (a aba e a planilha param assim que ele estoura).
// - Erro com mensagem fixa: nada do conteúdo nem do caminho.
import { inflateRawSync } from 'node:zlib'

const INVALID = 'planilha inválida'
/** Bytes descompactados no conjunto de todas as partes lidas de uma planilha. */
const INFLATED_MAX_BYTES = 64 * 1024 * 1024
/** Textos compartilhados guardados (os de índice maior saem vazios). */
const SHARED_STRINGS_MAX = 200_000
/** Colunas lidas por linha (A até AMJ); as de depois ficam de fora. */
const COLUMN_MAX = 1024
/** Caracteres de uma célula. */
const CELL_CHARS_MAX = 2000

interface ZipEntry {
  method: number
  flags: number
  compressedSize: number
  size: number
  localOffset: number
}

/** O pacote aberto: as entradas, as partes já descompactadas e o que ainda cabe no teto do conjunto. */
interface Package {
  bytes: Uint8Array
  entries: Map<string, ZipEntry>
  parts: Map<string, string>
  room: number
}

/** O teto de bytes descompactados do conjunto estourou. */
class OverBudget extends Error {}

/** O diretório central do zip: nome → entrada. Lança `INVALID` se não for zip. */
function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // O fim do diretório central: assinatura `PK\x05\x06` nos últimos 22 + 65.535 bytes (o comentário do zip).
  let end = -1
  for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error(INVALID)
  const count = view.getUint16(end + 10, true)
  const size = view.getUint32(end + 12, true)
  let at = view.getUint32(end + 16, true)
  if (at + size > bytes.byteLength) throw new Error(INVALID)
  const decoder = new TextDecoder('utf-8')
  const entries = new Map<string, ZipEntry>()
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== 0x02014b50) throw new Error(INVALID)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    if (at + 46 + nameLength > bytes.byteLength) throw new Error(INVALID)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    entries.set(name, {
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      localOffset: view.getUint32(at + 42, true),
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * O conteúdo de uma parte do pacote em texto (descompactada uma vez só); `null` quando ela não existe. Passando do teto do
 * conjunto, lança `OverBudget`.
 */
function zipText(pack: Package, name: string): string | null {
  const kept = pack.parts.get(name)
  if (kept !== undefined) return kept
  const entry = pack.entries.get(name)
  if (!entry) return null
  // Criptografado (bit 0) ou zip64 (tamanhos no campo extra): fora.
  if (entry.flags & 1 || entry.compressedSize === 0xffffffff || entry.size === 0xffffffff) throw new Error(INVALID)
  const { bytes } = pack
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const local = entry.localOffset
  if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== 0x04034b50) throw new Error(INVALID)
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
  if (start + entry.compressedSize > bytes.byteLength) throw new Error(INVALID)
  const data = bytes.subarray(start, start + entry.compressedSize)
  let raw: Uint8Array
  if (entry.method === 0) {
    if (data.byteLength > pack.room) throw new OverBudget()
    raw = data
  } else if (entry.method === 8) {
    if (pack.room <= 0) throw new OverBudget()
    try {
      raw = inflateRawSync(data, { maxOutputLength: pack.room })
    } catch (error) {
      // `maxOutputLength` passado: o teto do conjunto, não um zip quebrado.
      if (error instanceof RangeError || (error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') throw new OverBudget('teto', { cause: error })
      throw new Error(INVALID, { cause: error })
    }
  } else throw new Error(INVALID)
  pack.room -= raw.byteLength
  const text = new TextDecoder('utf-8').decode(raw)
  pack.parts.set(name, text)
  return text
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** As entidades do XML (`&amp;`, `&#233;`, `&#xE9;`); a desconhecida fica como está. */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole
    }
    return ENTITIES[code] ?? whole
  })
}

/** Os atributos de uma marca (`name="…"` ou `name='…'`), pelo nome sem prefixo (`r:id` vira `id` também). */
function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1] ?? ''
    const value = decodeXmlEntities(match[2] ?? match[3] ?? '')
    found.set(name, value)
    const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
    if (!found.has(local)) found.set(local, value)
  }
  return found
}

/** O texto de um trecho com `<t>`: os pedaços somados (rich text), sem a leitura fonética (`<rPh>`), cortado na célula. */
function runsText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let text = ''
  for (const match of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    text += decodeXmlEntities(match[1] ?? '')
    if (text.length >= CELL_CHARS_MAX) return text.slice(0, CELL_CHARS_MAX)
  }
  return text
}

/** "B3" → 1 (coluna, a partir de 0); sem letra, `null`. */
function columnOf(ref: string): number | null {
  const letters = /^([A-Z]{1,3})\d*$/i.exec(ref)?.[1]
  if (!letters) return null
  let column = 0
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64)
  return column - 1
}

/** O valor de uma célula em texto: compartilhado, inline, booleano, erro ou número, como guardado. */
function cellText(attrs: Map<string, string>, body: string, shared: readonly string[]): string {
  const type = attrs.get('t') ?? 'n'
  if (type === 'inlineStr') return runsText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '')
  const value = decodeXmlEntities(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '')
  if (type === 's') {
    const index = Number.parseInt(value, 10)
    return Number.isInteger(index) ? (shared[index] ?? '') : ''
  }
  if (type === 'b') return value === '1' ? 'VERDADEIRO' : value === '0' ? 'FALSO' : value
  return value
}

/**
 * Uma aba em linhas `A | B | C`, na ordem das linhas, entregues a `push` (que diz quando o orçamento estourou: aí a aba
 * para). A linha sem nenhum valor fica de fora; só as primeiras `COLUMN_MAX` colunas entram.
 */
function sheetLines(xml: string, shared: readonly string[], push: (line: string) => boolean): { full: boolean; lines: number } {
  let lines = 0
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    // Esparsa: só as células com valor, cada uma com a coluna dela.
    const cells: [number, string][] = []
    let next = 0
    let last = -1
    for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      // A coluna antes do resto: a célula fora das colunas lidas não custa mais nada.
      const column = columnOf(/\br\s*=\s*["']([^"']*)["']/.exec(cell[1] ?? '')?.[1] ?? '') ?? next
      next = column + 1
      if (column >= COLUMN_MAX) continue
      const attrs = attributes(cell[1] ?? '')
      const text = cellText(attrs, cell[2] ?? '', shared).replace(/\s+/g, ' ').trim().slice(0, CELL_CHARS_MAX)
      if (!text) continue
      cells.push([column, text])
      if (column > last) last = column
    }
    if (cells.length === 0) continue
    const values = new Array<string>(last + 1).fill('')
    for (const [column, text] of cells) values[column] = text
    lines++
    if (push(values.join(' | '))) return { full: true, lines }
  }
  return { full: false, lines }
}

/** O caminho de uma aba no pacote, pelo alvo do `.rels` (relativo a `xl/`, ou absoluto a partir da raiz). */
function partPath(target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts: string[] = ['xl']
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece && piece !== '.') parts.push(piece)
  }
  return parts.join('/')
}

/** Os textos compartilhados, até `SHARED_STRINGS_MAX` (cada um cortado na célula). */
function sharedStrings(xml: string): string[] {
  const shared: string[] = []
  for (const match of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    if (shared.length >= SHARED_STRINGS_MAX) break
    shared.push(runsText(match[1] ?? ''))
  }
  return shared
}

/**
 * A planilha em texto: por aba, `## <nome>` e as linhas `A | B | C`. Até `maxSheets` abas (as vazias contam); passando
 * de `maxChars` (ou do teto de bytes descompactados), para e termina com `[cortado]`. Não é zip ou não tem
 * `xl/workbook.xml`: lança erro com mensagem fixa.
 */
export function xlsxToText(bytes: Uint8Array, opts: { maxChars: number; maxSheets: number }): string {
  const pack: Package = { bytes, entries: zipEntries(bytes), parts: new Map(), room: INFLATED_MAX_BYTES }
  /** As partes da estrutura: sem elas (ou acima do teto), a planilha não abre. */
  const structural = (name: string): string | null => {
    try {
      return zipText(pack, name)
    } catch {
      throw new Error(INVALID)
    }
  }
  const workbook = structural('xl/workbook.xml')
  if (workbook === null) throw new Error(INVALID)
  const rels = new Map<string, string>()
  for (const match of (structural('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1] ?? '')
    const id = attrs.get('Id')
    const target = attrs.get('Target')
    if (id && target) rels.set(id, partPath(target))
  }
  const shared = sharedStrings(structural('xl/sharedStrings.xml') ?? '')
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)].map((match) => attributes(match[1] ?? ''))
  const out: string[] = []
  let length = 0
  const push = (line: string): boolean => {
    out.push(line)
    length += line.length + 1
    return length > opts.maxChars
  }
  let full = false
  // A parte já lida por outra aba (o `.rels` pode apontar várias abas para a mesma): não é varrida de novo.
  const seen = new Set<string>()
  for (const [index, sheet] of sheets.entries()) {
    if (index >= opts.maxSheets) {
      full = push(`[${sheets.length - opts.maxSheets} abas não lidas]`)
      break
    }
    const name = decodeXmlEntities(sheet.get('name') ?? `Aba ${index + 1}`)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
    const target = rels.get(sheet.get('id') ?? '') ?? `xl/worksheets/sheet${index + 1}.xml`
    let xml: string | null
    try {
      xml = zipText(pack, target)
    } catch (error) {
      if (!(error instanceof OverBudget)) throw error
      full = true
      break
    }
    if (index > 0 && (full = push(''))) break
    if ((full = push(`## ${name}`))) break
    if (seen.has(target)) {
      if ((full = push('(o mesmo conteúdo de uma aba anterior)'))) break
      continue
    }
    seen.add(target)
    const sheetOut = xml === null ? { full: false, lines: 0 } : sheetLines(xml, shared, push)
    if ((full = sheetOut.full)) break
    if (sheetOut.lines === 0 && (full = push('(aba vazia)'))) break
  }
  const text = out.join('\n')
  return full || text.length > opts.maxChars ? `${text.slice(0, opts.maxChars)}\n[cortado]` : text
}
