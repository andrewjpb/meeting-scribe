// Contrato 56: o Assistente organizando o email (R9 a R12). O que o main grava de cada organização (o lote, com o
// Desfazer), o que ele manda ao vivo para o chat e para a tela de email e as frases do cartão. O agente só move entre
// pastas: não apaga, não envia, não cria regra. Sem zod e sem Node: o renderer usa os tipos e as frases.
import { TOOL_FENCE } from './assistant'

/**
 * As ferramentas de organizar o email (só o Assistente interativo as recebe). Contrato 56 (D19): a execução de uma tarefa
 * agendada reconhece o pedido delas por esta lista e registra a recusa, sem os nomes em `main/schedules/`.
 */
export const EMAIL_ORGANIZE_TOOL_NAMES = ['listar_conversas', 'listar_pastas', 'criar_pasta', 'mover_emails', 'informar_progresso'] as const
export type EmailOrganizeToolName = (typeof EMAIL_ORGANIZE_TOOL_NAMES)[number]
/** Pedidos de organizar recusados guardados por execução. */
export const RUN_ORGANIZE_REFUSED_MAX = 20

/** O bloco ```lap-ferramenta … ``` numa linha própria (o mesmo de `main/chat/tools.ts`). */
const TOOL_BLOCK = new RegExp(`(^|\\n)[ \\t]*\`\`\`${TOOL_FENCE}[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*\`\`\`[ \\t]*(?=\\n|$)`, 'g')

const oneLine = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 200) : '')

/**
 * Contrato 56 (D19): os pedidos de organizar o email numa resposta (os blocos `lap-ferramenta` de uma dessas ferramentas),
 * já como a frase da tela de execuções: "mover 23 emails para Resolvidos", "criar a pasta Pendentes".
 */
export function emailOrganizeRequests(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(TOOL_BLOCK)) {
    let json: unknown
    try {
      json = JSON.parse(match[2] ?? '')
    } catch {
      continue
    }
    if (typeof json !== 'object' || json === null) continue
    const call = json as Record<string, unknown>
    const name = call['ferramenta']
    if (typeof name !== 'string' || !(EMAIL_ORGANIZE_TOOL_NAMES as readonly string[]).includes(name)) continue
    if (name === 'mover_emails') {
      const topics = Array.isArray(call['assuntos']) ? (call['assuntos'] as unknown[]) : []
      const count = topics.reduce<number>((sum, topic) => {
        const emails = typeof topic === 'object' && topic !== null ? (topic as { emails?: unknown }).emails : undefined
        return sum + (Array.isArray(emails) ? emails.length : 0)
      }, 0)
      const to = oneLine(call['destino'])
      found.push(`mover ${count === 1 ? '1 email' : `${count} emails`}${to ? ` para ${to}` : ''}`)
    } else if (name === 'criar_pasta') found.push(`criar a pasta ${oneLine(call['nome']) || 'nova'}`)
    else if (name === 'listar_conversas') found.push('listar as conversas do email')
    else if (name === 'listar_pastas') found.push('listar as pastas do email')
    else found.push('mostrar o progresso da organização')
  }
  return found
}

/** Mensagens movidas pelo agente num turno do chat (N7); as a mais voltam como `limite`. */
export const EMAIL_ORGANIZE_MOVE_MAX = 200
/** Mensagens lidas por `listar_conversas` (N7). */
export const EMAIL_ORGANIZE_READ_MAX = 200
/** Rodadas de ferramenta no turno que organiza (D3); os outros seguem com 4. */
export const EMAIL_ORGANIZE_ROUNDS_MAX = 40
/** O passo único das ferramentas de organizar na tela do chat (CA10). */
export const EMAIL_ORGANIZE_STEP_ID = 'organizar-email'
/** Pastas criadas pelo agente numa conversa do chat. */
export const EMAIL_ORGANIZE_FOLDERS_MAX = 10
/** Lotes guardados (D4): os 20 mais recentes, por no máximo 7 dias. */
export const EMAIL_BATCHES_MAX = 20
export const EMAIL_BATCH_DAYS = 7
/** O pedido gravado com o lote, o motivo e a evidência de cada assunto. */
export const EMAIL_BATCH_REQUEST_MAX = 200
export const EMAIL_BATCH_REASON_MAX = 200

export const EMAIL_VERDICTS = ['resolvido', 'pendente', 'outra'] as const
export type EmailVerdict = (typeof EMAIL_VERDICTS)[number]
export const EMAIL_ORGANIZE_STAGES = ['lendo', 'decidindo', 'movendo'] as const
export type EmailOrganizeStage = (typeof EMAIL_ORGANIZE_STAGES)[number]

/** `running`: o turno ainda organiza; `stopped`: "Parar" (ou o app caiu no meio); `done`: o turno terminou. */
export type EmailBatchState = 'running' | 'stopped' | 'done' | 'undone' | 'partial-undo'
export type EmailBatchItemStatus = 'pending' | 'moved' | 'failed' | 'undone' | 'undo-failed'
/**
 * Por que um item não voltou no Desfazer: `not-found` (já não está no destino), `folder-missing` (o destino saiu do
 * `LIST`), `origin-missing` (a pasta de origem saiu; o app não a recria), `server`/`unavailable`/`invalid` (o servidor).
 */
