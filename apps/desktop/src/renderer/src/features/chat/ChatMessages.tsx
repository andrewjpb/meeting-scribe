import { Check, ChevronDown, ChevronRight, Copy, FileText, FolderSearch, ListTree, RotateCcw, Search, ShieldOff, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { CHAT_ERROR_TEXT, type ChatMessage, type ChatMeta, type ChatStep } from '@shared/chat'
import { meetingPath } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { dayLabel, timeLabel } from '../meetings/format'
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
function Reasoning({ steps, thinking, denied, live }: { steps: readonly ChatStep[]; thinking: string; denied: number; live: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? live
  if (!steps.length && !thinking && !denied) return null
  const summary = [steps.length ? `${steps.length} ${steps.length === 1 ? 'passo' : 'passos'}` : '', thinking ? 'raciocínio' : ''].filter(Boolean).join(' · ')
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
          {steps.length > 0 && (
            <ol data-chat-steps className="flex flex-col gap-1">
              {steps.map((step, index) => (
                <li key={index} data-chat-step={step.tool} className="flex items-center gap-2 text-12 text-text-muted">
                  <Icon icon={stepIcon(step)} size={14} className="shrink-0 text-text-faint" />
                  <span className="min-w-0 truncate">{step.label}</span>
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
}

/** Resposta gravada: cabeçalho, raciocínio e passos (fechado), o texto, o erro, o rodapé e as ações. */
export function AssistantMessage({ message, meetings, onCopy, onRedo }: AssistantMessageProps) {
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
      <Reasoning steps={message.steps ?? []} thinking={message.thinking ?? ''} denied={message.denied ?? 0} live={false} />
      {message.text && (
        <div className="max-w-[72ch] text-15 text-text select-text">
          <ChatMarkdown text={message.text} />
        </div>
      )}
      {message.error && <p className="text-13 text-text-muted">{CHAT_ERROR_TEXT[message.error]}</p>}
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
  return (
    <li data-chat-message="assistant" data-chat-streaming="" className="flex flex-col gap-2">
      <AssistantHeader at="" />
      <Reasoning steps={answer.steps} thinking={answer.thinking} denied={answer.denied} live />
      {answer.text ? (
        <div className="max-w-[72ch] text-15 text-text">
          <ChatMarkdown text={answer.text} />
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
