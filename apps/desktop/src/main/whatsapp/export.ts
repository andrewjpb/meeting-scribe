// Mensagens do WhatsApp como material de leitura do Claude (contrato 24, CA5): o `.md` de cada conversa escolhida
// no "Perguntar" (na pasta de escopo da conversa, com as mesmas permissões e a mesma limpeza do contrato 16) e as
// linhas do dia da reunião para o resumo e a análise, quando a pessoa liga a opção. Só leitura: nada daqui envia.
// A leitura nunca zera as não lidas (pede sempre com `before`).
//
// Contrato 25 (CA2): o Assistente lê sozinho as conversas com mensagem nos últimos 14 dias (até 40 conversas e
// 3 000 mensagens, as mais recentes primeiro), no mesmo formato e na mesma pasta, com o id da conversa, as não lidas,
// quem mandou a última e se você respondeu depois da última mensagem do outro lado ("pendente de resposta"), e um
// `CONVERSAS-WHATSAPP.md` com uma linha por conversa.
//
// Contrato 147 (R1): nos arquivos do Assistente, a mídia leva o id da mensagem ("[anexo: imagem · 120 KB · mídia <id>]")
// ou "indisponível" quando o serviço não guardou as chaves; o áudio já transcrito pelo botão da tela sai com o texto
// guardado ("[áudio transcrito: "…"]"), lido do `transcripts.json` sem rede. Os outros usos da linha (rascunho,
// Detalhes, atendimento, resumo de reunião) ganham a transcrição, mas não o id: eles não têm como abrir a mídia.
//
// Contrato 149: o cache do export guarda também a conversa e as mídias de cada arquivo; `exportedMedia` é o recorte que as
// ferramentas de mídia do Assistente conferem (a conversa e a mensagem têm de estar num arquivo da pasta da pergunta).
import { chmod, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  mediaLabel,
  WHATSAPP_EXPORT_MESSAGES_MAX,
  WHATSAPP_EXPORT_PREFIX,
  WHATSAPP_MESSAGE_ID_PATTERN,
  WHATSAPP_OVERVIEW_FILE,
  WHATSAPP_RECENT_CHATS_MAX,
  WHATSAPP_RECENT_DAYS,
  WHATSAPP_RECENT_MESSAGES_MAX,
  type WhatsAppChat,
  type WhatsAppMedia,
  type WhatsAppMessage,
} from '../../shared/whatsapp'
import type { BridgeClient } from './client'

const DAY_MS = 86_400_000
const PAGE = 200
const two = (value: number): string => String(value).padStart(2, '0')

