import { ExternalLink, Eye, EyeOff, Reply, Trash2 } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { CAPTION_MAX } from '@shared/redes-rules'
import type { RedesComment, RedesMediaWithComments } from '@shared/redes'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { ScrollFade } from '../../design/ScrollFade'
import { commentAge, commentDateTime, commentsCountLabel, mediaCaptionLine } from './commentsFormat'
import { redesDate } from './redesFormat'
import { useRedes } from './redesStore'

const NUMBER = new Intl.NumberFormat('pt-BR')
const ACTIONS = 'flex shrink-0 items-center gap-1.5 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]'

/** Quem a pessoa está respondendo: o comentário clicado e o de cima (para onde a resposta vai). */
interface ReplyTarget {
  commentId: string
  topId: string
}

/**
 * Contrato 73 (artboard 05): os comentários de uma mídia em ordem cronológica, com as respostas recuadas 28 px. Cada um
 * mostra o @, a hora relativa e o texto (de terceiros: só texto, nunca marcação); as ações aparecem no hover ou no foco:
 * Responder (campo na linha, Enter envia, Esc cancela, até 2.200), Ocultar/Mostrar (o oculto fica apagado com o selo) e
 * Excluir (confirmação na linha). A resposta a uma resposta vai ao comentário de cima, que é o que o Instagram aceita.
 */
