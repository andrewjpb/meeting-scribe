// Importação de contatos do Funil de vendas (contrato 108, spec R14 a R16): lê um CSV ou um vCard e devolve as linhas,
// o mapeamento automático das colunas e as entradas prontas para o store. Módulo puro: recebe os bytes ou o texto e
// devolve estrutura; sem disco, sem Electron, sem biblioteca de CSV ou vCard. Não normaliza e-mail nem telefone (é do
// store, R3) e não grava nada. Os tipos de saída são próprios e estruturalmente compatíveis com `ContatoInput`.

/** Teto do arquivo, em bytes antes de decodificar (spec, "Modelo de dados"). */
export const IMPORT_BYTES_MAX = 5 * 1024 * 1024
/** Linhas de dados do CSV (sem o cabeçalho) ou cartões do vCard. */
export const IMPORT_LINHAS_MAX = 10000
export const IMPORT_PREVIA_LINHAS = 5
export const IMPORT_EXTENSOES = ['csv', 'vcf', 'txt'] as const

export type CampoImport = 'nome' | 'email' | 'telefone' | 'empresa' | 'cargo' | 'ignorar'
export type SeparadorCsv = ',' | ';' | '\t'
export type CodificacaoImport = 'utf-8' | 'latin1'
export interface EntradaImport {
  nome: string
  emails: string[]
  telefones: string[]
  empresaNome: string | null
  cargo: string | null
}
export type LeituraImport =
  | {
      ok: true
      tipo: 'csv'
      separador: SeparadorCsv
      codificacao: CodificacaoImport
      colunas: string[]
      mapeamento: CampoImport[]
      linhas: string[][]
      previa: string[][]
      /** Linhas de dados (sem o cabeçalho). */
      total: number
      /** Linhas sem nome ou sem e-mail e telefone com o mapeamento automático (R16); a prévia recalcula se o usuário remapear. */
      ignorados: number
    }
  | {
      ok: true
      tipo: 'vcard'
      codificacao: CodificacaoImport
      entradas: EntradaImport[]
      previa: EntradaImport[]
      /** Cartões BEGIN:VCARD a END:VCARD, válidos ou não. */
      total: number
      /** Cartões sem nome ou sem e-mail e telefone (R16). */
      ignorados: number
    }
  | { ok: false; erro: 'arquivo-grande' | 'linhas-demais' | 'formato' }

export interface CsvLido {
  separador: SeparadorCsv
  /** O cabeçalho, com `trim`; vazio quando o texto não tem nenhuma linha. */
  colunas: string[]
  /** As linhas de dados, células como vieram (sem as aspas). */
  linhas: string[][]
}
export interface VcardLido {
  /** Cartões BEGIN:VCARD a END:VCARD encontrados, válidos ou não. */
  cartoes: number
  /** Os cartões com nome e pelo menos um e-mail ou telefone, na ordem do arquivo. */
  entradas: EntradaImport[]
  /** Cartões sem nome ou sem e-mail e telefone (R16). */
  ignorados: number
}

const semAcento = (texto: string): string => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const chave = (texto: string): string => semAcento(texto).toLowerCase().trim()

// ---------------------------------------------------------------------------------------------------------------
// Codificação