/** "16/11 14:05", na hora local: o formato da citação "[<conversa> · dd/mm hh:mm]". */
export function stampLabel(at: number): string {
  const date = new Date(at)
  return `${two(date.getDate())}/${two(date.getMonth() + 1)} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** "2026-11-16 14:05", na hora local. */
export function fullStamp(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Texto numa linha, sem abrir seção falsa nem marca de fala. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^#+/, (marks) => marks.replace(/#/g, '＃'))
}

/** Contrato 147: a transcrição guardada vai até aqui na linha (o resto vira reticências). */
export const TRANSCRIPT_LINE_MAX = 2000

/** Contrato 147: as transcrições já guardadas (`transcripts.json`), só leitura e sem rede. */
export interface SavedTranscripts {
  get(chatId: string, messageId: string): Promise<string | null>
  /** Muda quando uma transcrição entra ou o arquivo sai: o export reescreve as conversas. */
  version?(): number
}

/** As transcrições guardadas dos áudios destas mensagens, por id. Só os áudios são procurados; falha vale como nenhuma. */
export async function savedTranscripts(messages: readonly WhatsAppMessage[], transcripts?: Pick<SavedTranscripts, 'get'>): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  if (!transcripts) return found
  for (const message of messages) {
    if (message.type !== 'audio' && message.media?.kind !== 'audio') continue
    const text = await transcripts.get(message.chatId, message.id).catch(() => null)
    if (text?.trim()) found.set(message.id, text)
  }
  return found
}

/** `[áudio transcrito: "texto"]`, numa linha, com as aspas trocadas e cortado em 2 000 caracteres. */
export function transcriptTag(text: string): string {
  const line = oneLine(text).replace(/"/g, "'")
  return `[áudio transcrito: "${line.length > TRANSCRIPT_LINE_MAX ? `${line.slice(0, TRANSCRIPT_LINE_MAX - 1)}…` : line}"]`
}

export interface MessageLineOptions {
  /** A transcrição guardada do áudio desta mensagem. */
  transcript?: string | null | undefined
  /** Só nos arquivos do Assistente: a mídia leva o id da mensagem (ou "indisponível"). */
  mediaId?: boolean | undefined
}

function mediaTag(message: WhatsAppMessage, options: MessageLineOptions): string {
  if (options.transcript?.trim()) return transcriptTag(options.transcript)
  if (!message.media) return ''
  if (!options.mediaId) return `[anexo: ${mediaLabel(message.media)}]`
  // Um id fora do padrão do serviço não entra na linha (não abre linha nem colchete falso): vale como indisponível.
  const available = message.media.downloadable !== false && WHATSAPP_MESSAGE_ID_PATTERN.test(message.id)
  return `[anexo: ${mediaLabel(message.media)} · ${available ? `mídia ${message.id}` : 'indisponível'}]`
}

/**
 * Uma mensagem: "[16/11 14:05] Ana: texto", com a mídia como "[anexo: imagem · 120 KB]" (no Assistente, com
 * "· mídia <id>") e o áudio já transcrito como "[áudio transcrito: "…"]".
 */
export function messageLine(message: WhatsAppMessage, options: MessageLineOptions = {}): string {
  const parts = [mediaTag(message, options), oneLine(message.text)].filter(Boolean)
  return `[${stampLabel(message.at)}] ${oneLine(message.author) || (message.fromMe ? 'Você' : 'Contato')}: ${parts.join(' ') || '(sem texto)'}`
}

/** Nome do arquivo de uma conversa: `WhatsApp - <nome> - <id sem caracteres estranhos>.md`. */
export function exportFileName(chat: Pick<WhatsAppChat, 'id' | 'name'>): string {
  const visible = [...chat.name].filter((char) => char.charCodeAt(0) >= 32).join('')
  const name = visible.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Conversa'
  const id = chat.id.replace(/[^\w-]/g, '_').slice(0, 80)
  return `${WHATSAPP_EXPORT_PREFIX}${name} - ${id}.md`
}

/** Quem mandou a última mensagem e se ela espera a sua resposta (a última é do outro lado). */
export interface ChatReplyState {
  lastFrom: string | null
  lastAt: number | null
  pending: boolean
}

/** A última mensagem da conversa (da lista ou das mensagens lidas): se é do outro lado, a resposta está pendente. */
export function replyState(chat: Pick<WhatsAppChat, 'lastMessage'>, messages: readonly WhatsAppMessage[] = []): ChatReplyState {
  const fromList = chat.lastMessage
  const fromRead = messages.at(-1) ?? null
  const last = fromRead && (!fromList || fromRead.at >= fromList.at) ? fromRead : fromList
  if (!last) return { lastFrom: null, lastAt: null, pending: false }
  return { lastFrom: last.fromMe ? 'Você' : oneLine(last.author) || 'Contato', lastAt: last.at, pending: !last.fromMe }
}

/** O `.md` de uma conversa para o Assistente: a mídia com o id da mensagem e os áudios com a transcrição guardada. */
export function chatMarkdown(
  chat: Pick<WhatsAppChat, 'id' | 'name' | 'kind'> & Partial<Pick<WhatsAppChat, 'unread' | 'lastMessage'>>,
  messages: readonly WhatsAppMessage[],
  days: number,
  transcripts: ReadonlyMap<string, string> = new Map(),
): string {
  const reply = replyState({ lastMessage: chat.lastMessage ?? null }, messages)
  const lines = [
    `# WhatsApp: ${oneLine(chat.name)}`,
    '',
    `- Conversa: ${chat.kind === 'group' ? 'grupo' : 'pessoa'}`,
    `- Id da conversa: ${chat.id}`,
    `- Período: últimos ${days} dias`,
    `- Mensagens: ${messages.length}`,
    ...(chat.unread !== undefined ? [`- Não lidas: ${chat.unread}`] : []),
    `- Última mensagem de: ${reply.lastFrom ?? 'ninguém'}${reply.lastAt !== null ? ` (${stampLabel(reply.lastAt)})` : ''}`,
    // Contrato 25: a data inteira, para o `INDICE.md` pôr a conversa mais recente primeiro.
    ...(reply.lastAt !== null ? [`- Data da última mensagem: ${fullStamp(reply.lastAt)}`] : []),
    `- Pendente de resposta: ${reply.pending ? 'sim' : 'não'}`,
    `- Citar como: [WhatsApp · ${oneLine(chat.name)} · dd/mm hh:mm]`,
    '',
    '## Mensagens',
    '',
    ...(messages.length ? messages.map((message) => messageLine(message, { transcript: transcripts.get(message.id), mediaId: true })) : ['Nenhuma mensagem no período.']),
  ]
  return `${lines.join('\n')}\n`
}

