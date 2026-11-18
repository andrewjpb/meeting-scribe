import { Check, CircleCheck, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isAiNote, isResolved, NOTE_COLOR_LABELS, NOTE_COLORS, NOTE_REASON_MAX, NOTE_TEXT_MAX, NOTE_TITLE_MAX, type MeetingNote, type NoteColor } from '@shared/meeting-notes'
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

/** Card criado há menos que isso entra com a animação de post-it sendo colado (adendo 30b). */
const ENTER_WINDOW_MS = 8_000

export type StickyNotePatch = { text?: string; title?: string; color?: NoteColor }

interface StickyNoteProps {
  note: MeetingNote
  onChange: (patch: StickyNotePatch) => void
  onDelete: () => void
  /** "Concluir" (contrato 30) com o motivo, que pode ficar vazio; sem isto, o card não tem "Concluir". */
  onResolve?: (reason: string) => void
  /** "Reabrir" de um card resolvido. */
  onReopen?: () => void
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
 * raio de 6 px. Em cima, o tempo da gravação, "Concluir" (ou "Reabrir") e "Excluir"; no meio, o título (só nos
 * cards que têm um, como os da IA) e o texto editável no próprio card (cresce com o conteúdo); embaixo, as seis
 * cores, com a atual marcada, e a marca da IA. Contrato 30: resolvido, o card esmaece e mostra ✓ e o motivo.
 */
export function StickyNote({ note, onChange, onDelete, onResolve, onReopen, onLeave, onTimeClick, autoFocus = false, onFocused, position, readOnly = false }: StickyNoteProps) {
  const text = useRef<HTMLTextAreaElement>(null)
  const [resolving, setResolving] = useState(false)
  const [reason, setReason] = useState('')
  // Decidido no primeiro desenho: trocar de aba depois não repete a entrada.
  const [entering] = useState(() => Date.now() - Date.parse(note.createdAt) < ENTER_WINDOW_MS)
  useEffect(() => {
    if (!autoFocus) return
    text.current?.focus()
    onFocused?.()
  }, [autoFocus, onFocused])

  const colors = COLOR_CLASS[note.color]
  const time = note.atMs === null ? null : formatClock(note.atMs)
  const resolved = isResolved(note)
  const ai = isAiNote(note)
  const label = `${time ? `Anotação ${position} de ${time}` : `Anotação ${position}`}${resolved ? ', resolvida' : ''}`
  const confirm = (): void => {
    setResolving(false)
    onResolve?.(reason)
    setReason('')
  }
  return (
    <article
      data-note={note.id}
      data-color={note.color}
      data-note-origin={ai ? 'ia' : 'manual'}
      data-note-status={resolved ? 'resolvida' : 'aberta'}
      aria-label={label}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onLeave?.()
      }}
      className={`note-card flex flex-col gap-2 rounded-[var(--radius-panel)] border p-3 ${colors.card} ${entering ? 'note-enter' : ''}`}
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
        <div className="-mr-1 flex items-center gap-1">
          {resolved
            ? onReopen && (
                <button type="button" data-action="reopen-note" aria-label={`Reabrir anotação ${position}`} onClick={onReopen} disabled={readOnly} className={ACTION_CLASS}>
                  <Icon icon={RotateCcw} size={14} />
                  Reabrir
                </button>
              )
            : onResolve && (
                <button
                  type="button"
                  data-action="resolve-note"
                  aria-label={`Concluir anotação ${position}`}
                  aria-expanded={resolving}
                  onClick={() => setResolving((open) => !open)}
                  disabled={readOnly}
                  className={ACTION_CLASS}
                >
                  <Icon icon={CircleCheck} size={14} />
                  Concluir
                </button>
              )}
          <button type="button" data-action="delete-note" aria-label={`Excluir anotação ${position}`} onClick={onDelete} disabled={readOnly} className={ACTION_CLASS}>
            <Icon icon={Trash2} size={14} />
            Excluir
          </button>
        </div>
      </div>
      {note.title !== undefined && (
        <input
          data-note-title
          aria-label={`Título da anotação ${position}`}
          value={note.title}
          maxLength={NOTE_TITLE_MAX}
          readOnly={readOnly}
          placeholder="Título"
          onChange={(event) => onChange({ title: event.target.value })}
          className="w-full bg-transparent text-14 font-semibold text-pretty select-text placeholder:text-current placeholder:opacity-60"
        />
      )}
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
      {/* A IA resolveu com o campo aberto: o campo fica e o motivo da pessoa substitui o dela. */}
      {resolving && (!resolved || note.resolution?.by === 'ia') && (
        <div data-note-resolve className="note-fade flex items-center gap-1.5">
          <input
            // Aberto pelo próprio clique em "Concluir": o foco vai para ele.
            autoFocus
            data-note-reason
            aria-label={`Motivo da conclusão da anotação ${position}`}
            value={reason}
            maxLength={NOTE_REASON_MAX}
            placeholder="Motivo (opcional)"
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                confirm()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setResolving(false)
              }
            }}
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-current/30 bg-transparent px-1.5 py-0.5 text-13 select-text placeholder:text-current placeholder:opacity-60"
          />
          <button type="button" data-action="confirm-resolve-note" onClick={confirm} className={`${ACTION_CLASS} border border-current/30`}>
            Concluir
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
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
        {ai && (
          <span data-note-ai title="Criada pela IA" aria-label="Criada pela IA" role="img" className={`inline-flex items-center opacity-70 ${entering ? 'note-badge-pulse' : ''}`}>
            <Icon icon={Sparkles} size={14} />
          </span>
        )}
      </div>
      {resolved && (
        <p data-note-resolution className="note-fade flex items-start gap-1 text-12 font-medium text-pretty">
          <Icon icon={Check} size={14} />
          <span>{note.resolution?.reason ? `Resolvida — ${note.resolution.reason}` : 'Resolvida'}</span>
        </p>
      )}
    </article>
  )
}
