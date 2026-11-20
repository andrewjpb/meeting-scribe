// Coluna de transcrição (CA11): horário na calha de 48 px, rótulo de quem fala na cor da fonte, texto
// 15/24, tradução 13/20 com filete (contrato 81); parcial em --text-muted itálico. Rola sozinha até o fim; se o
// usuário subir, para de rolar e mostra "Ir para o fim". Sem sombra, sem raio acima do token.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatClock, segmentLabel, type TranscriptSource, type TranslationState } from '@shared/transcription'

export interface TranscriptItem {
  id: string
  source: TranscriptSource
  speaker: string | null
  /** Nomes do Meet (contrato 27): "Ana" ou "Ana + Bruno" no lugar do rótulo. */
  names?: string[]
  startMs: number
  text: string
  translation: string | null
  partial: boolean
  translationState: TranslationState
}

interface TranscriptListProps {
  items: readonly TranscriptItem[]
  /** Espaço no fim (a barra de controles flutua por cima) e começo da lista. */
  bottomInset?: boolean
  /** Caixa alta: só a gravação rola sozinha; o detalhe abre no topo. */
  autoScroll?: boolean
  onRetryTranslation?: (id: string) => void
  /** Aviso antes da lista (estado sem chave, exemplo etc.). */
  header?: ReactNode
  /**
   * Trecho para onde rolar (o tempo de uma anotação, contrato 13). `seq` muda a cada clique, para o mesmo
   * trecho rolar de novo.
   */
  jumpTo?: { id: string; seq: number } | null
}

export function TranscriptList({ items, bottomInset = false, autoScroll = false, onRetryTranslation, header, jumpTo = null }: TranscriptListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    if (!jumpTo) return
    const target = scrollRef.current?.querySelector(`[data-segment="${CSS.escape(jumpTo.id)}"]`)
    target?.scrollIntoView({ block: 'center' })
  }, [jumpTo])

  // Rolar sempre que o texto muda, enquanto o usuário não tiver subido.
  useEffect(() => {
    if (!autoScroll) return
    const element = scrollRef.current
    if (!element || !atBottom) return
    element.scrollTop = element.scrollHeight
  }, [items, atBottom, autoScroll])

  const onScroll = (): void => {
    const element = scrollRef.current
    if (!element) return
    setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 32)
  }

  const toEnd = (): void => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior: 'auto' })
    setAtBottom(true)
  }

  return (
    <div data-transcript-scroll ref={scrollRef} onScroll={onScroll} className={`relative min-h-0 flex-1 overflow-y-auto px-8 ${bottomInset ? 'pb-28' : 'pb-8'}`}>
      <div className="mx-auto w-full max-w-[680px]">
        {header}
        {items.length > 0 && (
          <ol data-transcript-list className="flex flex-col gap-4 pt-5 pb-1">
            {items.map((item) => (
              <Segment key={item.id} item={item} onRetryTranslation={onRetryTranslation} target={jumpTo?.id === item.id} />
            ))}
          </ol>
        )}
      </div>
      {autoScroll && !atBottom && items.length > 0 && (
        <div className="pointer-events-none sticky bottom-24 z-10 mx-auto flex max-w-[680px] justify-end pr-1">
          <button
            type="button"
            data-action="scroll-to-end"
            onClick={toEnd}
            className="no-drag pointer-events-auto inline-flex h-7 items-center rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2.5 text-12 font-medium text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken"
          >
            Ir para o fim
          </button>
        </div>
      )}
    </div>
  )
}

function Segment({ item, onRetryTranslation, target }: { item: TranscriptItem; onRetryTranslation?: ((id: string) => void) | undefined; target: boolean }) {
  const showUnavailable = !item.partial && item.translationState === 'unavailable' && !item.translation
  return (
    <li data-segment={item.id} data-jump-target={target || undefined} className="grid grid-cols-[48px_minmax(0,1fr)]">
      <time className={`pt-0.5 text-12 tabular ${target ? 'font-bold text-title' : 'text-text-faint'}`}>{formatClock(item.startMs)}</time>
      <div className="flex min-w-0 flex-col gap-1">
        <p className={`caps ${item.source === 'mic' ? 'text-mic' : 'text-sys'}`}>{segmentLabel(item)}</p>
        <p data-transcript-text className={`text-15 leading-6 select-text ${item.partial ? 'text-text-muted italic' : 'text-text'}`}>{item.text}</p>
        {item.translation && <p data-transcript-translation className="border-l-2 border-line-strong pl-3 text-13 text-text-muted select-text">{item.translation}</p>}
        {showUnavailable && (
          <div className="flex flex-wrap items-center gap-3 border-l-2 border-line-strong pl-3 text-13 text-text-muted">
            <span>Tradução indisponível</span>
            {onRetryTranslation && (
              <button
                type="button"
                data-action="retry-translation"
                onClick={() => onRetryTranslation(item.id)}
                className="no-drag inline-flex h-7 items-center rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2.5 text-12 font-medium text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken"
              >
                Tentar de novo
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