/** Mensagens de uma conversa de `since` até agora, as mais recentes, até `max`, da mais antiga para a mais nova. */
export async function recentMessages(client: Pick<BridgeClient, 'messages'>, chatId: string, since: number, max: number, until = Date.now() + 1): Promise<WhatsAppMessage[]> {
  const collected: WhatsAppMessage[] = []
  // Cursor (hora, id): mensagens no mesmo milissegundo não se perdem entre as páginas.
  let cursor: { before: number; beforeId?: string } = { before: until }
  while (collected.length < max) {
    const limit = Math.min(PAGE, max - collected.length)
    const page = await client.messages(chatId, { ...cursor, limit })
    collected.unshift(...page.filter((message) => message.at >= since && message.at < until))
    const oldest = page[0]
    if (!oldest || oldest.at < since || page.length < limit) break
    cursor = { before: oldest.at, beforeId: oldest.id }
  }
  return collected.slice(-max)
}

/** Conversas lidas ao mesmo tempo do serviço (o `messages()` de cada uma). */
export const EXPORT_PARALLEL = 4

/** Contrato 149: uma mídia que está num arquivo exportado (o que a ferramenta do Assistente pode pedir). */
export interface ExportedMedia {
  kind: WhatsAppMedia['kind']
  /** O tipo declarado por quem mandou: só orienta (o que a mídia é, decidem os bytes). */
  mime: string | null
  size: number | null
  seconds: number | null
  /** O nome do documento, como veio: só para a resposta da ferramenta, nunca para nome de arquivo nem log. */
  name: string | null
  downloadable: boolean
  author: string
  at: number
}

/** Contrato 149: a conversa e a mídia de um arquivo exportado para a pasta. */
export interface ExportedChatMedia {
  chatName: string
  media: ExportedMedia
}

/**
 * O que já foi exportado em cada pasta: por arquivo, a chave (a última mensagem, as não lidas, o período e o dia), a
 * parte das mensagens pedida e quantas vieram. Mesma chave, o arquivo lá e o mesmo resultado com a parte de agora (a
 * mesma parte, ou a conversa coube inteira e ainda cabe): a conversa não é lida de novo. Contrato 149: e a conversa e as
 * mídias que o arquivo traz (o recorte que as ferramentas de mídia conferem).
 */
export type ExportCache = Map<string, Map<string, ExportCacheEntry>>
export interface ExportCacheEntry {
  key: string
  share: number
  count: number
  chatId?: string | undefined
  chatName?: string | undefined
  media?: ReadonlyMap<string, ExportedMedia> | undefined
}

/** Contrato 149: as mídias das mensagens de um arquivo, por id da mensagem. */
function exportedMediaOf(messages: readonly WhatsAppMessage[]): Map<string, ExportedMedia> {
  const found = new Map<string, ExportedMedia>()
  for (const message of messages) {
    if (!message.media || !WHATSAPP_MESSAGE_ID_PATTERN.test(message.id)) continue
    found.set(message.id, {
      kind: message.media.kind,
      mime: message.media.mime,
      size: message.media.size,
      seconds: message.media.seconds ?? null,
      name: message.media.name,
      downloadable: message.media.downloadable !== false,
      author: message.fromMe ? 'Você' : oneLine(message.author) || 'Contato',
      at: message.at,
    })
  }
  return found
}

/**
 * Contrato 149 (CA5): a mídia de uma conversa, se ela está num arquivo exportado para esta pasta e o arquivo ainda está lá
 * (o mesmo conjunto que `writeSources` deixou para a pergunta). Fora disso, `null`.
 */
