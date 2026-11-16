// Cards de anotação (contrato 13) em coluna (painel da gravação) ou em grade de 2 a 4 colunas (aba
// "Anotações" do detalhe), e o aviso de "Desfazer" depois de excluir. Quem usa guarda a lista e o
// "Desfazer" (no store da gravação ou do detalhe); aqui só a tela e o foco.
import { Undo2 } from 'lucide-react'
import { useRef } from 'react'
import type { MeetingNote, NoteColor } from '@shared/meeting-notes'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { StickyNote } from '../../design/StickyNote'

/** Marca o bloco (painel ou aba) que tem o "+ Nova anotação": para onde o foco vai depois da última exclusão. */
export const NOTES_ROOT_ATTR = 'data-notes-root'

interface NotesBoardProps {
  notes: readonly MeetingNote[]
  layout: 'column' | 'grid'
  /** Card recém-criado, que abre com o cursor no texto. */
  focusId: string | null
  /** O card recém-criado já recebeu o foco. */
  onFocused?: () => void
  readOnly?: boolean
  onChange: (id: string, patch: { text?: string; color?: NoteColor }) => void
  onDelete: (id: string) => void
  onLeave?: () => void
  onTimeClick?: (atMs: number) => void
}

export function NotesBoard({ notes, layout, focusId, onFocused, readOnly = false, onChange, onDelete, onLeave, onTimeClick }: NotesBoardProps) {
  const list = useRef<HTMLUListElement>(null)

  /** Exclui e leva o foco ao card seguinte ou, sem ele, ao "+ Nova anotação" (a lista pode sumir). */
  const remove = (id: string): void => {
    const index = notes.findIndex((note) => note.id === id)
    const next = notes[index + 1]?.id ?? null
    const root = list.current?.closest(`[${NOTES_ROOT_ATTR}]`) ?? null
    onDelete(id)
    requestAnimationFrame(() => {
      const target = next ? root?.querySelector<HTMLElement>(`[data-note="${CSS.escape(next)}"] [data-note-text]`) : root?.querySelector<HTMLElement>('[data-action="new-note"]')
      target?.focus()
    })
  }

  return (
    <ul
      ref={list}
      data-notes={layout}
      aria-label="Anotações"
      className={layout === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-start gap-3' : 'flex flex-col gap-3'}
    >
      {notes.map((note, index) => (
        <li key={note.id}>
          <StickyNote
            note={note}
            position={index + 1}
            autoFocus={note.id === focusId}
            readOnly={readOnly}
            onChange={(patch) => onChange(note.id, patch)}
            onDelete={() => remove(note.id)}
            {...(onFocused ? { onFocused } : {})}
            {...(onLeave ? { onLeave } : {})}
            {...(onTimeClick ? { onTimeClick } : {})}
          />
        </li>
      ))}
    </ul>
  )
}

/** Aviso em linha, no formato de nota: "Anotação excluída." e "Desfazer". */
export function NoteUndo({ onUndo }: { onUndo: () => void }) {
  return (
    <Note
      id="note-deleted"
      role="status"
      icon={Undo2}
      action={
        <button type="button" data-action="undo-delete-note" onClick={onUndo} className={NOTE_ACTION_CLASS}>
          Desfazer
        </button>
      }
    >
      Anotação excluída.
    </Note>
  )
}
