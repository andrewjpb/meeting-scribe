// Fontes do Assistente (contrato 25, CA2): além das reuniões, a pasta da conversa recebe, a cada pergunta, o
// `ESTADO.md` (o que está acontecendo no app agora, sem segredo nenhum), o `GUIA-DO-APP.md` (o guia do app com a
// versão instalada), o `AUTOMACOES.md` (agentes, tarefas e as últimas 20 execuções) e as conversas do WhatsApp (as
// recentes, ou só as escolhidas). Cada fonte com interruptor no painel "Contexto"; desligada, o arquivo sai da
// pasta. Contrato 45: o email (o `EMAILS.md` e as mensagens já baixadas, do cache local). O texto que vem de
// mensagem, de execução ou de reunião é só material: tudo em uma linha (o corpo do email, citado), sem cerca de código
// (um bloco de ação nunca nasce de uma mensagem copiada para cá). Contrato 78: os lembretes com o id (para o modelo
// propor alterar ou apagar um deles) e as agendas do Calendário do Mac em que dá para gravar, só pelo nome.
import { randomUUID } from 'node:crypto'
import { chmod, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AGENT_MODEL_LABELS,
  describeSchedule,
  formatRunAt,
  OUTPUT_LABELS,
  previewOf,
  promptHeader,
  RUN_STATUS_LABELS,
  RUN_TRIGGER_LABELS,
  SCOPE_LABELS,
  type Agent,
  type AutomationRun,
  type ScheduledTask,
} from '../../shared/automations'
import type { ChatCalendarAccess } from '../../shared/assistant'
import { chatSourcesOf, chatWhatsAppModeOf, type ChatScope } from '../../shared/chat'
import { EMAIL_EXPORT_PREFIX, EMAIL_OVERVIEW_FILE } from '../../shared/email'
import { WHATSAPP_DEFAULT_SCOPE_DAYS, WHATSAPP_EXPORT_PREFIX, WHATSAPP_OVERVIEW_FILE } from '../../shared/whatsapp'

export const STATE_FILE = 'ESTADO.md'
export const GUIDE_FILE = 'GUIA-DO-APP.md'
export const AUTOMATIONS_FILE = 'AUTOMACOES.md'
/** Contrato 45 (CA7): o resultado da ferramenta `buscar_emails` (trocado a cada busca, apagado na pergunta seguinte). */
export const EMAIL_SEARCH_FILE = 'BUSCA-EMAILS.md'
/**
 * Contrato 56: os resultados das ferramentas de organizar o email (trocados a cada chamada, apagados na pergunta
 * seguinte, como a busca). Fora do `INDICE.md`.
 */
export const EMAIL_CONVERSATIONS_FILE = 'CONVERSAS-EMAIL.md'
export const EMAIL_FOLDERS_FILE = 'PASTAS-EMAIL.md'
export const EMAIL_MOVE_FILE = 'MOVER-EMAILS.md'
const EMAIL_TOOL_FILES: readonly string[] = [EMAIL_CONVERSATIONS_FILE, EMAIL_FOLDERS_FILE, EMAIL_MOVE_FILE]
/** Arquivos das fontes do app, na ordem em que o `INDICE.md` lista. */
export const SOURCE_FILES = [STATE_FILE, GUIDE_FILE, AUTOMATIONS_FILE, WHATSAPP_OVERVIEW_FILE, EMAIL_OVERVIEW_FILE, EMAIL_SEARCH_FILE] as const
/** Execuções no `AUTOMACOES.md`. */
export const AUTOMATION_RUNS_IN_SOURCE = 20
/** Marca da versão no guia (`resources/assistente/guia-do-app.md`). */
export const GUIDE_VERSION_MARK = '{{versao}}'

