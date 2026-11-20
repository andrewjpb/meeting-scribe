import { MessageCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RedesMediaWithComments } from '@shared/redes'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/EmptyState'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { PageHeader } from '../../design/PageHeader'
import { ScrollFade } from '../../design/ScrollFade'
import { CommentsThread } from './CommentsThread'
import { CommentsThumb } from './CommentsThumb'
import { commentsCountLabel, commentsUpdatedLine, mediaCaptionLine, unreadLabel } from './commentsFormat'
import { useRedes } from './redesStore'

const PAGE_TOP = 'px-[var(--page-x)] pt-[var(--page-top)] pb-4'

/** Os ids dos comentários e respostas ainda não lidos de uma mídia. */
const unreadIds = (media: RedesMediaWithComments): string[] => media.comments.flatMap((top) => [top, ...top.replies]).filter((comment) => !comment.read).map((comment) => comment.id)

/**
 * Redes › Comentários (contrato 73, R5 e CA10, artboard 05): "@conta · Comentários" com "Atualizar"; à esquerda, as mídias
 * com comentário (miniatura, legenda em uma linha, "N comentários · M novos"); abrir uma mídia mostra os comentários dela
 * à direita e marca como lidos (o selo "novo" fica nos que eram novos enquanto ela está aberta). Abrir a seção atualiza.
 * Sem comentário nenhum, o estado vazio com a data da última atualização.
 */
export function CommentsSection({ accountId, username, title, notice }: { accountId: string; username: string; title: string; notice: ReactNode }) {
  const account = useRedes((state) => state.state?.accounts.find((item) => item.id === accountId) ?? null)
  const payload = useRedes((state) => state.comments[accountId])
  const loading = useRedes((state) => state.commentsLoading[accountId] === true)
  const [selected, setSelected] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const media = payload?.media ?? []
  const open = media.find((item) => item.mediaId === selected) ?? null
  const freshIds = useRedes((state) => (selected ? state.commentsFresh[selected] : undefined))

  // Abrir a seção: o que está guardado na hora e a leitura do Instagram em seguida.
  useEffect(() => {
    void useRedes.getState().loadComments(accountId)
    void useRedes.getState().refreshComments(accountId)
  }, [accountId])

  // Abrir a mídia (o clique) a deixa lida; o que chegar enquanto ela está aberta só conta como lido com a janela em
  // foco (a pessoa está lendo), como na conversa das mensagens. O "novo" fica nos que eram novos.
  const openId = open?.mediaId ?? null
  const pending = open ? unreadIds(open).join(',') : ''
  useEffect(() => {
    if (openId && pending && document.hasFocus()) void useRedes.getState().markCommentsRead(accountId, openId)
  }, [accountId, openId, pending])

  const choose = (mediaId: string): void => {
    if (mediaId === selected) return
    useRedes.getState().clearCommentsFresh()
    setActionError(null)
    setSelected(mediaId)
    const target = media.find((item) => item.mediaId === mediaId)
    if (target && unreadIds(target).length) void useRedes.getState().markCommentsRead(accountId, mediaId)
  }

  const error = actionError ?? payload?.error ?? null
  const refreshing = loading && !payload?.updatedAt

  return (
    <div data-redes-comments className="flex min-h-0 flex-1 flex-col">
      <div className={PAGE_TOP}>
        <PageHeader
          title={title}
          titleAttrs={{ 'data-redes-title': '' }}
          actions={
            <Button variant="secondary" icon={RefreshCw} action="redes-comments-refresh" data={{ 'data-redes-comments-refresh': '' }} disabled={loading} onClick={() => void useRedes.getState().refreshComments(accountId)}>
              {loading ? 'Atualizando…' : 'Atualizar'}
            </Button>
          }
        />
      </div>
      {notice}
      {error && (
        <div data-redes-comments-error className="px-[var(--page-x)] pb-3">
          <Note id="redes-comments-error" icon={TriangleAlert} role="alert">
            {error}
          </Note>
        </div>
      )}
      {media.length === 0 ? (
        <div data-redes-comments-empty className="flex flex-1 flex-col items-center border-t border-line px-[var(--page-x)]">
          <div className="grow-[3]" />
          {!refreshing && (
            <EmptyState
              illustration={
                <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised text-text-muted">
                  <Icon icon={MessageCircle} />
                </span>
              }
              title="Nenhum comentário ainda"
            >
              <span data-redes-comments-updated>
                Os comentários das 25 publicações mais recentes de @{username} aparecem aqui. {commentsUpdatedLine(payload?.updatedAt ?? null, new Date())}
              </span>
            </EmptyState>
          )}
          <div className="grow-[7]" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 border-t border-line">
          <div className="relative flex w-[300px] shrink-0 flex-col border-r border-line">
            <ul ref={listRef} aria-label="Publicações com comentários" data-redes-comments-media className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {media.map((item) => {
                const caption = mediaCaptionLine(item)
                const current = item.mediaId === selected
                return (
                  <li key={item.mediaId} className="flex flex-col">
                    <button
                      type="button"
                      data-redes-media={item.mediaId}
                      aria-current={current ? 'true' : undefined}
                      onClick={() => choose(item.mediaId)}
                      className={`no-drag flex h-11 min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] px-1 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${current ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}
                    >
                      <CommentsThumb path={item.thumbPath} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span data-redes-media-caption className={`truncate text-13 font-medium ${caption ? 'text-text' : 'text-text-faint'}`}>
                          {caption || 'Sem legenda'}
                        </span>
                        <span data-redes-media-line className="truncate text-12 text-text-muted">
                          {commentsCountLabel(item.commentsCount)}
                          {item.unread > 0 && (
                            <>
                              {' · '}
                              <span data-redes-media-unread className="font-medium text-accent">
                                {unreadLabel(item.unread)}
                              </span>
                            </>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <ScrollFade target={listRef} tone="page" />
          </div>
          {open && account ? (
            <CommentsThread key={open.mediaId} accountId={accountId} media={open} own={{ id: account.id, username: account.username }} fresh={new Set(freshIds ?? [])} onError={setActionError} />
          ) : (
            <div data-redes-thread-none className="flex flex-1 items-center justify-center px-6">
              <p className="text-13 text-text-muted">Escolha uma publicação para ver os comentários.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
