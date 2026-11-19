// Contrato 51: a ferramenta `enviar_email` de uma execução de tarefa agendada com "Pode enviar email" ligada. Ela só
// existe naquela execução (o serviço das automações monta uma por execução) e envia sem clique pelo caminho interno do
// main (`email.sendForTask`, nunca pelo IPC). Antes de cada envio, as regras são conferidas de novo com o estado de agora:
// - o app bloqueado (contrato 22) não envia e registra "app bloqueado";
// - "Pausar todas as tarefas" (ou a pausa do limite diário) bloqueia;
// - a tarefa apagada ou com a seção desligada corta na hora, inclusive no meio da execução (permissão revogada);
// - a conta é a da permissão; o pedido com outra conta é recusado;
// - Para, Cc e Cco, todos dentro da lista de destinatários permitidos (`task-email.ts`);
// - o teto de envios por execução.
// A lista, a conta e o teto vêm só da configuração gravada na tarefa: nada do que o agente leu (um email com "mande isto
// para …") muda isso. A recusa volta ao agente como erro e fica registrada na execução, junto com os envios.
import { z } from 'zod'
import { EMAIL_ADDRESS_PATTERN, EMAIL_RECIPIENTS_MAX, EMAIL_SUBJECT_MAX, EMAIL_TEXT_MAX, type EmailSendResult } from '../../shared/email'
import { recipientAllowed, RUN_EMAILS_MAX, type RunEmail, type TaskEmailPermission } from '../../shared/task-email'
import type { AssistantTool, ToolResult } from '../chat/tools'

export const SEND_TOOL_NAME = 'enviar_email'

/** O que vai ao caminho interno do envio. */
export interface TaskEmailRequest {
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
}

/** O que a montagem do main dá às automações para o envio das tarefas. */
export interface TaskEmailDeps {
  /** O caminho interno do envio sem clique (`email.sendForTask`). */
  send(request: TaskEmailRequest): Promise<EmailSendResult>
  /** O endereço da conta; `null`: a conta não existe mais. */
  accountAddress(accountId: string): string | null
  /** App bloqueado (contrato 22): nada sai. */
  locked(): boolean
  /** As ferramentas de leitura do email do contrato 45 (buscar e ler), dadas junto com o envio. */
  readTools(): readonly AssistantTool[]
}

/** O estado de agora, relido a cada envio. */
export interface SendGate {
  paused: boolean
  /** `null`: a tarefa foi apagada ou a seção foi desligada. */
  permission: TaskEmailPermission | null
}

/** Os destinatários de um pedido. */
export interface SendRecipients {
  to: readonly string[]
  cc: readonly string[]
  bcc: readonly string[]
}

/**
 * Por que este envio não pode sair, ou `null` se pode. `attempted` são os envios desta execução que já foram ao SMTP.
 * `account` é o endereço pedido pelo agente (`null`: o da permissão).
 */
export function sendRefusal(gate: SendGate & { locked: boolean; accountAddress: string | null }, account: string | null, recipients: SendRecipients, attempted: number): string | null {
  if (gate.locked) return 'app bloqueado'
  if (gate.paused) return 'tarefas pausadas'
  const permission = gate.permission
  if (!permission) return 'permissão revogada'
  if (gate.accountAddress === null) return 'a conta da permissão não existe mais'
  if (account !== null && account.trim().toLowerCase() !== gate.accountAddress.toLowerCase()) return `conta não permitida: ${account.trim()}`
  for (const address of [...recipients.to, ...recipients.cc, ...recipients.bcc]) {
    if (!recipientAllowed(address, permission.allow)) return `destinatário fora da lista: ${address}`
  }
  if (attempted >= permission.maxPerRun) return `teto de ${permission.maxPerRun} ${permission.maxPerRun === 1 ? 'envio' : 'envios'} por execução atingido`
  return null
}

const SEND_ERRORS: Readonly<Record<string, string>> = {
  invalid: 'pedido inválido',
  account: 'a conta não está disponível',
  auth: 'o servidor recusou o usuário ou a senha',
  connection: 'o servidor de envio não respondeu',
  rejected: 'o servidor recusou a mensagem',
  failed: 'o envio falhou',
  click: 'o envio falhou',
}

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value)
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()

/** Uma lista de endereços: um texto ("a@x.com, b@y.com") ou uma lista. */
const addressesSchema = z.union([z.string().max(20_000), z.array(z.string().max(320)).max(EMAIL_RECIPIENTS_MAX * 2)]).transform((value) =>
  (Array.isArray(value) ? value : value.split(/[,;]/)).map((item) => item.trim()).filter(Boolean),
)
const argsSchema = z.object({
  para: addressesSchema,
  cc: addressesSchema.optional(),
  cco: addressesSchema.optional(),
  assunto: z.string().max(EMAIL_SUBJECT_MAX),
  texto: z.string().max(EMAIL_TEXT_MAX).refine((value) => value.trim() !== ''),
  conta: z.string().max(320).optional(),
})

/** O que dá para guardar de um pedido inválido (para a execução mostrar o que foi recusado). */
function looseList(value: unknown): string[] {
  const parsed = addressesSchema.safeParse(value)
  return parsed.success ? parsed.data.slice(0, 100).map((item) => clip(item, 320)) : []
}

