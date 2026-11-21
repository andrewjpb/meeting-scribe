// Contrato 108: a leitura pura do arquivo de importação de contatos do Funil (`shared/funil-import.ts`), CSV e vCard
// (spec R14 a R16, CA5). Fixtures fictícias em `test/fixtures/funil/`; as grandes (CA4, CA6) são montadas aqui.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  IMPORT_BYTES_MAX,
  IMPORT_LINHAS_MAX,
  IMPORT_PREVIA_LINHAS,
  aplicarMapeamento,
  decodificar,
  lerArquivo,
  lerCsv,
  lerVcard,
  mapearCabecalho,
  type LeituraImport,
} from '../src/shared/funil-import'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'funil')
const bytesDe = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)))
const lerFixture = (name: string): LeituraImport => lerArquivo(bytesDe(name), name)
const utf8 = (texto: string): Uint8Array => new TextEncoder().encode(texto)

function csvOk(leitura: LeituraImport): Extract<LeituraImport, { tipo: 'csv' }> {
  if (!leitura.ok || leitura.tipo !== 'csv') throw new Error(`esperava CSV, veio ${JSON.stringify(leitura).slice(0, 200)}`)
  return leitura
}
function vcardOk(leitura: LeituraImport): Extract<LeituraImport, { tipo: 'vcard' }> {
  if (!leitura.ok || leitura.tipo !== 'vcard') throw new Error(`esperava vCard, veio ${JSON.stringify(leitura).slice(0, 200)}`)
  return leitura
}

