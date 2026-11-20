import { ArrowLeft, FolderInput, Mail, MailOpen, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'

/** "Voltar para a lista": só na janela estreita, quando a lista e a leitura se alternam. */
const NARROW_ONLY = 'min-[900px]:hidden'

interface SelectionSummaryProps {
  count: number
  /** POP3 e os Enviados do app: sem "Mover para…". */
  canMove: boolean
  /** Só na Caixa de Entrada (o main marca e apaga lá e nos Enviados). */
  canMarkRead: boolean
  canDelete: boolean
  /** A pergunta do Apagar, no plural ("Apagar estas 3 mensagens? Elas saem também do servidor."). */
  deleteQuestion: string
  onMove: (anchor: DOMRect | null) => void
  onMarkRead: () => void
  onDelete: () => Promise<boolean>
  /** Janela estreita: volta para a lista (limpa a seleção). */
  onBack: () => void
}

/**
 * Resumo da seleção (contrato 55, CA4, tela 01): com 2 ou mais mensagens marcadas, a área da leitura mostra quantas, o
 * que dá para fazer com elas (Mover para… ⇧⌘M, Marcar como lidas, Apagar, com a confirmação de sempre) e como escolher.
 */
export function SelectionSummary({ count, canMove, canMarkRead, canDelete, deleteQuestion, onMove, onMarkRead, onDelete, onBack }: SelectionSummaryProps) {
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const moveButton = useRef<HTMLDivElement | null>(null)
  return (
    <section data-email-selection-summary={count} aria-label={`${count} mensagens selecionadas`} className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <button type="button" data-action="email-selection-back" onClick={onBack} aria-label="Voltar para a lista" className={`no-drag absolute top-3 left-4 inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-title hover:bg-bg-sunken ${NARROW_ONLY}`}>
        <Icon icon={ArrowLeft} />
      </button>
      <span aria-hidden="true" className="relative inline-flex size-12 items-center justify-center">
        <span className="absolute top-0 right-0 size-9 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised" />
        <span className="absolute top-1 right-1 size-9 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised" />
        <span className="absolute bottom-0 left-0 inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-title bg-bg-raised text-title">
          <Icon icon={Mail} />
        </span>
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-20 font-bold text-title">{count} mensagens selecionadas</h2>
        <p className="text-13 text-text-muted">{canMove ? 'Arraste para uma pasta na barra lateral ou escolha uma ação.' : 'Escolha uma ação.'}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {canMove && (
          <div ref={moveButton}>
            <Button action="email-selection-move" icon={FolderInput} shortcut="⇧⌘M" ariaShortcut="Shift+Meta+M" onClick={() => onMove(moveButton.current?.getBoundingClientRect() ?? null)}>
              Mover para…
            </Button>
          </div>
        )}
        {canMarkRead && (
          <Button action="email-selection-read" variant="secondary" icon={MailOpen} onClick={onMarkRead}>
            Marcar como lidas
          </Button>
        )}
        {canDelete && (
          <Button action="email-selection-delete" variant="danger" icon={Trash2} onClick={() => setConfirm(true)}>
            Apagar
          </Button>
        )}
      </div>
      {confirm && (
        <Note
          id="email-selection-delete-confirm"
          icon={Trash2}
          role="alert"
          className="max-w-[520px] text-left"
          action={
            <div className="flex gap-2">
              <Button
                action="email-selection-delete-confirm"
                variant="danger"
                onClick={() =>
                  void onDelete().then((ok) => {
                    setConfirm(false)
                    setError(ok ? null : 'Não foi possível apagar todas agora. Confira se a conta está conectada e tente de novo.')
                  })
                }
              >
                Apagar
              </Button>
              <Button action="email-selection-delete-cancel" variant="secondary" onClick={() => setConfirm(false)}>
                Cancelar
              </Button>
            </div>
          }
        >
          {deleteQuestion}
        </Note>
      )}
      {error && (
        <Note id="email-selection-error" icon={Trash2} role="alert" className="max-w-[520px] text-left">
          {error}
        </Note>
      )}
      <p className="text-12 text-text-faint">⌘ clique escolhe uma a uma · ⇧ clique escolhe um intervalo · Esc limpa</p>
    </section>
  )
}