export type EmailUndoError = 'not-found' | 'folder-missing' | 'origin-missing' | 'server' | 'unavailable' | 'invalid'

/** Um assunto decidido pelo agente: o veredito, a pasta, o porquê e a evidência; `from` e `count` lidos do app. */
export interface EmailBatchTopic {
  assunto: string
  veredito: EmailVerdict
  /** A pasta de destino; `null` enquanto só decidido (`informar_progresso` sem destino). */
  destino: string | null
  motivo: string
  evidencia: string
  /** Quem mandou a mensagem mais recente da conversa (o nome, ou o endereço). */
  from: string
  count: number
}

export interface EmailBatchItem {
  messageId: string | null
  fromPath: string
  fromUid: number
  fromUidValidity: string
  toPath: string
  toUid: number | null
  toUidValidity: string | null
  status: EmailBatchItemStatus
  undoError?: EmailUndoError | undefined
  /** O assunto (posição em `topics`) de onde o item veio. */
  topic: number
  /** Desfeito: o UID novo na pasta de origem (`COPYUID` da volta), quando o servidor disse. */
  backUid?: number | undefined
  backUidValidity?: string | undefined
}

/** Contrato 156: o lote do agente do Assistente ou o do "Mover" do Painel de e-mail. */
export const EMAIL_BATCH_ORIGENS = ['agente', 'painel'] as const
export type EmailBatchOrigem = (typeof EMAIL_BATCH_ORIGENS)[number]

export interface EmailBatch {
  id: string
  accountId: string
  chatId: string
  startedAt: number
  endedAt: number | null
  state: EmailBatchState
  request: string
  totals: { read: number; total: number; outOfLimit: number }
  topics: EmailBatchTopic[]
  items: EmailBatchItem[]
  /** Contrato 156 (D4): quem moveu; ausente vale `agente` (os lotes de antes). O Desfazer é o mesmo para os dois. */
  origem?: EmailBatchOrigem | undefined
}

/** Um assunto como a tela mostra: o estado e onde a mensagem mais recente está agora (o clique abre o email). */
export interface EmailOrganizeTopic extends EmailBatchTopic {
  status: 'decidindo' | 'decidido' | 'movido'
  open: { accountId: string; mailbox: string; id: string } | null
}

/** `scribe:email-organize`: o estado inteiro do lote a cada mudança (não o delta). */
export interface EmailOrganizeEvent {
  batchId: string
  chatId: string
  accountId: string
  state: EmailBatchState
  etapa: EmailOrganizeStage
  read: number
  total: number
  outOfLimit: number
  /** Mensagens que estão no destino (movidas, e as que o Desfazer não trouxe de volta). */
  moved: number
  byFolder: { path: string; count: number }[]
  topics: EmailOrganizeTopic[]
}

export type EmailOrganizeError = 'missing' | 'pop3' | 'invalid' | 'busy' | 'unavailable' | 'server'
export type EmailOrganizeFailure = { ok: false; error: EmailOrganizeError }

/** O lote `running` mais recente e os lotes de hoje (o painel e a faixa abrem no meio ou depois de reiniciar). */
export type EmailOrganizeStateResult = { ok: true; running: EmailOrganizeEvent | null; today: EmailOrganizeEvent[] } | EmailOrganizeFailure
export type EmailBatchGetResult = { ok: true; batch: EmailBatch; view: EmailOrganizeEvent } | EmailOrganizeFailure
export type EmailBatchUndoResult = { ok: true; undone: number; failed: { code: EmailUndoError; count: number }[] } | EmailOrganizeFailure

const two = (value: number): string => String(value).padStart(2, '0')

/**
 * O estado do cartão depois do Desfazer (D17 do mockup): "Desfeito às 14:40 · as 18 voltaram para a Caixa de Entrada" ou
 * "Desfeito em parte às 14:40: 14 de 18 voltaram".
 */
export function emailUndoText(at: number, counts: { back: number; total: number; toInbox: boolean }): string {
  const date = new Date(at)
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`
  if (counts.total === 0) return `Nada a desfazer às ${time}: nenhuma mensagem chegou a ser movida`
  if (counts.back < counts.total) return `Desfeito em parte às ${time}: ${counts.back} de ${counts.total} voltaram`
  const where = counts.toInbox ? 'para a Caixa de Entrada' : 'para as pastas de onde vieram'
  return `Desfeito às ${time} · ${counts.total === 1 ? 'a mensagem voltou' : `as ${counts.total} voltaram`} ${where}`
}

/** O nome de uma pasta na tela: a INBOX é "Caixa de Entrada" e a subpasta vem com "›". */
export function emailFolderLabel(path: string, delimiter = '/'): string {
  return path.toUpperCase() === 'INBOX' ? 'Caixa de Entrada' : path.split(delimiter).join(' › ')
}
