import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { tarefasPath } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { FUNIL_LINK_CLASS } from '../funil/Timeline'

/** Quanto tempo o "Tarefa criada" fica no lugar do botão (R24, R25). */
export const AVISO_CRIADA_MS = 3_000

/** O id da tarefa recém-criada enquanto o aviso está na tela e quem o liga; o aviso some sozinho em 3 s. */
export function useTarefaCriada(): { criada: string | null; avisar: (id: string) => void } {
  const [criada, setCriada] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const avisar = (id: string): void => {
    if (timer.current) clearTimeout(timer.current)
    setCriada(id)
    timer.current = setTimeout(() => setCriada(null), AVISO_CRIADA_MS)
  }
  return { criada, avisar }
}

interface BotaoMaisTarefaProps {
  /** `data-action` do botão (`email-tarefa`, `whatsapp-tarefa`). */
  action: string
  /** Gancho `data-*` do aviso "Tarefa criada", com o id da tarefa (`data-email-tarefa-criada`). */
  avisoData: `data-${string}`
  /** O formulário está aberto: o botão fica pressionado. */
  aberto: boolean
  criada: string | null
  onClick: () => void
}

/**
 * "+ Tarefa" do e-mail e do WhatsApp (contrato 126, R24, R25, artboards 11 e 12): 28 px, como o `ActionButton`, com
 * `aria-pressed` e o fundo --bg-sunken enquanto o formulário está aberto. Depois de criar, por 3 s, "Tarefa criada" no
 * lugar dele, como link para a tarefa.
 */
export function BotaoMaisTarefa({ action, avisoData, aberto, criada, onClick }: BotaoMaisTarefaProps) {
  const navigate = useNavigate()
  if (criada !== null) {
    return (
      <span role="status" className="inline-flex h-7 shrink-0 items-center text-12">
        <button type="button" {...{ [avisoData]: criada }} className={FUNIL_LINK_CLASS} onClick={() => void navigate(tarefasPath(criada))}>
          Tarefa criada
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      data-action={action}
      aria-pressed={aberto}
      onClick={onClick}
      className={`no-drag inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong px-2 text-12 font-medium whitespace-nowrap text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken ${aberto ? 'bg-bg-sunken' : ''}`}
    >
      <Icon icon={Plus} size={14} />
      Tarefa
    </button>
  )
}
