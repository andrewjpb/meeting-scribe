import { ArrowLeft, Download, ExternalLink, Folder, FolderInput, Forward, ImageOff, Mail, MailOpen, MoreHorizontal, Paperclip, Reply, ReplyAll, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { Component, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { isInbox, type EmailAccount, type EmailMessage } from '@shared/email'
import { useLock } from '../../app/lockStore'
import { useSettings } from '../../app/settingsStore'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { ContactLink } from '../funil/ContactLink'
import { MENU_ITEM, useInlineMenu } from '../meetings/menu'
import { Avatar } from '../whatsapp/Avatar'
import { bodyKey, useEmail } from './emailStore'
import { addressLabel, addressLine, emailFullDate, sizeLabel, type ComposeMode } from './format'
import type { FolderItem } from './folderTree'
import { InviteCard } from './InviteCard'
import { InviteSuggestCard, useInviteSuggest } from './InviteSuggestCard'
import { linkify, sanitizeEmailHtml } from './sanitize'

/** "Voltar para a lista": só na janela estreita, quando a lista e a leitura se alternam. */
const NARROW_ONLY = 'min-[900px]:hidden'
const BACK_BUTTON = 'no-drag inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-title hover:bg-bg-sunken'

/** Falha ao desenhar o corpo de um email: o aviso no lugar dele, sem derrubar o resto do app. */
class BodyBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <Note id="email-body-crash" icon={TriangleAlert} role="alert">
        Não foi possível mostrar esta mensagem.
      </Note>
    )
  }
}

/** Link de um email: `https` abre no navegador depois da confirmação; `mailto:` abre o composer. */
type LinkAsk = { kind: 'https'; url: string } | { kind: 'insecure'; url: string }

interface ReadingPaneProps {
  account: EmailAccount
  message: EmailMessage
  /** Responder, Responder a todos e Encaminhar: quem chama espera o corpo (e os anexos) antes de abrir o composer. */
  onCompose: (mode: Exclude<ComposeMode, 'new'>) => void
  /** Já preparando o composer (o corpo ou os anexos ainda chegando). */
  composing: boolean
  /** `mailto:` de um link do email. */
  onMailto: (address: string) => void
  onDeleted: () => void
  /** Janela estreita: volta para a lista. */
  onBack: () => void
  /**
   * Contrato 55 (CA6): o menu "Mais", com "Mover para…" (o seletor, embaixo do botão) e as até 3 pastas recentes; sem
   * isto (POP3, Enviados do app), o botão não aparece.
   */
  move?: { recents: FolderItem[]; onPick: (anchor: DOMRect | null) => void; onMoveTo: (path: string) => void } | undefined
  /** Contrato 55: Apagar só onde o main apaga (Caixa de Entrada e Enviados). */
  canDelete?: boolean
  /** Contrato 55 (CA12): aberta durante a organização, o botão que volta ao painel. */
  onBackToOrganize?: (() => void) | undefined
}

