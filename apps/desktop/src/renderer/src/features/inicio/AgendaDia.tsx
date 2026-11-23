import { Calendar, Mic } from 'lucide-react'
import { Link } from 'react-router'
import type { InicioEvento, InicioView } from '@shared/inicio'
import { meetingPath, ROUTE_PATHS } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { useRecordEvent } from '../calendar/useRecordEvent'
import { useRecording } from '../live/recordingStore'
import { useStartRecording } from '../live/useStartRecording'
import { durationLabel } from '../meetings/format'
import { FONTE_ROTULO, horaMinuto, INICIO_LINK_CLASS, linhaDoDia, textoAmanha, textoEmAndamento, textoEventos, textoHorarioEvento, type EstadoEvento } from './inicioFormat'

/** O nó da linha: 7 px em --title; o passado em --text-faint, o atual em --accent. */
const NO_CLASS: Record<EstadoEvento, string> = { passado: 'bg-text-faint', atual: 'bg-accent', futuro: 'bg-title' }
/** O horário à esquerda da linha (44 px, alinhado à direita). */
const HORA_CLASS = 'absolute left-0 w-11 text-right text-12 tabular'

interface CartaoEventoProps {
  evento: InicioEvento
  estado: EstadoEvento
  agora: number
  /** É o evento atual e há gravação em andamento: "Gravando desde HH:mm" no lugar do "Transcrever" (artboard 02). */
  gravando: boolean
  /** Duração da reunião gravada do evento, quando a lista de reuniões já a tem. */
  duracaoGravada: number | null
}

/**
 * Um evento da linha (artboard 01): título com as etiquetas de fonte (escolha D4), horário e chamada; o passado já
 * gravado leva "Reunião gravada"; o atual fica destacado com "Em andamento · faltam N min" e "Transcrever" (o mesmo
 * fluxo do aviso: o evento da conta vai pelo `calendar-record`, o só do Mac começa sem agenda).
 */
function CartaoEvento({ evento, estado, agora, gravando, duracaoGravada }: CartaoEventoProps) {
  const gravarEvento = useRecordEvent()
  const gravar = useStartRecording()
  const startedAt = useRecording((state) => state.startedAt)
  const atual = estado === 'atual' && !evento.diaInteiro
  const transcrever = (): void => (evento.calendarKey ? gravarEvento(evento.calendarKey) : gravar())
  const caixa = atual ? (gravando ? 'border-rec bg-bg-raised py-2' : 'border-accent bg-hl py-2') : 'border-line py-1.5'
  return (
    <div data-inicio-evento={evento.id} data-inicio-estado={estado} data-inicio-fontes={evento.fontes.join(' ')} className={`flex min-w-0 flex-1 flex-col gap-0.5 rounded-[var(--radius-control)] border px-2.5 ${caixa}`}>
      <div className="flex items-center gap-2">
        <b className={`min-w-0 flex-1 truncate text-13 font-medium ${estado === 'passado' ? 'text-text-muted' : 'text-title'}`}>{evento.titulo}</b>
        {evento.fontes.map((fonte) => (
          <span key={fonte} data-inicio-fonte={fonte} className="inline-flex h-[18px] shrink-0 items-center rounded-[var(--radius-control)] bg-bg-sunken px-1.5 text-11 font-medium text-text-muted">
            {FONTE_ROTULO[fonte]}
          </span>
        ))}
      </div>
      <p className="text-12 text-text-muted tabular">{textoHorarioEvento(evento)}</p>
      {atual && gravando ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-2 text-12 font-medium text-rec">
            <span aria-hidden="true" className="size-2 shrink-0 bg-rec" />
            {startedAt ? `Gravando desde ${horaMinuto(startedAt)}` : 'Gravando'}
          </span>
          <span className="flex-1" />
          <Link to={ROUTE_PATHS.gravacao} draggable={false} data-inicio-abrir-gravacao="evento" className={INICIO_LINK_CLASS}>
            Abrir gravação
          </Link>
        </div>
      ) : atual ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-12 font-medium whitespace-nowrap text-accent tabular">{textoEmAndamento(evento.fim, agora)}</span>
          <span className="flex-1" />
          {evento.reuniaoId && <LinkGravada id={evento.reuniaoId} duracao={duracaoGravada} />}
          <button
            type="button"
            data-action="inicio-transcrever"
            onClick={transcrever}
            className="no-drag inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-2.5 text-12 font-medium whitespace-nowrap text-on-accent transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:opacity-90 active:opacity-80"
          >
            <Icon icon={Mic} size={14} />
            Transcrever
          </button>
        </div>
      ) : (
        evento.reuniaoId && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <LinkGravada id={evento.reuniaoId} duracao={duracaoGravada} />
          </div>
        )
      )}
    </div>
  )
}

