import { TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_EMAIL_SIGNATURE, EMAIL_SIGNATURE_MAX, type EmailSignature } from '@shared/email-signature'
import { EMAIL_SIGNATURE_DESCRIPTION, EMAIL_SIGNATURE_NEW_DESCRIPTION, EMAIL_SIGNATURE_REPLY_DESCRIPTION } from '@shared/settings-index'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { Switch } from '../../design/Switch'

/** "Texto da assinatura" grava 600 ms depois de a pessoa parar de digitar (ou ao sair do campo). */
const SAVE_AFTER_MS = 600

/** Uma linha da aba Email: o nome e a descrição do índice da busca em atributos, e o texto da tela à vista. */
export function EmailRow({ name, description, children, className = '' }: { name: string; description: string; children: ReactNode; className?: string }) {
  return (
    <div data-setting-row data-setting-name={name} data-setting-description={description} className={`py-4 ${className}`}>
      {children}
    </div>
  )
}

/**
 * Configurações › Email › Assinatura (contrato 55, CA16): o texto da conta escolhida (até 2000, com o contador) e os dois
 * interruptores. Lê ao trocar de conta (`scribe:email-signature-get`) e grava (`scribe:email-signature-set`) o texto ao
 * sair do campo ou 600 ms depois de parar de digitar, e o interruptor na hora. Falhou: a nota, e o campo fica como a
 * pessoa digitou.
 */
export function EmailSignatureSection({ accountId }: { accountId: string }) {
  const [signature, setSignature] = useState<EmailSignature | null>(null)
  const [problem, setProblem] = useState<'load' | 'save' | null>(null)
  // O texto pendente de gravar (o timer dos 600 ms) e o último valor: sair da tela grava o que ficou pendente.
  const pending = useRef<{ timer: number | null; value: EmailSignature }>({ timer: null, value: DEFAULT_EMAIL_SIGNATURE })

  useEffect(() => {
    let alive = true
    const box = pending.current
    void window.__scribeApi.invoke('scribe:email-signature-get', { accountId }).then(
      (result) => {
        if (!alive) return
        const value = result.ok ? result.signature : { ...DEFAULT_EMAIL_SIGNATURE }
        box.value = value
        setSignature(value)
        setProblem(result.ok ? null : 'load')
      },
      () => {
        if (!alive) return
        // Não carregou: o campo não fica preso desligado; a nota diz que a assinatura gravada não apareceu.
        setSignature({ ...DEFAULT_EMAIL_SIGNATURE })
        setProblem('load')
      },
    )
    return () => {
      alive = false
      // Ao sair (outra conta, outra tela): grava o que estava esperando os 600 ms, não descarta.
      if (box.timer !== null) {
        window.clearTimeout(box.timer)
        box.timer = null
        void window.__scribeApi.invoke('scribe:email-signature-set', { accountId, signature: box.value }).catch(() => undefined)
      }
    }
  }, [accountId])

  const save = (value: EmailSignature): void => {
    const box = pending.current
    if (box.timer !== null) window.clearTimeout(box.timer)
    box.timer = null
    void window.__scribeApi.invoke('scribe:email-signature-set', { accountId, signature: value }).then(
      (result) => setProblem(result.ok ? null : 'save'),
      () => setProblem('save'),
    )
  }
  const change = (patch: Partial<EmailSignature>, now: boolean): void => {
    const box = pending.current
    const value = { ...box.value, ...patch }
    box.value = value
    setSignature(value)
    if (now) save(value)
    else {
      if (box.timer !== null) window.clearTimeout(box.timer)
      box.timer = window.setTimeout(() => save(pending.current.value), SAVE_AFTER_MS)
    }
  }

  const value = signature ?? DEFAULT_EMAIL_SIGNATURE
  return (
    <Section title="Assinatura" anchor="assinatura">
      <EmailRow name="Assinatura" description={EMAIL_SIGNATURE_DESCRIPTION} className="flex flex-col gap-2">
        <label htmlFor="settings-email-signature" className="text-13 font-medium text-text">
          Texto da assinatura
        </label>
        <p id="settings-email-signature-help" className="-mt-1.5 text-12 text-text-muted">
          Texto simples. Links e emails viram link. Entra acima do texto citado, depois de “-- ”.
        </p>
        <textarea
          id="settings-email-signature"
          data-email-signature-text
          aria-describedby="settings-email-signature-help settings-email-signature-count"
          value={value.text}
          maxLength={EMAIL_SIGNATURE_MAX}
          disabled={signature === null}
          rows={4}
          onChange={(event) => change({ text: event.target.value }, false)}
          onBlur={() => pending.current.timer !== null && save(pending.current.value)}
          className="no-drag min-h-24 w-full resize-y rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 py-2.5 text-13 text-text select-text"
        />
        <p id="settings-email-signature-count" className="text-right text-12 tabular text-text-muted">
          {value.text.length} de {EMAIL_SIGNATURE_MAX}
        </p>
        {problem === 'save' && (
          <Note id="email-signature-save-error" icon={TriangleAlert} role="alert">
            Não foi possível salvar a assinatura.
          </Note>
        )}
        {problem === 'load' && (
          <Note id="email-signature-load-error" icon={TriangleAlert} role="alert">
            Não foi possível carregar a assinatura desta conta. O que você escrever aqui é gravado como a assinatura nova.
          </Note>
        )}
      </EmailRow>
      <EmailRow name="Assinatura em mensagens novas" description={EMAIL_SIGNATURE_NEW_DESCRIPTION} className="flex items-center justify-between gap-6">
        <p id="settings-email-signature-new" className="text-13 font-medium text-text">
          Em mensagens novas
        </p>
        <Switch checked={value.onNew} labelledBy="settings-email-signature-new" action="email-signature-new" disabled={signature === null} onChange={(onNew) => change({ onNew }, true)} />
      </EmailRow>
      <EmailRow name="Assinatura em respostas e encaminhamentos" description={EMAIL_SIGNATURE_REPLY_DESCRIPTION} className="flex items-center justify-between gap-6">
        <p id="settings-email-signature-reply" className="text-13 font-medium text-text">
          Em respostas e encaminhamentos
        </p>
        <Switch checked={value.onReply} labelledBy="settings-email-signature-reply" action="email-signature-reply" disabled={signature === null} onChange={(onReply) => change({ onReply }, true)} />
      </EmailRow>
    </Section>
  )
}