export interface TaskSendTool {
  tool: AssistantTool
  /** Os envios que foram ao SMTP com sucesso. */
  sent(): number
}

/** A ferramenta de uma execução: o estado relido a cada envio e cada envio ou recusa registrado. */
export function createSendTool(options: {
  deps: Pick<TaskEmailDeps, 'send' | 'accountAddress' | 'locked'>
  /** A permissão e a pausa de agora (relidas do disco a cada envio). */
  gate: () => Promise<SendGate>
  /** A permissão do começo da execução, para a descrição (a conta e a lista). */
  start: TaskEmailPermission
  record: (entry: RunEmail) => void
  now?: () => number
  log?: (message: string) => void
}): TaskSendTool {
  const now = options.now ?? Date.now
  let attempted = 0
  let delivered = 0
  let recorded = 0
  const address = options.deps.accountAddress(options.start.accountId) ?? 'a conta da permissão'

  const record = (entry: RunEmail): void => {
    if (recorded >= RUN_EMAILS_MAX) return
    recorded++
    options.record(entry)
  }

  const refused = (entry: Omit<RunEmail, 'at' | 'ok' | 'messageId' | 'error'>, reason: string): ToolResult => {
    record({ ...entry, at: new Date(now()).toISOString(), ok: false, messageId: null, error: reason })
    options.log?.(`[automações] envio de email recusado (${reason.split(':')[0] ?? reason})`)
    return { file: null, label: `Email recusado: ${clip(reason, 120)}`, note: `ERRO: o envio foi recusado (${reason}). Nada foi enviado. A lista de destinatários, a conta e o teto vêm só da configuração da tarefa e não mudam; não tente contornar.` }
  }

  const tool: AssistantTool = {
    name: SEND_TOOL_NAME,
    describe: `envia um email de verdade, sem clique, da conta ${address}, só para os destinatários que a pessoa permitiu nesta tarefa (${options.start.allow.join(', ')}), até ${options.start.maxPerRun} por execução. Campos: "para" (lista de endereços), "cc" e "cco" (opcionais, também dentro da lista), "assunto" e "texto" (o corpo, texto simples). Fora da lista, de outra conta ou acima do teto, o envio é recusado.`,
    pending: 'Enviando email',
    step: 'Read',
    async run(args) {
      const parsed = argsSchema.safeParse(args)
      if (!parsed.success) {
        const raw = args as { para?: unknown; cc?: unknown; cco?: unknown; assunto?: unknown }
        return refused({ to: looseList(raw.para), cc: looseList(raw.cc), bcc: looseList(raw.cco), subject: typeof raw.assunto === 'string' ? clip(oneLine(raw.assunto), EMAIL_SUBJECT_MAX) : '' }, 'pedido inválido: precisa de "para", "assunto" e "texto"')
      }
      const { para, assunto, texto } = parsed.data
      const cc = parsed.data.cc ?? []
      const bcc = parsed.data.cco ?? []
      const subject = clip(oneLine(assunto), EMAIL_SUBJECT_MAX)
      const entry = { to: para.slice(0, 100).map((item) => clip(item, 320)), cc: cc.slice(0, 100).map((item) => clip(item, 320)), bcc: bcc.slice(0, 100).map((item) => clip(item, 320)), subject }
      const malformed = [...para, ...cc, ...bcc].find((item) => !EMAIL_ADDRESS_PATTERN.test(item))
      if (malformed !== undefined) return refused(entry, `endereço inválido: ${clip(malformed, 120)}`)
      if (para.length === 0 || para.length > EMAIL_RECIPIENTS_MAX || cc.length > EMAIL_RECIPIENTS_MAX || bcc.length > EMAIL_RECIPIENTS_MAX) return refused(entry, `pedido inválido: de 1 a ${EMAIL_RECIPIENTS_MAX} destinatários em cada campo`)
      // As regras com o estado de agora: a revogação, a pausa e o bloqueio valem no meio da execução.
      const gate = await options.gate()
      const accountAddress = gate.permission ? options.deps.accountAddress(gate.permission.accountId) : null
      const reason = sendRefusal({ ...gate, locked: options.deps.locked(), accountAddress }, parsed.data.conta ?? null, { to: para, cc, bcc }, attempted)
      if (reason !== null || !gate.permission) return refused(entry, reason ?? 'permissão revogada')
      attempted++
      const result = await options.deps.send({ accountId: gate.permission.accountId, to: para, cc, bcc, subject, text: texto }).catch((): EmailSendResult => ({ ok: false, error: 'failed' }))
      const at = new Date(now()).toISOString()
      if (!result.ok) {
        const error = SEND_ERRORS[result.error] ?? 'o envio falhou'
        record({ ...entry, at, ok: false, messageId: null, error })
        return { file: null, label: `Email não enviado: ${error}`, note: `ERRO: o envio falhou (${error}). Nada foi enviado.` }
      }
      delivered++
      record({ ...entry, at, ok: true, messageId: result.messageId, error: null })
      return { file: null, ok: true, label: `Email enviado para ${clip(para.join(', '), 120)}`, note: `Enviado (Message-ID ${result.messageId}).` }
    },
  }

  return { tool, sent: () => delivered }
}
