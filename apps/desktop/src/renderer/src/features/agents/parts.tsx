// Peças comuns das Automações (contrato 23): o ícone colorido do agente, os campos no padrão dos controles e a
// resposta de uma execução com os componentes do chat v2 (contrato 16): o pedido, o raciocínio e os passos, a
// resposta e o rodapé com modelo, tempo, tokens e custo nominal.
import { Bell, Bot, CalendarDays, CircleHelp, FileText, ListChecks, Search, Sparkles, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentColor, AgentIcon } from '@shared/automations'
import { CONTROL_CLASS } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { COLOR_CLASS } from '../../design/StickyNote'
import { AssistantMessage, LiveAssistantMessage, UserMessage } from '../chat/ChatMessages'
import type { ChatMeetings } from '../chat/useChatMeetings'
import { useAutomations } from './automationsStore'

export const AGENT_ICON_GLYPHS: Readonly<Record<AgentIcon, LucideIcon>> = {
  bot: Bot,
  calendar: CalendarDays,
  'list-checks': ListChecks,
  'circle-help': CircleHelp,
  'file-text': FileText,
  bell: Bell,
  search: Search,
  sparkles: Sparkles,
}

export const AGENT_ICON_LABELS: Readonly<Record<AgentIcon, string>> = {
  bot: 'Robô',
  calendar: 'Calendário',
  'list-checks': 'Lista',
  'circle-help': 'Pergunta',
  'file-text': 'Documento',
  bell: 'Sino',
  search: 'Lupa',
  sparkles: 'Brilho',
}

/** Quadrado de 32 px na cor do agente (as cores das anotações) com o ícone dele. */
export function AgentBadge({ icon, color }: { icon: AgentIcon; color: AgentColor }) {
  const tone = COLOR_CLASS[color]
  return (
    <span aria-hidden="true" data-agent-badge={color} className={`flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border ${tone.card}`}>
      <Icon icon={AGENT_ICON_GLYPHS[icon]} />
    </span>
  )
}

/** Campo de várias linhas no padrão dos controles. */
export const AREA_CLASS = `${CONTROL_CLASS} h-auto min-w-0 w-full px-3 py-2 leading-5 select-text placeholder:text-text-faint`
/** Campo curto (número, hora, data) no padrão dos controles. */
export const INPUT_CLASS = `${CONTROL_CLASS} px-3 tabular`

/** Rótulo de um campo do formulário, com a descrição e o controle abaixo. */
export function FormField({ label, htmlFor, labelId, hint, children }: { label: string; htmlFor?: string; labelId?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" data-form-field={label}>
      {htmlFor ? (
        <label id={labelId} htmlFor={htmlFor} className="text-13 font-medium text-text">
          {label}
        </label>
      ) : (
        <p id={labelId} className="text-13 font-medium text-text">
          {label}
        </p>
      )}
      {children}
      {hint && <p className="text-12 text-text-muted">{hint}</p>}
    </div>
  )
}

/**
 * Resposta de uma execução: a em curso (que chega pelos eventos) ou a gravada, com o pedido acima. "Copiar"
 * escreve a resposta na área de transferência pelo main.
 */
export function RunAnswer({ runId, prompt, meetings }: { runId: string; prompt: string | null; meetings: ChatMeetings }) {
  const live = useAutomations((state) => state.live[runId])
  const finished = useAutomations((state) => state.finished[runId])
  const answer = finished?.answer ?? null
  return (
    <ol aria-label="Execução" aria-live="polite" data-run-answer={runId} data-run-state={finished ? finished.status : 'running'} className="flex flex-col gap-6">
      {prompt && <UserMessage text={prompt} />}
      {!finished && live && <LiveAssistantMessage answer={live} />}
      {answer && <AssistantMessage message={answer} meetings={meetings} onCopy={() => window.__scribeApi.invoke('scribe:analysis-copy', { text: answer.text })} onRedo={null} />}
      {finished?.error && (
        <li data-run-error className="text-13 text-text-muted">
          {finished.error}
        </li>
      )}
    </ol>
  )
}
