// Arquivos de mídia na pasta da conversa do Assistente (contrato 149, ia-midia D1 e D5): a imagem, a figurinha e o PDF
// que as ferramentas de mídia baixam, e as transcrições e os textos de anexo que elas escrevem, para a IA abrir com o
// `Read` de sempre. Tudo aqui é do app:
// - o tipo sai dos primeiros bytes (PNG, JPEG, GIF, `RIFF…WEBP` e `%PDF`), nunca do tipo declarado por quem mandou: SVG,
//   HTML, Lottie com cara de figurinha ou qualquer outra coisa nunca é gravada como imagem;
// - o nome é `Midia - <fonte> - <hash>.<ext>`, com o hash da conversa e da mensagem (ou do email e do índice): nada de nome
//   de anexo nem de texto de mensagem no caminho;
// - gravação atômica, 0600, só na pasta da conversa; o prefixo próprio deixa a limpeza achar os arquivos (a pasta que
//   some, a fonte desligada, o "Sair"/"Remover" da conta) sem tocar nas fontes e nas reuniões;
// - o limite de mídias por pergunta (`createMediaBudget`) e a escolha de quais ferramentas a conversa recebe
//   (`mediaToolsFor`: só com a função ligada, a fonte ligada e o app desbloqueado).
// Nada daqui vai para log.
import { createHash, randomUUID } from 'node:crypto'
import { chmod, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ASSISTANT_MEDIA_PER_QUESTION_MAX } from '../../shared/assistant'
import type { AssistantTool } from './tools'

export const MEDIA_FILE_PREFIX = 'Midia - '
/** Contrato 165: `Pasta`, as cópias dos arquivos das pastas permitidas que o Assistente lê. */
export const MEDIA_SOURCES = ['WhatsApp', 'Email', 'Pasta'] as const
export type MediaSource = (typeof MEDIA_SOURCES)[number]
/** O que os bytes podem ser para virar arquivo de mídia. */
export type MediaFileKind = 'png' | 'jpg' | 'gif' | 'webp' | 'pdf'
/** Os textos que as ferramentas escrevem (transcrição, anexo de texto) também ficam como mídia. */
export type MediaFileExtension = MediaFileKind | 'md'

const MEDIA_FILE_PATTERN = /^Midia - (WhatsApp|Email|Pasta) - [0-9a-f]{16}\.(png|jpg|gif|webp|pdf|md)$/
/** O temporário de uma gravação interrompida (`<nome>.tmp-<pid>-<uuid>`): sai na limpeza junto com os arquivos. */
const MEDIA_TEMP_PATTERN = /^Midia - (WhatsApp|Email|Pasta) - [0-9a-f]{16}\.(png|jpg|gif|webp|pdf|md)\.tmp-[\w-]{1,100}$/

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean => bytes.length >= at + signature.length && signature.every((value, index) => bytes[at + index] === value)
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))

/**
 * O tipo pelos primeiros bytes: PNG, JPEG, GIF, WebP (`RIFF`, o tamanho, `WEBP` e um bloco `VP8 `, `VP8L` ou `VP8X`) ou
 * PDF (`%PDF-`). Qualquer outra coisa, `null`.
 */
export function sniffMedia(bytes: Uint8Array): MediaFileKind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8) && (startsWith(bytes, ascii('VP8 '), 12) || startsWith(bytes, ascii('VP8L'), 12) || startsWith(bytes, ascii('VP8X'), 12))) return 'webp'
  if (startsWith(bytes, ascii('%PDF-'))) return 'pdf'
  return null
}

/** "imagem" ou "PDF", para o passo e a resposta da ferramenta. */
export const mediaKindLabel = (kind: MediaFileKind): string => (kind === 'pdf' ? 'PDF' : 'imagem')
/** O passo da tela pelo que os bytes são: "Abrindo uma imagem" ou "Abrindo um PDF". */
export const openingLabel = (kind: MediaFileKind): string => (kind === 'pdf' ? 'Abrindo um PDF' : 'Abrindo uma imagem')

/** O hash curto de uma mídia (a fonte e a chave dela: conversa e mensagem, ou email e índice). */
export function mediaHash(source: MediaSource, key: string): string {
  return createHash('sha256').update(`${source}\n${key}`).digest('hex').slice(0, 16)
}

/** `Midia - WhatsApp - <hash>.<ext>`: o nome gerado pelo app, sem nada do que veio de fora. */
export function mediaFileName(source: MediaSource, key: string, extension: MediaFileExtension): string {
  return `${MEDIA_FILE_PREFIX}${source} - ${mediaHash(source, key)}.${extension}`
}

/** O arquivo é de mídia (de uma fonte, ou de qualquer uma)? */
export function isMediaFile(name: string, source?: MediaSource): boolean {
  const match = MEDIA_FILE_PATTERN.exec(name)
  return match !== null && (source === undefined || match[1] === source)
}

