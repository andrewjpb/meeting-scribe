// Textos do WhatsApp na tela (contrato 24): erros, horários e a linha da última mensagem.
import { mediaLabel, type WhatsAppChat, type WhatsAppError, type WhatsAppMessage } from '@shared/whatsapp'

export function whatsappErrorText(error: WhatsAppError | null): string | null {
  switch (error) {
    case 'python-missing':
      return 'Este Mac não tem o Python 3. Instale pelo Homebrew (brew install python) ou em python.org e tente de novo.'
    case 'python-old':
      return 'O Python 3 deste Mac é anterior ao 3.10. Instale uma versão nova pelo Homebrew (brew install python) ou em python.org.'
    case 'install-failed':
      return 'Não foi possível instalar. Confira a internet e tente de novo.'
    case 'libmagic':
      return 'Falta a libmagic, que o serviço usa. Instale no Terminal com brew install libmagic e clique em "Ligar".'
    case 'start-failed':
      return 'O serviço não ligou. Tente de novo; se continuar, use "Remover" e instale outra vez.'
    case 'service':
      return 'O serviço do WhatsApp parou de responder. Clique em "Ligar".'
    case 'risk':
      return 'Marque "Entendo o risco e quero continuar" para seguir.'
    case null:
      return null
  }
}

const two = (value: number): string => String(value).padStart(2, '0')

/** "14:05" hoje; "16/11" em outro dia. */
export function messageTimeLabel(at: number, now = new Date()): string {
  const date = new Date(at)
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  return sameDay ? `${two(date.getHours())}:${two(date.getMinutes())}` : `${two(date.getDate())}/${two(date.getMonth() + 1)}`
}

/** "14:05" sempre (dentro da conversa aberta). */
export function clockLabel(at: number): string {
  const date = new Date(at)
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Prévia da última mensagem na lista: o texto ou a mídia. */
export function previewText(message: WhatsAppMessage | null): string {
  if (!message) return 'Sem mensagens'
  const text = message.text.replace(/\s+/g, ' ').trim()
  const body = text || (message.media ? mediaLabel(message.media) : '')
  return message.fromMe ? `Você: ${body}` : body
}

/** Começo de uma sequência: a primeira mensagem ou outro autor que a anterior. */
export const startsRun = (message: WhatsAppMessage, previous: WhatsAppMessage | undefined): boolean => !previous || previous.fromMe !== message.fromMe || previous.author !== message.author

/** "+5511911110000" de uma conversa de pessoa (o número do `@lid`, quando o serviço sabe); `null` sem número. */
export function chatPhone(chat: Pick<WhatsAppChat, 'id' | 'kind' | 'phone'>): string | null {
  if (chat.kind === 'group') return null
  if (chat.phone) return chat.phone
  const [user = '', server = ''] = chat.id.split('@')
  return server === 's.whatsapp.net' && /^\d{6,15}$/.test(user) ? `+${user}` : null
}

/** Contrato 33: largura da janela (px) a partir da qual o painel Detalhes começa aberto. */
export const DETAILS_OPEN_MIN_WIDTH = 1280

/** Ao abrir a tela: Detalhes abertos com a janela larga, fechados abaixo. Depois vale a escolha da pessoa. */
export function detailsStartOpen(windowWidth: number): boolean {
  return windowWidth >= DETAILS_OPEN_MIN_WIDTH
}
