import { ArrowLeft, Paperclip, Send, TriangleAlert, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { settingsPath } from '@shared/routes'
import { EMAIL_ATTACH_MAX_BYTES, EMAIL_ATTACH_MAX_FILES, EMAIL_SUBJECT_MAX, EMAIL_TEXT_MAX, type EmailAccount } from '@shared/email'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { useEmail } from './emailStore'
import { attachmentsSize, mergeRecipients, parseRecipients, sendErrorText, sizeLabel, type ComposeDraft, type Recipient } from './format'

/** "Voltar para a lista": só na janela estreita, quando a lista e a leitura se alternam. */
const NARROW_ONLY = 'min-[900px]:hidden'
const BACK_BUTTON = 'no-drag inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-title hover:bg-bg-sunken'

const TITLES: Record<ComposeDraft['mode'], string> = { new: 'Nova mensagem', reply: 'Responder', replyAll: 'Responder a todos', forward: 'Encaminhar' }
const INPUT = 'no-drag min-w-0 bg-transparent text-13 text-text select-text placeholder:text-text-faint focus-visible:outline-none'

/** Para e Cc: cada endereço vira uma etiqueta (vírgula, ponto e vírgula, Enter ou sair do campo); ⌫ no campo vazio tira a última. */
function RecipientField({ id, label, value, onChange }: { id: string; label: string; value: Recipient[]; onChange: (next: Recipient[]) => void }) {
  const [typing, setTyping] = useState('')
  const commit = (text: string): void => {
    const added = parseRecipients(text)
    if (added.length) onChange(mergeRecipients(value, added))
    setTyping('')
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if ((event.key === 'Enter' || event.key === ',' || event.key === ';') && typing.trim()) {
      event.preventDefault()
      commit(typing)
    } else if (event.key === 'Backspace' && !typing && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div data-email-recipients={id} className="flex min-h-10 items-center gap-3 border-b border-line has-[input:focus-visible]:border-focus">
      <label htmlFor={`email-compose-${id}`} className="w-14 shrink-0 text-12 font-medium text-text-muted">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1.5">
        {value.map((item) => (
          <span
            key={item.address}
            data-email-chip={item.address}
            data-email-chip-valid={item.valid ? 'true' : 'false'}
            className={`inline-flex h-6 max-w-full items-center gap-1 rounded-[var(--radius-control)] border px-1.5 text-12 ${item.valid ? 'border-line bg-bg-sunken text-text' : 'border-rec text-rec'}`}
          >
            <span className="truncate">{item.address}</span>
            {!item.valid && <span className="sr-only">(endereço inválido)</span>}
            <button type="button" aria-label={`Tirar ${item.address}`} onClick={() => onChange(value.filter((other) => other !== item))} className="no-drag inline-flex size-4 items-center justify-center text-text-muted hover:text-title">
              <Icon icon={X} size={14} />
            </button>
          </span>
        ))}
        <input
          id={`email-compose-${id}`}
          type="text"
          value={typing}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value
            // Colar uma lista: o que vem antes da última vírgula já vira etiqueta.
            if (/[,;\n]/.test(next)) {
              const cut = Math.max(next.lastIndexOf(','), next.lastIndexOf(';'), next.lastIndexOf('\n'))
              commit(next.slice(0, cut))
              setTyping(next.slice(cut + 1))
            } else setTyping(next)
          }}
          onKeyDown={onKey}
          onBlur={() => typing.trim() && commit(typing)}
          className={`${INPUT} h-7 flex-[1_1_160px]`}
        />
      </div>
    </div>
  )
}

interface ComposerProps {
  account: EmailAccount
  /** O nome da conta na tela (o da barra lateral), para a linha de apoio da assinatura. */
  accountName: string
  draft: ComposeDraft
  /** Saiu com sucesso: o id da mensagem em Enviados. */
  onSent: (messageId: string) => void
  onBack: () => void
}

