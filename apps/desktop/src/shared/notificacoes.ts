// Centro de notificações (contrato 160): as conversas do WhatsApp com não lidas e os e-mails não lidos da Caixa de
// Entrada de todas as contas, numa lista só, da mais nova para a mais antiga. Tudo sai dos stores que o renderer já
// sincroniza; aqui ficam só as regras puras, testadas em test/renderer/notificacoes-logic.test.ts.
import { isInbox, type EmailMessage } from './email'
import type { Etiqueta } from './triagem'
import type { WhatsAppChat, WhatsAppMessage, WhatsAppMessageType } from './whatsapp'

export type NotificacaoItem =
  | { kind: 'whatsapp'; chatId: string; nome: string; previa: string; at: number; naoLidas: number; urgente: boolean }
  | { kind: 'email'; accountId: string; id: string; de: string; assunto: string; at: number; conta: string }

export type NotificacoesFiltro = 'todas' | 'whatsapp' | 'email'

export interface NotificacoesContagem {
  total: number
  /** A soma das não lidas das conversas. */
  whatsapp: number
  /** Os e-mails (um por linha). */
  email: number
}

export interface NotificacoesInput {
  chats: readonly WhatsAppChat[]
  /** `whatsappNotifyGroups` das Configurações: sem ele, só as conversas de pessoa. */
  incluirGrupos: boolean
  /** Por `chatId` (contrato 159); o `urgente` da linha sai daqui. */
  etiquetas: Readonly<Record<string, Etiqueta>>
  contas: readonly { id: string; label: string }[]
  /** Por `<accountId>:<pasta>`, como em `emailStore.folders`; só a `<id>:inbox` de cada conta conta. */
  folders: Readonly<Record<string, readonly EmailMessage[] | undefined>>
}

/** A lista inteira, da mais nova para a mais antiga, misturando as duas origens. */
export function montarNotificacoes(input: NotificacoesInput): NotificacaoItem[] {
  const whatsapp: NotificacaoItem[] = input.chats
    .filter((chat) => chat.unread > 0 && (chat.kind !== 'group' || input.incluirGrupos))
    .map((chat) => ({
      kind: 'whatsapp',
      chatId: chat.id,
      nome: chat.name,
      previa: previaDaMensagem(chat.lastMessage),
      at: chat.lastMessage?.at ?? 0,
      naoLidas: chat.unread,
      urgente: input.etiquetas[chat.id]?.urgente === true,
    }))
  const email: NotificacaoItem[] = input.contas.flatMap((conta) =>
    (input.folders[`${conta.id}:inbox`] ?? [])
      .filter((message) => isInbox(message) && !message.seen)
      .map((message) => ({
        kind: 'email' as const,
        accountId: conta.id,
        id: message.id,
        de: remetente(message),
        assunto: message.subject.replace(/\s+/g, ' ').trim(),
        at: message.date,
        conta: conta.label,
      })),
  )
  return [...whatsapp, ...email].sort((a, b) => b.at - a.at)
}

export function filtrarNotificacoes(items: readonly NotificacaoItem[], filtro: NotificacoesFiltro): NotificacaoItem[] {
  return filtro === 'todas' ? [...items] : items.filter((item) => item.kind === filtro)
}

export function contarNotificacoes(items: readonly NotificacaoItem[]): NotificacoesContagem {
  let whatsapp = 0
  let email = 0
  for (const item of items) {
    if (item.kind === 'whatsapp') whatsapp += item.naoLidas
    else email += 1
  }
  return { total: whatsapp + email, whatsapp, email }
}

const mensagens = (n: number): string => `${n} ${n === 1 ? 'mensagem' : 'mensagens'} no WhatsApp`
const emails = (n: number): string => `${n} ${n === 1 ? 'e-mail' : 'e-mails'}`

/** "7 por ler: 5 mensagens no WhatsApp e 2 e-mails."; uma origem só: "2 e-mails por ler."; nada: "Nada por ler." */
export function resumoNotificacoes(c: NotificacoesContagem): string {
  if (c.whatsapp > 0 && c.email > 0) return `${c.total} por ler: ${mensagens(c.whatsapp)} e ${emails(c.email)}.`
  if (c.whatsapp > 0) return `${mensagens(c.whatsapp)} por ler.`
  if (c.email > 0) return `${emails(c.email)} por ler.`
  return 'Nada por ler.'
}

// Os mesmos nomes de `MEDIA_LABELS` de whatsapp.ts (que não é exportado), pelo tipo da mensagem.
const MIDIA: Readonly<Record<WhatsAppMessageType, string>> = {
  text: '',
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  document: 'documento',
  sticker: 'figurinha',
  other: 'anexo',
}

/** A última mensagem numa linha só: o texto, ou a mídia sem texto entre colchetes ("[imagem]"); sem mensagem, nada. */
export function previaDaMensagem(m: WhatsAppMessage | null): string {
  if (!m) return ''
  const texto = m.text.replace(/\s+/g, ' ').trim()
  if (texto) return texto
  const midia = MIDIA[m.type] || (m.media ? MIDIA[m.media.kind] : '')
  return midia ? `[${midia}]` : ''
}

function remetente(message: Pick<EmailMessage, 'from'>): string {
  const from = message.from[0]
  if (!from) return 'Remetente desconhecido'
  return (from.name ?? '').replace(/\s+/g, ' ').trim() || from.address
}
