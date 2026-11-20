import { ExternalLink, Pencil, RefreshCw, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { Publication, PublicationState } from '@shared/redes'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { ScrollFade } from '../../design/ScrollFade'
import { MediaThumb } from './MediaThumb'
import { publicationLine } from './redesFormat'
import { useRedes } from './redesStore'

type GroupId = 'erro' | 'rascunho' | 'agendada' | 'publicada'

/** Os grupos na ordem do artboard 03; a que está publicando fica no topo das publicadas, a caminho delas. */
const GROUPS: readonly { id: GroupId; title: string; states: readonly PublicationState[] }[] = [
  { id: 'erro', title: 'Com erro', states: ['erro'] },
  { id: 'rascunho', title: 'Rascunhos', states: ['rascunho'] },
  { id: 'agendada', title: 'Agendadas', states: ['agendada'] },
  { id: 'publicada', title: 'Publicadas', states: ['publicando', 'publicada'] },
]

const time = (iso: string | null): number => (iso ? Date.parse(iso) : 0)

/** Agendadas pela hora marcada (a próxima primeiro); publicadas da mais nova (publicando no topo); o resto pela última edição. */
function sorted(group: GroupId, list: Publication[]): Publication[] {
  const copy = [...list]
  if (group === 'agendada') return copy.sort((a, b) => time(a.scheduledAt) - time(b.scheduledAt))
  if (group === 'publicada') return copy.sort((a, b) => Number(b.state === 'publicando') - Number(a.state === 'publicando') || time(b.publishedAt) - time(a.publishedAt))
  return copy.sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
}

/** A primeira linha da legenda (a fila mostra uma linha só, com reticências). */
const captionLine = (caption: string): string => caption.split('\n').find((line) => line.trim())?.trim() ?? ''

/**
 * A fila de publicações de uma conta (contrato 72, artboard 03): os grupos Com erro, Rascunhos, Agendadas e Publicadas com
 * a contagem (grupo vazio some), uma linha de 44 px por publicação (a com erro ganha a terceira linha com a mensagem) e
 * as ações da linha no hover ou no foco. Rola sozinha, com o esmaecimento no pé.
 */
export function PublicationsList({ publications, editingId, onEdit }: { publications: Publication[]; editingId: string | null; onEdit: (id: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null)
  const now = new Date()

  const run = async (id: string, call: () => Promise<{ ok: true } | { ok: false; error: string }>): Promise<void> => {
    setRowError(null)
    const result = await call()
    if (!result.ok) setRowError({ id, text: result.error })
  }
  const store = useRedes.getState

  const actions = (publication: Publication) => {
    const { id } = publication
    if (publication.state === 'publicando') return null
    if (confirmDelete === id) {
      return (
        <div data-redes-pub-delete-ask className="flex shrink-0 items-center gap-2">
          <span className="text-12 text-text">Excluir esta publicação?</span>
          <Button
            variant="danger"
            action="redes-pub-delete-confirm"
            data={{ 'data-redes-pub-delete-confirm': id }}
            onClick={() => {
              setConfirmDelete(null)
              void run(id, () => store().deletePublication(id))
            }}
          >
            Excluir
          </Button>
          <Button variant="secondary" action="redes-pub-delete-cancel" onClick={() => setConfirmDelete(null)}>
            Cancelar
          </Button>
        </div>
      )
    }
    const edit = <ActionButton icon={Pencil} label="Editar" action="redes-pub-edit" data={{ 'data-redes-pub-action': 'editar' }} onClick={() => onEdit(id)} />
    let buttons
    switch (publication.state) {
      case 'rascunho':
        buttons = (
          <>
            {edit}
            <ActionButton icon={Trash2} label="Excluir" tone="danger" action="redes-pub-delete" data={{ 'data-redes-pub-action': 'excluir' }} onClick={() => setConfirmDelete(id)} />
          </>
        )
        break
      case 'agendada':
        buttons = (
          <>
            {edit}
            <ActionButton icon={Undo2} label="Voltar a rascunho" action="redes-pub-unschedule" data={{ 'data-redes-pub-action': 'voltar' }} onClick={() => void run(id, () => store().unschedule(id))} />
          </>
        )
        break
      case 'erro':
        buttons = (
          <>
            <ActionButton icon={RefreshCw} label="Tentar de novo" action="redes-pub-retry" data={{ 'data-redes-pub-action': 'tentar' }} onClick={() => void run(id, () => store().retry(id))} />
            {edit}
          </>
        )
        break
      case 'publicada':
        buttons = publication.permalink ? (
          <ActionButton
            icon={ExternalLink}
            label="Abrir no Instagram"
            action="redes-pub-open"
            data={{ 'data-redes-pub-action': 'abrir' }}
            onClick={() => publication.permalink && window.__scribeApi.send('scribe:open-link', publication.permalink)}
          />
        ) : null
        break
    }
    return buttons ? (
      <div data-redes-pub-actions className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] group-hover:opacity-100 group-focus-within:opacity-100">
        {buttons}
      </div>
    ) : null
  }

  const groups = GROUPS.map((group) => ({ ...group, items: sorted(group.id, publications.filter((item) => group.states.includes(item.state))) })).filter((group) => group.items.length > 0)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={listRef} data-redes-queue className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[var(--page-x)] pt-3 pb-8">
        {groups.length === 0 && (
          <p data-redes-queue-empty className="pt-2 text-13 text-text-muted">
            Nenhuma publicação ainda. "Nova publicação" começa um rascunho com as mídias e a legenda.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.id} data-redes-group={group.id} aria-label={group.title} className="flex flex-col">
            <h2 className="label flex h-7 items-center gap-1.5">
              <span>{group.title}</span>
              <span data-redes-group-count className="tabular text-text-faint">
                {group.items.length}
              </span>
            </h2>
            <ul className="flex flex-col">
              {group.items.map((publication) => {
                const editing = publication.id === editingId
                const first = publication.media[0]
                const caption = captionLine(publication.caption)
                const error = rowError?.id === publication.id ? rowError.text : publication.state === 'erro' || publication.state === 'agendada' ? publication.error : null
                return (
                  <li
                    key={publication.id}
                    data-redes-pub={publication.id}
                    data-redes-pub-state={publication.state}
                    data-redes-pub-editing={editing ? '' : undefined}
                    className={`group flex min-h-[var(--row-h)] items-center gap-3 border-b border-line px-2 py-1 last:border-b-0 ${editing ? 'bg-bg-sunken' : ''}`}
                  >
                    {first && <MediaThumb path={first.localPath} kind={first.kind} size={36} />}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p data-redes-pub-caption className={`truncate text-13 font-medium ${caption ? 'text-text' : 'text-text-faint'}`}>
                        {caption || 'Sem legenda'}
                      </p>
                      <p data-redes-pub-line className="truncate text-12 text-text-muted">
                        {publicationLine(publication, now, editing)}
                      </p>
                      {error && (
                        <p data-redes-pub-error className={`flex min-w-0 items-center gap-1 text-12 ${publication.state === 'agendada' && rowError?.id !== publication.id ? 'text-text-muted' : 'text-rec'}`}>
                          <Icon icon={TriangleAlert} size={14} className="shrink-0" />
                          <span className="truncate">{error}</span>
                        </p>
                      )}
                    </div>
                    {actions(publication)}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      <ScrollFade target={listRef} tone="page" />
    </div>
  )
}