/** UTF-8 (com ou sem BOM); se a decodificação estrita falhar, Latin-1 (o BOM sai nos dois casos). */
export function decodificar(bytes: Uint8Array): { texto: string; codificacao: CodificacaoImport } {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  try {
    return { texto: new TextDecoder('utf-8', { fatal: true }).decode(bom ? bytes.subarray(3) : bytes), codificacao: 'utf-8' }
  } catch {
    return { texto: new TextDecoder('latin1').decode(bom ? bytes.subarray(3) : bytes), codificacao: 'latin1' }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CSV

const SEPARADORES: readonly SeparadorCsv[] = [',', ';', '\t']

/** O separador de maior contagem fora de aspas na primeira linha não vazia; empate ou nenhum, na ordem `,` `;` `\t`. */
function detectarSeparador(texto: string): SeparadorCsv {
  let i = 0
  while (i < texto.length && (texto[i] === '\r' || texto[i] === '\n')) i++
  const contagem = new Map<string, number>()
  let aspas = false
  for (; i < texto.length; i++) {
    const c = texto[i] ?? ''
    if (c === '"') aspas = !aspas
    else if (!aspas && (c === '\r' || c === '\n')) break
    else if (!aspas) contagem.set(c, (contagem.get(c) ?? 0) + 1)
  }
  let melhor: SeparadorCsv = ','
  for (const sep of SEPARADORES) if ((contagem.get(sep) ?? 0) > (contagem.get(melhor) ?? 0)) melhor = sep
  return melhor
}

/** Aspas duplas com `""` escapado e quebra de linha dentro de aspas; linhas só com células vazias são ignoradas. */
function linhasCsv(texto: string, separador: SeparadorCsv): string[][] {
  const linhas: string[][] = []
  let linha: string[] = []
  let celula = ''
  let i = 0
  const fecharLinha = (): void => {
    linha.push(celula)
    celula = ''
    if (linha.some((valor) => valor.trim() !== '')) linhas.push(linha)
    linha = []
  }
  while (i < texto.length) {
    const c = texto[i]
    if (c === '"' && celula.trim() === '') {
      // Campo entre aspas (os espaços antes da aspa saem, como o Excel exporta `Ana; "X; Y"`): vai até a aspa que
      // não é seguida de outra; o que vier depois dela até o separador entra como texto (CSV torto não derruba a
      // leitura).
      celula = ''
      i++
      for (;;) {
        const fecha = texto.indexOf('"', i)
        if (fecha < 0) {
          celula += texto.slice(i)
          i = texto.length
          break
        }
        celula += texto.slice(i, fecha)
        if (texto[fecha + 1] === '"') {
          celula += '"'
          i = fecha + 2
        } else {
          i = fecha + 1
          break
        }
      }
      continue
    }
    if (c === separador) {
      linha.push(celula)
      celula = ''
      i++
    } else if (c === '\r' || c === '\n') {
      fecharLinha()
      i += c === '\r' && texto[i + 1] === '\n' ? 2 : 1
    } else {
      // Trecho sem aspas até o próximo separador, quebra ou aspa.
      let fim = i + 1
      while (fim < texto.length) {
        const d = texto[fim]
        if (d === separador || d === '\r' || d === '\n' || d === '"') break
        fim++
      }
      celula += texto.slice(i, fim)
      i = fim
      // Aspa no meio de um campo sem aspas é texto; depois de só espaços, abre o campo entre aspas na volta do laço.
      if (texto[i] === '"' && celula.trim() !== '') {
        celula += '"'
        i++
      }
    }
  }
  if (celula !== '' || linha.length > 0) fecharLinha()
  return linhas
}

/** A primeira linha é o cabeçalho (R14). Texto sem nenhuma linha devolve `colunas` vazio. */
export function lerCsv(texto: string): CsvLido {
  const limpo = texto.replace(/^\uFEFF/, '')
  const separador = detectarSeparador(limpo)
  const [cabecalho, ...linhas] = linhasCsv(limpo, separador)
  return { separador, colunas: (cabecalho ?? []).map((coluna) => coluna.trim()), linhas }
}

const NOMES_CAMPO: readonly [CampoImport, readonly string[]][] = [
  ['nome', ['nome', 'name', 'contato', 'full name', 'first name', 'last name']],
  ['email', ['email', 'e-mail', 'correio']],
  ['telefone', ['telefone', 'phone', 'celular', 'whatsapp', 'mobile', 'tel']],
  ['empresa', ['empresa', 'company', 'organizacao', 'organization']],
  ['cargo', ['cargo', 'title', 'job title', 'funcao']],
]

/** Mapeamento automático por nome da coluna, sem acento e sem caixa (R14); o que não casa vira `ignorar`. */
export function mapearCabecalho(colunas: readonly string[]): CampoImport[] {
  return colunas.map((coluna) => {
    const nome = chave(coluna)
    return NOMES_CAMPO.find(([, nomes]) => nomes.includes(nome))?.[0] ?? 'ignorar'
  })
}

/**
 * Monta as entradas com o mapeamento (o automático ou o que o usuário escolheu na prévia). Várias colunas `nome` juntam
 * com um espaço na ordem das colunas; várias `email` e `telefone` acumulam; `empresa` e `cargo` ficam com o primeiro
 * valor não vazio. Linha sem nome, ou sem nenhum e-mail e nenhum telefone, conta em `ignorados` (R16).
 */
export function aplicarMapeamento(linhas: readonly (readonly string[])[], mapeamento: readonly CampoImport[]): { entradas: EntradaImport[]; ignorados: number } {
  const entradas: EntradaImport[] = []
  let ignorados = 0
  for (const linha of linhas) {
    const nomes: string[] = []
    const entrada: EntradaImport = { nome: '', emails: [], telefones: [], empresaNome: null, cargo: null }
    mapeamento.forEach((campo, coluna) => {
      const valor = (linha[coluna] ?? '').trim()
      if (valor === '') return
      if (campo === 'nome') nomes.push(valor)
      else if (campo === 'email') entrada.emails.push(valor)
      else if (campo === 'telefone') entrada.telefones.push(valor)
      else if (campo === 'empresa') entrada.empresaNome ??= valor
      else if (campo === 'cargo') entrada.cargo ??= valor
    })
    entrada.nome = nomes.join(' ')
    if (entradaValida(entrada)) entradas.push(entrada)
    else ignorados++
  }
  return { entradas, ignorados }
}

const entradaValida = (entrada: EntradaImport): boolean => entrada.nome !== '' && (entrada.emails.length > 0 || entrada.telefones.length > 0)

// ---------------------------------------------------------------------------------------------------------------
// vCard (2.1, 3.0 e 4.0)

interface PropriedadeVcard {
  /** Em maiúsculo, sem o grupo (`item1.EMAIL` → `EMAIL`). */
  nome: string
  /** Os parâmetros como vieram, em maiúsculo (`TYPE=WORK`, `QUOTED-PRINTABLE`, `CHARSET=UTF-8`). */
  parametros: string[]
  /** O valor já decodificado do QUOTED-PRINTABLE, ainda com o escape do vCard (`\,` `\;` `\n`). */
  valor: string
}

/** Posição do primeiro `:` fora de aspas (parâmetro do 4.0 pode vir entre aspas com `:` dentro). */
function doisPontos(linha: string): number {
  let aspas = false
  for (let i = 0; i < linha.length; i++) {
    if (linha[i] === '"') aspas = !aspas
    else if (!aspas && linha[i] === ':') return i
  }
  return -1
}

const quotedPrintable = (parametros: readonly string[]): boolean => parametros.some((p) => p === 'QUOTED-PRINTABLE' || p === 'ENCODING=QUOTED-PRINTABLE')

/** A linha lógica (ainda sem separar) é de uma propriedade em QUOTED-PRINTABLE? */
function quotedPrintableLinha(linha: string): boolean {
  const posicao = doisPontos(linha)
  return posicao >= 0 && quotedPrintable(linha.slice(0, posicao).split(';').slice(1).map((p) => p.trim().toUpperCase()))
}

function decodificarQuotedPrintable(valor: string, parametros: readonly string[]): string {
  const charset = parametros.find((p) => p.startsWith('CHARSET='))?.slice('CHARSET='.length).replace(/"/g, '').toLowerCase() ?? 'utf-8'
  const latin1 = ['iso-8859-1', 'latin1', 'latin-1', 'windows-1252', 'cp1252'].includes(charset)
  const bytes: number[] = []
  const texto = new TextEncoder()
  for (let i = 0; i < valor.length; i++) {
    const c = valor[i] ?? ''
    const hex = c === '=' ? valor.slice(i + 1, i + 3) : ''
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16))
      i += 2
    } else if (latin1) bytes.push(c.charCodeAt(0) & 0xff)
    else bytes.push(...texto.encode(c))
  }
  return new TextDecoder(latin1 ? 'latin1' : 'utf-8').decode(new Uint8Array(bytes))
}

