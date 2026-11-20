import { Calendar, CalendarX, Check, FolderInput, Forward, Mail, MailOpen, PenLine, Reply, SquarePen, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { emailFolderFromSlug, emailFolderSegment, emailPath, settingsPath, type EmailNavigationState, type EmailRouteFolder } from '@shared/routes'
import { EMAIL_INBOX_MAILBOX, isInbox, isSent, type EmailAccount, type EmailBody, type EmailFolderNode, type EmailMessage } from '@shared/email'
import type { EmailSignature } from '@shared/email-signature'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { Avatar } from '../whatsapp/Avatar'
import { Composer } from './Composer'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { accountTree } from './EmailNav'
import { bodyKey, folderKey, useEmail } from './emailStore'
import { moveMessages, useEmailUi } from './emailUi'
import { breadcrumb, findFolder } from './folderTree'
import { accountLabel, addressLabel, composeFrom, createDraftRequests, emailTimeLabel, emptyDraft, groupByDay, previewLine, parseRecipients, rowTitle, signatureEntered, signedDraft, unreadCount, type ComposeMode, type Recipient } from './format'
import { recentTargets, submenuTargets } from './moveTargets'
import { MoveToPicker } from './MoveToPicker'
import { OrganizeBanner, OrganizePanel } from './OrganizePanel'
import { folderPhrase, organizeBanner, organizeView, panelBatch, type OrganizeTopicRow } from './organizeState'
import { ReadingPane } from './ReadingPane'
import { EMPTY_SELECTION, isMultiSelection, selectedLabel, selectionReducer, type EmailSelection, type SelectionAction } from './selection'
import { SelectionSummary } from './SelectionSummary'

/** Pede o corpo (para a prévia) quando a linha aparece na tela. */
function usePreview(accountId: string, id: string, target: RefObject<Element | null>): EmailBody | null {
  const state = useEmail((store) => store.bodies[bodyKey(accountId, id)])
  useEffect(() => {
    const el = target.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      useEmail.getState().requestBody(accountId, id)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        useEmail.getState().requestBody(accountId, id)
        observer.disconnect()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [accountId, id, target])
  return state && state !== 'loading' && state !== 'error' ? state : null
}

interface MessageRowProps {
  message: EmailMessage
  sentMailbox: string
  active: boolean
  /** Contrato 55 (CA4): com 2 ou mais marcadas, cada linha mostra a caixa de seleção no lugar do avatar. */
  selecting: boolean
  checked: boolean
  /** Saindo da lista (movida): esmaece por `--duration-base`. */
  leaving: boolean
  draggable: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onMenu: (event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) => void
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
}

/** O calendário (ou o calendário com X, no cancelamento) à direita do assunto (contrato 63, CA19). */
function InviteRowIcon({ cancel }: { cancel: boolean }) {
  const label = cancel ? 'Convite cancelado' : 'Convite de reunião'
  return (
    <span data-email-row-invite={cancel ? 'cancel' : 'invite'} title={label} className="inline-flex shrink-0 text-text-faint">
      <Icon icon={cancel ? CalendarX : Calendar} size={14} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Uma linha da lista, no desenho do Outlook: iniciais, quem mandou em peso forte, a hora à direita, o assunto e a prévia. */
function MessageRow({ message, sentMailbox, active, selecting, checked, leaving, draggable, onClick, onMenu, onDragStart, onDragEnd }: MessageRowProps) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const body = usePreview(message.accountId, message.id, ref)
  const unread = !isSent(message, { sentMailbox }) && !message.seen
  const person = isSent(message, { sentMailbox }) ? message.to[0] : message.from[0]
  return (
    <button
      ref={ref}
      type="button"
      data-email-message={message.id}
      data-email-unread={unread ? 'true' : 'false'}
      data-email-checked={checked ? 'true' : undefined}
      data-email-leaving={leaving ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      aria-hidden={leaving || undefined}
      tabIndex={leaving ? -1 : undefined}
      draggable={draggable && !leaving}
      onClick={onClick}
      onContextMenu={onMenu}
      onKeyDown={(event) => {
        if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') onMenu(event)
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`no-drag flex w-full min-w-0 items-start gap-3 rounded-[var(--radius-control)] border-l-3 px-2.5 py-2.5 text-left transition-opacity duration-[var(--duration-base)] ease-[var(--ease-out)] ${leaving ? 'pointer-events-none opacity-0' : ''} ${checked && selecting ? 'border-accent bg-bg-sunken' : active ? 'border-transparent bg-bg-sunken' : 'border-transparent hover:bg-bg-sunken'}`}
    >
      {selecting ? (
        <span role="checkbox" aria-checked={checked} aria-label={checked ? 'Selecionada' : 'Não selecionada'} data-email-row-checkbox className="inline-flex size-10 shrink-0 items-center justify-center">
          <span aria-hidden="true" className={`inline-flex size-4 items-center justify-center rounded-[var(--radius-control)] border ${checked ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-bg-raised'}`}>
            {checked && <Icon icon={Check} size={14} />}
          </span>
        </span>
      ) : (
        <Avatar id={person?.address ?? message.id} name={addressLabel(person)} size={10} />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span data-email-row-from className="min-w-0 flex-1 truncate text-13 font-bold text-title">
            {rowTitle(message, { sentMailbox })}
          </span>
          <span className={`shrink-0 text-12 tabular ${unread ? 'font-medium text-accent' : 'text-text-faint'}`}>{emailTimeLabel(message.date)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span data-email-row-subject className={`min-w-0 flex-1 truncate text-13 ${unread ? 'font-medium text-accent' : 'text-text'}`}>
            {message.subject || '(sem assunto)'}
          </span>
          {/* Contrato 63 (CA19): o convite, só com o corpo já baixado (nada é pedido por causa do ícone). */}
          {body?.invite && <InviteRowIcon cancel={body.invite.method === 'CANCEL'} />}
          {unread && <span data-email-unread-dot aria-hidden="true" className="size-1.5 shrink-0 bg-accent" />}
          {unread && <span className="sr-only">Não lida</span>}
        </span>
        <span data-email-row-preview className="truncate text-12 text-text-muted">
          {(body ? previewLine(body) : '') || ' '}
        </span>
      </span>
    </button>
  )
}

/**
 * Tela "Email" (contrato 43, CA1): a pasta escolhida na barra lateral em duas colunas, como no Outlook para desktop: a
 * lista (com "Nova mensagem" no topo e os grupos por dia) e a leitura da mensagem escolhida, ou o composer no lugar
 * dela. Janela estreita (menos de 900 px): uma coluna de cada vez, como no WhatsApp.
 *
 * Contrato 55: qualquer pasta da conta (CA1, CA3), seleção múltipla com ⌘ e ⇧ (CA4), arrastar para a barra lateral
 * (CA5), "Mover para…" por ⇧⌘M, menu "Mais" e clique direito (CA6 a CA8), e o painel "Organizando" do Assistente no
 * lugar da leitura, com a faixa do Desfazer no topo da lista (CA12, CA13).
 */
export function EmailScreen() {
  const { conta } = useParams()
  const location = useLocation()
  const accounts = useEmail((state) => state.accounts)
  const loadFailed = useEmail((state) => state.loadFailed)
  const trees = useEmail((state) => state.trees)

  if (!accounts) {
    return loadFailed ? (
      <div className="px-10 pt-7">
        <Note id="email-load-failed" icon={TriangleAlert} role="alert">
          Não foi possível ler as contas de email.
        </Note>
      </div>
    ) : null
  }
  const first = accounts[0]
  const status = accounts.find((item) => item.account.id === conta)
  const folder = emailFolderFromSlug(emailFolderSegment(location.pathname))
  if (!status || !folder) {
    if (first) return <Navigate replace to={emailPath(first.account.id, 'inbox')} />
    return (
      <div className="px-10 pt-7">
        <Note
          id="email-no-accounts"
          icon={Mail}
          role="status"
          action={
            <Link to={settingsPath('email')} className={NOTE_ACTION_CLASS}>
              Abrir Configurações › Email
            </Link>
          }
        >
          Nenhuma conta de email ainda. Adicione uma em Configurações › Email.
        </Note>
      </div>
    )
  }
  const tree = trees[status.account.id]
  const pop3 = status.account.incoming.protocol === 'pop3' || tree?.pop3 === true
  // CA1: pasta que não existe mais na conta (ou numa POP3, que só tem as duas) abre a Caixa de Entrada com a nota.
  if (typeof folder !== 'string' && folder.path.toUpperCase() !== EMAIL_INBOX_MAILBOX && (pop3 || (tree && !hasPath(tree.nodes, folder.path)))) {
    const state: EmailNavigationState = { missingFolder: folder.path }
    return <Navigate replace to={emailPath(status.account.id, 'inbox')} state={state} />
  }
  const normalized: EmailRouteFolder = typeof folder !== 'string' && folder.path.toUpperCase() === EMAIL_INBOX_MAILBOX ? 'inbox' : folder
  return <FolderView key={`${status.account.id}:${folderKey(status.account.id, normalized)}`} account={status.account} sentMailbox={status.sentMailbox} folder={normalized} pop3={pop3} nodes={tree?.nodes ?? []} />
}

const hasPath = (nodes: readonly EmailFolderNode[], path: string): boolean => nodes.some((node) => (node.path === path && !node.noselect) || hasPath(node.children, path))

/** A meia-noite local seguinte (a faixa do Desfazer vale até ela). */
function useToday(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const next = new Date(now)
    next.setHours(24, 0, 5, 0)
    const timer = window.setTimeout(() => setNow(Date.now()), next.getTime() - now)
    return () => window.clearTimeout(timer)
  }, [now])
  return now
}

interface FolderViewProps {
  account: EmailAccount
  sentMailbox: string
  folder: EmailRouteFolder
  pop3: boolean
  nodes: EmailFolderNode[]
}

function FolderView({ account, sentMailbox, folder, pop3, nodes }: FolderViewProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const key = folderKey(account.id, folder)
  const fromPath = folder === 'inbox' ? EMAIL_INBOX_MAILBOX : folder === 'sent' ? sentMailbox : folder.path
  const messages = useEmail((state) => state.folders[key])
  const leavingIds = useEmail((state) => state.leaving[key])
  const folderError = useEmail((state) => state.folderErrors[key])
  const accounts = useEmail((state) => state.accounts)
  const draft = useEmail((state) => state.draft)
  const composing = useEmail((state) => state.composing)
  const organize = useEmail((state) => state.organize)
  const batches = useEmail((state) => state.batches)
  const live = useEmail((state) => state.organizeLive)
  const closed = useEmail((state) => state.organizeClosed)
  const dismissed = useEmail((state) => state.bannerDismissed)
  const bannerResults = useEmail((state) => state.bannerResults)
  const recentsSaved = useSettingsRecents(account.id)
  const moveError = useEmailUi((state) => (state.moveError?.key === key ? state.moveError.text : null))
  const asked = (location.state ?? null) as EmailNavigationState | null
  const [selected, setSelected] = useState<string | null>(asked?.messageId ?? null)
  const [selection, setSelection] = useState<EmailSelection>(asked?.messageId ? { ids: [asked.messageId], anchor: asked.messageId } : EMPTY_SELECTION)
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Janela estreita: "Voltar" do painel "Organizando" mostra a lista (o painel volta ao abrir e fechar uma mensagem).
  const [listOverPanel, setListOverPanel] = useState(false)
  const now = useToday()
  // Outro pedido (o clique na notificação ou no painel): a mensagem pedida, ou nenhuma.
  const [seenKey, setSeenKey] = useState(location.key)
  if (seenKey !== location.key) {
    setSeenKey(location.key)
    setSelected(asked?.messageId ?? null)
    setSelection(asked?.messageId ? { ids: [asked.messageId], anchor: asked.messageId } : EMPTY_SELECTION)
  }
  const leaving = new Set(leavingIds ?? [])
  const visible = (messages ?? []).filter((message) => !leaving.has(message.id))
  const order = visible.map((message) => message.id)
  // CA4 e CA10: as que saíram da lista deixam a seleção; a aberta que saiu abre a próxima (ou o vazio).
  const [seenOrder, setSeenOrder] = useState(order)
  if (seenOrder.join('\n') !== order.join('\n')) {
    setSeenOrder(order)
    if (selected !== null && messages !== undefined && !order.includes(selected) && seenOrder.includes(selected)) {
      const next = seenOrder.slice(seenOrder.indexOf(selected) + 1).find((id) => order.includes(id)) ?? null
      setSelected(next)
      setSelection(next ? { ids: [next], anchor: next } : EMPTY_SELECTION)
    } else setSelection(selectionReducer(selection, { type: 'prune' }, order))
  }
  const dispatch = (action: SelectionAction): EmailSelection => {
    const next = selectionReducer(selection, action, order)
    setSelection(next)
    return next
  }

  const ownDraft = draft && draft.accountId === account.id ? draft : null
  const showComposer = composing && ownDraft !== null
  const open = visible.find((message) => message.id === selected) ?? null
  const multi = isMultiSelection(selection)
  const sidebar = accountTree(nodes, pop3)
  const name = (path: string): string => breadcrumb(path, nodes)
  const label = folder === 'inbox' ? 'Caixa de Entrada' : folder === 'sent' ? 'Enviados' : (findFolder(sidebar, folder.path)?.label ?? breadcrumb(folder.path, nodes))
  const movable = (message: EmailMessage): boolean => !pop3 && folder !== 'sent' && message.uid !== null
  const canDelete = folder === 'inbox' || folder === 'sent'

  // O painel "Organizando" desta conta (em qualquer pasta dela) e a faixa da pasta organizada.
  const liveSet = new Set(live)
  const panelEvent = panelBatch(organize, account.id, liveSet, new Set(closed))
  const view = panelEvent ? organizeView(panelEvent, batches[panelEvent.batchId] ?? null, name) : null
  const banner =
    organize.today
      .filter((event) => event.accountId === account.id)
      .map((event) => organizeBanner(event, batches[event.batchId] ?? null, now, new Set(dismissed), bannerResults))
      .filter((item) => item !== null && (item.path === fromPath || (folder === 'inbox' && item.path.toUpperCase() === EMAIL_INBOX_MAILBOX)))
      .at(-1) ?? null
  // D6: um lote novo desta conta toma a área da leitura.
  const [seenBatch, setSeenBatch] = useState(view?.running ? view.batchId : null)
  if (view?.running && seenBatch !== view.batchId) {
    setSeenBatch(view.batchId)
    setSelected(null)
    setSelection(EMPTY_SELECTION)
  }

  useEffect(() => {
    void useEmail.getState().loadFolder(account.id, folder)
  }, [account.id, folder])

  // A lista à vista (o `email-changed` relê esta do servidor) e, fora a INBOX, a pasta relida a cada 5 min (52 CA3).
  useEffect(() => {
    useEmail.setState({ viewing: key })
    return () => useEmail.setState((state) => (state.viewing === key ? { viewing: null } : {}))
  }, [key])
  useEffect(() => {
    if (typeof folder === 'string') return undefined
    window.__scribeApi.send('scribe:email-folder-watch', { accountId: account.id, path: folder.path })
    return () => window.__scribeApi.send('scribe:email-folder-watch', null)
  }, [account.id, folder])

  // Contrato 43 (CA4): o main sabe qual pasta está aberta aqui; com a janela em foco, o email novo dela não notifica.
  useEffect(() => window.__scribeApi.send('scribe:email-viewing', typeof folder === 'string' ? { accountId: account.id, folder } : null), [account.id, folder])
  useEffect(() => () => window.__scribeApi.send('scribe:email-viewing', null), [])

  // A mensagem aberta (pela lista ou pela notificação) é lida e conta como lida.
  const openId = open?.id ?? null
  useEffect(() => {
    if (!openId) return
    useEmail.getState().requestBody(account.id, openId)
    const current = useEmail.getState().folders[key]?.find((message) => message.id === openId)
    if (current && isInbox(current) && !current.seen) void useEmail.getState().markRead(account.id, openId, true)
  }, [account.id, key, openId])

  const [preparing, setPreparing] = useState(false)
  // Contrato 54: o rascunho que espera o main só abre se ainda for o último pedido (nada de composer por cima da
  // mensagem que a pessoa acabou de abrir, nem dois no clique duplo).
  const [draftRequests] = useState(createDraftRequests)
  useEffect(
    () => () => {
      draftRequests.cancel()
      setPreparing(false)
    },
    [account.id, key, draftRequests],
  )

  const openPicker = (ids: readonly string[], anchor: DOMRect | null = null): void => {
    const list = ids.filter((id) => visible.some((message) => message.id === id && movable(message)))
    if (!list.length) return
    useEmailUi.getState().openPicker({ accountId: account.id, from: folder, fromPath, ids: list, anchor: anchor ? { top: anchor.bottom + 4, right: anchor.right } : null })
  }
  const actionIds = (): string[] => (selection.ids.length ? selection.ids : selected ? [selected] : [])

  // ⇧⌘M (CA7): o seletor para a seleção ou a mensagem aberta, fora de um campo de texto.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'm') || event.repeat) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, [contenteditable="true"], [data-email-composer]') || useEmailUi.getState().picker) return
      event.preventDefault()
      openPicker(actionIds())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const choose = (event: MouseEvent<HTMLButtonElement>, id: string): void => {
    setListOverPanel(false)
    draftRequests.cancel()
    setPreparing(false)
    useEmail.getState().closeDraft(false)
    setPendingDelete(null)
    const next = dispatch({ type: 'click', id, meta: event.metaKey, shift: event.shiftKey })
    if (!event.metaKey && !event.shiftKey) setSelected(id)
    else setSelected(next.ids.length === 1 ? (next.ids[0] ?? null) : next.ids.length === 0 ? null : selected)
  }

  // Contrato 54 (CA4): a assinatura da conta entra no rascunho ao abrir; sem resposta do main, o rascunho vem sem ela.
  const signature = (): Promise<EmailSignature | null> =>
    window.__scribeApi.invoke('scribe:email-signature-get', { accountId: account.id }).then(
      (result) => (result.ok ? result.signature : null),
      () => null,
    )
  // Responder e Encaminhar esperam o corpo (a citação é da mensagem inteira) e, no Encaminhar, os anexos da original
  // (CA9), já nos limites do envio; os que passam ficam de fora e o composer diz quais.
  const compose = (mode: Exclude<ComposeMode, 'new'>, message: EmailMessage): void => {
    const token = draftRequests.start()
    setPreparing(true)
    void (async () => {
      const body = await useEmail.getState().loadBody(account.id, message.id)
      const found = await signature()
      const draft = { ...signedDraft(composeFrom(mode, message, body, { ...account, sentMailbox }), found), signed: signatureEntered(found, mode) }
      if (mode === 'forward' && body && body.attachments.length > 0) {
        const attached = await window.__scribeApi.invoke('scribe:email-attachments', { accountId: account.id, id: message.id }).catch(() => null)
        if (attached?.ok) {
          draft.attachments = attached.attachments
          draft.skippedAttachments = attached.skipped
        } else draft.skippedAttachments = body.attachments.map((item, index) => item.filename ?? `anexo-${index + 1}`)
      }
      if (draftRequests.current(token)) useEmail.getState().openDraft(draft)
    })().finally(() => draftRequests.current(token) && setPreparing(false))
  }

  const newMessage = (to: Recipient[] = []): void => {
    if (ownDraft && !to.length) {
      draftRequests.cancel()
      setPreparing(false)
      useEmail.getState().showDraft()
      return
    }
    const token = draftRequests.start()
    setPreparing(true)
    void signature()
      .then((found) => {
        if (draftRequests.current(token)) useEmail.getState().openDraft({ ...signedDraft({ ...emptyDraft(account.id), to }, found), signed: signatureEntered(found, 'new') })
      })
      .finally(() => draftRequests.current(token) && setPreparing(false))
  }

  const sent = (messageId: string): void => {
    useEmail.getState().closeDraft(true)
    void useEmail.getState().loadFolder(account.id, 'sent')
    const state: EmailNavigationState = { messageId }
    void navigate(emailPath(account.id, 'sent'), { state })
  }

  const markAll = async (ids: readonly string[], seen: boolean): Promise<void> => {
    setActionError(null)
    const store = useEmail.getState()
    const targets = visible.filter((message) => ids.includes(message.id) && message.seen !== seen)
    const results = await Promise.all(targets.map((message) => store.markRead(account.id, message.id, seen)))
    if (results.includes(false)) setActionError('Não foi possível marcar todas agora. Confira se a conta está conectada e tente de novo.')
  }
  const removeAll = async (ids: readonly string[]): Promise<boolean> => {
    let ok = true
    for (const id of ids) ok = (await useEmail.getState().remove(account.id, id)) && ok
    if (ids.includes(selected ?? '')) setSelected(null)
    return ok
  }

  // Clique direito (CA8): numa linha da seleção, a seleção inteira; fora dela, a seleção vira a linha.
  const openMenu = (event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>, id: string): void => {
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    const at = 'clientX' in event && event.clientX ? { x: event.clientX, y: event.clientY } : { x: box.left + 40, y: box.top + 24 }
    let ids = selection.ids
    if (!selection.ids.includes(id)) {
      ids = [id]
      setSelection({ ids, anchor: id })
      setSelected(id)
    }
    setMenu({ ...at, ids })
  }
  const menuEntries = (ids: string[]): MenuEntry[] => {
    const list = visible.filter((message) => ids.includes(message.id))
    const one = list.length === 1 ? (list[0] ?? null) : null
    const canMove = list.some(movable)
    const anyUnread = list.some((message) => !message.seen)
    const entries: MenuEntry[] = [
      { key: 'reply', label: 'Responder', icon: Reply, disabled: !one, data: { action: 'email-menu-reply' }, onSelect: () => one && compose('reply', one) },
      { key: 'forward', label: 'Encaminhar', icon: Forward, disabled: !one, data: { action: 'email-menu-forward' }, onSelect: () => one && compose('forward', one) },
    ]
    if (canMove) {
      entries.push({
        key: 'move',
        label: 'Mover para',
        icon: FolderInput,
        divider: true,
        data: { action: 'email-menu-move' },
        children: [
          ...submenuTargets(sidebar, fromPath).map(({ item, depth, disabled }) => ({ key: item.path, label: item.label, depth, disabled, data: { 'email-menu-folder': item.path }, onSelect: () => void moveMessages(account.id, folder, ids, item.path) })),
          { key: '\u0000other', label: 'Outra pasta…', shortcut: '⇧⌘M', divider: true, data: { action: 'email-menu-other' }, onSelect: () => openPicker(ids) },
        ],
      })
    }
    if (folder === 'inbox') entries.push({ key: 'seen', label: anyUnread ? (list.length > 1 ? 'Marcar como lidas' : 'Marcar como lida') : list.length > 1 ? 'Marcar como não lidas' : 'Marcar como não lida', icon: anyUnread ? MailOpen : Mail, divider: !canMove, data: { action: 'email-menu-seen' }, onSelect: () => void markAll(ids, anyUnread) })
    if (canDelete) entries.push({ key: 'delete', label: 'Apagar', icon: Trash2, tone: 'danger', divider: true, data: { action: 'email-menu-delete' }, onSelect: () => setPendingDelete(ids) })
    return entries
  }

  // Arrastar (CA5): a selecionada leva a seleção inteira; a não selecionada, só ela.
  const dragStart = (event: DragEvent<HTMLButtonElement>, message: EmailMessage): void => {
    if (!movable(message)) {
      event.preventDefault()
      return
    }
    const ids = selection.ids.includes(message.id) ? selection.ids.filter((id) => visible.some((item) => item.id === id && movable(item))) : [message.id]
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${ids.length}`)
    useEmailUi.getState().setDrag({ accountId: account.id, from: folder, fromPath, ids, pop3 })
  }

  const openTopic = (row: OrganizeTopicRow): void => {
    if (!row.open) return
    const target: EmailRouteFolder = isInbox({ mailbox: row.open.mailbox }) ? 'inbox' : row.open.mailbox === sentMailbox ? 'sent' : { path: row.open.mailbox }
    if (folderKey(account.id, target) === key) {
      setSelected(row.open.id)
      setSelection({ ids: [row.open.id], anchor: row.open.id })
      return
    }
    const state: EmailNavigationState = { messageId: row.open.id }
    void navigate(emailPath(row.open.accountId, target), { state })
  }

  const groups = groupByDay(messages ?? [])
  const unread = folder === 'inbox' ? unreadCount(messages) : folder === 'sent' ? 0 : visible.filter((message) => !message.seen).length
  const paneOpen = showComposer || open !== null || multi || (view !== null && !listOverPanel)
  const deleteText = (count: number): string => (count === 1 ? (folder === 'inbox' ? 'Apagar esta mensagem? Ela sai também do servidor.' : 'Apagar esta mensagem do app?') : folder === 'inbox' ? `Apagar estas ${count} mensagens? Elas saem também do servidor.` : `Apagar estas ${count} mensagens do app?`)
  // M2: as recentes com o caminho inteiro ("Clientes › ABF").
  const recents = recentTargets(recentsSaved, sidebar, fromPath).map((item) => ({ ...item, label: breadcrumb(item.path, nodes) }))
  const where = folderPhrase(batches[view?.batchId ?? banner?.batchId ?? '']?.fromPath ?? null, name)

  return (
    <div data-email-folder-view={typeof folder === 'string' ? folder : 'path'} data-email-folder-view-path={fromPath} data-email-view-account={account.id} className="flex min-h-0 flex-1">
      <aside aria-label={`${label} de ${account.address}`} className={`flex w-[340px] shrink-0 flex-col border-r border-line max-[899px]:w-full max-[899px]:border-r-0 ${paneOpen ? 'max-[899px]:hidden' : ''}`}>
        <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
          <div className="flex">
            <Button action="email-new" icon={ownDraft ? PenLine : SquarePen} onClick={() => newMessage()}>
              {ownDraft ? 'Voltar ao rascunho' : 'Nova mensagem'}
            </Button>
          </div>
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h1 data-email-folder-title className="truncate text-15 font-bold text-title">
              {label}
            </h1>
            <span className="shrink-0 text-12 tabular text-text-muted">{unread > 0 ? `${unread} não ${unread === 1 ? 'lida' : 'lidas'}` : ''}</span>
          </div>
          <p className="-mt-2 truncate px-1 text-12 text-text-muted">{account.address}</p>
          {multi && (
            <div data-email-selection-bar className="flex h-10 items-center gap-1 rounded-[var(--radius-control)] bg-bg-sunken pr-1 pl-3">
              <span data-email-selected-count className="min-w-0 flex-1 truncate text-13 font-medium text-title">
                {selectedLabel(selection.ids.length)}
              </span>
              {!pop3 && folder !== 'sent' && (
                <button type="button" data-action="email-bar-move" aria-label="Mover para…" title="Mover para… (⇧⌘M)" onClick={(event) => openPicker(selection.ids, event.currentTarget.getBoundingClientRect())} className="no-drag inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title">
                  <Icon icon={FolderInput} />
                </button>
              )}
              {folder === 'inbox' && (
                <button type="button" data-action="email-bar-read" aria-label="Marcar como lidas" title="Marcar como lidas" onClick={() => void markAll(selection.ids, true)} className="no-drag inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title">
                  <Icon icon={MailOpen} />
                </button>
              )}
              {canDelete && (
                <button type="button" data-action="email-bar-delete" aria-label="Apagar" title="Apagar" onClick={() => setPendingDelete(selection.ids)} className="no-drag inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-rec">
                  <Icon icon={Trash2} />
                </button>
              )}
              <button type="button" data-action="email-bar-clear" aria-label="Limpar a seleção" title="Limpar a seleção (Esc)" onClick={() => dispatch({ type: 'clear' })} className="no-drag inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title">
                <Icon icon={X} />
              </button>
            </div>
          )}
        </div>
        {banner && <OrganizeBanner key={banner.batchId} banner={banner} where={where} />}
        {asked?.missingFolder && (
          <Note id="email-folder-missing" icon={TriangleAlert} role="status" className="mx-2 mb-1">
            {`A pasta “${breadcrumb(asked.missingFolder, nodes)}” não existe mais nesta conta.`}
          </Note>
        )}
        {asked?.movedByRule && !asked.messageId && (
          <Note id="email-moved-by-rule" icon={FolderInput} role="status" className="mx-2 mb-1">
            {`A mensagem foi movida para ${label} por uma regra.`}
          </Note>
        )}
        {(moveError || actionError) && (
          <Note
            id="email-move-error"
            icon={TriangleAlert}
            role="alert"
            className="mx-2 mb-1"
            action={
              <button
                type="button"
                aria-label="Fechar o aviso"
                onClick={() => {
                  useEmailUi.getState().clearMoveError()
                  setActionError(null)
                }}
                className="no-drag inline-flex size-5 items-center justify-center text-text-muted hover:text-title"
              >
                <Icon icon={X} size={14} />
              </button>
            }
          >
            {moveError ?? actionError}
          </Note>
        )}
        {folderError && folderError !== 'missing' && (
          <Note id="email-folder-error" icon={TriangleAlert} role="status" className="mx-2 mb-1">
            {folderError === 'unavailable' ? 'Sem conexão com o servidor: a lista é a última que o app guardou.' : 'O servidor não abriu esta pasta agora: a lista é a última que o app guardou.'}
          </Note>
        )}
        {pendingDelete && (
          <Note
            id="email-list-delete-confirm"
            icon={Trash2}
            role="alert"
            className="mx-2 mb-1"
            action={
              <div className="flex gap-2">
                <Button
                  action="email-list-delete-confirm"
                  variant="danger"
                  onClick={() =>
                    void removeAll(pendingDelete).then((ok) => {
                      setPendingDelete(null)
                      if (!ok) setActionError('Não foi possível apagar agora. Confira se a conta está conectada e tente de novo.')
                    })
                  }
                >
                  Apagar
                </Button>
                <Button action="email-list-delete-cancel" variant="secondary" onClick={() => setPendingDelete(null)}>
                  Cancelar
                </Button>
              </div>
            }
          >
            {deleteText(pendingDelete.length)}
          </Note>
        )}
        <div
          data-email-list
          onKeyDown={(event) => {
            if (event.key === 'Escape' && selection.ids.length) {
              event.preventDefault()
              dispatch({ type: 'clear' })
              setSelected(null)
            }
          }}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        >
          {messages === undefined ? (
            <div className="flex flex-col gap-2 px-1" aria-hidden="true">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-14 rounded-[var(--radius-control)] bg-bg-sunken" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <p className="px-2 pt-2 text-12 text-text-muted">{folder === 'inbox' ? 'Nenhuma mensagem na Caixa de Entrada.' : folder === 'sent' ? 'Nenhuma mensagem enviada pelo app ainda.' : 'Nenhuma mensagem nesta pasta.'}</p>
          ) : (
            groups.map((group) => (
              <section key={group.label} aria-label={group.label} data-email-group={group.label} className="flex flex-col">
                <h2 className="px-2.5 pt-3 pb-1 text-12 font-bold text-text-muted">{group.label}</h2>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((message) => (
                    <li key={message.id}>
                      <MessageRow
                        message={message}
                        sentMailbox={sentMailbox}
                        active={!showComposer && !multi && message.id === selected}
                        selecting={multi}
                        checked={selection.ids.includes(message.id)}
                        leaving={leaving.has(message.id)}
                        draggable={movable(message)}
                        onClick={(event) => choose(event, message.id)}
                        onMenu={(event) => openMenu(event, message.id)}
                        onDragStart={(event) => dragStart(event, message)}
                        onDragEnd={() => useEmailUi.getState().setDrag(null)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </aside>
      <div className={`flex min-h-0 min-w-0 flex-1 ${paneOpen ? '' : 'max-[899px]:hidden'}`}>
        {showComposer && ownDraft ? (
          <Composer key={ownDraft.mode + (ownDraft.inReplyTo ?? '')} account={account} accountName={accountLabel((accounts ?? []).map((item) => item.account), account)} draft={ownDraft} onSent={sent} onBack={() => useEmail.getState().closeDraft(false)} />
        ) : multi ? (
          <SelectionSummary
            count={selection.ids.length}
            canMove={!pop3 && folder !== 'sent'}
            canMarkRead={folder === 'inbox'}
            canDelete={canDelete}
            deleteQuestion={deleteText(selection.ids.length)}
            onMove={(anchor) => openPicker(selection.ids, anchor)}
            onMarkRead={() => void markAll(selection.ids, true)}
            onDelete={() => removeAll(selection.ids)}
            onBack={() => {
              dispatch({ type: 'clear' })
              setSelected(null)
            }}
          />
        ) : open ? (
          <ReadingPane
            key={open.id}
            account={account}
            message={open}
            onCompose={(mode) => compose(mode, open)}
            composing={preparing}
            onMailto={(address) => newMessage(parseRecipients(address))}
            onDeleted={() => setSelected(null)}
            onBack={() => setSelected(null)}
            canDelete={canDelete}
            move={movable(open) ? { recents, onPick: (anchor) => openPicker([open.id], anchor), onMoveTo: (path) => void moveMessages(account.id, folder, [open.id], path) } : undefined}
            onBackToOrganize={
              view
                ? () => {
                    setSelected(null)
                    setSelection(EMPTY_SELECTION)
                  }
                : undefined
            }
          />
        ) : view ? (
          <OrganizePanel view={view} onOpen={openTopic} where={where} onBack={() => setListOverPanel(true)} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-13 text-text-muted">Escolha uma mensagem para ler.</p>
          </div>
        )}
      </div>
      {menu && <ContextMenu kind="message" label={menu.ids.length > 1 ? `${menu.ids.length} mensagens` : 'Mensagem'} at={{ x: menu.x, y: menu.y }} entries={menuEntries(menu.ids)} onClose={() => setMenu(null)} />}
      <MoveToPicker />
    </div>
  )
}

/** As pastas recentes da conta (CA6), das configurações. */
function useSettingsRecents(accountId: string): string[] | undefined {
  return useSettings((state) => state.settings.emailRecentFolders[accountId])
}