describe('CSV', () => {
  it('CA1: separador ";", BOM fora, mapeamento automático, 3 entradas e 1 ignorada', () => {
    const leitura = csvOk(lerFixture('contatos-ponto-e-virgula-bom.csv'))
    expect(leitura.separador).toBe(';')
    expect(leitura.codificacao).toBe('utf-8')
    expect(leitura.colunas[0]).toBe('Nome')
    expect(leitura.colunas).toEqual(['Nome', 'E-mail', 'Telefone', 'Empresa'])
    expect(leitura.mapeamento).toEqual(['nome', 'email', 'telefone', 'empresa'])
    expect(leitura.linhas).toHaveLength(4)
    const { entradas, ignorados } = aplicarMapeamento(leitura.linhas, leitura.mapeamento)
    expect(entradas).toHaveLength(3)
    expect(ignorados).toBe(1)
    expect(entradas[0]).toEqual({ nome: 'Ana Souza', emails: ['ana.souza@acme.example'], telefones: ['(11) 98888-0001'], empresaNome: 'Acme Comércio', cargo: null })
    expect(entradas[1]).toEqual({ nome: 'Bruno Lima', emails: ['bruno@lima.example'], telefones: [], empresaNome: null, cargo: null })
    expect(entradas[2]?.empresaNome).toBe('Dias; Filhos Ltda')
    expect(entradas.map((e) => e.nome)).not.toContain('Daniel Rocha')
  })

  it('CA2: First name + Last name viram um nome só', () => {
    const leitura = csvOk(lerFixture('contatos-first-last.csv'))
    expect(leitura.separador).toBe(',')
    expect(leitura.mapeamento).toEqual(['nome', 'nome', 'email'])
    const { entradas, ignorados } = aplicarMapeamento(leitura.linhas, leitura.mapeamento)
    expect(entradas[0]?.nome).toBe('Fernanda Alves')
    expect(entradas[1]?.nome).toBe('Gustavo Pereira')
    expect(ignorados).toBe(0)
  })

  it('CA4: 5 MB + 1 byte recusa; exatamente 5 MB de CSV válido não', () => {
    expect(lerArquivo(new Uint8Array(IMPORT_BYTES_MAX + 1), 'grande.csv')).toEqual({ ok: false, erro: 'arquivo-grande' })
    const cabecalho = 'Nome,Email\n'
    const fim = ',zeca@exemplo.example\n'
    const texto = cabecalho + 'Z'.repeat(IMPORT_BYTES_MAX - cabecalho.length - fim.length) + fim
    const bytes = utf8(texto)
    expect(bytes.length).toBe(IMPORT_BYTES_MAX)
    const leitura = csvOk(lerArquivo(bytes, 'limite.csv'))
    expect(leitura.linhas).toHaveLength(1)
    expect(aplicarMapeamento(leitura.linhas, leitura.mapeamento).entradas).toHaveLength(1)
  })

  it('CA5: Latin-1 decodificado, "João" na prévia e "Organização" mapeia para empresa', () => {
    const leitura = csvOk(lerFixture('contatos-latin1.csv'))
    expect(leitura.codificacao).toBe('latin1')
    expect(leitura.colunas).toEqual(['Nome', 'Organização', 'E-mail'])
    expect(leitura.mapeamento).toEqual(['nome', 'empresa', 'email'])
    expect(leitura.previa.flat().join(' ')).toContain('João')
    expect(aplicarMapeamento(leitura.linhas, leitura.mapeamento).entradas[0]?.empresaNome).toBe('Padaria Pão Quente')
  })

  it('CA6: 10 001 linhas de dados recusa com linhas-demais; 10 000 passa; arquivo vazio é formato', () => {
    const csv = (n: number): Uint8Array => utf8('Nome,Telefone\n' + Array.from({ length: n }, (_, i) => `Pessoa ${i},1199990${i}`).join('\n') + '\n')
    expect(lerArquivo(csv(IMPORT_LINHAS_MAX + 1), 'muitas.csv')).toEqual({ ok: false, erro: 'linhas-demais' })
    const limite = csvOk(lerArquivo(csv(IMPORT_LINHAS_MAX), 'limite.csv'))
    expect(limite.linhas).toHaveLength(IMPORT_LINHAS_MAX)
    expect(limite.previa).toHaveLength(IMPORT_PREVIA_LINHAS)
    expect(limite.previa[0]).toEqual(['Pessoa 0', '11999900'])
    expect(lerArquivo(new Uint8Array(0), 'vazio.csv')).toEqual({ ok: false, erro: 'formato' })
    expect(lerArquivo(utf8('\r\n\n  \n'), 'branco.txt')).toEqual({ ok: false, erro: 'formato' })
    expect(lerArquivo(new Uint8Array(0), 'vazio.vcf')).toEqual({ ok: false, erro: 'formato' })
  })

  it('CA8: campo entre aspas com ";" e quebra de linha fica numa célula só', () => {
    const texto = 'Nome;Empresa;Cargo\r\n"Lúcia ""Lu"" Prado";"Prado; Irmãos\r\nFilial Sul";Gerente\r\nMário;Loja;Dono\r\n'
    const lido = lerCsv(texto)
    expect(lido.separador).toBe(';')
    expect(lido.linhas).toHaveLength(2)
    expect(lido.linhas[0]).toEqual(['Lúcia "Lu" Prado', 'Prado; Irmãos\r\nFilial Sul', 'Gerente'])
    expect(lido.linhas[1]).toEqual(['Mário', 'Loja', 'Dono'])
  })

  it('CA9: Celular e WhatsApp são telefone e os dois entram na entrada', () => {
    const lido = lerCsv('Nome\tCelular\tWhatsApp\tCargo\nRita Gomes\t11 91111-0005\t11 92222-0006\tCompradora\n')
    expect(lido.separador).toBe('\t')
    const mapeamento = mapearCabecalho(lido.colunas)
    expect(mapeamento).toEqual(['nome', 'telefone', 'telefone', 'cargo'])
    const { entradas } = aplicarMapeamento(lido.linhas, mapeamento)
    expect(entradas[0]).toEqual({ nome: 'Rita Gomes', emails: [], telefones: ['11 91111-0005', '11 92222-0006'], empresaNome: null, cargo: 'Compradora' })
  })

  it('mapeia os nomes da spec sem acento, sem caixa e com espaços nas pontas; o resto é ignorar', () => {
    expect(mapearCabecalho(['  NAME ', 'Contato', 'Full Name', 'Correio', 'Phone', 'Mobile', 'Tel', 'Company', 'Organization', 'Title', 'Job Title', 'Função', 'Observações', ''])).toEqual([
      'nome',
      'nome',
      'nome',
      'email',
      'telefone',
      'telefone',
      'telefone',
      'empresa',
      'empresa',
      'cargo',
      'cargo',
      'cargo',
      'ignorar',
      'ignorar',
    ])
  })

  it('aplicarMapeamento: valores com trim, vazios descartados, linha curta não quebra, sem nome é ignorada', () => {
    const { entradas, ignorados } = aplicarMapeamento(
      [
        ['  Ana  ', ' a@x.example ', '  ', 'b@x.example'],
        ['', 'sem-nome@x.example', '', ''],
        ['Curta'],
      ],
      ['nome', 'email', 'ignorar', 'email'],
    )
    expect(entradas).toEqual([{ nome: 'Ana', emails: ['a@x.example', 'b@x.example'], telefones: [], empresaNome: null, cargo: null }])
    expect(ignorados).toBe(2)
  })

  it('lerCsv: separador pela primeira linha fora de aspas, linhas vazias ignoradas, cabeçalho só', () => {
    expect(lerCsv('"a;b;c",d,e\n1,2,3').separador).toBe(',')
    expect(lerCsv('Nome;Email\n\n;\n\nAna;a@x.example\n').linhas).toEqual([['Ana', 'a@x.example']])
    expect(lerCsv('Nome,Email')).toEqual({ separador: ',', colunas: ['Nome', 'Email'], linhas: [] })
    expect(lerCsv('')).toEqual({ separador: ',', colunas: [], linhas: [] })
  })

  it('aspas abrem o campo mesmo com espaço antes, como o Excel exporta', () => {
    const lido = lerCsv('Nome; Empresa\nAna; "X; Y"\nBeto;  "Z"\n')
    expect(lido.colunas).toEqual(['Nome', 'Empresa'])
    expect(lido.linhas).toEqual([
      ['Ana', 'X; Y'],
      ['Beto', 'Z'],
    ])
    expect(lerCsv('Nome,Obs\nAna,diz "oi"\n').linhas).toEqual([['Ana', 'diz "oi"']])
  })

  it('total e ignorados no resultado do CSV, com o mapeamento automático', () => {
    const leitura = csvOk(lerFixture('contatos-ponto-e-virgula-bom.csv'))
    expect(leitura.total).toBe(4)
    expect(leitura.ignorados).toBe(1)
  })
})