/**
 * Composer (contrato 43, CA3), no lugar do painel de leitura: Para e Cc com etiquetas, assunto, corpo e anexos locais.
 * "Enviar" (ou ⌘↵) manda pelo `emailSend` do preload, que só vale no clique da pessoa, sem diálogo de confirmação.
 * Deu certo: o composer fecha e a mensagem aparece em Enviados. Deu errado: o rascunho fica, com o aviso.
 */
export function Composer({ account, accountName, draft, onSent, onBack }: ComposerProps) {
  const update = useEmail((state) => state.updateDraft)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const sendingNow = useRef(false)
  const total = attachmentsSize(draft.attachments)

  const pick = (): void => {
    setError(null)
    void window.__scribeApi.invoke('scribe:email-attach-pick').then(
      (result) => {
        if (!result) return
        if (!result.ok) {
          setError(result.error === 'too-big' ? `Os anexos passam de ${sizeLabel(EMAIL_ATTACH_MAX_BYTES)}.` : 'Não foi possível ler o arquivo escolhido.')
          return
        }
        const current = useEmail.getState().draft?.attachments ?? []
        const next = [...current, ...result.attachments]
        if (next.length > EMAIL_ATTACH_MAX_FILES) setError(`No máximo ${EMAIL_ATTACH_MAX_FILES} anexos por mensagem.`)
        else if (attachmentsSize(next) > EMAIL_ATTACH_MAX_BYTES) setError(`Os anexos passam de ${sizeLabel(EMAIL_ATTACH_MAX_BYTES)}.`)
        else update({ attachments: next })
      },
      () => setError('Não foi possível ler o arquivo escolhido.'),
    )
  }

  const send = (): void => {
    // O que está na loja agora (o "Para" que acabou de virar etiqueta ao sair do campo já conta).
    const current = useEmail.getState().draft ?? draft
    if (sendingNow.current) return
    if (!current.to.length) {
      setError('Escreva pelo menos um destinatário em "Para".')
      document.getElementById('email-compose-to')?.focus()
      return
    }
    if ([...current.to, ...current.cc].some((item) => !item.valid)) {
      setError('Há um endereço inválido (em vermelho). Corrija ou tire antes de enviar.')
      return
    }
    sendingNow.current = true
    setSending(true)
    setError(null)
    void window.__scribeApi
      .emailSend({
        accountId: account.id,
        to: current.to.map((item) => item.address),
        cc: current.cc.map((item) => item.address),
        subject: current.subject.replace(/[\r\n]+/g, ' '),
        text: current.text,
        inReplyTo: current.inReplyTo ?? undefined,
        attachments: current.attachments,
      })
      .then(
        (result) => {
          sendingNow.current = false
          setSending(false)
          if (result.ok) onSent(result.messageId)
          else setError(sendErrorText(result.error))
        },
        () => {
          sendingNow.current = false
          setSending(false)
          setError(sendErrorText('failed'))
        },
      )
  }

  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <section data-email-composer={draft.mode} aria-label={TITLES[draft.mode]} onKeyDown={onKey} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-6 py-2">
        <button type="button" data-action="email-composer-back" onClick={onBack} aria-label="Voltar para a lista" className={`${BACK_BUTTON} ${NARROW_ONLY}`}>
          <Icon icon={ArrowLeft} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-15 font-bold text-title">{TITLES[draft.mode]}</h2>
        <span className="truncate text-12 text-text-muted">De: {account.name ? `${account.name} <${account.address}>` : account.address}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-6 pt-1 pb-4">
        <RecipientField id="to" label="Para" value={draft.to} onChange={(to) => update({ to })} />
        <RecipientField id="cc" label="Cc" value={draft.cc} onChange={(cc) => update({ cc })} />
        <div className="flex min-h-10 items-center gap-3 border-b border-line has-[input:focus-visible]:border-focus">
          <label htmlFor="email-compose-subject" className="w-14 shrink-0 text-12 font-medium text-text-muted">
            Assunto
          </label>
          <input
            id="email-compose-subject"
            type="text"
            value={draft.subject}
            maxLength={EMAIL_SUBJECT_MAX}
            autoComplete="off"
            onChange={(event) => update({ subject: event.target.value })}
            className={`${INPUT} h-9 flex-1`}
          />
        </div>
        <label htmlFor="email-compose-text" className="sr-only">
          Mensagem
        </label>
        <textarea
          id="email-compose-text"
          data-email-compose-text
          value={draft.text}
          maxLength={EMAIL_TEXT_MAX}
          placeholder="Escreva a mensagem"
          onChange={(event) => update({ text: event.target.value })}
          className="no-drag mt-3 min-h-[160px] flex-1 resize-none bg-transparent text-15 text-text select-text placeholder:text-text-faint focus-visible:outline-offset-4"
        />
        {draft.attachments.length > 0 && (
          <ul data-email-compose-attachments aria-label="Anexos" className="mt-3 flex flex-wrap gap-2">
            {draft.attachments.map((item, index) => (
              <li key={`${item.name}:${index}`} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-bg-sunken px-2.5 py-1.5 text-12 text-text">
                <Icon icon={Paperclip} size={14} className="shrink-0 text-text-muted" />
                <span className="max-w-[220px] truncate">{item.name}</span>
                <span className="shrink-0 tabular text-text-faint">{sizeLabel(item.bytes.byteLength)}</span>
                <button
                  type="button"
                  aria-label={`Tirar o anexo ${item.name}`}
                  disabled={sending}
                  onClick={() => update({ attachments: draft.attachments.filter((_, other) => other !== index) })}
                  className="no-drag inline-flex size-4 items-center justify-center text-text-muted hover:text-title"
                >
                  <Icon icon={X} size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {draft.skippedAttachments.length > 0 && (
          <Note id="email-forward-skipped" icon={Paperclip} role="status" className="mt-3">
            {`Ficaram de fora deste encaminhamento (o limite é ${EMAIL_ATTACH_MAX_FILES} anexos e ${sizeLabel(EMAIL_ATTACH_MAX_BYTES)} por mensagem): ${draft.skippedAttachments.join(', ')}.`}
          </Note>
        )}
        {error && (
          <Note id="email-send-error" icon={TriangleAlert} role="alert" className="mt-3">
            {error}
          </Note>
        )}
        {confirmDiscard && (
          <Note
            id="email-discard-confirm"
            icon={X}
            role="alert"
            className="mt-3"
            action={
              <div className="flex gap-2">
                <Button action="email-discard-confirm" variant="danger" onClick={() => useEmail.getState().closeDraft(true)}>
                  Descartar
                </Button>
                <Button action="email-discard-cancel" variant="secondary" onClick={() => setConfirmDiscard(false)}>
                  Continuar escrevendo
                </Button>
              </div>
            }
          >
            Descartar este rascunho?
          </Note>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-action="email-attach"
              aria-label="Anexar arquivos"
              title="Anexar arquivos"
              onClick={pick}
              disabled={sending}
              className="no-drag inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-bg-raised text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken disabled:pointer-events-none disabled:opacity-50"
            >
              <Icon icon={Paperclip} />
            </button>
            {draft.attachments.length > 1 && <span className="text-12 tabular text-text-faint">{sizeLabel(total)}</span>}
          </div>
          <div className="flex items-center gap-2" title="Nada sai sem o seu clique em Enviar.">
            <Button action="email-discard" variant="secondary" onClick={() => setConfirmDiscard(true)} disabled={sending}>
              Descartar
            </Button>
            <Button action="email-send" icon={Send} onClick={send} disabled={sending} shortcut="⌘↵" ariaShortcut="Meta+Enter">
              {sending ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </div>
        {/* Contrato 55 (CA11, D5): a assinatura é texto do campo; esta linha só diz de onde ela veio. */}
        {draft.signed && (
          <p data-email-signature-hint className="mt-3 text-12 text-text-muted">
            Assinatura da conta {accountName}. Pode editar ou apagar aqui; a padrão fica em{' '}
            <Link to={settingsPath('email', 'assinatura')} className="font-medium text-accent underline decoration-1 underline-offset-3">
              Configurações › Email
            </Link>
          </p>
        )}
      </div>
    </section>
  )
}