/** "Reunião gravada · 28 min": o link para o detalhe da reunião do evento. */
function LinkGravada({ id, duracao }: { id: string; duracao: number | null }) {
  return (
    <>
      <Link to={meetingPath(id)} draggable={false} data-inicio-reuniao-gravada={id} className={INICIO_LINK_CLASS}>
        Reunião gravada
      </Link>
      {duracao !== null && <span className="text-12 text-text-faint tabular">· {durationLabel(duracao)}</span>}
    </>
  )
}

interface AgendaDiaProps {
  view: InicioView | null
  agora: number
  /** Duração de cada reunião gravada, pelo id (da lista de reuniões). */
  duracoes: ReadonlyMap<string, number>
}

/**
 * "Agenda de hoje" (D11, artboards 01 e 02): 380 px à esquerda, a linha comprimida do dia (escolha D2) com a marca
 * "agora" relida pela tela a cada minuto e, no pé, "Amanhã: N eventos".
 */
export function AgendaDia({ view, agora, duracoes }: AgendaDiaProps) {
  const gravando = useRecording((state) => state.session !== null)
  const eventos = view?.agenda.eventos ?? []
  const itens = linhaDoDia(eventos, agora)
  // Só o primeiro evento em andamento leva a marca da gravação (o main não diz qual evento está sendo gravado).
  const gravandoId = gravando ? itens.find((item) => item.tipo === 'evento' && item.estado === 'atual' && !item.evento.diaInteiro) : undefined
  return (
    <section data-inicio-agenda aria-label="Agenda de hoje" className="flex min-h-0 w-[380px] shrink-0 flex-col">
      <header className="flex h-7 shrink-0 items-baseline gap-2 border-b border-line-strong">
        <h2 className="text-14 leading-5 font-semibold text-title">Agenda de hoje</h2>
        <span data-inicio-agenda-total={eventos.length} className="text-12 text-text-muted tabular">
          {textoEventos(eventos.length)}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ol className="relative flex flex-col gap-1.5 pt-2.5 pb-2 before:absolute before:top-[18px] before:bottom-4 before:left-[55px] before:w-px before:bg-line-strong before:content-['']">
          {itens.map((item, index) => {
            if (item.tipo === 'limite') {
              return (
                <li key={`limite-${index}`} data-inicio-limite className="relative h-4 pl-[72px]">
                  <time className={`${HORA_CLASS} top-0 text-text-faint`}>{item.hora}</time>
                  <span aria-hidden="true" className="absolute top-[7px] left-[52px] h-px w-[7px] bg-line-strong" />
                </li>
              )
            }
            if (item.tipo === 'livre') {
              return (
                <li key={`livre-${index}`} data-inicio-livre className="h-5 pl-[72px] text-11 leading-5 text-text-faint">
                  {item.texto}
                </li>
              )
            }
            if (item.tipo === 'agora') {
              return (
                <li key="agora" data-inicio-agora className="relative h-4">
                  <time className={`${HORA_CLASS} top-0 font-medium text-accent`}>{item.hora}</time>
                  <span aria-hidden="true" className="absolute top-2 right-0 left-[52px] h-px bg-accent" />
                  <span className="absolute -top-2 right-0 text-11 font-medium text-accent">agora</span>
                </li>
              )
            }
            const { evento, estado } = item
            return (
              <li key={evento.id} className="relative flex items-start pl-[72px]">
                <time className={`${HORA_CLASS} top-2 text-text-muted`}>{item.hora}</time>
                <span aria-hidden="true" className={`absolute top-3 left-[52px] size-[7px] ${NO_CLASS[estado]}`} />
                <CartaoEvento evento={evento} estado={estado} agora={agora} gravando={gravandoId === item} duracaoGravada={evento.reuniaoId ? (duracoes.get(evento.reuniaoId) ?? null) : null} />
              </li>
            )
          })}
        </ol>
      </div>
      {view && (
        <p data-inicio-amanha={view.agenda.amanha} className="mt-auto flex h-8 shrink-0 items-center gap-2 border-t border-line-strong px-2 text-13 text-text">
          <Icon icon={Calendar} size={14} className="shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate">{textoAmanha(view.agenda.amanha)}</span>
        </p>
      )}
    </section>
  )
}