/** O que o `ESTADO.md` mostra. Nada de token, senha, chave ou caminho. */
export interface AssistantState {
  now: number
  timeZone: string
  version: string
  /** Gravação em curso: quando começou. */
  recording: { startedAt: number } | null
  /** "Conectada como ana@exemplo.com", "Não conectada". */
  google: string
  /** A linha do estado do WhatsApp das Configurações ("Conectado como …", "Não instalado"). */
  whatsapp: string
  /** Contrato 45: as contas de email ("ana@x.com (IMAP, conectada)"), sem senha nem servidor. */
  email?: string | undefined
  /** "Pausadas pela pessoa", "pausadas pelo limite diário" ou `null`. */
  automationsPaused: string | null
  agents: readonly Pick<Agent, 'name'>[]
  /** Tarefas ligadas (fora da pausa automática), com a próxima vez. Contrato 78: o id, para os lembretes. */
  tasks: readonly Pick<ScheduledTask, 'id' | 'name' | 'enabled' | 'autoPaused' | 'nextRunAt' | 'timezone' | 'reminder'>[]
  /**
   * Contrato 78: o Calendário do Mac. As agendas graváveis (nome, conta e a que o app usa por padrão), nunca o id; sem
   * acesso, a lista vazia. Ausente, a seção não sai.
   */
  calendar?: { access: ChatCalendarAccess; calendars: readonly { title: string; source: string; isDefault: boolean }[] } | undefined
}

/** Contrato 78: a seção "Agendas do Mac" do `ESTADO.md`. */
function calendarLines(calendar: NonNullable<AssistantState['calendar']>): string[] {
  if (calendar.access === 'unavailable') return ['Calendário indisponível.']
  if (calendar.access !== 'full') return ['Sem acesso ao Calendário do Mac (peça em Configurações › Email › Convites).']
  if (!calendar.calendars.length) return ['Nenhuma agenda em que dá para gravar.']
  return calendar.calendars.map((item) => `- ${oneLine(item.title)} (${oneLine(item.source)})${item.isDefault ? ', padrão' : ''}`)
}

const oneLine = (text: string): string => previewOf(text, 400)

/** `ESTADO.md`: data, hora e fuso de agora, gravação, contas, versão e automações ligadas. */
export function stateMarkdown(state: AssistantState): string {
  const on = state.tasks.filter((task) => task.enabled && !task.autoPaused)
  const reminders = on.filter((task) => task.reminder && task.nextRunAt && !Number.isNaN(Date.parse(task.nextRunAt)))
  const lines = [
    '# Estado atual do app',
    '',
    'Gerado agora, a cada pergunta. Use a data, a hora e o fuso daqui para entender "hoje", "amanhã", "sexta às 3" e "daqui a 2 horas".',
    '',
    `- ${promptHeader(state.now, state.timeZone)}`,
    `- Fuso: ${state.timeZone}`,
    `- Versão instalada: ${state.version}`,
    `- Gravação: ${state.recording ? `em andamento desde ${formatRunAt(state.recording.startedAt, state.timeZone)}` : 'nenhuma em andamento'}`,
    `- Conta Google: ${state.google}`,
    `- WhatsApp: ${state.whatsapp}`,
    ...(state.email !== undefined ? [`- Email: ${state.email}`] : []),
    `- Automações: ${state.automationsPaused ?? 'rodando'}`,
    `- Agentes cadastrados: ${state.agents.length ? state.agents.map((agent) => oneLine(agent.name)).join(', ') : 'nenhum'}`,
    `- Tarefas ligadas: ${
      on.length
        ? on
            .map((task) => {
              const next = task.nextRunAt ? Date.parse(task.nextRunAt) : Number.NaN
              return `${oneLine(task.name)}${task.reminder ? ' (lembrete)' : ''}${Number.isNaN(next) ? '' : ` (próxima: ${formatRunAt(next, task.timezone)})`}`
            })
            .join('; ')
        : 'nenhuma'
    }`,
    // Contrato 78: os lembretes que ainda vão avisar, com o id (o cartão de alterar ou apagar só aceita um destes).
    '',
    '## Lembretes',
    '',
    ...(reminders.length ? reminders.map((task) => `- Lembrete: ${oneLine(task.reminder?.text ?? task.name)} · ${formatRunAt(Date.parse(task.nextRunAt ?? ''), task.timezone)} · id: ${task.id}`) : ['Nenhum lembrete.']),
    ...(state.calendar ? ['', '## Agendas do Mac', '', ...calendarLines(state.calendar)] : []),
  ]
  return `${lines.join('\n')}\n`
}

