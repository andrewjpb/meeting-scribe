// Contrato 166 (pastas-assistente D4, CA5): o leitor próprio de `.xlsx`, com um pacote mínimo montado aqui (diretório
// central, uma parte guardada sem compressão e as outras com deflate).
import { randomBytes } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { xlsxToText } from '../src/main/chat/xlsx-text'

/** Um zip mínimo (sem CRC: o leitor não confere), com `stored` sem compressão e o resto com deflate. */
function zip(files: Record<string, string>, stored: readonly string[] = []): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const raw = Buffer.from(text, 'utf8')
    const method = stored.includes(name) ? 0 : 8
    const data = method === 0 ? raw : deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

/** A planilha do CA5: "Preços" (compartilhadas, número, inline com entidade, booleano) e "Vazia". */
function workbook(): Uint8Array {
  return zip(
    {
      '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
      'xl/workbook.xml':
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pre&#231;os" sheetId="1" r:id="rId1"/><sheet name="Vazia" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="sharedStrings" Target="sharedStrings.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<?xml version="1.0"?><sst count="3"><si><t>item</t></si><si><r><t>val</t></r><r><t xml:space="preserve">or</t></r></si><si><t>hospedagem</t><rPh><t>fonetica</t></rPh></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><f>300+10</f><v>310</v></c><c r="C2" t="inlineStr"><is><t>x&amp;y</t></is></c><c r="D2" t="b"><v>1</v></c></row><row r="3"/><row r="4"><c r="B4" t="e"><v>#DIV/0!</v></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet2.xml': '<?xml version="1.0"?><worksheet><sheetData/></worksheet>',
    },
    ['xl/worksheets/sheet2.xml'],
  )
}

describe('xlsxToText (contrato 166, CA5)', () => {
  it('as abas com o nome, as linhas "A | B | C" e os valores em cache', () => {
    const text = xlsxToText(workbook(), { maxChars: 20_000, maxSheets: 50 })
    expect(text).toContain('## Preços')
    expect(text).toContain('item | valor')
    expect(text).toContain('hospedagem | 310 | x&y | VERDADEIRO')
    expect(text).toContain(' | #DIV/0!')
    expect(text).toContain('## Vazia')
    expect(text).not.toContain('fonetica')
    expect(text).not.toContain('300+10')
    expect(text.indexOf('## Preços')).toBeLessThan(text.indexOf('## Vazia'))
  })

  it('maxSheets: 1 → só a primeira aba', () => {
    const text = xlsxToText(workbook(), { maxChars: 20_000, maxSheets: 1 })
    expect(text).toContain('## Preços')
    expect(text).not.toContain('## Vazia')
  })

  it('maxChars: 20 → cortado, terminando com [cortado]', () => {
    const text = xlsxToText(workbook(), { maxChars: 20, maxSheets: 50 })
    expect(text.endsWith('[cortado]')).toBe(true)
    expect(text.length).toBeLessThanOrEqual(20 + '\n[cortado]'.length)
  })

  it('bytes aleatórios, zip sem workbook.xml ou vazio → erro com mensagem fixa', () => {
    expect(() => xlsxToText(new Uint8Array(randomBytes(4096)), { maxChars: 100, maxSheets: 1 })).toThrow('planilha inválida')
    expect(() => xlsxToText(zip({ 'word/document.xml': '<w/>' }), { maxChars: 100, maxSheets: 1 })).toThrow('planilha inválida')
    expect(() => xlsxToText(new Uint8Array(), { maxChars: 100, maxSheets: 1 })).toThrow('planilha inválida')
  })

  it('colunas distantes: zip pequeno com 20.000 linhas de célula em XFD termina rápido e sem explodir memória', () => {
    const rows = '<row r="1"><c r="XFD1" t="inlineStr"><is><t>x</t></is></c></row>'.repeat(20_000)
    const bytes = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Longe" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}<row r="20001"><c r="A20001" t="inlineStr"><is><t>perto</t></is></c><c r="AMK20001"><v>9</v></c></row></sheetData></worksheet>`,
    })
    expect(bytes.byteLength).toBeLessThan(8 * 1024)
    const heap = process.memoryUsage().heapUsed
    const started = performance.now()
    const text = xlsxToText(bytes, { maxChars: 20_000, maxSheets: 50 })
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(2000)
    expect(process.memoryUsage().heapUsed - heap).toBeLessThan(200 * 1024 * 1024)
    expect(text).toContain('## Longe')
    expect(text).toContain('perto')
    expect(text).not.toContain(' | 9')
  })

  it('50 abas apontando para a mesma parte: termina rápido, respeita maxSheets e não varre a parte de novo', () => {
    const sheets = Array.from({ length: 50 }, (_, index) => `<sheet name="A${index + 1}" sheetId="${index + 1}" r:id="rId1"/>`).join('')
    const rows = Array.from({ length: 5000 }, (_, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${index}</v></c></row>`).join('')
    const bytes = zip({
      'xl/workbook.xml': `<workbook><sheets>${sheets}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    })
    const started = performance.now()
    const text = xlsxToText(bytes, { maxChars: 1_000_000, maxSheets: 10 })
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(2000)
    expect(text).toContain('## A10')
    expect(text).not.toContain('## A11')
    expect(text).toContain('[40 abas não lidas]')
    expect(text.split('\n4999').length - 1).toBe(1)
    // As abas vazias também contam para o limite.
    const empty = zip({
      'xl/workbook.xml': `<workbook><sheets>${sheets}</sheets></workbook>`,
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>',
    })
    const emptyText = xlsxToText(empty, { maxChars: 1_000_000, maxSheets: 3 })
    expect(emptyText).toContain('## A3')
    expect(emptyText).not.toContain('## A4')
  })

  it('teto de bytes descompactados no conjunto: aba enorme corta, sem travar', () => {
    const big = `<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row>${'<row/>'.repeat(12_000_000)}</sheetData></worksheet>`
    const bytes = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Grande" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': big,
    })
    const text = xlsxToText(bytes, { maxChars: 20_000, maxSheets: 50 })
    expect(text.endsWith('[cortado]')).toBe(true)
  })
})