/** O arquivo já gravado desta mídia nesta pasta (a mesma mídia na mesma conversa não baixa de novo), ou `null`. */
export async function existingMediaFile(folder: string, source: MediaSource, key: string, extensions?: readonly MediaFileExtension[]): Promise<string | null> {
  const stem = `${MEDIA_FILE_PREFIX}${source} - ${mediaHash(source, key)}.`
  const names = await readdir(folder).catch(() => [] as string[])
  return names.find((name) => name.startsWith(stem) && isMediaFile(name, source) && (!extensions || extensions.some((extension) => name === `${stem}${extension}`))) ?? null
}

/** Grava na pasta da conversa (temporário + `rename`, 0600). O nome tem de ser um de `mediaFileName`. */
export async function writeMediaFile(folder: string, name: string, content: Uint8Array | string): Promise<void> {
  if (!isMediaFile(name)) throw new Error('nome de mídia inválido')
  const file = join(folder, name)
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temp, content, typeof content === 'string' ? { encoding: 'utf8', mode: 0o600 } : { mode: 0o600 })
  await rename(temp, file)
  await chmod(file, 0o600)
}

/** Apaga os arquivos de mídia de uma pasta (de uma fonte, ou todos), e os temporários que sobraram. Devolve quantos saíram. */
export async function clearMediaFiles(folder: string, source?: MediaSource): Promise<number> {
  let removed = 0
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    const temp = MEDIA_TEMP_PATTERN.exec(name)
    if (!isMediaFile(name, source) && !(temp && (source === undefined || temp[1] === source))) continue
    await rm(join(folder, name), { force: true })
    removed++
  }
  return removed
}

/**
 * Texto de terceiro (transcrição, anexo de texto) como citação: cada linha com `> `, sem cerca de código (``` vira ''')
 * e sem caractere de controle. Nunca abre seção nem bloco de ação ou de ferramenta.
 */
export function quotedMaterial(text: string): string[] {
  const clean = [...text]
    .map((char) => {
      const code = char.charCodeAt(0)
      return char === '\n' || char === '\t' ? char : code < 0x20 || code === 0x7f ? ' ' : char
    })
    .join('')
    .replace(/`{3,}/g, "'''")
    .trim()
  if (!clean) return ['> (vazio)']
  return clean.split('\n').map((line) => (line.trim() ? `> ${line}` : '>'))
}

/**
 * O nome que quem mandou deu ao arquivo (documento do WhatsApp, anexo do email), marcado como dado de terceiro: numa linha,
 * sem caractere de controle, crase, aspas nem as marcas « », cortado em 120.
 */
export function senderGivenName(name: string | null): string {
  const clean = [...(name ?? '')]
    .map((char) => (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f ? ' ' : char))
    .join('')
    .replace(/[`"«»]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return clean ? `nome dado por quem mandou: «${clean}»` : 'sem nome'
}

/** Tamanho legível para a resposta da ferramenta: "240 KB", "1,4 MB". */
export function sizeText(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'tamanho desconhecido'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

/** Contrato 149 (CA6): as mídias de cada pergunta (o turno do chat), sem contar duas vezes a mesma. */
export interface MediaBudget {
  /** Conta a mídia neste turno; `false` quando ela passaria do limite (e não conta). Sem turno, `false`. */
  take(turnId: string | undefined, key: string): boolean
}

/** Turnos lembrados (os mais antigos saem). */
const BUDGET_TURNS_MAX = 50

export function createMediaBudget(max = ASSISTANT_MEDIA_PER_QUESTION_MAX): MediaBudget {
  const turns = new Map<string, Set<string>>()
  return {
    take(turnId, key) {
      if (!turnId) return false
      let used = turns.get(turnId)
      if (!used) {
        used = new Set()
        turns.set(turnId, used)
        while (turns.size > BUDGET_TURNS_MAX) {
          const oldest = turns.keys().next().value
          if (oldest === undefined) break
          turns.delete(oldest)
        }
      }
      if (used.has(key)) return true
      if (used.size >= max) return false
      used.add(key)
      return true
    },
  }
}

/**
 * Contrato 149 (D4, CA7, CA9): as ferramentas de mídia que a conversa recebe agora: nenhuma com a função desligada ou o
 * app bloqueado; as do WhatsApp só com a fonte WhatsApp ligada; a do email só com a fonte Email ligada.
 */
export function mediaToolsFor(options: {
  enabled: boolean
  locked: boolean
  whatsapp: { on: boolean; tools: readonly AssistantTool[] }
  email: { on: boolean; tools: readonly AssistantTool[] }
}): AssistantTool[] {
  if (!options.enabled || options.locked) return []
  return [...(options.whatsapp.on ? options.whatsapp.tools : []), ...(options.email.on ? options.email.tools : [])]
}
