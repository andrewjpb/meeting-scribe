import { Check, ChevronDown, ChevronRight, Copy, Download, FileText, FolderSearch, ListTree, RotateCcw, Search, ShieldOff, Square, SquareCheck, SquareDot, Terminal, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { withoutPendingActions } from '@shared/assistant'
import { chatErrorText, type ChatMessage, type ChatMeta, type ChatPlanEntry, type ChatStep, type ChatStepStatus } from '@shared/chat'
import { acpReady } from '@shared/acp'
import { useAcp } from '../../app/acpStore'
import { useAgentLabel } from '../../app/agentLabel'
import { useSettings } from '../../app/settingsStore'
import { meetingPath } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { dayLabel, timeLabel } from '../meetings/format'
import { ActionCards } from './ActionCards'
import type { LiveAnswer } from './chatStore'
import { ChatMarkdown } from './ChatMarkdown'
import { answerTimeLabel, answerTokens, consultedLabel, COST_HINT, costLabel, modelLabel, tokensLabel } from './format'
import type { ChatMeetings } from './useChatMeetings'

/** Botão discreto das ações da resposta e do rodapé. */
export const QUIET_BUTTON =
  'no-drag inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-12 text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken hover:text-title disabled:pointer-events-none disabled:opacity-50'

/** Ícone de cada passo: o índice, uma reunião, uma busca, a lista de arquivos. */
function stepIcon(step: ChatStep): LucideIcon {
  if (step.tool === 'Grep') return Search
  if (step.tool === 'Glob') return FolderSearch
  return step.meetingId ? FileText : ListTree
}

/** Estado do passo como o protocolo manda (contrato 17, CA4). */
const STEP_STATUS: Record<ChatStepStatus, string> = {
  pending: 'pendente',
  in_progress: 'em andamento',
  completed: 'feito',
  failed: 'falhou',
}

/** Marca de cada item do plano: quadrado vazio, com ponto ou marcado (o motivo do logo). */
const PLAN_ICON: Record<ChatPlanEntry['status'], LucideIcon> = { pending: Square, in_progress: SquareDot, completed: SquareCheck }
const PLAN_STATUS: Record<ChatPlanEntry['status'], string> = { pending: 'a fazer', in_progress: 'fazendo', completed: 'feito' }

/** "Plano" do agente (ACP): itens com o estado de cada um. */
function Plan({ entries }: { entries: readonly ChatPlanEntry[] }) {
  return (
    <div data-chat-plan className="flex flex-col gap-1">
      <p className="text-12 font-medium text-text-muted">Plano</p>
      <ol className="flex flex-col gap-1">
        {entries.map((entry, index) => (
          <li key={index} data-chat-plan-entry={entry.status} className={`flex items-center gap-2 text-12 ${entry.status === 'completed' ? 'text-text-faint' : 'text-text-muted'}`}>
            <Icon icon={PLAN_ICON[entry.status]} size={14} className="shrink-0 text-text-faint" />
            <span className="min-w-0 truncate">{entry.content}</span>
            <span className="sr-only">({PLAN_STATUS[entry.status]})</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Pergunta da pessoa: bloco com fundo sutil, à direita. */
export function UserMessage({ text, editing = false }: { text: string; editing?: boolean }) {
  return (
    <li data-chat-message="user" className="flex justify-end">
      <p
        className={`max-w-[72ch] rounded-[var(--radius-panel)] bg-bg-sunken px-4 py-2.5 text-15 whitespace-pre-line text-text select-text ${editing ? 'outline-1 outline-dashed outline-line-strong' : ''}`}
      >
        {text}
      </p>
    </li>
  )
}

/**
 * "Raciocínio e passos" (contrato 16, CA2): recolhível, aberto enquanto o Claude pensa e fechado depois que a
 * resposta termina. Os passos na ordem, com ícone; as ferramentas negadas; o raciocínio em texto puro (nunca
 * Markdown nem HTML), menor e em cor secundária.
 */
function Reasoning({ steps, thinking, denied, plan, live }: { steps: readonly ChatStep[]; thinking: string; denied: number; plan: readonly ChatPlanEntry[]; live: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? live
  if (!steps.length && !thinking && !denied && !plan.length) return null
  const summary = [plan.length ? 'plano' : '', steps.length ? `${steps.length} ${steps.length === 1 ? 'passo' : 'passos'}` : '', thinking ? 'raciocínio' : ''].filter(Boolean).join(' · ')
  return (
    <div data-chat-reasoning={open ? 'open' : 'closed'} className="flex flex-col gap-2">
      <button
        type="button"
        data-action="toggle-reasoning"
        aria-expanded={open}
        onClick={() => setToggled(!open)}
        className="no-drag -ml-1 inline-flex items-center gap-1.5 self-start rounded-[var(--radius-control)] px-1 py-0.5 text-12 font-medium text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
      >
        <Icon icon={open ? ChevronDown : ChevronRight} size={14} />
        Raciocínio e passos
        {summary && <span className="font-normal text-text-faint">· {summary}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-l-2 border-line-strong pl-3">
          {plan.length > 0 && <Plan entries={plan} />}
          {steps.length > 0 && (
            <ol data-chat-steps className="flex flex-col gap-1">
              {steps.map((step, index) => (
                <li key={step.id ?? index} data-chat-step={step.tool} data-chat-step-status={step.status} className="flex items-center gap-2 text-12 text-text-muted">
                  <Icon icon={stepIcon(step)} size={14} className="shrink-0 text-text-faint" />
                  <span className="min-w-0 truncate">{step.label}</span>
                  {step.status && <span className="shrink-0 text-text-faint">· {STEP_STATUS[step.status]}</span>}
                </li>
              ))}
            </ol>
          )}
          {denied > 0 && (
            <p data-chat-denied={denied} className="flex items-center gap-2 text-12 text-text-muted">
              <Icon icon={ShieldOff} size={14} className="shrink-0 text-text-faint" />
              {denied === 1 ? '1 ferramenta negada' : `${denied} ferramentas negadas`} (o Claude só lê as reuniões)
            </p>
          )}
          {thinking && (
            <p data-chat-thinking className="max-w-[72ch] text-12 whitespace-pre-wrap text-text-muted select-text">
              {thinking}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Modelo, tempo, tokens, custo nominal e as reuniões consultadas (clicável: abre a lista). */
function AnswerFooter({ meta, model, meetings }: { meta: ChatMeta | undefined; model: string | undefined; meetings: ChatMeetings }) {
  const navigate = useNavigate()
  const [showConsulted, setShowConsulted] = useState(false)
  const name = modelLabel(meta?.model || model)
  if (!meta && !name) return null
  const tokens = meta ? answerTokens(meta) : null
  const now = new Date()
  const parts = [name, meta ? answerTimeLabel(meta.durationMs) : '', tokens ? `${tokensLabel(tokens.input)} entrada · ${tokensLabel(tokens.output)} saída` : ''].filter(Boolean)
  return (
    <div data-chat-footer className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-12 text-text-faint tabular">
        <span>{parts.join(' · ')}</span>
        {meta && (
          <span data-chat-cost title={COST_HINT}>
            · {costLabel(meta.costUsd)}
            <span className="sr-only"> ({COST_HINT})</span>
          </span>
        )}
        {meta && meta.consulted.length > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              data-action="toggle-consulted"
              aria-expanded={showConsulted}
              onClick={() => setShowConsulted(!showConsulted)}
              className="no-drag rounded-[var(--radius-control)] text-accent underline decoration-1 underline-offset-3 hover:text-title"
            >
              {consultedLabel(meta.consulted.length)}
            </button>
          </>
        )}
      </div>
      {showConsulted && meta && (
        <ul data-chat-consulted className="flex flex-col gap-1 pt-1">
          {meta.consulted.map((id) => {
            const entry = meetings.byId.get(id)
            const date = entry ? new Date(entry.meeting.startedAt) : null
            return (
              <li key={id}>
                <button
                  type="button"
                  data-meeting-link={id}
                  onClick={() => void navigate(meetingPath(id))}
                  className="no-drag rounded-[var(--radius-control)] text-left text-12 text-accent underline decoration-1 underline-offset-3 hover:text-title"
                >
                  {entry ? entry.meeting.title : 'Reunião excluída'}
                  {date && (
                    <span className="text-text-faint">
                      {' '}
                      · {dayLabel(date, now)} {timeLabel(date)}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * O agente do ACP não abriu (contrato 17, CA8): troca a "Conexão com o Claude" para a linha de comando; a
 * próxima pergunta já vai por ela.
 */
function AgentActions({ missing }: { missing: boolean }) {
  const transport = useSettings((state) => state.settings.claudeTransport)
  const update = useSettings((state) => state.update)
  const acp = useAcp((state) => state.status)
  const label = useAgentLabel()
  if (transport === 'cli') return <p className="text-12 text-text-muted">Conexão trocada para a linha de comando. Pergunte de novo.</p>
  // Sem o agente: instalar (só com este clique) ou seguir pela linha de comando.
  const installing = acp?.state === 'installing'
  const installed = acp !== null && acpReady(acp)
  return (
    <div className="-ml-2 flex flex-wrap items-center gap-1">
      {missing && !installed && (
        <button type="button" data-action="acp-install-from-chat" disabled={installing} onClick={() => void useAcp.getState().install()} className={`${QUIET_BUTTON} text-accent`}>
          <Icon icon={Download} size={14} />
          {installing ? `Instalando o agente… ${acp?.progress ?? 0}%` : `Instalar o agente do ${label}`}
        </button>
      )}
      {missing && installed && <p className="px-2 text-12 text-text-muted">Agente instalado. Tente de novo.</p>}
      <button type="button" data-action="use-command-line" onClick={() => void update({ claudeTransport: 'cli' })} className={`${QUIET_BUTTON} text-accent`}>
        <Icon icon={Terminal} size={14} />
        Usar a linha de comando
      </button>
    </div>
  )
}

/** Cabeçalho da resposta: "Claude" e o horário. */
function AssistantHeader({ at }: { at: string }) {
  const date = at ? new Date(at) : null
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-13 font-bold text-title">Claude</span>
      {date && !Number.isNaN(date.getTime()) && <time className="text-12 text-text-faint tabular">{timeLabel(date)}</time>}
    </p>
  )
}

interface AssistantMessageProps {
  message: ChatMessage
  meetings: ChatMeetings
  /** "Copiar" (sempre) e "Refazer"/"Tentar de novo" (só na última resposta, fora de uma resposta em curso). */
  onCopy: () => Promise<boolean>
  onRedo: (() => void) | null
  /** Contrato 25: a conversa e a posição desta resposta, para os cartões de ação. */
  chatId?: string | null | undefined
  index?: number | undefined
}

/** Resposta gravada: cabeçalho, raciocínio e passos (fechado), o texto, o erro, o rodapé e as ações. */
export function AssistantMessage({ message, meetings, onCopy, onRedo, chatId = null, index }: AssistantMessageProps) {
  const agentLabel = useAgentLabel()
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void onCopy().then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <li data-chat-message="assistant" data-chat-error={message.error} className="flex flex-col gap-2">
      <AssistantHeader at={message.at} />
      <Reasoning steps={message.steps ?? []} thinking={message.thinking ?? ''} denied={message.denied ?? 0} plan={message.plan ?? []} live={false} />
      {message.text && (
        <div className="max-w-[72ch] text-15 text-text select-text">
          <ChatMarkdown text={message.text} />
        </div>
      )}
      {message.actions && message.actions.length > 0 && chatId && index !== undefined && <ActionCards chatId={chatId} index={index} actions={message.actions} />}
      {message.error && <p className="text-13 text-text-muted">{chatErrorText(message.error, agentLabel)}</p>}
      {(message.error === 'agent' || message.error === 'agent-missing') && <AgentActions missing={message.error === 'agent-missing'} />}
      <AnswerFooter meta={message.meta} model={message.model} meetings={meetings} />
      <div data-chat-actions className="-ml-2 flex flex-wrap items-center gap-1">
        {message.text && (
          <button type="button" data-action="chat-copy" onClick={copy} className={QUIET_BUTTON}>
            <Icon icon={copied ? Check : Copy} size={14} />
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        )}
        {onRedo && (
          <button type="button" data-action={message.error ? 'chat-retry' : 'chat-redo'} onClick={onRedo} className={QUIET_BUTTON}>
            <Icon icon={RotateCcw} size={14} />
            {message.error ? 'Tentar de novo' : 'Refazer'}
          </button>
        )}
      </div>
    </li>
  )
}

/**
 * Resposta em curso (contrato 16, CA2): enquanto o texto não começa, uma linha com o estado ("Pensando…",
 * depois o último passo); o bloco "Raciocínio e passos" aberto; o texto aparecendo enquanto é escrito.
 */
export function LiveAssistantMessage({ answer }: { answer: LiveAnswer }) {
  const status = answer.steps.at(-1)?.label ?? 'Pensando…'
  // Contrato 25: o bloco de ação ainda sendo escrito não aparece; vira cartão quando a resposta termina.
  const text = withoutPendingActions(answer.text)
  return (
    <li data-chat-message="assistant" data-chat-streaming="" className="flex flex-col gap-2">
      <AssistantHeader at="" />
      <Reasoning steps={answer.steps} thinking={answer.thinking} denied={answer.denied} plan={answer.plan} live />
      {text ? (
        <div className="max-w-[72ch] text-15 text-text">
          <ChatMarkdown text={text} />
        </div>
      ) : (
        <p role="status" data-chat-status className="flex items-center gap-2 text-13 text-text-muted">
          {/* Quadrado do logo, pulsando; parado com movimento reduzido (regra de tokens.css). */}
          <span aria-hidden="true" className="rec-pulse size-1.5 shrink-0 bg-accent" />
          {status}
        </p>
      )}
    </li>
  )
}
