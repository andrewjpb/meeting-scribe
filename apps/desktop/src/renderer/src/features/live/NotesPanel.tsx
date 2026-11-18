// Painel lateral da gravação (contrato 13, CA3): à direita da transcrição, que continua visível e rolando.
// Contrato 19, CA4: duas abas, "Anotações" e "Análise". Em "Anotações", "+ Nova anotação" e os cards em
// coluna, o mais novo em cima; em "Análise", as análises "Analisar até agora". As anotações e as análises
// ficam no `recordingStore` até a reunião existir; "Encerrar" as salva nela.
// Contrato 30: em "Anotações", o interruptor "IA anotando" (com "anotando…" enquanto um ciclo roda) e o filtro
// "Abertas · Resolvidas · Todas"; os cards continuam em coluna.
import { Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Icon } from '../../design/Icon'
import { Switch } from '../../design/Switch'
import { Button } from '../../design/Button'
import { tabPanelId, Tabs, tabId } from '../../design/Tabs'
import { NoteUndo, NotesBoard } from '../notes/NotesBoard'
import { filterNotes, NotesFilter, type NotesFilterValue } from '../notes/NotesFilter'
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
  const aiNotes = useRecording((state) => state.aiNotes)
  const aiBusy = useRecording((state) => state.aiNotesBusy)
  const [filter, setFilter] = useState<NotesFilterValue>('todas')
  const { addNote, editNote, deleteNote, undoDeleteNote, noteFocused, setPanelTab, resolveNote, reopenNote, toggleAiNotes } = useRecording.getState()
  const shown = filterNotes(notes, filter)

  // O fim do painel fica livre para a barra de controles, que flutua por cima: nenhum card passa por baixo dela.
  return (
    <aside data-notes-panel data-notes-root data-panel-tab={tab} aria-label="Anotações e análise" className="flex w-[320px] shrink-0 flex-col border-l border-line pb-28">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 pt-2">
        <Tabs value={tab} tabs={PANEL_TABS} onChange={setPanelTab} label="Painel da gravação" id={PANEL_TABS_ID} />
        {tab === 'anotacoes' && (
          <div className="pb-1.5">
            <Button
              action="new-note"
              variant="secondary"
              icon={Plus}
              onClick={() => {
                // O card novo está aberto: com "Resolvidas" ele não apareceria.
                if (filter === 'resolvidas') setFilter('todas')
                addNote()
              }}
              disabled={saving}
            >
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
            <div data-ai-notes={aiNotes ? 'on' : 'off'} className="mb-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <span id="ai-notes-label" className="inline-flex items-center gap-1.5 text-13 font-medium">
                  <Icon icon={Sparkles} size={14} />
                  IA anotando
                  {aiBusy && (
                    <span data-ai-notes-busy role="status" className="note-busy-pulse text-12 font-normal text-text-muted">
                      anotando…
                    </span>
                  )}
                </span>
                <Switch checked={aiNotes} labelledBy="ai-notes-label" action="ai-notes" onChange={toggleAiNotes} disabled={saving} />
              </div>
              {notes.length > 0 && <NotesFilter notes={notes} value={filter} onChange={setFilter} />}
            </div>
            {undo && (
              <div className="mb-3">
                <NoteUndo onUndo={undoDeleteNote} />
              </div>
            )}
            {notes.length === 0 ? (
              <p className="pt-1 text-13 text-pretty text-text-muted">Anote o que quiser lembrar. Cada card guarda o momento da gravação.</p>
            ) : shown.length === 0 ? (
              <p className="notes-filter-enter pt-1 text-13 text-text-muted">{filter === 'abertas' ? 'Nenhuma anotação aberta.' : 'Nenhuma anotação resolvida.'}</p>
            ) : (
              <NotesBoard
                notes={shown}
                layout="column"
                focusId={newNoteId}
                onFocused={noteFocused}
                readOnly={saving}
                onChange={editNote}
                onDelete={deleteNote}
                onResolve={resolveNote}
                onReopen={reopenNote}
                filterKey={filter}
              />
            )}
          </>
        )}
      </div>
    </aside>
  )
}
