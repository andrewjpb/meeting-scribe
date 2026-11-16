import { TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { WHATSAPP_RISK_CHECKBOX, WHATSAPP_RISK_TEXT, WHATSAPP_RISK_TITLE } from '@shared/whatsapp'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'

interface RiskPanelProps {
  /** "Mostrar QR code" no pareamento; "Instalar" na instalação. */
  confirmLabel: string
  confirmAction: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Tela de risco (contrato 24, CA2): vem antes de qualquer QR code e antes de instalar. O botão só se habilita com a
 * caixa marcada; "Cancelar" volta sem nada. Aparece de novo a cada pareamento.
 */
export function RiskPanel({ confirmLabel, confirmAction, onConfirm, onCancel }: RiskPanelProps) {
  const [accepted, setAccepted] = useState(false)
  const titleId = useId()
  const checkId = useId()
  return (
    <section data-whatsapp-risk aria-labelledby={titleId} className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line-strong bg-bg-sunken p-4">
      <h3 id={titleId} className="flex items-center gap-2 text-15 font-bold text-title">
        <Icon icon={TriangleAlert} className="shrink-0 text-rec" />
        {WHATSAPP_RISK_TITLE}
      </h3>
      <p data-whatsapp-risk-text className="text-13 text-pretty text-text">
        {WHATSAPP_RISK_TEXT}
      </p>
      <label htmlFor={checkId} className="flex cursor-default items-center gap-2 text-13 font-medium text-text">
        <input id={checkId} type="checkbox" data-whatsapp-risk-check checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="no-drag size-4 shrink-0 accent-accent" />
        {WHATSAPP_RISK_CHECKBOX}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button action={confirmAction} onClick={onConfirm} disabled={!accepted}>
          {confirmLabel}
        </Button>
        <Button action="whatsapp-risk-cancel" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </section>
  )
}
