// Mensagens do WhatsApp como material de leitura do Claude (contrato 24, CA5): o `.md` de cada conversa escolhida
// no "Perguntar" (na pasta de escopo da conversa, com as mesmas permissões e a mesma limpeza do contrato 16) e as
// linhas do dia da reunião para o resumo e a análise, quando a pessoa liga a opção. Só leitura: nada daqui envia.
// A leitura nunca zera as não lidas (pede sempre com `before`).
import { chmod, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mediaLabel, WHATSAPP_EXPORT_MESSAGES_MAX, WHATSAPP_EXPORT_PREFIX, type WhatsAppChat, type WhatsAppMessage } from '../../shared/whatsapp'
import type { BridgeClient } from './client'

const DAY_MS = 86_400_000
const PAGE = 200
const two = (value: number): string => String(value).padStart(2, '0')

/** "16/11 14:05", na hora local: o formato da citação "[<conversa> · dd/mm hh:mm]". */
export function stampLabel(at: number): string {
  const date = new Date(at)
  return `${two(date.getDate())}/${two(date.getMonth() + 1)} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Texto numa linha, sem abrir seção falsa nem marca de fala. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^#+/, (marks) => marks.replace(/#/g, '＃'))
}

/** Uma mensagem: "[16/11 14:05] Ana: texto", com a mídia como "[anexo: imagem · 120 KB]". */
export function messageLine(message: WhatsAppMessage): string {
  const parts = [message.media ? `[anexo: ${mediaLabel(message.media)}]` : '', oneLine(message.text)].filter(Boolean)
  return `[${stampLabel(message.at)}] ${oneLine(message.author) || (message.fromMe ? 'Você' : 'Contato')}: ${parts.join(' ') || '(sem texto)'}`
}

/** Nome do arquivo de uma conversa: `WhatsApp - <nome> - <id sem caracteres estranhos>.md`. */
export function exportFileName(chat: Pick<WhatsAppChat, 'id' | 'name'>): string {
  const visible = [...chat.name].filter((char) => char.charCodeAt(0) >= 32).join('')
  const name = visible.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Conversa'
  const id = chat.id.replace(/[^\w-]/g, '_').slice(0, 80)
  return `${WHATSAPP_EXPORT_PREFIX}${name} - ${id}.md`
}

export function chatMarkdown(chat: Pick<WhatsAppChat, 'id' | 'name' | 'kind'>, messages: readonly WhatsAppMessage[], days: number): string {
  const lines = [
    `# WhatsApp: ${oneLine(chat.name)}`,
    '',
    `- Conversa: ${chat.kind === 'group' ? 'grupo' : 'pessoa'}`,
    `- Período: últimos ${days} dias`,
    `- Mensagens: ${messages.length}`,
    `- Citar como: [${oneLine(chat.name)} · dd/mm hh:mm]`,
    '',
    '## Mensagens',
    '',
    ...(messages.length ? messages.map(messageLine) : ['Nenhuma mensagem no período.']),
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

/**
 * Escreve na pasta de escopo um `.md` por conversa escolhida (até 10), dos últimos `days` dias, com no máximo
 * 2 000 mensagens no total (divididas entre as conversas). Devolve os nomes escritos.
 */
export async function exportChats(client: Pick<BridgeClient, 'messages' | 'chats'>, folder: string, chatIds: readonly string[], days: number, now = Date.now()): Promise<string[]> {
  if (!chatIds.length) return []
  const known = new Map((await client.chats()).map((chat) => [chat.id, chat]))
  const chosen = chatIds.flatMap((id) => {
    const chat = known.get(id)
    return chat ? [chat] : []
  })
  if (!chosen.length) return []
  const share = Math.floor(WHATSAPP_EXPORT_MESSAGES_MAX / chosen.length)
  const since = now - days * DAY_MS
  const written: string[] = []
  for (const chat of chosen) {
    const messages = await recentMessages(client, chat.id, since, share, now + 1)
    const name = exportFileName(chat)
    const file = join(folder, name)
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, chatMarkdown(chat, messages, days), { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
    await chmod(file, 0o600)
    written.push(name)
  }
  return written
}

/** As mensagens do dia (local) de `startedAt` numa conversa, até 500, como linhas para o resumo e a análise. */
export async function dayLines(client: Pick<BridgeClient, 'messages'>, chatId: string, startedAt: string): Promise<string[]> {
  const start = new Date(startedAt)
  if (Number.isNaN(start.getTime())) return []
  const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const messages = await recentMessages(client, chatId, dayStart, 500, dayStart + DAY_MS)
  return messages.map((message) => {
    const date = new Date(message.at)
    return messageLine(message).replace(/^\[[^\]]+\]/, `[${two(date.getHours())}:${two(date.getMinutes())}]`)
  })
}