describe('vCard', () => {
  it('CA3: 2 cartões 3.0 com 2 EMAIL cada; a linha dobrada vira um valor só', () => {
    const leitura = vcardOk(lerFixture('contatos-3.0.vcf'))
    expect(leitura.codificacao).toBe('utf-8')
    expect(leitura.entradas).toHaveLength(2)
    expect(leitura.entradas.map((e) => e.emails.length)).toEqual([2, 2])
    expect(leitura.entradas[0]).toEqual({
      nome: 'Helena Martins',
      emails: ['helena@martins.example', 'helena.martins.pessoal@correio-muito-comprido.example'],
      telefones: ['+55 11 96666-0003'],
      empresaNome: 'Martins, Costa & Cia',
      cargo: 'Diretora comercial',
    })
    expect(leitura.entradas[1]?.emails).toEqual(['igor@nascimento.example', 'igor.n@outro.example'])
    expect(leitura.previa).toEqual(leitura.entradas)
  })

  it('CA7: vCard 2.1 com N em "Nome Sobrenome" e QUOTED-PRINTABLE decodificado', () => {
    const leitura = vcardOk(lerFixture('contatos-2.1.vcf'))
    expect(leitura.entradas).toEqual([{ nome: 'Maria Conceição', emails: [], telefones: ['+55 31 95555-0004'], empresaNome: 'Comércio de Frutas São José', cargo: null }])
  })

  it('vCard 4.0 pelo conteúdo num .txt: TEL em URI, cartão sem e-mail e telefone não entra, sem END não conta', () => {
    const texto = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Otávio Reis',
      'TEL;VALUE=uri;TYPE="voice,cell":tel:+55-11-93333-0007',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Sem Contato',
      'ORG:Nada',
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:Aberto',
      'EMAIL:aberto@x.example',
    ].join('\n')
    expect(lerVcard(texto)).toEqual({
      cartoes: 2,
      ignorados: 1,
      entradas: [{ nome: 'Otávio Reis', emails: [], telefones: ['+55-11-93333-0007'], empresaNome: null, cargo: null }],
    })
    const leitura = vcardOk(lerArquivo(utf8(texto), 'contatos.txt'))
    expect(leitura.entradas).toHaveLength(1)
    expect(lerArquivo(utf8('qualquer coisa'), 'vazio.vcf')).toEqual({ ok: false, erro: 'formato' })
  })

  it('QUOTED-PRINTABLE: a quebra mole seguida de linha com espaço guarda o espaço antes de decodificar', () => {
    const texto = 'BEGIN:VCARD\r\nVERSION:2.1\r\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jo=C3=A3o=\r\n da Silva\r\nTEL:1\r\nEND:VCARD\r\n'
    expect(lerVcard(texto).entradas[0]?.nome).toBe('João da Silva')
  })

  it('total e ignorados no resultado do vCard', () => {
    const texto = 'BEGIN:VCARD\nFN:Com Tel\nTEL:1\nEND:VCARD\nBEGIN:VCARD\nFN:Sem Nada\nEND:VCARD\n'
    const leitura = vcardOk(lerArquivo(utf8(texto), 'dois.vcf'))
    expect(leitura.total).toBe(2)
    expect(leitura.ignorados).toBe(1)
    expect(leitura.entradas).toHaveLength(1)
    const fixture = vcardOk(lerFixture('contatos-3.0.vcf'))
    expect([fixture.total, fixture.ignorados]).toEqual([2, 0])
  })

  it('mais de 10 000 cartões recusa com linhas-demais', () => {
    const cartao = 'BEGIN:VCARD\nFN:X\nTEL:1\nEND:VCARD\n'
    expect(lerArquivo(utf8(cartao.repeat(IMPORT_LINHAS_MAX + 1)), 'muitos.vcf')).toEqual({ ok: false, erro: 'linhas-demais' })
    expect(vcardOk(lerArquivo(utf8(cartao.repeat(IMPORT_LINHAS_MAX)), 'limite.vcf')).previa).toHaveLength(IMPORT_PREVIA_LINHAS)
  })
})

describe('decodificar', () => {
  it('tira o BOM do UTF-8, aceita UTF-8 sem BOM e cai para Latin-1 quando o UTF-8 estrito falha', () => {
    expect(decodificar(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ texto: 'A', codificacao: 'utf-8' })
    expect(decodificar(utf8('Conceição'))).toEqual({ texto: 'Conceição', codificacao: 'utf-8' })
    expect(decodificar(new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f]))).toEqual({ texto: 'João', codificacao: 'latin1' })
  })

  it('BOM seguido de bytes que não são UTF-8: o BOM sai também no Latin-1 e a primeira coluna mapeia', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Nome;Email\nJo'), 0xe3, ...new TextEncoder().encode('o;j@x.example\n')])
    expect(decodificar(bytes)).toEqual({ texto: 'Nome;Email\nJoão;j@x.example\n', codificacao: 'latin1' })
    const leitura = csvOk(lerArquivo(bytes, 'bom-latin1.csv'))
    expect(leitura.colunas[0]).toBe('Nome')
    expect(leitura.mapeamento).toEqual(['nome', 'email'])
  })
})
