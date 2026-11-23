// Proposta do agente no modo rascunho (contrato 143): a caixa acima do campo de mensagem com o texto que o agente
// propôs, editável, "Enviar" e "Descartar". O envio sai direto do clique, pelo `atendimentoDraftSend` do preload (que
// exige a ativação viva do clique, como o "Enviar" normal); nada sai sem ele. Uma proposta nova troca o texto mostrado.
import { Bot, Send } from 'lucide-react'
import { useState } from 'react'
import type { AtendimentoDraftSendResult } from '@shared/atendimento'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { AREA_CLASS } from '../agents/parts'
import { useAtendimentoNow } from './AtendimentoBadge'
import { useAtendimento } from './atendimentoStore'
import { relativeLabel } from './status'

/** O campo da proposta aceita até 1.000 caracteres digitados. */
const PROPOSAL_TEXT_MAX = 1000

const SEND_ERRORS: Record<Extract<AtendimentoDraftSendResult, { ok: false }>['error'], string> = {
  click: 'Clique em Enviar de novo.',
  state: 'O WhatsApp não está conectado.',
  'no-draft': 'Essa proposta não existe mais.',
  invalid: 'Não foi possível enviar.',
  failed: 'Não foi possível enviar.',
}

interface AtendimentoProposalProps {
  chatId: string
  /** Depois do envio aceito: relê a conversa, como no envio normal. */
  onSent: () => void
}

export function AtendimentoProposal({ chatId, onSent }: AtendimentoProposalProps) {
  const draft = useAtendimento((state) => state.runtime[chatId]?.draft ?? null)
  const agentName = useAtendimento((state) => state.state?.agents.find((agent) => agent.id === draft?.agentId)?.name ?? 'O agente')
  const now = useAtendimentoNow()
  // O texto editado é desta proposta; uma nova (outro `at` ou outro texto) começa do texto dela.
  const key = draft ? `${draft.at}|${draft.text}` : null
  const [edited, setEdited] = useState<{ key: string; text: string } | null>(null)
  const [sending, setSending] = useState(false)
  // O erro é do envio de uma proposta; uma nova não herda o da anterior.
  const [failure, setFailure] = useState<{ key: string; text: string } | null>(null)
  // A proposta enviada ou que não existe mais some na hora, antes da releitura do serviço.
  const [gone, setGone] = useState<string | null>(null)

  if (!draft || !key || gone === key) {
    return failure && (!key || failure.key === key) ? (
      <p role="alert" data-atendimento-proposal-error className="text-12 text-rec">
        {failure.text}
      </p>
    ) : null
  }
  const text = edited?.key === key ? edited.text : draft.text
  const error = failure?.key === key ? failure.text : null

  /** Direto do clique: o preload confere a ativação do usuário antes de pedir o envio. */
  const send = (): void => {
    if (!text.trim() || sending) return
    setSending(true)
    setFailure(null)
    void window.__scribeApi.atendimentoDraftSend({ chatId, text }).then(
      (result) => {
        setSending(false)
        if (result.ok) {
          setGone(key)
          onSent()
        } else {
          setFailure({ key, text: SEND_ERRORS[result.error] })
          if (result.error === 'no-draft') setGone(key)
        }
        void useAtendimento.getState().loadRuntime()
      },
      () => {
        setSending(false)
        setFailure({ key, text: SEND_ERRORS.failed })
      },
    )
  }

  const discard = (): void => {
    setFailure(null)
    setGone(key)
    void useAtendimento
      .getState()
      .discardDraft(chatId)
      .catch(() => undefined)
  }

  return (
    <section data-atendimento-proposal aria-label={`${agentName} propôs uma resposta`} className="flex flex-col gap-2 border-l-3 border-accent bg-bg-sunken px-3 py-2">
      <div className="flex items-center gap-1.5 text-12">
        <Icon icon={Bot} size={14} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate">
          <span className="font-bold text-title">{agentName}</span> <span className="text-accent">propôs uma resposta</span>
        </span>
        <span className="ml-auto shrink-0 text-text-faint tabular">{relativeLabel(draft.at, new Date(now))}</span>
      </div>
      <label htmlFor={`atendimento-proposal-${chatId}`} className="sr-only">
        Texto proposto por {agentName}
      </label>
      <textarea
        id={`atendimento-proposal-${chatId}`}
        data-atendimento-proposal-text
        rows={2}
        value={text}
        maxLength={PROPOSAL_TEXT_MAX}
        onChange={(event) => setEdited({ key, text: event.target.value })}
        className={AREA_CLASS}
      />
      {error && (
        <p role="alert" data-atendimento-proposal-error className="text-12 text-rec">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button action="atendimento-draft-send" icon={Send} onClick={send} disabled={!text.trim() || sending}>
          {sending ? 'Enviando…' : 'Enviar'}
        </Button>
        <Button action="atendimento-draft-discard" variant="secondary" onClick={discard} disabled={sending}>
          Descartar
        </Button>
        <span className="ml-auto text-12 text-text-muted">Nada sai sem o seu clique.</span>
      </div>
    </section>
  )
}
