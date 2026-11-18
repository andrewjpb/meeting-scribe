// Cards de anotação (contrato 13) em coluna (painel da gravação) ou em grade de 2 a 4 colunas (aba
// "Anotações" do detalhe), e o aviso de "Desfazer" depois de excluir. Quem usa guarda a lista e o
// "Desfazer" (no store da gravação ou do detalhe); aqui só a tela e o foco.
// Contrato 30: no detalhe a grade vira um quadro (`canvas`): o card arrastado fica onde foi solto (posição em
// frações do quadro, pelo `transform`); o que nunca foi arrastado continua na grade automática. A ordem dos `<li>`
// continua a da lista: a posição é só visual.
import { Undo2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import type { MeetingNote, NotePosition } from '@shared/meeting-notes'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { StickyNote, type StickyNotePatch } from '../../design/StickyNote'
import { clampPosition } from './noteList'

/** Marca o bloco (painel ou aba) que tem o "+ Nova anotação": para onde o foco vai depois da última exclusão. */
export const NOTES_ROOT_ATTR = 'data-notes-root'

/** Largura do card no quadro (a mesma das colunas da grade automática). */
export const CANVAS_CARD_WIDTH = 240
/** Altura do card enquanto ela ainda não foi medida: a posição vertical vai de 0 até a altura do quadro menos a do card. */
export const CANVAS_CARD_HEIGHT = 170
/** Quanto o ponteiro anda antes de virar arrasto (um clique não move o card). */
const DRAG_THRESHOLD_PX = 4

interface NotesBoardProps {
  notes: readonly MeetingNote[]
  layout: 'column' | 'grid' | 'canvas'
  /** Card recém-criado, que abre com o cursor no texto. */
  focusId: string | null
  /** O card recém-criado já recebeu o foco. */
  onFocused?: () => void
  readOnly?: boolean
  onChange: (id: string, patch: StickyNotePatch) => void
  onDelete: (id: string) => void
  /** "Concluir" e "Reabrir" (contrato 30). */
  onResolve?: (id: string, reason: string) => void
  onReopen?: (id: string) => void
  /** Soltar o card no quadro (só no `canvas`). */
  onMove?: (id: string, position: NotePosition) => void
  onLeave?: () => void
  onTimeClick?: (atMs: number) => void
  /** Muda quando o filtro muda: a lista nova entra com um fade curto. */
  filterKey?: string
}

/** Rotação leve e sempre a mesma de cada card (−2° a +2°), pelo id. */
export function noteTilt(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return ((Math.abs(hash) % 41) - 20) / 10
}

/**
 * Fração do quadro em px (e de volta), com o card sempre inteiro dentro dele (`cardHeight`: a altura medida do card).
 * Limitação aceita: a fração vertical é da altura atual do quadro, que muda quando a grade cresce ou o filtro troca.
 */
export function positionToPx(position: NotePosition, board: { width: number; height: number }, cardHeight = CANVAS_CARD_HEIGHT): { x: number; y: number } {
  const { x, y } = clampPosition(position)
  return { x: x * Math.max(0, board.width - CANVAS_CARD_WIDTH), y: y * Math.max(0, board.height - cardHeight) }
}

export function pxToPosition(px: { x: number; y: number }, board: { width: number; height: number }, cardHeight = CANVAS_CARD_HEIGHT): NotePosition {
  const free = { x: Math.max(0, board.width - CANVAS_CARD_WIDTH), y: Math.max(0, board.height - cardHeight) }
  return clampPosition({ x: free.x ? px.x / free.x : 0, y: free.y ? px.y / free.y : 0 })
}

export function NotesBoard({ notes, layout, focusId, onFocused, readOnly = false, onChange, onDelete, onResolve, onReopen, onMove, onLeave, onTimeClick, filterKey }: NotesBoardProps) {
  const list = useRef<HTMLUListElement>(null)
  const board = useBoardSize(list, layout === 'canvas', filterKey)

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

  const card = (note: MeetingNote, index: number) => (
    <StickyNote
      note={note}
      position={index + 1}
      autoFocus={note.id === focusId}
      readOnly={readOnly}
      onChange={(patch) => onChange(note.id, patch)}
      onDelete={() => remove(note.id)}
      {...(onResolve ? { onResolve: (reason: string) => onResolve(note.id, reason) } : {})}
      {...(onReopen ? { onReopen: () => onReopen(note.id) } : {})}
      {...(onFocused ? { onFocused } : {})}
      {...(onLeave ? { onLeave } : {})}
      {...(onTimeClick ? { onTimeClick } : {})}
    />
  )

  // O quadro segue sendo uma grade para os cards nunca arrastados (o smoke e o leitor de tela leem a mesma lista).
  const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-start gap-3'
  // 240 px = `CANVAS_CARD_WIDTH` (o Tailwind só acha a classe escrita por inteiro).
  const canvasClass = `relative grid grid-cols-[repeat(auto-fill,240px)] content-start items-start gap-4 min-h-[max(560px,70vh)] rounded-[var(--radius-panel)] border border-dashed border-line p-4`
  return (
    <ul
      ref={list}
      key={filterKey}
      data-notes={layout === 'column' ? 'column' : 'grid'}
      {...(layout === 'canvas' ? { 'data-notes-canvas': '' } : {})}
      aria-label="Anotações"
      className={`${layout === 'column' ? 'flex flex-col gap-3' : layout === 'grid' ? gridClass : canvasClass} ${filterKey ? 'notes-filter-enter' : ''}`}
    >
      {notes.map((note, index) =>
        layout === 'canvas' ? (
          <CanvasItem key={note.id} note={note} board={board} readOnly={readOnly} {...(onMove ? { onMove } : {})}>
            {card(note, index)}
          </CanvasItem>
        ) : (
          <li key={note.id}>{card(note, index)}</li>
        ),
      )}
    </ul>
  )
}

/**
 * Tamanho do quadro até a borda do padding (a mesma referência do card solto, em `top: 0; left: 0`, e do `offsetLeft` do
 * card na grade), relido quando a janela muda.
 */
function useBoardSize(ref: RefObject<HTMLUListElement | null>, active: boolean, remount?: string): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!active || !element) return
    const read = (): void => {
      const width = element.clientWidth
      const height = element.clientHeight
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
    // `remount`: o filtro troca o `<ul>` (key), e o observador vai para o novo.
  }, [ref, active, remount])
  return size
}

