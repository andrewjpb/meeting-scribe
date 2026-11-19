// Notificações de email (contrato 43, CA4), no desenho das do WhatsApp (contrato 40) e sem relógio nem Electron: cada
// email novo entra com as configurações, o bloqueio e se a pessoa já está olhando (janela em foco com a Caixa de
// Entrada daquela conta aberta); sai a notificação a mostrar, ou nada. Quem mostra é injetado (`ShowEmailNotice`): no
// app, a `Notification` do Electron; nos testes e no smoke, um substituto que registra. Tudo é local.
import { isInbox, type EmailAccount, type EmailMessage } from '../../shared/email'
import { BURST_MIN, BURST_WINDOW_MS, clip, type NoticeHandle } from '../whatsapp/notify'

export { BURST_MIN, BURST_WINDOW_MS, NOTICE_BODY_MAX } from '../whatsapp/notify'

export interface IncomingEmail {
  message: EmailMessage
  /** A conta que recebeu: o email dela mesma (enviado de outro programa e copiado na INBOX) não notifica. */
  account: Pick<EmailAccount, 'id' | 'address'>
  /** `emailNotifications`: desligado, nada sai. */
  enabled: boolean
  /** A janela do app está em foco com a Caixa de Entrada desta conta aberta. */
  viewing: boolean
  /** App bloqueado (contrato 22): sem o assunto. */
  locked: boolean
}

export interface EmailNotice {
  accountId: string
  /** A mensagem que o clique abre (na rajada, a última). */
  id: string
  title: string
  body: string
  /** Quantos emails a notificação resume (1, ou 3 ou mais numa rajada). */
  count: number
}

export type ShowEmailNotice = (notice: EmailNotice) => NoticeHandle

/** Quem mandou, como a notificação mostra: o nome, ou o endereço sem nome. */
export function senderName(message: Pick<EmailMessage, 'from'>): string {
  const from = message.from[0]
  if (!from) return 'Remetente desconhecido'
  return (from.name ?? '').replace(/\s+/g, ' ').trim() || from.address
}

/** Corpo: o assunto (≤140), ou "(sem assunto)". */
export function emailNoticeBody(message: Pick<EmailMessage, 'subject'>): string {
  return clip(message.subject.replace(/\s+/g, ' ').trim() || '(sem assunto)')
}

/** Notifica? Nada desligado; nunca o que saiu da própria conta; nada com a Caixa de Entrada já à vista. */
export function shouldNotifyEmail(input: IncomingEmail): boolean {
  if (!input.enabled || !isInbox(input.message)) return false
  const own = input.account.address.toLowerCase()
  if (input.message.from.some((item) => item.address.toLowerCase() === own)) return false
  // Bloqueado, a tela fica coberta: avisa, sem o assunto.
  return input.locked || !input.viewing
}

interface Burst {
  first: number
  count: number
  handles: NoticeHandle[]
}

export interface EmailNotifier {
  receive(input: IncomingEmail): EmailNotice | null
}

/**
 * O notificador, com a memória das rajadas por remetente (dentro da conta). Até o segundo email de Fulano em 5 s, uma
 * notificação por email; do terceiro em diante, as anteriores saem e fica uma só, "3 emails de Fulano". Bloqueado, o
 * título é o nome do app e o corpo só diz de quem é ("Email de Fulano").
 */
export function createEmailNotifier(deps: { show: ShowEmailNotice; appName: () => string; now: () => number }): EmailNotifier {
  const bursts = new Map<string, Burst>()
  return {
    receive(input) {
      if (!shouldNotifyEmail(input)) return null
      const { message, locked } = input
      const now = deps.now()
      for (const [key, burst] of bursts) if (now - burst.first > BURST_WINDOW_MS) bursts.delete(key)
      const key = `${input.account.id}\n${(message.from[0]?.address ?? '').toLowerCase()}`
      let burst = bursts.get(key)
      if (!burst) {
        burst = { first: now, count: 0, handles: [] }
        bursts.set(key, burst)
      }
      burst.count++
      const who = senderName(message)
      const count = burst.count >= BURST_MIN ? burst.count : 1
      const base = { accountId: input.account.id, id: message.id, count }
      const notice: EmailNotice =
        count > 1
          ? { ...base, title: locked ? deps.appName() : who, body: `${count} emails de ${who}` }
          : locked
            ? { ...base, title: deps.appName(), body: `Email de ${who}` }
            : { ...base, title: who, body: emailNoticeBody(message) }
      if (count > 1) {
        for (const handle of burst.handles) handle.close()
        burst.handles = []
      }
      burst.handles.push(deps.show(notice))
      return notice
    },
  }
}
