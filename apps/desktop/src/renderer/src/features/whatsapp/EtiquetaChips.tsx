// Contrato 162: as etiquetas da triagem na linha da conversa, na linha da prévia ("Urgente" primeiro, depois o âmbito).
// Só exibição: clicar no chip não faz nada (a linha inteira abre a conversa).
import { chipsDe, type Etiqueta } from '@shared/triagem'

const CHIP_CLASS = 'flex h-5 shrink-0 items-center rounded-[var(--radius-control)] px-1.5 text-11 font-medium whitespace-nowrap'

export function EtiquetaChips({ etiqueta }: { etiqueta: Etiqueta | null }) {
  const chips = chipsDe(etiqueta)
  if (!chips.length) return null
  return (
    <>
      {chips.map((chip) => {
        const urgente = chip === 'Urgente'
        return (
          <span key={chip} data-triagem-chip={urgente ? 'urgente' : chip.toLowerCase()} className={`${CHIP_CLASS} ${urgente ? 'bg-accent text-on-accent' : 'bg-bg-sunken text-text-muted'}`}>
            {chip}
          </span>
        )
      })}
    </>
  )
}