/** Altura do card desenhado (cresce com o texto), para o fim do quadro segurar o card inteiro. */
function useCardHeight(ref: RefObject<HTMLLIElement | null>): number {
  const [height, setHeight] = useState(CANVAS_CARD_HEIGHT)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const read = (): void => setHeight(element.offsetHeight || CANVAS_CARD_HEIGHT)
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return height
}

interface Drag {
  pointerId: number
  startX: number
  startY: number
  origin: { x: number; y: number }
  moved: boolean
}

/** Um card do quadro: arrastável pelo papel (texto, campos e botões continuam com o clique e o teclado de sempre). */
function CanvasItem({ note, board, readOnly, onMove, children }: { note: MeetingNote; board: { width: number; height: number }; readOnly: boolean; onMove?: (id: string, position: NotePosition) => void; children: ReactNode }) {
  const drag = useRef<Drag | null>(null)
  const item = useRef<HTMLLIElement>(null)
  const [dragPx, setDragPx] = useState<{ x: number; y: number } | null>(null)
  const height = useCardHeight(item)
  const placed = dragPx ?? (note.position ? positionToPx(note.position, board, height) : null)
  const limit = { x: Math.max(0, board.width - CANVAS_CARD_WIDTH), y: Math.max(0, board.height - height) }
  const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value))

  const down = (event: ReactPointerEvent<HTMLLIElement>): void => {
    if (readOnly || !onMove || event.button !== 0) return
    if ((event.target as HTMLElement).closest('textarea, input, button, a')) return
    const target = event.currentTarget
    // Card ainda na grade: o arrasto começa de onde ele está desenhado (`offsetLeft/Top` contam da borda do padding do
    // quadro, a mesma origem do card solto).
    const origin = placed ?? { x: target.offsetLeft, y: target.offsetTop }
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, moved: false }
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // Ponteiro que já acabou: o arrasto segue pelos eventos do próprio card.
    }
  }

  const move = (event: ReactPointerEvent<HTMLLIElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    current.moved = true
    event.preventDefault()
    setDragPx({ x: clamp(current.origin.x + dx, limit.x), y: clamp(current.origin.y + dy, limit.y) })
  }

  const up = (event: ReactPointerEvent<HTMLLIElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    if (current.moved && dragPx) onMove?.(note.id, pxToPosition(dragPx, board, height))
    setDragPx(null)
  }

  const style = { '--note-tilt': `${noteTilt(note.id)}deg`, ...(placed ? { '--note-x': `${placed.x}px`, '--note-y': `${placed.y}px`, width: `${CANVAS_CARD_WIDTH}px` } : {}) } as CSSProperties
  return (
    <li
      ref={item}
      data-note-item={note.id}
      {...(placed ? { 'data-placed': '' } : {})}
      {...(dragPx ? { 'data-dragging': '' } : {})}
      style={style}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {children}
    </li>
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
