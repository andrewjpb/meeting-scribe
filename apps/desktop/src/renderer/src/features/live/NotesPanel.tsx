// Painel de anotações da gravação (contrato 13, CA3): à direita da transcrição, que continua visível e
// rolando. "+ Nova anotação" e os cards em coluna, o mais novo em cima. As anotações ficam no
// `recordingStore` até a reunião existir; "Encerrar" as salva nela.
import { Plus } from 'lucide-react'
import { Button } from '../../design/Button'
import { NoteUndo, NotesBoard } from '../notes/NotesBoard'
import { useRecording } from './recordingStore'

export function NotesPanel() {
  const notes = useRecording((state) => state.notes)
  const newNoteId = useRecording((state) => state.newNoteId)
  const saving = useRecording((state) => state.saving)
  const undo = useRecording((state) => state.noteUndo)
  const { addNote, editNote, deleteNote, undoDeleteNote, noteFocused } = useRecording.getState()

  // O fim do painel fica livre para a barra de controles, que flutua por cima: nenhum card passa por baixo dela.
  return (
    <aside data-notes-panel data-notes-root aria-label="Anotações" className="flex w-[320px] shrink-0 flex-col border-l border-line pb-28">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2 className="text-13 font-bold text-title">Anotações</h2>
        <Button action="new-note" variant="secondary" icon={Plus} onClick={addNote} disabled={saving}>
          Nova anotação
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {undo && (
          <div className="mb-3">
            <NoteUndo onUndo={undoDeleteNote} />
          </div>
        )}
        {notes.length === 0 ? (
          <p className="pt-1 text-13 text-pretty text-text-muted">Anote o que quiser lembrar. Cada card guarda o momento da gravação.</p>
        ) : (
          <NotesBoard
            notes={notes}
            layout="column"
            focusId={newNoteId}
            onFocused={noteFocused}
            readOnly={saving}
            onChange={editNote}
            onDelete={deleteNote}
          />
        )}
      </div>
    </aside>
  )
}