/** `GUIA-DO-APP.md`: o guia do pacote com a versão instalada no lugar da marca. */
export function guideMarkdown(template: string, version: string): string {
  return template.split(GUIDE_VERSION_MARK).join(version)
}

export interface AutomationsSnapshot {
  agents: readonly Agent[]
  tasks: readonly ScheduledTask[]
  /** As mais recentes primeiro, com o pedido e a resposta. */
  runs: readonly AutomationRun[]
}

/** `AUTOMACOES.md`: agentes, tarefas (próxima e última execução, estado) e as últimas 20 execuções. */
export function automationsMarkdown(snapshot: AutomationsSnapshot, timeZone: string): string {
  const agentName = (id: string): string => snapshot.agents.find((agent) => agent.id === id)?.name ?? 'agente excluído'
  const when = (iso: string | null, zone: string): string => {
    const at = iso ? Date.parse(iso) : Number.NaN
    return Number.isNaN(at) ? 'nenhuma' : formatRunAt(at, zone)
  }
  const lines = [
    '# Automações',
    '',
    'Os agentes e as tarefas agendadas da tela "Automações", e as últimas execuções. Cite como [Automações · <nome do agente ou da tarefa>].',
    '',
    '## Agentes',
    '',
    ...(snapshot.agents.length
      ? snapshot.agents.map(
          (agent) =>
            `- ${oneLine(agent.name)} · id: ${agent.id} · modelo ${AGENT_MODEL_LABELS[agent.model]} · ${SCOPE_LABELS[agent.scope.kind]} · saída: ${OUTPUT_LABELS[agent.output.kind]}${agent.description ? ` · ${oneLine(agent.description)}` : ''}`,
        )
      : ['Nenhum agente.']),
    '',
    '## Tarefas agendadas',
    '',
    ...(snapshot.tasks.length
      ? snapshot.tasks.map((task) => {
          // Contrato 78: o lembrete com o id (o cartão de alterar ou apagar só aceita um destes).
          if (task.reminder) {
            const at = task.schedule.kind === 'once' ? task.schedule.at : task.nextRunAt
            const state = task.lastRunAt ? `já avisou em ${when(task.lastRunAt, task.timezone)}` : task.enabled ? 'ligado' : 'desligado'
            return `- Lembrete: ${oneLine(task.reminder.text)} · ${when(at, task.timezone)} · id: ${task.id} · só notificação, sem agente · ${state}`
          }
          const state = task.autoPaused ? 'pausada depois de 3 falhas' : task.enabled ? 'ligada' : 'desligada'
          const who = `agente ${oneLine(agentName(task.agentId))}`
          const last = task.lastStatus ? `${RUN_STATUS_LABELS[task.lastStatus]} em ${when(task.lastRunAt, task.timezone)}` : 'ainda não rodou'
          return `- ${oneLine(task.name)} · ${who} · ${describeSchedule(task.schedule, task.timezone)} · ${state} · próxima: ${when(task.nextRunAt, task.timezone)} · última: ${last}`
        })
      : ['Nenhuma tarefa agendada.']),
    '',
    `## Últimas ${AUTOMATION_RUNS_IN_SOURCE} execuções`,
    '',
    ...(snapshot.runs.length
      ? snapshot.runs.slice(0, AUTOMATION_RUNS_IN_SOURCE).map((run) => {
          // O pedido sem o cabeçalho "Agora: …" que o agendador acrescenta.
          const prompt = run.prompt.split('\n\n').slice(1).join(' ') || run.prompt
          const at = Date.parse(run.startedAt)
          const parts = [
            `- ${Number.isNaN(at) ? run.startedAt : formatRunAt(at, timeZone)}`,
            oneLine(run.taskName ?? run.agentName),
            `agente ${oneLine(run.agentName)}`,
            RUN_TRIGGER_LABELS[run.trigger],
            RUN_STATUS_LABELS[run.status],
            `pedido: "${previewOf(prompt, 200)}"`,
            run.answer?.text ? `começo da resposta: "${previewOf(run.answer.text, 300)}"` : run.error ? `erro: ${oneLine(run.error)}` : '',
          ]
          return parts.filter(Boolean).join(' · ')
        })
      : ['Nenhuma execução.']),
  ]
  return `${lines.join('\n')}\n`
}

