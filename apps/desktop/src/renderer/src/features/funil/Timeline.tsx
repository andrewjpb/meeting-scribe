import { GitCommitHorizontal, Mail, NotebookText, Smartphone, SquareCheck, StickyNote, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { EventoFunilTipo, ItemLinhaDoTempo } from '@shared/funil'
import { meetingPath, tarefasPath } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { useEmail } from '../email/emailStore'
import { dataHora, emailDestino, textoItemTarefa, whatsappDestino, type Destino } from './funilFormat'

/** O link de cada item: sublinhado em --accent, como o "Abrir resumo" do artboard 04. */
export const FUNIL_LINK_CLASS =
  'no-drag rounded-[var(--radius-control)] text-left font-medium text-accent underline decoration-1 underline-offset-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'

const EVENTO_ROTULO: Record<EventoFunilTipo, string> = {
  criada: 'Criada',
  etapa: 'Etapa',
  valor: 'Valor',
  'proximo-passo': 'Próximo passo',
  nota: 'Nota',
  vinculo: 'Vínculo',
  ganho: 'Ganho',
  perdido: 'Perdido',
  reaberta: 'Reaberta',
  tarefa: 'Tarefa',
}

/** O que cada linha mostra: ícone, rótulo do tipo, título, a linha de texto e o link (texto e destino). */
interface Linha {
  icon: LucideIcon
  rotulo: string
  titulo: string
  texto: string | null
  link: { texto: string; destino: Destino<unknown> } | null
}

function linhaDe(item: ItemLinhaDoTempo, sentMailbox: (accountId: string) => string | null): Linha | null {
  switch (item.tipo) {
    case 'reuniao':
      return {
        icon: NotebookText,
        rotulo: 'Reunião',
        titulo: item.titulo,
        texto: item.apagada ? null : item.resumo,
        link: item.apagada ? null : { texto: 'Abrir resumo', destino: { path: meetingPath(item.meetingId), state: null } },
      }
    case 'email': {
      const destino = emailDestino(item, sentMailbox(item.accountId))
      const texto = item.para ? `De ${item.de} para ${item.para}` : `De ${item.de}`
      return { icon: Mail, rotulo: 'E-mail', titulo: item.assunto || '(sem assunto)', texto, link: destino ? { texto: 'Abrir e-mail', destino } : null }
    }
    case 'whatsapp': {
      const destino = whatsappDestino([item.chatId])
      return { icon: Smartphone, rotulo: 'WhatsApp', titulo: item.nome, texto: item.ultimaMensagem, link: destino ? { texto: 'Abrir conversa', destino } : null }
    }
    case 'evento':
      return { icon: item.evento.tipo === 'nota' ? StickyNote : GitCommitHorizontal, rotulo: EVENTO_ROTULO[item.evento.tipo], titulo: item.evento.texto, texto: null, link: null }
    // Contrato 125 (R18): "Tarefa criada" ou "Tarefa concluída", a origem e o prazo; "Abrir tarefa" só se ela existe.
    case 'tarefa': {
      const { rotulo, linha } = textoItemTarefa(item)
      return { icon: SquareCheck, rotulo, titulo: item.titulo, texto: linha, link: item.existe ? { texto: 'Abrir tarefa', destino: { path: tarefasPath(item.tarefaId), state: null } } : null }
    }
    default:
      return null
  }
}

const chave = (item: ItemLinhaDoTempo, index: number): string => {
  switch (item.tipo) {
    case 'reuniao':
      return `reuniao:${item.meetingId}`
    case 'email':
      return `email:${item.accountId}:${item.messageId}`
    case 'whatsapp':
      return `whatsapp:${item.chatId}`
    case 'evento':
      return `evento:${item.evento.id}:${index}`
    case 'tarefa':
      return `tarefa:${item.tarefaId}:${item.acao}:${index}`
    default:
      return `item:${index}`
  }
}

interface TimelineProps {
  itens: readonly ItemLinhaDoTempo[]
  /** Uma linha por item, só com o ícone, "Tipo · título" e o dia (a ficha do contato e da empresa, artboard 05). */
  compacto?: boolean | undefined
}

/**
 * Linha do tempo do funil (contrato 119, R29; reaproveitada pelo 114): uma linha por item, na ordem em que veio (o main
 * já ordena por data decrescente). Reunião, e-mail e conversa levam ao resumo, ao e-mail (só se ainda estiver no cache)
 * e à conversa; a reunião que não existe mais aparece como "Reunião apagada", sem data e sem link. A tarefa (contrato
 * 125) leva a `/tarefas/<id>` enquanto existir.
 */
export function Timeline({ itens, compacto = false }: TimelineProps) {
  const navigate = useNavigate()
  const accounts = useEmail((state) => state.accounts)
  const sentMailbox = (accountId: string): string | null => accounts?.find((status) => status.account.id === accountId)?.sentMailbox ?? null
  const abrir = (destino: Destino<unknown>): void => void navigate(destino.path, destino.state === null ? undefined : { state: destino.state })

  return (
    <ol data-funil-timeline={compacto ? 'compacto' : ''} className="flex flex-col">
      {itens.map((item, index) => {
        const linha = linhaDe(item, sentMailbox)
        // Tipo que esta versão da tela não conhece: a linha fica vazia.
        if (linha === null) return null
        const apagada = item.tipo === 'reuniao' && item.apagada
        const data = item.at === null || apagada ? null : dataHora(item.at)
        const marcas = { 'data-funil-timeline-item': item.tipo, 'data-funil-timeline-apagada': apagada ? '' : undefined }
        // O link de uma tarefa leva o id dela (contrato 125).
        const tarefaId = item.tipo === 'tarefa' ? item.tarefaId : undefined
        if (compacto) {
          return (
            <li key={chave(item, index)} {...marcas} className="flex min-h-8 items-center gap-2.5 border-b border-line py-1.5 text-13">
              <Icon icon={linha.icon} className="shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-text" title={`${linha.rotulo} · ${linha.titulo}`}>
                {linha.rotulo} ·{' '}
                {linha.link ? (
                  <button type="button" data-funil-timeline-tarefa={tarefaId} className={FUNIL_LINK_CLASS} onClick={() => linha.link && abrir(linha.link.destino)}>
                    {linha.titulo}
                  </button>
                ) : (
                  linha.titulo
                )}
              </span>
              {data && <span className="shrink-0 text-12 text-text-faint tabular">{data.slice(0, 5)}</span>}
            </li>
          )
        }
        return (
          <li key={chave(item, index)} {...marcas} className="flex items-start gap-3 border-b border-line py-2.5">
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-text-muted">
              <Icon icon={linha.icon} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-11 font-medium text-text-muted">{linha.rotulo}</span>
                <span data-funil-timeline-titulo className="min-w-0 flex-1 truncate text-13 font-medium text-title" title={linha.titulo}>
                  {linha.titulo}
                </span>
                {data && <time className="shrink-0 text-12 whitespace-nowrap text-text-faint tabular">{data}</time>}
              </p>
              {linha.texto && <p className="truncate text-12 text-text-muted">{linha.texto}</p>}
              {linha.link && (
                <p className="text-12">
                  <button type="button" data-funil-timeline-link={item.tipo} data-funil-timeline-tarefa={tarefaId} className={FUNIL_LINK_CLASS} onClick={() => linha.link && abrir(linha.link.destino)}>
                    {linha.link.texto}
                  </button>
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