/** "Mais" da barra da leitura (contrato 55, CA6, tela 02), no padrão dos menus em linha. */
function MoreMenu({ recents, onPick, onMoveTo }: NonNullable<ReadingPaneProps['move']>) {
  const [open, setOpen] = useState(false)
  const { button, menu, onBlur, onKeyDown } = useInlineMenu(open, () => setOpen(false))
  return (
    <div onBlur={onBlur} onKeyDown={open ? onKeyDown : undefined} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        data-action="email-more"
        aria-label="Mais"
        title="Mais"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-strong text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken ${open ? 'bg-bg-sunken' : ''}`}
      >
        <Icon icon={MoreHorizontal} size={14} />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Mais" data-email-more-menu className="absolute top-full right-0 z-10 mt-1 flex w-60 flex-col overflow-hidden rounded-[var(--radius-control)] border border-line-strong bg-bg-raised py-1">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-action="email-more-move"
            aria-keyshortcuts="Shift+Meta+M"
            onClick={() => {
              setOpen(false)
              onPick(button.current?.getBoundingClientRect() ?? null)
            }}
            className={`${MENU_ITEM} gap-2.5 text-text`}
          >
            <Icon icon={FolderInput} />
            <span className="flex-1">Mover para…</span>
            <span className="text-12 text-text-faint">⇧⌘M</span>
          </button>
          {recents.length > 0 && (
            <>
              <div role="separator" className="my-1 h-px bg-line" />
              <p aria-hidden="true" className="label px-3 pt-1 pb-1">
                Recentes
              </p>
              {recents.map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  data-email-recent={folder.path}
                  onClick={() => {
                    setOpen(false)
                    onMoveTo(folder.path)
                  }}
                  className={`${MENU_ITEM} gap-2.5 text-text`}
                >
                  <Icon icon={Folder} />
                  <span className="truncate">{folder.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Painel de leitura (contrato 43, CA1 e CA2): a barra de ações (Responder, Responder a todos, Encaminhar, Apagar e
 * Marcar como lida ou não lida), o cabeçalho (assunto, remetente, Para, Cc e data) e o corpo. HTML só sanitizado,
 * com as imagens de fora bloqueadas até "Carregar imagens"; texto puro com os links clicáveis.
 */
export function ReadingPane({ account, message, onCompose, composing, onMailto, onDeleted, onBack, move, canDelete = true, onBackToOrganize }: ReadingPaneProps) {
  const state = useEmail((store) => store.bodies[bodyKey(account.id, message.id)])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [ask, setAsk] = useState<LinkAsk | null>(null)
  const sender = message.from[0]
  // Contrato 116 (R36): "+ Contato" ao lado do remetente, menos quando ele é uma das contas do usuário.
  const accounts = useEmail((store) => store.accounts)
  const senderAddress = sender?.address.trim().toLowerCase() ?? ''
  const ownSender = [account, ...(accounts ?? []).map((status) => status.account)].some((item) => item.address.trim().toLowerCase() === senderAddress)
  // Contrato 64 (CA14): "Sugerir evento" só com a opção ligada, o corpo já lido e sem convite; nunca com o app bloqueado.
  const suggestOn = useSettings((store) => store.settings.inviteSuggest)
  const locked = useLock((store) => store.status.locked)
  const suggest = useInviteSuggest(account.id, message.id)
  const bodyReady = state !== undefined && state !== 'loading' && state !== 'error'
  const canSuggest = suggestOn && !locked && bodyReady && !state.invite
  const suggestLabel = suggest.view?.phase === 'loading' ? 'Sugerindo…' : 'Sugerir evento'

  const remove = (): void => {
    void useEmail
      .getState()
      .remove(account.id, message.id)
      .then((ok) => {
        setConfirmDelete(false)
        if (ok) onDeleted()
        else setActionError('Não foi possível apagar agora. Confira se a conta está conectada e tente de novo.')
      })
  }

  const toggleSeen = (): void => {
    setActionError(null)
    void useEmail
      .getState()
      .markRead(account.id, message.id, !message.seen)
      .then((ok) => {
        if (!ok) setActionError('Não foi possível marcar agora. Confira se a conta está conectada e tente de novo.')
      })
  }

  const openLink = (href: string): void => {
    if (/^mailto:/i.test(href)) {
      let address = href.slice(7).split('?')[0] ?? ''
      try {
        address = decodeURIComponent(address)
      } catch {
        // Escape quebrado no link: fica o texto como veio (o composer confere o endereço).
      }
      onMailto(address)
      return
    }
    setAsk(/^https:/i.test(href) ? { kind: 'https', url: href } : { kind: 'insecure', url: href })
  }

  return (
    <section data-email-reading={message.id} aria-label={message.subject || '(sem assunto)'} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* CA7: uma linha só, como no Outlook: as três respostas com rótulo à esquerda; Marcar e Apagar só com o ícone, à direita.
          Contrato 64: "Sugerir evento" à direita, antes de Marcar (quadro 09); com a barra estreita, só o ícone. O grupo da
          direita nunca encolhe: se faltar espaço, quem é cortado é o da esquerda. */}
      <div data-email-actions className="@container/actions flex h-11 shrink-0 flex-nowrap items-center gap-2 overflow-hidden border-b border-line px-5">
        <div data-email-actions-left className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
          <button type="button" data-action="email-back" onClick={onBack} aria-label="Voltar para a lista" className={`${BACK_BUTTON} ${NARROW_ONLY}`}>
            <Icon icon={ArrowLeft} />
          </button>
          {onBackToOrganize && <ActionButton icon={Sparkles} label="Voltar ao andamento" action="email-back-to-organize" onClick={onBackToOrganize} />}
          <ActionButton icon={Reply} label="Responder" action="email-reply" disabled={composing} onClick={() => onCompose('reply')} />
          <ActionButton icon={ReplyAll} label="Responder a todos" action="email-reply-all" disabled={composing} onClick={() => onCompose('replyAll')} />
          <ActionButton icon={Forward} label="Encaminhar" action="email-forward" disabled={composing} onClick={() => onCompose('forward')} />
        </div>
        <div data-email-actions-right className="flex shrink-0 flex-nowrap items-center gap-2">
          {canSuggest && (
            <>
              <span data-invite-suggest-wide className="hidden @min-[660px]/actions:contents">
                <ActionButton icon={Sparkles} label={suggestLabel} action="invite-suggest" disabled={suggest.view?.phase === 'loading'} onClick={suggest.start} />
              </span>
              <span data-invite-suggest-narrow className="contents @min-[660px]/actions:hidden">
                <ActionButton icon={Sparkles} label={suggestLabel} action="invite-suggest" iconOnly disabled={suggest.view?.phase === 'loading'} onClick={suggest.start} />
              </span>
            </>
          )}
          {isInbox(message) && (
            <ActionButton icon={message.seen ? Mail : MailOpen} label={message.seen ? 'Marcar como não lida' : 'Marcar como lida'} action="email-toggle-seen" iconOnly onClick={toggleSeen} />
          )}
          {canDelete && <ActionButton icon={Trash2} label="Apagar" action="email-delete" tone="danger" iconOnly onClick={() => setConfirmDelete(true)} />}
          {move && <MoreMenu {...move} />}
        </div>
      </div>
      <div data-email-reading-scroll className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
          {confirmDelete && (
            <Note
              id="email-delete-confirm"
              icon={Trash2}
              role="alert"
              action={
                <div className="flex gap-2">
                  <Button action="email-delete-confirm" variant="danger" onClick={remove}>
                    Apagar
                  </Button>
                  <Button action="email-delete-cancel" variant="secondary" onClick={() => setConfirmDelete(false)}>
                    Cancelar
                  </Button>
                </div>
              }
            >
              {isInbox(message) && message.uid !== null ? 'Apagar esta mensagem? Ela sai também do servidor.' : 'Apagar esta mensagem do app?'}
            </Note>
          )}
          {actionError && (
            <Note id="email-action-error" icon={TriangleAlert} role="alert">
              {actionError}
            </Note>
          )}
          <h2 data-email-subject className="text-17 font-semibold text-title select-text">
            {message.subject || '(sem assunto)'}
          </h2>
          <div className="flex items-start gap-3">
            <Avatar id={sender?.address ?? message.id} name={addressLabel(sender)} size={8} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-12 text-text-muted select-text">
              {/* R36: o "+ Contato" na mesma linha do remetente. O endereço parte de largura 0 e cresce até a dele (`basis-0
                  grow max-w-max`): a linha só quebra quando nome e botão não cabem, e o que encolhe (com reticências) é ele. */}
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span data-email-from title={addressLabel(sender)} className="max-w-full min-w-0 truncate text-13 font-bold text-text">
                  {addressLabel(sender)}
                </span>
                {sender && sender.name && <span className="max-w-max min-w-0 grow basis-0 truncate">{sender.address}</span>}
                {sender && senderAddress && !ownSender && (
                  <span className="self-center">
                    <ContactLink email={sender.address} nome={sender.name?.trim() || sender.address.split('@')[0] || sender.address} origem="email" />
                  </span>
                )}
              </p>
              {message.to.length > 0 && <p data-email-to>Para: {message.to.map(addressLine).join(', ')}</p>}
              {message.cc.length > 0 && <p data-email-cc>Cc: {message.cc.map(addressLine).join(', ')}</p>}
            </div>
            <span data-email-date className="shrink-0 text-12 tabular text-text-faint">
              {emailFullDate(message.date)}
            </span>
          </div>
          {/* Contrato 63: o cartão do convite, só com o corpo já lido e com convite (acima dos avisos do corpo). */}
          {state !== undefined && state !== 'loading' && state !== 'error' && state.invite && <InviteCard account={account} message={message} invite={state.invite} onLink={openLink} />}
          {/* Contrato 64: no mesmo lugar, a sugestão do Claude (ou a frase do erro). */}
          {canSuggest && suggest.view?.phase === 'ready' && <InviteSuggestCard accountId={account.id} id={message.id} suggestion={suggest.view.suggestion} onDiscard={suggest.discard} />}
          {canSuggest && suggest.view?.phase === 'error' && (
            <Note id="invite-suggest-error" icon={TriangleAlert} role="alert">
              {suggest.view.text}
            </Note>
          )}
          {ask && (
            <Note
              id="email-external-link"
              icon={ExternalLink}
              action={
                <div className="flex gap-2">
                  {ask.kind === 'https' && (
                    <Button
                      action="email-open-link"
                      variant="secondary"
                      onClick={() => {
                        window.__scribeApi.send('scribe:open-link', ask.url)
                        setAsk(null)
                      }}
                    >
                      Abrir
                    </Button>
                  )}
                  <Button action="email-cancel-link" variant="secondary" onClick={() => setAsk(null)}>
                    {ask.kind === 'https' ? 'Cancelar' : 'Fechar'}
                  </Button>
                </div>
              }
            >
              {ask.kind === 'https' ? `Abrir ${ask.url} no navegador?` : `O app só abre links seguros (https). Este não abre: ${ask.url}`}
            </Note>
          )}
          <BodyBoundary>
            <MessageBody accountId={account.id} messageId={message.id} state={state} onLink={openLink} />
          </BodyBoundary>
        </div>
      </div>
    </section>
  )
}

function MessageBody({ accountId, messageId, state, onLink }: { accountId: string; messageId: string; state: ReturnType<typeof useEmail.getState>['bodies'][string] | undefined; onLink: (href: string) => void }) {
  if (state === undefined || state === 'loading') {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true" data-email-body-loading>
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-4 w-full rounded-[var(--radius-control)] bg-bg-sunken last:w-2/3" />
        ))}
      </div>
    )
  }
  if (state === 'error') {
    return (
      <Note
        id="email-body-error"
        icon={TriangleAlert}
        role="alert"
        action={
          <button type="button" className="no-drag text-13 font-medium text-accent underline decoration-1 underline-offset-3" onClick={() => useEmail.getState().requestBody(accountId, messageId, true)}>
            Tentar de novo
          </button>
        }
      >
        Não foi possível abrir esta mensagem agora.
      </Note>
    )
  }
  return (
    <>
      {state.html ? <HtmlBody html={state.html} onLink={onLink} /> : <TextBody text={state.text ?? ''} onLink={onLink} />}
      {state.attachments.length > 0 && (
        <ul data-email-attachments aria-label="Anexos" className="flex flex-wrap gap-2 border-t border-line pt-4">
          {state.attachments.map((item, index) => (
            <AttachmentItem key={`${item.filename ?? ''}:${index}`} accountId={accountId} messageId={messageId} index={index} name={item.filename} size={item.size} />
          ))}
        </ul>
      )}
    </>
  )
}

const SAVE_ERRORS = { 'not-found': 'O anexo não está mais nesta mensagem.', unavailable: 'Não foi possível baixar agora. Confira se a conta está conectada.', write: 'Não foi possível gravar o arquivo nessa pasta.' } as const

/**
 * Um anexo recebido (CA8): nome, tamanho e "Baixar", que salva pelo diálogo do macOS. Os bytes vêm do servidor ou da
 * mensagem guardada só no clique; o arquivo nunca é aberto.
 */
function AttachmentItem({ accountId, messageId, index, name, size }: { accountId: string; messageId: string; index: number; name: string | null; size: number }) {
  const [state, setState] = useState<{ busy: boolean; saved: string | null; error: string | null }>({ busy: false, saved: null, error: null })
  const save = (): void => {
    setState({ busy: true, saved: null, error: null })
    void window.__scribeApi.invoke('scribe:email-attachment-save', { accountId, id: messageId, index }).then(
      (result) => setState(result === null ? { busy: false, saved: null, error: null } : result.ok ? { busy: false, saved: result.name, error: null } : { busy: false, saved: null, error: SAVE_ERRORS[result.error] }),
      () => setState({ busy: false, saved: null, error: SAVE_ERRORS.unavailable }),
    )
  }
  return (
    <li data-email-attachment={index} className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-bg-sunken py-1 pr-1 pl-2.5 text-12 text-text">
        <Icon icon={Paperclip} size={14} className="shrink-0 text-text-muted" />
        <span className="max-w-[240px] truncate">{name ?? 'Anexo sem nome'}</span>
        <span className="shrink-0 tabular text-text-faint">{sizeLabel(size)}</span>
        <ActionButton icon={Download} label={state.busy ? 'Baixando…' : 'Baixar'} action="email-attachment-save" disabled={state.busy} onClick={save} />
      </div>
      {state.saved && (
        <p role="status" data-email-attachment-saved className="text-12 text-text-muted">
          Salvo como {state.saved}.
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-12 text-rec">
          {state.error}
        </p>
      )}
    </li>
  )
}

/** HTML sanitizado; o clique num link passa pela confirmação. As imagens de fora só com "Carregar imagens". */
function HtmlBody({ html, onLink }: { html: string; onLink: (href: string) => void }) {
  const [images, setImages] = useState<Record<string, string | null> | null>(null)
  const [loading, setLoading] = useState(false)
  const clean = useMemo(() => sanitizeEmailHtml(html, images ? { images } : {}), [html, images])
  const pending = images ? clean.blocked.filter((url) => !(url in images)) : clean.blocked

  const load = (): void => {
    setLoading(true)
    void window.__scribeApi.invoke('scribe:email-remote-images', { urls: clean.blocked }).then(
      (found) => {
        setLoading(false)
        // As que não vieram ficam como texto alternativo (e não são pedidas de novo).
        setImages({ ...Object.fromEntries(clean.blocked.map((url) => [url, null])), ...found })
      },
      () => setLoading(false),
    )
  }

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const link = (event.target as Element).closest('a[data-email-link]')
    if (!link) return
    event.preventDefault()
    const href = link.getAttribute('href')
    if (href) onLink(href)
  }

  return (
    <>
      {pending.length > 0 && (
        <Note
          id="email-images-blocked"
          icon={ImageOff}
          role="status"
          action={
            <Button action="email-load-images" variant="secondary" onClick={load} disabled={loading}>
              {loading ? 'Carregando…' : 'Carregar imagens'}
            </Button>
          }
        >
          {pending.length === 1 ? 'Uma imagem de fora deste email foi bloqueada.' : `${pending.length} imagens de fora deste email foram bloqueadas.`}
        </Note>
      )}
      {/* `clean.html` só tem as marcas e os atributos da lista de permitidos (`sanitize.ts`). */}
      <div data-email-body="html" onClick={onClick} className="email-body select-text" dangerouslySetInnerHTML={{ __html: clean.html }} />
    </>
  )
}

function TextBody({ text, onLink }: { text: string; onLink: (href: string) => void }) {
  const parts: ReactNode[] = linkify(text).map((part, index) =>
    part.kind === 'link' ? (
      <a
        key={index}
        href={part.url}
        data-email-link=""
        onClick={(event) => {
          event.preventDefault()
          onLink(part.url)
        }}
      >
        {part.text}
      </a>
    ) : (
      part.text
    ),
  )
  return (
    <div data-email-body="text" className="email-body text-15 whitespace-pre-wrap select-text">
      {parts}
    </div>
  )
}