/**
 * Linhas lógicas do vCard: no 2.1, junta as quebras moles do QUOTED-PRINTABLE (linha terminada em `=`) com a linha
 * seguinte inteira, espaço do começo incluído (no QP ele é texto); fora disso desdobra as continuadas (começam com
 * espaço ou tab, que sai).
 */
function propriedadesVcard(texto: string): (PropriedadeVcard | null)[] {
  const fisicas = texto.split(/\r\n|\r|\n/)
  const logicas: string[] = []
  for (const linha of fisicas) {
    const anterior = logicas[logicas.length - 1]
    if (anterior !== undefined && anterior.endsWith('=') && quotedPrintableLinha(anterior)) logicas[logicas.length - 1] = anterior.slice(0, -1) + linha
    else if (anterior !== undefined && (linha.startsWith(' ') || linha.startsWith('\t'))) logicas[logicas.length - 1] = anterior + linha.slice(1)
    else logicas.push(linha)
  }
  const propriedades: (PropriedadeVcard | null)[] = []
  for (const linha of logicas) {
    const posicao = doisPontos(linha)
    if (posicao < 0) {
      propriedades.push(null)
      continue
    }
    const [nomeComGrupo = '', ...parametros] = linha.slice(0, posicao).split(';')
    const nome = nomeComGrupo.slice(nomeComGrupo.lastIndexOf('.') + 1).trim().toUpperCase()
    const params = parametros.map((p) => p.trim().toUpperCase())
    const bruto = linha.slice(posicao + 1)
    const valor = quotedPrintable(params) ? decodificarQuotedPrintable(bruto, params) : bruto
    propriedades.push({ nome, parametros: params, valor })
  }
  return propriedades
}

