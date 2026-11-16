// Nomes dos arquivos da reunião na pasta escolhida (contrato 07, CA5): `AAAA-MM-DD HHhMM - <título>`,
// com o título limpo do que o macOS não aceita. Funções puras; quem confere o disco é `service.ts`.
import { basename, dirname, resolve } from 'node:path'

/** Tamanho máximo do título dentro do nome do arquivo. */
export const FILE_TITLE_MAX = 80
/** Título que sobra vazio depois da limpeza. */
const FALLBACK_TITLE = 'Reunião'
/** Sufixo do arquivo que ficou pela metade (app fechado ou travado no meio, CA7). */
export const INCOMPLETE_SUFFIX = ' (incompleto)'
export const PART_SUFFIX = '.part'

const two = (value: number): string => String(value).padStart(2, '0')

/**
 * Título pronto para nome de arquivo: sem `/` e `:` (proibidos no macOS e no Finder), sem caractere de
 * controle, sem ponto no começo (arquivo oculto), espaços juntados e até 80 caracteres.
 */
export function cleanFileTitle(title: string): string {
  const cleaned = [...title.normalize('NFC')]
    .map((char) => (char === '/' || char === ':' ? '-' : char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim()
  const cut = [...cleaned].slice(0, FILE_TITLE_MAX).join('').replace(/[\s.]+$/, '')
  return cut || FALLBACK_TITLE
}

/** `2026-11-15 14h05 - Planejamento`, na hora local de início. */
export function meetingFileBase(startedAt: Date, title: string): string {
  const date = `${startedAt.getFullYear()}-${two(startedAt.getMonth() + 1)}-${two(startedAt.getDate())}`
  const time = `${two(startedAt.getHours())}h${two(startedAt.getMinutes())}`
  return `${date} ${time} - ${cleanFileTitle(title)}`
}

/** `base`, `base (2)`, `base (3)`… o primeiro que `taken` não recusar. */
export function uniqueBase(base: string, taken: (candidate: string) => boolean): string {
  if (!taken(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!taken(candidate)) return candidate
  }
}

/**
 * Caminho de `name` dentro de `folder`, só se o nome for um nome simples (sem `/`, sem `..`) e o caminho
 * resolvido cair exatamente dentro da pasta. Qualquer outra coisa lança erro: o main nunca escreve fora.
 */
export function insideFolder(folder: string, name: string): string {
  const root = resolve(folder)
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) throw new Error('nome de arquivo inválido')
  const target = resolve(root, name)
  if (dirname(target) !== root || basename(target) !== name) throw new Error('arquivo fora da pasta')
  return target
}

/** Arquivo que o app deixou pela metade: `<AAAA-MM-DD HHhMM - título>.<m4a|webm|md>.part`. */
const PART_PATTERN = /^(\d{4}-\d{2}-\d{2} \d{2}h\d{2} - .+)\.(m4a|webm|md)\.part$/

/** Nome final de um `.part` recuperado: `<base> (incompleto).<ext>`; `null` se não é um arquivo do app. */
export function incompleteName(partName: string): { base: string; extension: string } | null {
  const match = PART_PATTERN.exec(partName)
  if (!match?.[1] || !match[2]) return null
  return { base: `${match[1]}${INCOMPLETE_SUFFIX}`, extension: match[2] }
}
