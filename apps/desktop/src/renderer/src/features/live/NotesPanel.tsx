// Painel lateral da gravação (contrato 13, CA3): à direita da transcrição, que continua visível e rolando.
// Contrato 19, CA4: duas abas, "Anotações" e "Análise". Em "Anotações", "+ Nova anotação" e os cards em
// coluna, o mais novo em cima; em "Análise", as análises "Analisar até agora". As anotações e as análises
// ficam no `recordingStore` até a reunião existir; "Encerrar" as salva nela.
import { Plus } from 'lucide-react'
import { Button } from '../../design/Button'
import { tabPanelId, Tabs, tabId } from '../../design/Tabs'
import { NoteUndo, NotesBoard } from '../notes/NotesBoard'
import { AnalysisPanel } from './AnalysisPanel'
import { useRecording, type SidePanelTab } from './recordingStore'

const PANEL_TABS: { value: SidePanelTab; label: string }[] = [
  { value: 'anotacoes', label: 'Anotações' },
  { value: 'analise', label: 'Análise' },
]
const PANEL_TABS_ID = 'recording-panel'

export function NotesPanel() {
  const notes = useRecording((state) => state.notes)
  const newNoteId = useRecording((state) => state.newNoteId)
  const saving = useRecording((state) => state.saving)
  const undo = useRecording((state) => state.noteUndo)
  const tab = useRecording((state) => state.panelTab)
  const { addNote, editNote, deleteNote, undoDeleteNote, noteFocused, setPanelTab } = useRecording.getState()

  // O fim do painel fica livre para a barra de controles, que flutua por cima: nenhum card passa por baixo dela.
  return (
    <aside data-notes-panel data-notes-root data-panel-tab={tab} aria-label="Anotações e análise" className="flex w-[320px] shrink-0 flex-col border-l border-line pb-28">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 pt-2">
        <Tabs value={tab} tabs={PANEL_TABS} onChange={setPanelTab} label="Painel da gravação" id={PANEL_TABS_ID} />
        {tab === 'anotacoes' && (
          <div className="pb-1.5">
            <Button action="new-note" variant="secondary" icon={Plus} onClick={addNote} disabled={saving}>
              Nova anotação
            </Button>
          </div>
        )}
      </div>
      <div role="tabpanel" id={tabPanelId(PANEL_TABS_ID, tab)} aria-labelledby={tabId(PANEL_TABS_ID, tab)} className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-4">
        {tab === 'analise' ? (
          <AnalysisPanel />
        ) : (
          <>
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
          </>
        )}
      </div>
    </aside>
  )
}
