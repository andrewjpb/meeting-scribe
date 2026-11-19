import { Mail, PenLine, SquarePen, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { EMAIL_FOLDER_SLUGS, emailPath, settingsPath, type EmailNavigationState } from '@shared/routes'
import type { EmailAccount, EmailBody, EmailFolder, EmailMessage } from '@shared/email'
import { Button } from '../../design/Button'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { Avatar } from '../whatsapp/Avatar'
import { Composer } from './Composer'
import { bodyKey, folderKey, useEmail } from './emailStore'
import { addressLabel, composeFrom, emailTimeLabel, emptyDraft, groupByDay, previewLine, parseRecipients, rowTitle, unreadCount, type ComposeMode, type Recipient } from './format'
import { ReadingPane } from './ReadingPane'

const FOLDER_NAMES: Record<EmailFolder, string> = { inbox: 'Caixa de Entrada', sent: 'Enviados' }

const folderOf = (slug: string | undefined): EmailFolder | null => (slug === EMAIL_FOLDER_SLUGS.inbox ? 'inbox' : slug === EMAIL_FOLDER_SLUGS.sent ? 'sent' : null)

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

/** Uma linha da lista, no desenho do Outlook: iniciais, quem mandou em peso forte, a hora à direita, o assunto e a prévia. */
function MessageRow({ message, active, onOpen }: { message: EmailMessage; active: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const body = usePreview(message.accountId, message.id, ref)
  const unread = message.folder === 'inbox' && !message.seen
  const person = message.folder === 'sent' ? message.to[0] : message.from[0]
  return (
    <button
      ref={ref}
      type="button"
      data-email-message={message.id}
      data-email-unread={unread ? 'true' : 'false'}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      className={`no-drag flex w-full min-w-0 items-start gap-3 rounded-[var(--radius-control)] px-2.5 py-2.5 text-left ${active ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}
    >
      <Avatar id={person?.address ?? message.id} name={addressLabel(person)} size={10} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span data-email-row-from className="min-w-0 flex-1 truncate text-13 font-bold text-title">
            {rowTitle(message)}
          </span>
          <span className={`shrink-0 text-12 tabular ${unread ? 'font-medium text-accent' : 'text-text-faint'}`}>{emailTimeLabel(message.date)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span data-email-row-subject className={`min-w-0 flex-1 truncate text-13 ${unread ? 'font-medium text-accent' : 'text-text'}`}>
            {message.subject || '(sem assunto)'}
          </span>
          {unread && (
            <span data-email-unread-dot aria-hidden="true" className="size-1.5 shrink-0 bg-accent" />
          )}
          {unread && <span className="sr-only">Não lida</span>}
        </span>
        <span data-email-row-preview className="truncate text-12 text-text-muted">
          {(body ? previewLine(body) : '') || '\u00a0'}
        </span>
      </span>
    </button>
  )
}

/**
 * Tela "Email" (contrato 43, CA1): a pasta escolhida na barra lateral em duas colunas, como no Outlook para desktop: a
 * lista (com "Nova mensagem" no topo e os grupos por dia) e a leitura da mensagem escolhida, ou o composer no lugar
 * dela. Janela estreita (menos de 900 px): uma coluna de cada vez, como no WhatsApp.
 */
export function EmailScreen() {
  const { conta, pasta } = useParams()
  const accounts = useEmail((state) => state.accounts)
  const loadFailed = useEmail((state) => state.loadFailed)

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
  const folder = folderOf(pasta)
  if (!status || !folder) {
    if (first) return <Navigate replace to={emailPath(first.account.id, 'inbox')} />
    return (
      <div className="px-10 pt-7">
        <Note
          id="email-no-accounts"
          icon={Mail}
          role="status"
          action={
            <Link to={settingsPath('contas')} className={NOTE_ACTION_CLASS}>
              Abrir Contas
            </Link>
          }
        >
          Nenhuma conta de email ainda. Adicione uma em Configurações › Contas › Email.
        </Note>
      </div>
    )
  }
  return <FolderView account={status.account} folder={folder} />
}

function FolderView({ account, folder }: { account: EmailAccount; folder: EmailFolder }) {
  const location = useLocation()
  const navigate = useNavigate()
  const messages = useEmail((state) => state.folders[folderKey(account.id, folder)])
  const draft = useEmail((state) => state.draft)
  const composing = useEmail((state) => state.composing)
  const asked = (location.state ?? null) as EmailNavigationState | null
  const [selected, setSelected] = useState<string | null>(asked?.messageId ?? null)
  // Outra pasta ou um pedido novo (o clique na notificação): a mensagem pedida, ou nenhuma.
  const [seenKey, setSeenKey] = useState(location.key)
  if (seenKey !== location.key) {
    setSeenKey(location.key)
    setSelected(asked?.messageId ?? null)
  }
  const ownDraft = draft && draft.accountId === account.id ? draft : null
  const showComposer = composing && ownDraft !== null
  const open = messages?.find((message) => message.id === selected) ?? null

  useEffect(() => {
    void useEmail.getState().loadFolder(account.id, folder)
  }, [account.id, folder])

  // Contrato 43 (CA4): o main sabe qual pasta está aberta aqui; com a janela em foco, o email novo dela não notifica.
  useEffect(() => window.__scribeApi.send('scribe:email-viewing', { accountId: account.id, folder }), [account.id, folder])
  useEffect(() => () => window.__scribeApi.send('scribe:email-viewing', null), [])

  // A mensagem aberta (pela lista ou pela notificação) é lida e conta como lida.
  const openId = open?.id ?? null
  useEffect(() => {
    if (!openId) return
    useEmail.getState().requestBody(account.id, openId)
    const current = useEmail.getState().folders[folderKey(account.id, folder)]?.find((message) => message.id === openId)
    if (current && current.folder === 'inbox' && !current.seen) void useEmail.getState().markRead(account.id, openId, true)
  }, [account.id, folder, openId])

  const select = (id: string): void => {
    setSelected(id)
    useEmail.getState().closeDraft(false)
  }

  // Responder e Encaminhar esperam o corpo (a citação é da mensagem inteira) e, no Encaminhar, os anexos da original
  // (CA9), já nos limites do envio; os que passam ficam de fora e o composer diz quais.
  const [preparing, setPreparing] = useState(false)
  const compose = (mode: Exclude<ComposeMode, 'new'>, message: EmailMessage): void => {
    setPreparing(true)
    void (async () => {
      const body = await useEmail.getState().loadBody(account.id, message.id)
      const draft = composeFrom(mode, message, body, account)
      if (mode === 'forward' && body && body.attachments.length > 0) {
        const found = await window.__scribeApi.invoke('scribe:email-attachments', { accountId: account.id, id: message.id }).catch(() => null)
        if (found?.ok) {
          draft.attachments = found.attachments
          draft.skippedAttachments = found.skipped
        } else draft.skippedAttachments = body.attachments.map((item, index) => item.filename ?? `anexo-${index + 1}`)
      }
      useEmail.getState().openDraft(draft)
    })().finally(() => setPreparing(false))
  }

  const newMessage = (to: Recipient[] = []): void => {
    if (ownDraft && !to.length) {
      useEmail.getState().showDraft()
      return
    }
    useEmail.getState().openDraft({ ...emptyDraft(account.id), to })
  }

  const sent = (messageId: string): void => {
    useEmail.getState().closeDraft(true)
    void useEmail.getState().loadFolder(account.id, 'sent')
    const state: EmailNavigationState = { messageId }
    void navigate(emailPath(account.id, 'sent'), { state })
  }

  const groups = groupByDay(messages ?? [])
  const unread = folder === 'inbox' ? unreadCount(messages) : 0
  const paneOpen = showComposer || open !== null

  return (
    <div data-email-folder-view={folder} data-email-view-account={account.id} className="flex min-h-0 flex-1">
      <aside aria-label={`${FOLDER_NAMES[folder]} de ${account.address}`} className={`flex w-[340px] shrink-0 flex-col border-r border-line max-[899px]:w-full max-[899px]:border-r-0 ${paneOpen ? 'max-[899px]:hidden' : ''}`}>
        <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
          <div className="flex">
            <Button action="email-new" icon={ownDraft ? PenLine : SquarePen} onClick={() => newMessage()}>
              {ownDraft ? 'Voltar ao rascunho' : 'Nova mensagem'}
            </Button>
          </div>
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h1 data-email-folder-title className="truncate text-15 font-bold text-title">
              {FOLDER_NAMES[folder]}
            </h1>
            <span className="shrink-0 text-12 tabular text-text-muted">{unread > 0 ? `${unread} não ${unread === 1 ? 'lida' : 'lidas'}` : ''}</span>
          </div>
          <p className="-mt-2 truncate px-1 text-12 text-text-muted">{account.address}</p>
        </div>
        <div data-email-list className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {messages === undefined ? (
            <div className="flex flex-col gap-2 px-1" aria-hidden="true">
              {[0, 1, 2, 3].map((key) => (
                <div key={key} className="h-14 rounded-[var(--radius-control)] bg-bg-sunken" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <p className="px-2 pt-2 text-12 text-text-muted">{folder === 'inbox' ? 'Nenhuma mensagem na Caixa de Entrada.' : 'Nenhuma mensagem enviada pelo app ainda.'}</p>
          ) : (
            groups.map((group) => (
              <section key={group.label} aria-label={group.label} data-email-group={group.label} className="flex flex-col">
                <h2 className="px-2.5 pt-3 pb-1 text-12 font-bold text-text-muted">{group.label}</h2>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((message) => (
                    <li key={message.id}>
                      <MessageRow message={message} active={!showComposer && message.id === selected} onOpen={() => select(message.id)} />
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
          <Composer key={ownDraft.mode + (ownDraft.inReplyTo ?? '')} account={account} draft={ownDraft} onSent={sent} onBack={() => useEmail.getState().closeDraft(false)} />
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
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-13 text-text-muted">Escolha uma mensagem para ler.</p>
          </div>
        )}
      </div>
    </div>
  )
}