export async function exportedMedia(cache: ExportCache, folder: string, chatId: string, messageId: string): Promise<ExportedChatMedia | null> {
  const known = cache.get(folder)
  if (!known) return null
  const present = new Set(await readdir(folder).catch(() => [] as string[]))
  for (const [file, entry] of known) {
    if (entry.chatId !== chatId || !present.has(file)) continue
    const media = entry.media?.get(messageId)
    if (media) return { chatName: entry.chatName ?? '', media }
  }
  return null
}

/** O que a exportação leu: os arquivos (os de agora, mantidos ou reescritos) e a lista das conversas. */
export interface ExportResult {
  files: string[]
  chats: WhatsAppChat[]
  /** Conversas lidas de novo (as outras ficaram como estavam). */
  read: number
}

async function writeFileAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
  await chmod(file, 0o600)
}

/** Grava só se o conteúdo mudou; `true` se gravou. */
export async function writeIfChanged(file: string, content: string): Promise<boolean> {
  const current = await readFile(file, 'utf8').catch(() => null)
  if (current === content) return false
  await writeFileAtomic(file, content)
  return true
}

/** Roda `work` em cada item, no máximo `limit` ao mesmo tempo, na ordem dos resultados. */
async function inParallel<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const at = next++
      results[at] = await work(items[at] as T)
    }
  })
  await Promise.all(lanes)
  return results
}

const dayKey = (at: number): string => fullStamp(at).slice(0, 10)

/**
 * Um `.md` por conversa, as mensagens de `days` dias com até `share` cada, lidas `EXPORT_PARALLEL` por vez. Com o
 * cache, a conversa sem mensagem nova desde o último export (o mesmo `lastMessage` da lista), no mesmo dia, fica
 * como está; as que saíram da lista não são apagadas aqui (quem chama remove o que sobrou).
 */
async function exportSet(
  client: Pick<BridgeClient, 'messages'>,
  folder: string,
  chats: readonly WhatsAppChat[],
  days: number,
  share: number,
  now: number,
  cache?: ExportCache,
  transcripts?: SavedTranscripts,
): Promise<{ files: string[]; read: number }> {
  const known = cache ? (cache.get(folder) ?? new Map<string, ExportCacheEntry>()) : null
  if (cache && known) cache.set(folder, known)
  const present = new Set(await readdir(folder).catch(() => [] as string[]))
  let read = 0
  const files = await inParallel(chats, EXPORT_PARALLEL, async (chat) => {
    const name = exportFileName(chat)
    // Contrato 147: uma transcrição nova (ou o arquivo apagado) também reescreve a conversa.
    const key = `${chat.lastMessage?.at ?? 0}:${chat.lastMessage?.id ?? ''}:${chat.unread}:${days}:${dayKey(now)}:${transcripts?.version?.() ?? 0}`
    const before = known?.get(name)
    const same = before !== undefined && before.key === key && (before.share === share || (before.count < before.share && before.count <= share))
    if (same && present.has(name)) return name
    const messages = await recentMessages(client, chat.id, now - days * DAY_MS, share, now + 1)
    read++
    await writeFileAtomic(join(folder, name), chatMarkdown(chat, messages, days, await savedTranscripts(messages, transcripts)))
    known?.set(name, { key, share, count: messages.length, chatId: chat.id, chatName: chat.name, media: exportedMediaOf(messages) })
    return name
  })
  return { files, read }
}

/**
 * Escreve na pasta de escopo um `.md` por conversa escolhida (até 10), dos últimos `days` dias, com no máximo
 * 2 000 mensagens no total (divididas entre as conversas). Devolve os nomes escritos.
 */
export async function exportChats(
  client: Pick<BridgeClient, 'messages' | 'chats'>,
  folder: string,
  chatIds: readonly string[],
  days: number,
  now = Date.now(),
  cache?: ExportCache,
  list?: readonly WhatsAppChat[],
  transcripts?: SavedTranscripts,
): Promise<string[]> {
  if (!chatIds.length) return []
  const known = new Map((list ?? (await client.chats())).map((chat) => [chat.id, chat]))
  const chosen = chatIds.flatMap((id) => {
    const chat = known.get(id)
    return chat ? [chat] : []
  })
  if (!chosen.length) return []
  return (await exportSet(client, folder, chosen, days, Math.floor(WHATSAPP_EXPORT_MESSAGES_MAX / chosen.length), now, cache, transcripts)).files
}

