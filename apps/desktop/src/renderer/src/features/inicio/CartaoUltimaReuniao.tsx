import { Link } from 'react-router'
import { meetingPath } from '@shared/routes'
import type { MeetingOverview } from '@shared/meetings-overview'
import { durationLabel } from '../meetings/format'
import { INICIO_CARTAO_CABECALHO_CLASS, INICIO_CARTAO_CLASS, INICIO_CARTAO_TITULO_CLASS, INICIO_LINK_CLASS, textoQuandoFoi } from './inicioFormat'

/**
 * Última reunião (D9, artboard 01): a primeira da lista de Reuniões (`useMeetingsOverview`, da mais nova para a mais
 * antiga), com a data, a duração e a primeira frase do resumo; "Abrir" leva ao detalhe. Sem reunião, o cartão não aparece.
 */
export function CartaoUltimaReuniao({ reunioes, agora }: { reunioes: readonly MeetingOverview[] | null; agora: number }) {
  const ultima = reunioes?.[0]
  if (!ultima) return null
  const { meeting, summary } = ultima
  return (
    <section data-inicio-cartao="ultima-reuniao" aria-label="Última reunião" className={INICIO_CARTAO_CLASS}>
      <header className={INICIO_CARTAO_CABECALHO_CLASS}>
        <h2 className={INICIO_CARTAO_TITULO_CLASS}>Última reunião</h2>
        <span className="flex-1" />
        <Link to={meetingPath(meeting.id)} draggable={false} data-inicio-abrir="ultima-reuniao" className={INICIO_LINK_CLASS}>
          Abrir
        </Link>
      </header>
      <p className="truncate text-13 font-medium text-title">{meeting.title}</p>
      <p className="text-12 text-text-muted tabular">
        {textoQuandoFoi(new Date(meeting.startedAt), new Date(agora))} · {durationLabel(meeting.durationMs)}
      </p>
      {summary?.overview && <p className="mt-1 truncate text-13 text-text">{summary.overview}</p>}
    </section>
  )
}