export interface AssistantSourcesDeps {
  state: () => Promise<AssistantState>
  /** O guia do pacote, com a marca da versão. */
  guide: () => Promise<string>
  automations: () => Promise<AutomationsSnapshot>
  /** Só leitura: as conversas recentes ou as escolhidas (contrato 24). */
  whatsapp?: {
    exportRecent(folder: string): Promise<string[]>
    exportChats(folder: string, chatIds: readonly string[], days: number): Promise<string[]>
  }
  /** Contrato 45: o cache do email (`EMAILS.md` e as mensagens já baixadas). Só leitura, sem ir ao servidor. */
  email?: { export(folder: string): Promise<string[]> }
  log?: (message: string) => void
}

/** Fontes escritas numa pasta: o que entrou (para a instrução e o teste). */
export interface WrittenSources {
  files: string[]
  whatsapp: boolean
  /** Contrato 45. */
  email: boolean
}

/** Grava (atômico, 0600) só se o conteúdo mudou. */
async function writeAtomic(file: string, content: string): Promise<void> {
  if ((await readFile(file, 'utf8').catch(() => null)) === content) return
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
  await chmod(file, 0o600)
}

/** O arquivo é de uma fonte do app (e sai da pasta antes de escrever de novo)? */
export const isSourceFile = (name: string): boolean =>
  (SOURCE_FILES as readonly string[]).includes(name) || EMAIL_TOOL_FILES.includes(name) || ((name.startsWith(WHATSAPP_EXPORT_PREFIX) || name.startsWith(EMAIL_EXPORT_PREFIX)) && name.endsWith('.md'))

/**
 * Antes de cada pergunta: as fontes da conversa na pasta dela. Cada arquivo só é regravado se mudou (e o WhatsApp só
 * relê a conversa com mensagem nova); no fim, sai só o que não vale mais (a fonte desligada, a conversa que saiu do
 * período). Uma fonte que falha fica de fora; a pergunta segue.
 */
export async function writeSources(deps: AssistantSourcesDeps, folder: string, scope: ChatScope): Promise<WrittenSources> {
  const sources = chatSourcesOf(scope)
  const files: string[] = []
  const attempt = async (label: string, work: () => Promise<string[]>): Promise<string[]> => {
    try {
      return await work()
    } catch (error) {
      deps.log?.(`[assistente] fonte ${label} ficou de fora: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }
  const state = await deps.state()
  files.push(
    ...(await attempt('estado', async () => {
      await writeAtomic(join(folder, STATE_FILE), stateMarkdown(state))
      return [STATE_FILE]
    })),
  )
  if (sources.guide)
    files.push(
      ...(await attempt('guia', async () => {
        await writeAtomic(join(folder, GUIDE_FILE), guideMarkdown(await deps.guide(), state.version))
        return [GUIDE_FILE]
      })),
    )
  if (sources.automations)
    files.push(
      ...(await attempt('automações', async () => {
        await writeAtomic(join(folder, AUTOMATIONS_FILE), automationsMarkdown(await deps.automations(), state.timeZone))
        return [AUTOMATIONS_FILE]
      })),
    )
  let whatsapp = false
  if (sources.whatsapp && deps.whatsapp) {
    const client = deps.whatsapp
    const chosen = chatWhatsAppModeOf(scope) === 'chosen'
    const written = await attempt('whatsapp', () => (chosen ? client.exportChats(folder, scope.whatsappChats ?? [], scope.whatsappDays ?? WHATSAPP_DEFAULT_SCOPE_DAYS) : client.exportRecent(folder)))
    whatsapp = written.length > 0
    files.push(...written)
  }
  let email = false
  if (sources.email && deps.email) {
    const client = deps.email
    const written = await attempt('email', () => client.export(folder))
    email = written.length > 0
    files.push(...written)
  }
  const keep = new Set(files)
  for (const name of await readdir(folder).catch(() => [] as string[])) if (isSourceFile(name) && !keep.has(name)) await rm(join(folder, name), { force: true })
  return { files, whatsapp, email }
}
