import { Mail, MailOpen, Smartphone, Users } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { NotificacaoItem } from '@shared/notificacoes'
import { Icon } from '../../design/Icon'
import { emailTimeLabel } from '../email/format'
import { AVATAR_TONE_CLASSES, avatarInitials, avatarTone } from '../whatsapp/avatar-tone'

interface NotificacaoRowProps {
  item: NotificacaoItem
  onOpen: () => void
  /** Só nas linhas de e-mail. */
  onMarkRead?: () => void
  marking?: boolean
}

const QUADRADO_CLASS = 'flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)]'

/** O quadrado de 28 da origem: as iniciais na cor da conversa (o ícone de grupo num grupo) ou o contorno com o envelope. */
function Origem({ item }: { item: NotificacaoItem }) {
  if (item.kind === 'email') {
    return (
      <span aria-hidden="true" className={`${QUADRADO_CLASS} border border-line-strong bg-bg-raised text-text-muted`}>
        <Icon icon={Mail} size={14} />
      </span>
    )
  }
  if (item.chatId.endsWith('@g.us')) {
    return (
      <span aria-hidden="true" className={`${QUADRADO_CLASS} bg-bg-sunken text-text-muted`}>
        <Icon icon={Users} size={14} />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={`${QUADRADO_CLASS} text-11 font-bold ${AVATAR_TONE_CLASSES[avatarTone(item.chatId)]}`}>
      {avatarInitials(item.nome)}
    </span>
  )
}

/**
 * Uma linha de Notificações (mockup 01, escolhas D5 e D6): 44 px em duas linhas de texto, a origem à esquerda e a hora à
 * direita (no WhatsApp, "N não lidas" abaixo dela em --accent). A linha inteira é um botão; no e-mail, "Marcar como lida"
 * (ghost de 32) entra antes da hora no hover e no foco por teclado (da linha ou dele; contrato 171), fora do botão da linha
 * (botão não vai dentro de botão).
 */
export function NotificacaoRow({ item, onOpen, onMarkRead, marking = false }: NotificacaoRowProps) {
  const whatsapp = item.kind === 'whatsapp'
  const nome = whatsapp ? item.nome : item.de
  const marcar = (event: MouseEvent): void => {
    event.stopPropagation()
    onMarkRead?.()
  }
  return (
    <li className="group relative flex border-b border-line hover:border-transparent">
      <button
        type="button"
        data-notificacao={whatsapp ? `whatsapp:${item.chatId}` : `email:${item.accountId}:${item.id}`}
        onClick={onOpen}
        className="no-drag flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] group-focus-within:bg-bg-sunken hover:bg-bg-sunken focus-visible:outline-offset-[-2px]"
      >
        <Origem item={item} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-13 font-bold text-title">{nome}</span>
            {whatsapp && item.urgente && (
              <span data-notificacao-urgente className="flex h-5 shrink-0 items-center rounded-[var(--radius-control)] bg-accent px-1.5 text-11 font-medium text-on-accent">
                Urgente
              </span>
            )}
            <span className="flex shrink-0 items-center gap-1 text-12 whitespace-nowrap text-text-faint">
              <Icon icon={whatsapp ? Smartphone : Mail} size={14} />
              {whatsapp ? 'WhatsApp' : 'Email'}
            </span>
          </span>
          <span className="truncate text-12 text-text-muted">
            {whatsapp ? (
              item.previa
            ) : (
              <>
                {item.assunto || '(sem assunto)'} <span className="text-text-faint">· {item.conta}</span>
              </>
            )}
          </span>
        </span>
        <span className="flex w-24 shrink-0 flex-col items-end text-12 whitespace-nowrap tabular">
          <time dateTime={new Date(item.at).toISOString()} className={whatsapp ? 'text-accent' : 'text-text-faint'}>
            {emailTimeLabel(item.at)}
          </time>
          {whatsapp && (
            <span className="font-medium text-accent">
              {item.naoLidas} {item.naoLidas === 1 ? 'não lida' : 'não lidas'}
            </span>
          )}
        </span>
      </button>
      {/* À esquerda da coluna da hora: 8 de recuo + 96 da coluna + 10 de vão. */}
      {onMarkRead && (
        <button
          type="button"
          data-notificacao-lida
          onClick={marcar}
          disabled={marking}
          className={`no-drag absolute top-1/2 right-[114px] inline-flex h-8 -translate-y-1/2 items-center gap-1.5 rounded-[var(--radius-control)] bg-bg-sunken px-2.5 text-13 font-medium whitespace-nowrap text-title transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-line focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-50 ${marking ? '' : 'opacity-0'}`}
        >
          <Icon icon={MailOpen} className="text-text-muted" />
          Marcar como lida
        </button>
      )}
    </li>
  )
}