/** Separa os componentes de um valor estruturado (`N`, `ORG`) no `;` sem escape. */
function componentes(valor: string): string[] {
  const partes: string[] = []
  let atual = ''
  for (let i = 0; i < valor.length; i++) {
    const c = valor[i]
    if (c === '\\' && i + 1 < valor.length) {
      atual += c + (valor[i + 1] ?? '')
      i++
    } else if (c === ';') {
      partes.push(atual)
      atual = ''
    } else atual += c
  }
  partes.push(atual)
  return partes
}

const semEscape = (valor: string): string => valor.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c)).trim()

/** `TEL;VALUE=uri:tel:+55...` do 4.0 vira o número. */
const semUriTel = (valor: string): string => valor.replace(/^tel:/i, '')

function entradaDoCartao(propriedades: readonly PropriedadeVcard[]): EntradaImport {
  let fn = ''
  let n = ''
  const entrada: EntradaImport = { nome: '', emails: [], telefones: [], empresaNome: null, cargo: null }
  for (const { nome, valor } of propriedades) {
    if (nome === 'FN') fn ||= semEscape(valor)
    else if (nome === 'N' && !n) {
      // Sobrenome;Nome;Nomes adicionais;Prefixo;Sufixo → "Nome Nomes adicionais Sobrenome".
      const [sobrenome = '', prenome = '', adicionais = ''] = componentes(valor).map(semEscape)
      n = [prenome, adicionais, sobrenome].filter(Boolean).join(' ')
    } else if (nome === 'EMAIL') {
      const email = semEscape(valor)
      if (email) entrada.emails.push(email)
    } else if (nome === 'TEL') {
      const telefone = semUriTel(semEscape(valor))
      if (telefone) entrada.telefones.push(telefone)
    } else if (nome === 'ORG') entrada.empresaNome ??= semEscape(componentes(valor)[0] ?? '') || null
    else if (nome === 'TITLE') entrada.cargo ??= semEscape(valor) || null
  }
  entrada.nome = fn || n
  return entrada
}

/** Cartões BEGIN:VCARD a END:VCARD; cartão sem END no fim do texto não conta. */
export function lerVcard(texto: string): VcardLido {
  const entradas: EntradaImport[] = []
  let cartoes = 0
  let ignorados = 0
  let atual: PropriedadeVcard[] | null = null
  for (const propriedade of propriedadesVcard(texto.replace(/^\uFEFF/, ''))) {
    if (!propriedade) continue
    const valor = propriedade.valor.trim().toUpperCase()
    if (propriedade.nome === 'BEGIN' && valor === 'VCARD') atual = []
    else if (propriedade.nome === 'END' && valor === 'VCARD' && atual) {
      cartoes++
      const entrada = entradaDoCartao(atual)
      if (entradaValida(entrada)) entradas.push(entrada)
      else ignorados++
      atual = null
    } else atual?.push(propriedade)
  }
  return { cartoes, entradas, ignorados }
}

// ---------------------------------------------------------------------------------------------------------------
// Arquivo

const extensao = (nomeArquivo: string): string => {
  const ponto = nomeArquivo.lastIndexOf('.')
  return ponto < 0 ? '' : nomeArquivo.slice(ponto + 1).toLowerCase()
}

/** Lê o arquivo escolhido (R13 a R15): vCard pela extensão `vcf` ou pelo conteúdo; senão CSV. */
export function lerArquivo(bytes: Uint8Array, nomeArquivo: string): LeituraImport {
  if (bytes.length > IMPORT_BYTES_MAX) return { ok: false, erro: 'arquivo-grande' }
  const { texto, codificacao } = decodificar(bytes)
  if (extensao(nomeArquivo) === 'vcf' || /^\s*BEGIN:VCARD/i.test(texto)) {
    const { cartoes, entradas, ignorados } = lerVcard(texto)
    if (cartoes === 0) return { ok: false, erro: 'formato' }
    if (cartoes > IMPORT_LINHAS_MAX) return { ok: false, erro: 'linhas-demais' }
    return { ok: true, tipo: 'vcard', codificacao, entradas, previa: entradas.slice(0, IMPORT_PREVIA_LINHAS), total: cartoes, ignorados }
  }
  const { separador, colunas, linhas } = lerCsv(texto)
  if (colunas.length === 0) return { ok: false, erro: 'formato' }
  if (linhas.length > IMPORT_LINHAS_MAX) return { ok: false, erro: 'linhas-demais' }
  const mapeamento = mapearCabecalho(colunas)
  const { ignorados } = aplicarMapeamento(linhas, mapeamento)
  return { ok: true, tipo: 'csv', separador, codificacao, colunas, mapeamento, linhas, previa: linhas.slice(0, IMPORT_PREVIA_LINHAS), total: linhas.length, ignorados }
}
