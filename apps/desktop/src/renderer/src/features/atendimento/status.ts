// Atendimento na tela do WhatsApp (contrato 143): o estado do selo de uma conversa, as respostas do dia, as mensagens
// que o agente enviou e os campos do painel da conversa (com os problemas que travam o "Salvar"). Tudo puro, testado
// em `test/renderer/atendimento-status.test.ts`.
import {
  ATENDIMENTO_ABOUT_MAX,
  ATENDIMENTO_BINDING_DEFAULTS,
  ATENDIMENTO_DELAY_MAX_MINUTES,
  ATENDIMENTO_MAX_PER_HOUR_MAX,
  ATENDIMENTO_MAX_PER_HOUR_MIN,
  ATENDIMENTO_PAUSE_ON_MY_REPLY_MAX,
  ATENDIMENTO_TIME_PATTERN,
  isWithinHours,
  type AtendimentoBinding,
  type AtendimentoBindingInput,
  type AtendimentoLogEntry,
  type AtendimentoMode,
  type AtendimentoRuntime,
} from '@shared/atendimento'

export type BadgeKind = 'off' | 'all-paused' | 'handed-off' | 'proposed' | 'scheduled' | 'paused' | 'out-of-hours' | 'attending'

const MINUTE = 60_000
const pad = (value: number): string => String(value).padStart(2, '0')
const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "15:40" no mesmo dia de `now`; "24/11 15:40" em outro. */
export function untilLabel(iso: string, now: Date): string {
  const date = new Date(iso)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return sameDay(date, now) ? time : `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time}`
}

/** A pausa do atendimento ainda vale em `now`. */
export const pausedNow = (binding: Pick<AtendimentoBinding, 'pausedUntil'> | undefined, now: Date): boolean =>
  Boolean(binding?.pausedUntil && Date.parse(binding.pausedUntil) > now.getTime())

/** O selo da conversa, na precedência do contrato: o primeiro que vale ganha. `null`: a conversa não tem atendimento. */
export function atendimentoStatus(input: {
  binding: AtendimentoBinding | undefined
  pausedAll: boolean
  runtime: AtendimentoRuntime[string] | undefined
  now: Date
}): { kind: BadgeKind; label: string } | null {
  const { binding, pausedAll, runtime, now } = input
  if (!binding) return null
  if (!binding.enabled) return { kind: 'off', label: 'desligado' }
  if (pausedAll) return { kind: 'all-paused', label: 'todos pausados' }
  if (runtime?.handedOffAt) return { kind: 'handed-off', label: 'passou para você' }
  if (runtime?.draft) return { kind: 'proposed', label: 'propôs uma resposta' }
  const due = runtime?.dueAt ? Date.parse(runtime.dueAt) - now.getTime() : 0
  if (due > 0) return { kind: 'scheduled', label: due < MINUTE ? 'responde em instantes' : `responde em ${Math.ceil(due / MINUTE)} min` }
  if (pausedNow(binding, now) && binding.pausedUntil) return { kind: 'paused', label: `pausado até ${untilLabel(binding.pausedUntil, now)}` }
  if (!isWithinHours(binding.hours, now)) return { kind: 'out-of-hours', label: 'fora do horário' }
  return { kind: 'attending', label: 'atendendo' }
}

const REPLY_ACTIONS: ReadonlySet<AtendimentoLogEntry['action']> = new Set(['sent', 'draft-sent'])

/** Respostas do agente na conversa (enviadas sozinho ou pela proposta) no dia local de `now`. */
export function repliesToday(log: readonly AtendimentoLogEntry[], chatId: string, now: Date): number {
  return log.filter((entry) => entry.chatId === chatId && REPLY_ACTIONS.has(entry.action) && sameDay(new Date(entry.at), now)).length
}

/** Id da mensagem → agente que a enviou, das linhas `sent` e `draft-sent` que têm o id. */
export function agentMessageIds(log: readonly AtendimentoLogEntry[]): Map<string, string> {
  const ids = new Map<string, string>()
  for (const entry of log) if (entry.messageId && REPLY_ACTIONS.has(entry.action)) ids.set(entry.messageId, entry.agentId)
  return ids
}

/** "agora", "há 3 min" ou, depois de uma hora, a hora ("às 14:05"; em outro dia, "24/11 14:05"). */
export function relativeLabel(iso: string, now: Date): string {
  const diff = now.getTime() - Date.parse(iso)
  if (diff < MINUTE) return 'agora'
  if (diff < 60 * MINUTE) return `há ${Math.floor(diff / MINUTE)} min`
  const date = new Date(iso)
  return sameDay(date, now) ? `às ${pad(date.getHours())}:${pad(date.getMinutes())}` : untilLabel(iso, now)
}

/** Os campos do painel da conversa: números como texto (o que está digitado), o horário separado em partes. */
export interface BindingDraft {
  agentId: string
  enabled: boolean
  mode: AtendimentoMode
  delayMin: string
  delayMax: string
  typing: boolean
  identify: boolean
  about: string
  hoursMode: 'always' | 'pick'
  days: number[]
  start: string
  end: string
  maxPerHour: string
  pause: string
}

