import { CalendarClock } from 'lucide-react'
import { notRecordingText } from '@shared/calendar'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { useRecording } from '../live/recordingStore'
import { useCalendar } from './calendarStore'
import { useRecordEvent } from './useRecordEvent'

/**
 * Faixa no topo do app (contrato 12, CA7): a reunião da agenda começou e nada está gravando. No formato de aviso
 * (nota), sem sombra, com "Gravar" e "Ignorar". Some quando a gravação começa, o evento acaba ou é cancelado.
 */
export function CalendarBanner() {
  const banner = useCalendar((state) => state.view.banner)
  const recording = useRecording((state) => state.session !== null)
  const record = useRecordEvent()
  if (!banner || recording) return null
  return (
    <div className="relative z-10 px-8 pt-3" data-calendar-banner={banner.key}>
      <Note
        id="calendar-not-recording"
        icon={CalendarClock}
        role="status"
        action={
          <span className="flex shrink-0 items-center gap-4">
            <button type="button" data-action="calendar-banner-record" onClick={() => record(banner.key)} className={NOTE_ACTION_CLASS}>
              Gravar
            </button>
            <button type="button" data-action="calendar-banner-dismiss" onClick={() => void useCalendar.getState().dismiss(banner.key)} className={NOTE_ACTION_CLASS}>
              Ignorar
            </button>
          </span>
        }
      >
        {notRecordingText(banner.title)}
      </Note>
    </div>
  )
}
