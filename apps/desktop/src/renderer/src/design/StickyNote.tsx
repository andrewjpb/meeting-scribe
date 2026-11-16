import { Check, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { NOTE_COLOR_LABELS, NOTE_COLORS, NOTE_TEXT_MAX, type MeetingNote, type NoteColor } from '@shared/meeting-notes'
import { formatClock } from '@shared/transcription'
import { Icon } from './Icon'

/** Fundo, borda e texto de cada cor (tokens `--note-*`), em classes inteiras para o Tailwind achar. */
export const COLOR_CLASS: Record<NoteColor, { card: string; swatch: string; edge: string }> = {
  yellow: { card: 'bg-note-yellow border-note-yellow-border text-note-yellow-text', swatch: 'bg-note-yellow', edge: 'border-note-yellow-border' },
  pink: { card: 'bg-note-pink border-note-pink-border text-note-pink-text', swatch: 'bg-note-pink', edge: 'border-note-pink-border' },
  green: { card: 'bg-note-green border-note-green-border text-note-green-text', swatch: 'bg-note-green', edge: 'border-note-green-border' },
  blue: { card: 'bg-note-blue border-note-blue-border text-note-blue-text', swatch: 'bg-note-blue', edge: 'border-note-blue-border' },
  purple: { card: 'bg-note-purple border-note-purple-border text-note-purple-text', swatch: 'bg-note-purple', edge: 'border-note-purple-border' },
  orange: { card: 'bg-note-orange border-note-orange-border text-note-orange-text', swatch: 'bg-note-orange', edge: 'border-note-orange-border' },
}

const ACTION_CLASS =
  'no-drag inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] px-1 text-12 font-medium transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:opacity-70 disabled:pointer-events-none disabled:opacity-50'

interface StickyNoteProps {
  note: MeetingNote
  onChange: (patch: { text?: string; color?: NoteColor }) => void
  onDelete: () => void
  /** O foco saiu do card (texto, cores e botões): quem guarda salva na hora. */
  onLeave?: () => void
  /** Clique no tempo ("12:34"); sem isto o tempo é só texto. */
  onTimeClick?: (atMs: number) => void
  /** Card recém-criado: já abre com o cursor no texto. */
  autoFocus?: boolean
  /** O foco do `autoFocus` já foi dado: quem guarda limpa o pedido. */
  onFocused?: () => void
  /** Posição na tela (1, 2…), para os nomes acessíveis serem únicos. */
  position: number
  readOnly?: boolean
}

/**
 * Anotação em card colorido (contrato 13): o "papel" é só a cor de fundo e uma borda de 1 px, sem sombra,
 * raio de 6 px. Em cima, o tempo da gravação e "Excluir"; no meio, o texto editável no próprio card (cresce
 * com o conteúdo); embaixo, as seis cores, com a atual marcada.
 */
export function StickyNote({ note, onChange, onDelete, onLeave, onTimeClick, autoFocus = false, onFocused, position, readOnly = false }: StickyNoteProps) {
  const text = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!autoFocus) return
    text.current?.focus()
    onFocused?.()
  }, [autoFocus, onFocused])

  const colors = COLOR_CLASS[note.color]
  const time = note.atMs === null ? null : formatClock(note.atMs)
  return (
    <article
      data-note={note.id}
      data-color={note.color}
      aria-label={time ? `Anotação ${position} de ${time}` : `Anotação ${position}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onLeave?.()
      }}
      className={`flex flex-col gap-2 rounded-[var(--radius-panel)] border p-3 ${colors.card}`}
    >
      <div className="flex h-6 items-center justify-between gap-2">
        {time === null ? (
          <span />
        ) : onTimeClick && note.atMs !== null ? (
          <button
            type="button"
            data-action="note-time"
            title="Ir para este momento da transcrição"
            onClick={() => note.atMs !== null && onTimeClick(note.atMs)}
            className={`${ACTION_CLASS} -ml-1 tabular underline decoration-1 underline-offset-3`}
          >
            {time}
          </button>
        ) : (
          <span data-note-time className="text-12 font-medium tabular">
            {time}
          </span>
        )}
        <button type="button" data-action="delete-note" aria-label={`Excluir anotação ${position}`} onClick={onDelete} disabled={readOnly} className={`${ACTION_CLASS} -mr-1`}>
          <Icon icon={Trash2} size={14} />
          Excluir
        </button>
      </div>
      <textarea
        ref={text}
        data-note-text
        aria-label={`Texto da anotação ${position}`}
        value={note.text}
        maxLength={NOTE_TEXT_MAX}
        readOnly={readOnly}
        rows={3}
        placeholder="Escreva aqui…"
        onChange={(event) => onChange({ text: event.target.value })}
        className="field-sizing-content min-h-[66px] w-full resize-none bg-transparent text-14 text-pretty select-text placeholder:text-current placeholder:opacity-60"
      />
      <div role="group" aria-label={`Cor da anotação ${position}`} className="flex items-center gap-1.5">
        {NOTE_COLORS.map((color) => {
          const current = color === note.color
          return (
            <button
              key={color}
              type="button"
              data-note-color={color}
              aria-label={NOTE_COLOR_LABELS[color]}
              aria-pressed={current}
              title={NOTE_COLOR_LABELS[color]}
              disabled={readOnly}
              onClick={() => onChange({ color })}
              className={`no-drag inline-flex size-5 items-center justify-center rounded-[var(--radius-control)] border text-current disabled:opacity-50 ${COLOR_CLASS[color].swatch} ${current ? 'border-current' : COLOR_CLASS[color].edge}`}
            >
              {current && <Icon icon={Check} size={14} />}
            </button>
          )
        })}
      </div>
    </article>
  )
}
