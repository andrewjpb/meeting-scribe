// Filtro "Abertas · Resolvidas · Todas" das anotações (contrato 30, CA3), no painel da gravação e na aba do detalhe.
// Opções no traço da barra de pastas (contrato 28), com a contagem de cada uma; o padrão é "Todas".
import { isResolved, type MeetingNote } from '@shared/meeting-notes'

export type NotesFilterValue = 'abertas' | 'resolvidas' | 'todas'

const OPTIONS: { value: NotesFilterValue; label: string }[] = [
  { value: 'abertas', label: 'Abertas' },
  { value: 'resolvidas', label: 'Resolvidas' },
  { value: 'todas', label: 'Todas' },
]

const CHIP = 'no-drag inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-12 whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]'
const chipClass = (active: boolean): string => `${CHIP} ${active ? 'border-title bg-title font-medium text-bg' : 'border-line-strong bg-bg-raised text-text hover:bg-bg-sunken'}`

/** Só os cards do filtro, na mesma ordem da lista. */
export function filterNotes<T extends Pick<MeetingNote, 'status'>>(notes: readonly T[], filter: NotesFilterValue): T[] {
  if (filter === 'todas') return [...notes]
  return notes.filter((note) => isResolved(note) === (filter === 'resolvidas'))
}

export function NotesFilter({ notes, value, onChange }: { notes: readonly MeetingNote[]; value: NotesFilterValue; onChange: (value: NotesFilterValue) => void }) {
  const resolved = notes.filter(isResolved).length
  const counts: Record<NotesFilterValue, number> = { abertas: notes.length - resolved, resolvidas: resolved, todas: notes.length }
  return (
    <div data-notes-filter={value} role="group" aria-label="Filtrar anotações" className="flex flex-wrap items-center gap-1.5">
      {OPTIONS.map((option) => (
        <button key={option.value} type="button" data-notes-filter-option={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={chipClass(value === option.value)}>
          {option.label}
          <span className="tabular opacity-70">{counts[option.value]}</span>
        </button>
      ))}
    </div>
  )
}