export function CommentsThread({ accountId, media, own, fresh, onError }: { accountId: string; media: RedesMediaWithComments; own: { id: string; username: string }; fresh: ReadonlySet<string>; onError: (text: string | null) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [reply, setReply] = useState<ReplyTarget | null>(null)
  const [draft, setDraft] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const now = new Date()
  const caption = mediaCaptionLine(media)
  const store = useRedes.getState

  const focusAction = (commentId: string, action: 'reply' | 'delete'): void => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-redes-comment="${commentId}"] [data-redes-comment-${action}]`)?.focus({ preventScroll: true }))
  }
  const openReply = (comment: RedesComment, top: RedesComment): void => {
    onError(null)
    setConfirm(null)
    setReply({ commentId: comment.id, topId: top.id })
    // Responder a uma resposta: o @ dela já vai no começo, como no Instagram.
    setDraft(comment.parentId && comment.username ? `@${comment.username} ` : '')
  }
  const cancelReply = (): void => {
    const target = reply
    setReply(null)
    setDraft('')
    if (target) focusAction(target.commentId, 'reply')
  }
  const chars = [...draft].length
  const sendReply = async (): Promise<void> => {
    if (!reply || busy || !draft.trim() || chars > CAPTION_MAX) return
    setBusy(reply.commentId)
    onError(null)
    const result = await store().replyComment(accountId, reply.commentId, draft)
    setBusy(null)
    if (!result.ok) {
      onError(result.error)
      return
    }
    const target = reply
    setReply(null)
    setDraft('')
    focusAction(target.commentId, 'reply')
  }
  const run = async (commentId: string, call: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    setBusy(commentId)
    onError(null)
    const result = await call()
    setBusy(null)
    if (!result.ok) onError(result.error ?? null)
  }
  const onReplyKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void sendReply()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelReply()
    }
  }

  const item = (comment: RedesComment, top: RedesComment) => {
    const mine = comment.fromId === own.id || comment.username === own.username
    const confirming = confirm === comment.id
    const replying = reply?.commentId === comment.id
    const isNew = fresh.has(comment.id)
    return (
      <li
        key={comment.id}
        data-redes-comment={comment.id}
        data-redes-comment-hidden={comment.hidden ? '' : undefined}
        data-redes-comment-reply-of={comment.parentId ?? undefined}
        className={`group flex flex-col border-b border-line pb-1.5 last:border-b-0 ${comment.parentId ? 'pl-7' : ''}`}
      >
        <div className="flex h-8 min-w-0 items-center gap-2">
          <span data-redes-comment-user className="min-w-0 truncate text-13 font-semibold text-title">
            @{comment.username || 'usuário'}
          </span>
          <time dateTime={comment.timestamp} title={commentDateTime(comment.timestamp)} data-redes-comment-time className="shrink-0 text-12 tabular text-text-faint">
            {commentAge(comment.timestamp, now)}
          </time>
          {isNew && (
            <span data-redes-comment-new className="shrink-0 text-11 font-medium text-accent">
              novo
            </span>
          )}
          {comment.hidden && (
            <span data-redes-comment-hidden-badge className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-line-strong px-1.5 text-11 font-medium text-text-muted">
              <Icon icon={EyeOff} size={14} />
              Oculto
            </span>
          )}
          <span className="flex-1" />
          {confirming ? (
            <div data-redes-comment-delete-ask className={ACTIONS}>
              <span className="text-12 text-text">Excluir este comentário?</span>
              <Button
                variant="danger"
                action="redes-comment-delete-confirm"
                data={{ 'data-redes-comment-delete-confirm': comment.id }}
                disabled={busy !== null}
                onClick={() => {
                  setConfirm(null)
                  void run(comment.id, () => store().deleteComment(accountId, comment.id))
                }}
              >
                Excluir
              </Button>
              <Button
                variant="secondary"
                action="redes-comment-delete-cancel"
                onClick={() => {
                  setConfirm(null)
                  focusAction(comment.id, 'delete')
                }}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <div data-redes-comment-actions className={`${ACTIONS} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`}>
              <ActionButton icon={Reply} label="Responder" action="redes-comment-reply" data={{ 'data-redes-comment-reply': comment.id }} disabled={busy !== null} onClick={() => openReply(comment, top)} />
              {!mine && (
                <ActionButton
                  icon={comment.hidden ? Eye : EyeOff}
                  label={comment.hidden ? 'Mostrar' : 'Ocultar'}
                  action="redes-comment-hide"
                  data={{ 'data-redes-comment-hide': comment.id }}
                  disabled={busy !== null}
                  onClick={() => void run(comment.id, () => store().hideComment(accountId, comment.id, !comment.hidden))}
                />
              )}
              <ActionButton
                icon={Trash2}
                label="Excluir"
                tone="danger"
                action="redes-comment-delete"
                data={{ 'data-redes-comment-delete': comment.id }}
                disabled={busy !== null}
                onClick={() => {
                  onError(null)
                  setReply(null)
                  setConfirm(comment.id)
                }}
              />
            </div>
          )}
        </div>
        <p data-redes-comment-text className={`text-13 break-words whitespace-pre-wrap text-text ${comment.hidden ? 'opacity-60' : ''}`}>
          {comment.text}
        </p>
        {replying && (
          <div data-redes-comment-reply-box className="mt-2 flex flex-col gap-1.5">
            <textarea
              data-redes-comment-reply-input
              aria-label={`Responder a @${comment.username}`}
              value={draft}
              rows={2}
              // O campo abre pelo clique em "Responder" e é o próximo passo.
              autoFocus
              disabled={busy !== null}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onReplyKey}
              onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
              className="no-drag min-h-13 resize-none rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2.5 py-1.5 text-13 text-text select-text placeholder:text-text-faint"
              placeholder="Escreva a resposta"
            />
            <div className="flex items-center gap-2">
              <span className="text-12 text-text-muted">↵ envia · Esc cancela</span>
              <span className="flex-1" />
              <span data-redes-comment-reply-count className={`text-12 tabular ${chars > CAPTION_MAX ? 'text-rec' : 'text-text-faint'}`}>
                {NUMBER.format(chars)}/{NUMBER.format(CAPTION_MAX)}
              </span>
              <Button variant="secondary" action="redes-comment-reply-cancel" onClick={cancelReply}>
                Cancelar
              </Button>
              <Button action="redes-comment-reply-send" data={{ 'data-redes-comment-reply-send': comment.id }} disabled={busy !== null || !draft.trim() || chars > CAPTION_MAX} onClick={() => void sendReply()}>
                {busy === comment.id ? 'Respondendo…' : 'Responder'}
              </Button>
            </div>
          </div>
        )}
      </li>
    )
  }

  return (
    <section aria-label="Comentários da publicação" data-redes-thread={media.mediaId} className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-6">
        <div className="flex min-w-0 flex-1 flex-col">
          <p data-redes-thread-caption className={`truncate text-13 font-semibold ${caption ? 'text-title' : 'text-text-faint'}`}>
            {caption || 'Sem legenda'}
          </p>
          <p data-redes-thread-line className="truncate text-12 text-text-muted">
            {commentsCountLabel(media.commentsCount)} · publicada em {redesDate(media.timestamp)}
          </p>
        </div>
        {media.permalink && (
          <ActionButton icon={ExternalLink} label="Abrir no Instagram" action="redes-comments-open" data={{ 'data-redes-thread-open': '' }} onClick={() => media.permalink && window.__scribeApi.send('scribe:open-link', media.permalink)} />
        )}
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-1 pb-6">
          <ul className="flex flex-col">{media.comments.flatMap((top) => [item(top, top), ...top.replies.map((replyItem) => item(replyItem, top))])}</ul>
        </div>
        <ScrollFade target={listRef} tone="page" />
      </div>
    </section>
  )
}