/** Horário sugerido ao trocar "Sempre" por "Escolher" numa conversa sem horário: segunda a sexta, das 8 às 18. */
export const DEFAULT_PICKED_HOURS = { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' } as const

/** O formulário de um atendimento salvo, ou o de um novo (`ATENDIMENTO_BINDING_DEFAULTS`, com o agente pedido). */
export function bindingDraft(binding: AtendimentoBinding | undefined, defaultAgentId = ''): BindingDraft {
  const source = binding ?? ATENDIMENTO_BINDING_DEFAULTS
  return {
    agentId: binding?.agentId ?? defaultAgentId,
    enabled: source.enabled,
    mode: source.mode,
    delayMin: String(source.delayMinMinutes),
    delayMax: String(source.delayMaxMinutes),
    typing: source.typing,
    identify: source.identify,
    about: source.about,
    hoursMode: source.hours ? 'pick' : 'always',
    days: source.hours ? [...source.hours.days] : [...DEFAULT_PICKED_HOURS.days],
    start: source.hours?.start ?? DEFAULT_PICKED_HOURS.start,
    end: source.hours?.end ?? DEFAULT_PICKED_HOURS.end,
    maxPerHour: String(source.maxPerHour),
    pause: String(source.pauseOnMyReplyMinutes),
  }
}

/** Inteiro de `min` a `max` digitado como texto; `null` fora disso. */
function wholeIn(value: string, min: number, max: number): number | null {
  if (!/^\d{1,5}$/.test(value.trim())) return null
  const number = Number(value.trim())
  return number >= min && number <= max ? number : null
}

/** O que impede salvar, campo a campo (a frase aparece junto do campo). Vazio: pode salvar. */
export interface BindingProblems {
  agent?: string
  delay?: string
  hours?: string
  maxPerHour?: string
  pause?: string
  about?: string
}

export function bindingProblems(draft: BindingDraft): BindingProblems {
  const problems: BindingProblems = {}
  if (!draft.agentId) problems.agent = 'Escolha um agente.'
  const min = wholeIn(draft.delayMin, 0, ATENDIMENTO_DELAY_MAX_MINUTES)
  const max = wholeIn(draft.delayMax, 0, ATENDIMENTO_DELAY_MAX_MINUTES)
  if (min === null || max === null) problems.delay = `Use minutos inteiros de 0 a ${ATENDIMENTO_DELAY_MAX_MINUTES}.`
  else if (max < min) problems.delay = 'O segundo número não pode ser menor que o primeiro.'
  if (draft.hoursMode === 'pick') {
    if (draft.days.length === 0) problems.hours = 'Escolha pelo menos um dia.'
    else if (!ATENDIMENTO_TIME_PATTERN.test(draft.start) || !ATENDIMENTO_TIME_PATTERN.test(draft.end)) problems.hours = 'Use horas no formato HH:MM, de 00:00 a 23:59.'
  }
  if (wholeIn(draft.maxPerHour, ATENDIMENTO_MAX_PER_HOUR_MIN, ATENDIMENTO_MAX_PER_HOUR_MAX) === null) problems.maxPerHour = `Use um número de ${ATENDIMENTO_MAX_PER_HOUR_MIN} a ${ATENDIMENTO_MAX_PER_HOUR_MAX}.`
  if (wholeIn(draft.pause, 0, ATENDIMENTO_PAUSE_ON_MY_REPLY_MAX) === null) problems.pause = `Use minutos inteiros de 0 a ${ATENDIMENTO_PAUSE_ON_MY_REPLY_MAX}.`
  if (draft.about.length > ATENDIMENTO_ABOUT_MAX) problems.about = `Use até ${ATENDIMENTO_ABOUT_MAX} caracteres.`
  return problems
}

/** O pedido de `saveBinding` com os campos do painel (já sem problemas). */
export function bindingInput(chatId: string, draft: BindingDraft): AtendimentoBindingInput {
  return {
    chatId,
    agentId: draft.agentId,
    enabled: draft.enabled,
    mode: draft.mode,
    delayMinMinutes: Number(draft.delayMin.trim()),
    delayMaxMinutes: Number(draft.delayMax.trim()),
    typing: draft.typing,
    identify: draft.identify,
    about: draft.about,
    // Dias em ordem, como o esquema guarda.
    hours: draft.hoursMode === 'pick' ? { days: [...draft.days].sort((a, b) => a - b), start: draft.start, end: draft.end } : null,
    maxPerHour: Number(draft.maxPerHour.trim()),
    pauseOnMyReplyMinutes: Number(draft.pause.trim()),
  }
}

/** As linhas da lista do aviso de risco, com os valores do formulário. */
export function riskLines(draft: Pick<BindingDraft, 'delayMin' | 'delayMax' | 'typing' | 'maxPerHour'>): string[] {
  const min = Number(draft.delayMin.trim())
  const max = Number(draft.delayMax.trim())
  return [
    min === 0 && max === 0 ? 'responde sem espera;' : `espera de ${min} a ${max} minutos antes de responder;`,
    ...(draft.typing ? ['mostra “digitando…” antes de enviar;'] : []),
    `responde no máximo ${Number(draft.maxPerHour.trim())} vezes por hora.`,
  ]
}
