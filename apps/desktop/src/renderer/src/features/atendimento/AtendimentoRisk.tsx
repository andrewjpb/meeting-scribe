// Aviso de risco do atendimento automático (contrato 143): aparece no painel da conversa, no lugar do formulário, antes
// do primeiro "Responder sozinho". Como o `RiskPanel` do pareamento: o botão só se habilita com a caixa marcada e
// "Cancelar" volta sem nada. A lista diz o que o agente vai fazer nesta conversa, com os valores do formulário.
import { TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { riskLines, type BindingDraft } from './status'

interface AtendimentoRiskProps {
  draft: BindingDraft
  busy: boolean
  onAccept: () => void
  onCancel: () => void
}

export function AtendimentoRisk({ draft, busy, onAccept, onCancel }: AtendimentoRiskProps) {
  const [accepted, setAccepted] = useState(false)
  const titleId = useId()
  const checkId = useId()
  return (
    <section data-atendimento-risk aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 text-13 text-pretty">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-rec">
          <Icon icon={TriangleAlert} />
        </span>
        <h3 id={titleId} className="text-15 font-bold text-title">
          Antes de deixar um agente responder sozinho
        </h3>
        <p className="text-text">
          O WhatsApp do app funciona com um cliente não oficial. Responder mensagens de forma automática aumenta a chance de o WhatsApp suspender ou bloquear o seu número, às vezes sem aviso.
        </p>
        <p className="text-text">Para diminuir o risco, nesta conversa o agente:</p>
        <ul data-atendimento-risk-list className="flex flex-col gap-1.5">
          {riskLines(draft).map((line) => (
            <li key={line} className="flex gap-2 text-text">
              <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 bg-text-faint" />
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>
        <p className="text-text-muted">Mesmo assim o risco continua. Se preferir, use o modo Rascunho: o agente só propõe e quem envia é você.</p>
        <label htmlFor={checkId} className="flex cursor-default items-center gap-2 rounded-[var(--radius-control)] border border-line-strong px-3 py-2 font-medium text-title">
          <input id={checkId} type="checkbox" data-atendimento-risk-check checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="no-drag size-4 shrink-0 accent-accent" />
          Entendo o risco e quero continuar
        </label>
        <p className="text-text-muted">Este aviso aparece só antes do primeiro atendimento automático.</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-3">
        <Button action="atendimento-risk-cancel" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button action="atendimento-risk-accept" onClick={onAccept} disabled={!accepted || busy}>
          Ligar atendimento
        </Button>
      </div>
    </section>
  )
}