/** Uma linha do `CONVERSAS-WHATSAPP.md`. */
export function overviewLine(chat: WhatsAppChat, reply: ChatReplyState, file: string): string {
  const last = chat.lastMessage ? oneLine(chat.lastMessage.text || (chat.lastMessage.media ? `[anexo: ${mediaLabel(chat.lastMessage.media)}]` : '')) : ''
  const preview = last.length > 120 ? `${last.slice(0, 119)}…` : last
  return [
    `- ${oneLine(chat.name)}`,
    chat.kind === 'group' ? 'grupo' : 'pessoa',
    `id: ${chat.id}`,
    `não lidas: ${chat.unread}`,
    `última de: ${reply.lastFrom ?? 'ninguém'}${reply.lastAt !== null ? ` em ${stampLabel(reply.lastAt)}` : ''}`,
    `pendente de resposta: ${reply.pending ? 'sim' : 'não'}`,
    `última mensagem: "${preview.replace(/"/g, "'")}"`,
    `arquivo: ${file}`,
  ].join(' · ')
}

/**
 * As conversas com mensagem nos últimos 14 dias (até 40, as mais recentes primeiro), com até 3 000 mensagens no total
 * divididas entre elas, e o `CONVERSAS-WHATSAPP.md`. Uma leitura só da lista (`chats()`, devolvida para os cartões);
 * com o cache, só as conversas com mensagem nova são lidas e reescritas. Devolve os nomes (o resumo por último).
 */
export async function exportRecentWith(client: Pick<BridgeClient, 'messages' | 'chats'>, folder: string, now = Date.now(), cache?: ExportCache, transcripts?: SavedTranscripts): Promise<ExportResult> {
  const since = now - WHATSAPP_RECENT_DAYS * DAY_MS
  const all = await client.chats()
  const chosen = all
    .filter((chat) => chat.lastMessage !== null && chat.lastMessage.at >= since)
    .sort((a, b) => (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0))
    .slice(0, WHATSAPP_RECENT_CHATS_MAX)
  if (!chosen.length) return { files: [], chats: all, read: 0 }
  const share = Math.max(1, Math.floor(WHATSAPP_RECENT_MESSAGES_MAX / chosen.length))
  const { files, read } = await exportSet(client, folder, chosen, WHATSAPP_RECENT_DAYS, share, now, cache, transcripts)
  const lines = chosen.map((chat, at) => overviewLine(chat, replyState(chat), files[at] ?? exportFileName(chat)))
  const pending = lines.filter((line) => line.includes(' · pendente de resposta: sim · ')).length
  const overview = [
    `# Conversas do WhatsApp (últimos ${WHATSAPP_RECENT_DAYS} dias)`,
    '',
    `Uma linha por conversa, da mais recente para a mais antiga: nome · tipo · id · não lidas · quem mandou a última · pendente de resposta · a última mensagem · arquivo. "Pendente de resposta: sim" quer dizer que a última mensagem é do outro lado (você não respondeu depois dela). ${pending} de ${lines.length} pendentes.`,
    '',
    ...lines,
  ]
  await writeIfChanged(join(folder, WHATSAPP_OVERVIEW_FILE), `${overview.join('\n')}\n`)
  return { files: [...files, WHATSAPP_OVERVIEW_FILE], chats: all, read }
}

/** `exportRecentWith`, só os nomes (o contrato 25 sem cache). */
export async function exportRecent(client: Pick<BridgeClient, 'messages' | 'chats'>, folder: string, now = Date.now(), cache?: ExportCache, transcripts?: SavedTranscripts): Promise<string[]> {
  return (await exportRecentWith(client, folder, now, cache, transcripts)).files
}

/**
 * As mensagens do dia (local) de `startedAt` numa conversa, até 500, como linhas para o resumo e a análise. Contrato
 * 147: com a transcrição guardada dos áudios, sem o id da mídia.
 */
export async function dayLines(client: Pick<BridgeClient, 'messages'>, chatId: string, startedAt: string, transcripts?: Pick<SavedTranscripts, 'get'>): Promise<string[]> {
  const start = new Date(startedAt)
  if (Number.isNaN(start.getTime())) return []
  const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const messages = await recentMessages(client, chatId, dayStart, 500, dayStart + DAY_MS)
  const saved = await savedTranscripts(messages, transcripts)
  return messages.map((message) => {
    const date = new Date(message.at)
    return messageLine(message, { transcript: saved.get(message.id) }).replace(/^\[[^\]]+\]/, `[${two(date.getHours())}:${two(date.getMinutes())}]`)
  })
}
