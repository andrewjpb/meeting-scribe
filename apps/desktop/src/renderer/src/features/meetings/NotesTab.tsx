import { Copy, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../design/Button'
import type { StickyNotePatch } from '../../design/StickyNote'
import { RetryNotice } from '../live/Notices'
import { NoteUndo, NotesBoard } from '../notes/NotesBoard'
import { filterNotes, NotesFilter, type NotesFilterValue } from '../notes/NotesFilter'
import { useMeetingNotes } from './notesStore'

/**
 * Aba "Anotações" do detalhe (contrato 13, CA5): os cards em grade de 2 a 4 colunas, com as mesmas ações da
 * gravação e "Copiar anotações". Cards criados aqui não têm tempo. Quem guarda e salva é o `notesStore`
 * (500 ms depois da última tecla; na hora ao sair do card, trocar a cor, excluir, desfazer e sair da aba),
 * que continua vivo quando a aba fecha. Clicar no tempo de um card leva à transcrição (`onJump`).
 * Contrato 30: os cards ficam num quadro (arrastar e soltar salva a posição), com "Concluir"/"Reabrir" e o filtro
 * "Abertas · Resolvidas · Todas".
 */
export function NotesTab({ meetingId, onJump }: { meetingId: string; onJump: (atMs: number) => void }) {
  const entry = useMeetingNotes((state) => state.meetings[meetingId])
  const store = useMeetingNotes.getState()
  const [filter, setFilter] = useState<NotesFilterValue>('todas')

  useEffect(() => {
    void useMeetingNotes.getState().load(meetingId)
    // Sair da aba ou da reunião com uma edição esperando: salva na hora (o aviso de falha fica no detalhe).
    return () => void useMeetingNotes.getState().flush(meetingId)
  }, [meetingId])

  if (!entry || entry.status === 'loading') return <div className="flex-1" aria-busy="true" />

  const change = (id: string, patch: StickyNotePatch): void => store.change(meetingId, id, patch)
  const create = (): void => {
    // O card novo está aberto: com "Resolvidas" ele não apareceria.
    if (filter === 'resolvidas') setFilter('todas')
    store.create(meetingId)
  }
  const shown = filterNotes(entry.notes, filter)

  return (
    <div data-notes-scroll className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
      <div data-notes-tab={entry.status === 'ready' ? entry.notes.length : 'failed'} data-notes-root className="mx-auto flex w-full max-w-[1040px] flex-col gap-3 pt-5">
        {entry.status === 'failed' ? (
          <RetryNotice id="notes-load-failed" text="Não foi possível abrir as anotações." onRetry={() => void store.load(meetingId)} />
        ) : (
          <>
            {entry.undo && <NoteUndo onUndo={() => store.undo(meetingId)} />}
            {entry.notes.length === 0 ? (
              <div className="flex flex-col items-start gap-4">
                <p className="text-13 text-text-muted">Nenhuma anotação.</p>
                <Button action="new-note" icon={Plus} onClick={create}>
                  Nova anotação
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button action="new-note" variant="secondary" icon={Plus} onClick={create}>
                    Nova anotação
                  </Button>
                  <CopyNotes meetingId={meetingId} />
                  <div className="ml-auto">
                    <NotesFilter notes={entry.notes} value={filter} onChange={setFilter} />
                  </div>
                </div>
                <NotesBoard
                  notes={shown}
                  layout="canvas"
                  focusId={entry.focusId}
                  onFocused={() => store.clearFocus(meetingId)}
                  onChange={change}
                  onDelete={(id) => store.remove(meetingId, id)}
                  onResolve={(id, reason) => store.resolve(meetingId, id, reason)}
                  onReopen={(id) => store.reopen(meetingId, id)}
                  onMove={(id, position) => store.move(meetingId, id, position)}
                  onLeave={() => void store.flush(meetingId)}
                  onTimeClick={onJump}
                  filterKey={filter}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** "Copiar anotações": salva o que estiver pendente e o main monta o mesmo Markdown do `.md`. */
function CopyNotes({ meetingId }: { meetingId: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async (): Promise<void> => {
    const show = (next: 'copied' | 'failed'): void => {
      setState(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), 2500)
    }
    // A edição que ainda esperava os 500 ms vai antes: a cópia sai com o texto da tela.
    await useMeetingNotes.getState().flush(meetingId)
    try {
      show((await window.__scribeApi.invoke('scribe:notes-copy', { meetingId })) === 'copied' ? 'copied' : 'failed')
    } catch {
      show('failed')
    }
  }

  return (
    <Button action="copy-notes" variant="secondary" icon={Copy} onClick={() => void copy()}>
      {state === 'copied' ? 'Copiado' : state === 'failed' ? 'Não copiou' : 'Copiar anotações'}
    </Button>
  )
}
