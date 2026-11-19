import { Check, ChevronDown, ChevronRight, Copy, Download, FileText, FolderSearch, Globe, ListTree, Plug, RotateCcw, Search, ShieldOff, Square, SquareCheck, SquareDot, Terminal, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { withoutPendingActions } from '@shared/assistant'
import { chatErrorText, chatWebUsage, chatWebUsageLabel, type ChatMessage, type ChatMeta, type ChatPlanEntry, type ChatStep, type ChatStepStatus } from '@shared/chat'
import { acpReady } from '@shared/acp'
import { EMAIL_ORGANIZE_STEP_ID } from '@shared/email-organize'
import { useAcp } from '../../app/acpStore'
import { useAgentLabel } from '../../app/agentLabel'
import { useSettings } from '../../app/settingsStore'
import { meetingPath, ROUTE_PATHS } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { dayLabel, timeLabel } from '../meetings/format'
import { ActionCards } from './ActionCards'
import type { LiveAnswer } from './chatStore'
import { ChatMarkdown } from './ChatMarkdown'
import { McpApprovalCard } from './McpApprovalCard'
import { answerTimeLabel, answerTokens, consultedLabel, COST_HINT, costLabel, modelLabel, tokensLabel } from './format'
import type { ChatMeetings } from './useChatMeetings'

/** Botão discreto das ações da resposta e do rodapé. */
export const QUIET_BUTTON =
  'no-drag inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-12 text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken hover:text-title disabled:pointer-events-none disabled:opacity-50'

/** Ícone de cada passo: o índice, uma reunião, uma busca, a lista de arquivos, a internet (contrato 26), o MCP (contrato 21) e o navegador (contrato 47). */
function stepIcon(step: ChatStep): LucideIcon {
  if (step.tool === 'Mcp') return step.status === 'failed' ? ShieldOff : Plug
  if (step.tool === 'WebFetch' && step.status === 'failed') return ShieldOff
  if (step.tool === 'WebSearch' || step.tool === 'WebFetch' || step.tool.startsWith('navegador_')) return Globe
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

/**
 * Contrato 38: no Assistente, a resposta é um cartão suave (fundo elevado, fio e o raio do painel; sem sombra) e as ações
 * ficam no rodapé dele, separadas por um fio.
 */
const CARD = 'rounded-[var(--radius-panel)] border border-line bg-bg-raised px-4 py-3'
const CARD_ACTIONS = 'mt-1 flex flex-wrap items-center gap-1 border-t border-line pt-2 empty:hidden'
/** Ações do cartão: o botão discreto com um fio que aparece no passar do mouse. */
const CARD_BUTTON = `${QUIET_BUTTON} border border-transparent hover:border-line`

/** Pergunta da pessoa: bloco com fundo sutil, à direita (no Assistente, com mais respiro). */
export function UserMessage({ text, editing = false, card = false }: { text: string; editing?: boolean; card?: boolean }) {
  return (
    <li data-chat-message="user" className="flex justify-end">
      <p
        className={`max-w-[72ch] rounded-[var(--radius-panel)] bg-bg-sunken ${card ? 'px-4 py-3' : 'px-4 py-2.5'} text-15 whitespace-pre-line text-text select-text ${editing ? 'outline-1 outline-dashed outline-line-strong' : ''}`}
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

/**
 * Modelo, tempo, tokens, custo nominal e as reuniões consultadas (clicável: abre a lista). Contrato 26: "Usou a
 * internet · N buscas · M páginas" quando a resposta buscou ou abriu páginas.
 */
function AnswerFooter({ meta, model, meetings, steps }: { meta: ChatMeta | undefined; model: string | undefined; meetings: ChatMeetings; steps?: readonly ChatStep[] | undefined }) {
  const navigate = useNavigate()
  const [showConsulted, setShowConsulted] = useState(false)
  const name = modelLabel(meta?.model || model)
  const web = chatWebUsage(steps)
  if (!meta && !name && !web.used) return null
  const tokens = meta ? answerTokens(meta) : null
  const now = new Date()
  const parts = [name, meta ? answerTimeLabel(meta.durationMs) : '', tokens ? `${tokensLabel(tokens.input)} entrada · ${tokensLabel(tokens.output)} saída` : ''].filter(Boolean)
  return (
    <div data-chat-footer className="flex flex-col gap-1">
      {web.used && (
        <p data-chat-web={`${web.searches}/${web.pages}`} className="flex items-center gap-1.5 text-12 text-text-muted">
          <Icon icon={Globe} size={14} className="shrink-0 text-text-faint" />
          {chatWebUsageLabel(web)}
        </p>
      )}
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

/** Cabeçalho da resposta: "Claude" e o horário; no cartão em curso, o quadrado do logo pulsando (contrato 38). */
function AssistantHeader({ at, pulse = false }: { at: string; pulse?: boolean }) {
  const date = at ? new Date(at) : null
  return (
    <p className="flex items-baseline gap-2">
      {/* Parado com movimento reduzido (regra de tokens.css). */}
      {pulse && <span aria-hidden="true" className="chat-live-pulse size-1.5 shrink-0 self-center bg-accent" />}
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
  /** Contrato 38: cartão (Assistente). */
  card?: boolean | undefined
}

/** Resposta gravada: cabeçalho, raciocínio e passos (fechado), o texto, o erro, o rodapé e as ações. */
export function AssistantMessage({ message, meetings, onCopy, onRedo, chatId = null, index, card = false }: AssistantMessageProps) {
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
    <li data-chat-message="assistant" data-chat-error={message.error} className={`flex flex-col gap-2 ${card ? CARD : ''}`}>
      <AssistantHeader at={message.at} />
      <Reasoning steps={message.steps ?? []} thinking={message.thinking ?? ''} denied={message.denied ?? 0} plan={message.plan ?? []} live={false} />
      {message.text && (
        <div className="max-w-[72ch] text-15 text-text select-text">
          <ChatMarkdown text={message.text} />
        </div>
      )}
      {message.actions && message.actions.length > 0 && chatId && index !== undefined && <ActionCards chatId={chatId} index={index} actions={message.actions} web={chatWebUsage(message.steps).used} />}
      {message.error && <p className="text-13 text-text-muted">{chatErrorText(message.error, agentLabel)}</p>}
      {(message.error === 'agent' || message.error === 'agent-missing') && <AgentActions missing={message.error === 'agent-missing'} />}
      <AnswerFooter meta={message.meta} model={message.model} meetings={meetings} steps={message.steps} />
      <div data-chat-actions className={card ? CARD_ACTIONS : '-ml-2 flex flex-wrap items-center gap-1'}>
        {message.text && (
          <button type="button" data-action="chat-copy" onClick={copy} className={card ? CARD_BUTTON : QUIET_BUTTON}>
            <Icon icon={copied ? Check : Copy} size={14} />
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        )}
        {onRedo && (
          <button type="button" data-action={message.error ? 'chat-retry' : 'chat-redo'} onClick={onRedo} className={card ? CARD_BUTTON : QUIET_BUTTON}>
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
 * depois o último passo); o bloco "Raciocínio e passos" aberto; o texto aparecendo enquanto é escrito. Contrato 21: os
 * cartões de aprovação das ferramentas MCP, logo abaixo dos passos.
 */
export function LiveAssistantMessage({ answer, card = false, chatId = null }: { answer: LiveAnswer; card?: boolean; chatId?: string | null }) {
  const navigate = useNavigate()
  const status = answer.steps.at(-1)?.label ?? 'Pensando…'
  // Contrato 56 (D13 do mockup): enquanto o Assistente organiza o email, sem cartão; só o passo e o link para a tela Email.
  const organizing = answer.steps.some((step) => step.id === EMAIL_ORGANIZE_STEP_ID && step.status === 'in_progress')
  // Contrato 25: o bloco de ação ainda sendo escrito não aparece; vira cartão quando a resposta termina.
  const text = withoutPendingActions(answer.text)
  return (
    <li data-chat-message="assistant" data-chat-streaming="" className={`flex flex-col gap-2 ${card ? `${CARD} chat-card-enter` : ''}`}>
      <AssistantHeader at="" pulse={card} />
      <Reasoning steps={answer.steps} thinking={answer.thinking} denied={answer.denied} plan={answer.plan} live />
      {chatId && answer.approvals.map((approval) => <McpApprovalCard key={approval.id} chatId={chatId} approval={approval} />)}
      {text ? (
        <div className="max-w-[72ch] text-15 text-text">
          <ChatMarkdown text={text} />
        </div>
      ) : (
        <p role="status" data-chat-status className="flex items-center gap-2 text-13 text-text-muted">
          {/* Quadrado do logo, pulsando; parado com movimento reduzido (regra de tokens.css). No cartão, ele pulsa no cabeçalho. */}
          {!card && <span aria-hidden="true" className="rec-pulse size-1.5 shrink-0 bg-accent" />}
          {status}
        </p>
      )}
      {organizing && (
        <p className="flex items-center gap-2 text-12">
          <button type="button" data-action="chat-email-organize-follow" onClick={() => void navigate(ROUTE_PATHS.email.replace('/:conta?/:pasta?', ''))} className="no-drag font-medium text-accent hover:underline">
            Acompanhar no Email
          </button>
        </p>
      )}
    </li>
  )
}
