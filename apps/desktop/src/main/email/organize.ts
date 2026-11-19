// Contrato 56: o Assistente organiza o email (R9 a R12), pelas ferramentas do protocolo `lap-ferramenta` (D1). Cinco
// ferramentas, separadas das de leitura (`assistant-tools.ts`), que nunca vão a uma tarefa agendada:
// - `listar_conversas` (leitura): a pasta agrupada em conversas (pelo `References`/`In-Reply-To` e, sem eles, pelo
//   assunto e os participantes), com as respostas de Enviados juntas, até 200 mensagens (N7);
// - `listar_pastas` (leitura): a árvore do `LIST`, com o que pode ser destino;
// - `criar_pasta`: só cria (nunca renomeia nem apaga), até 10 por conversa;
// - `mover_emails`: move por assunto, com as recusas conferidas aqui com o estado de agora (nunca pelo que o modelo leu);
// - `informar_progresso`: a etapa, os contadores e as decisões, sem mover nada.
// O agente nunca apaga email: não há ferramenta de apagar e a Lixeira e o Spam são recusados como destino (N4, F4).
//
// Cada turno do chat que move abre um lote por conta (`batches.ts`): os itens vão como `pending` antes do `MOVE` e como
// `moved` depois (com o UID novo do `COPYUID`). "Parar" (o sinal do turno) deixa o `MOVE` em curso terminar e não começa
// o próximo. O Desfazer (`undoBatch`) só depende do arquivo e do servidor: acha cada mensagem no destino pelo UID (com o
// mesmo `UIDVALIDITY`) ou pelo Message-ID, devolve à pasta de origem e nunca recria pasta sumida (D6). A cada mudança, o
// estado inteiro do lote vai ao renderer (`scribe:email-organize`), salvo com o app bloqueado.
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chmod, rename, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { EmailBatchAction } from '../../shared/assistant'
import { EMAIL_FOLDER_PATH_MAX, EMAIL_INBOX_MAILBOX, EMAIL_MOVE_MAX, EMAIL_REF_PATTERN, isInbox, isSent, type EmailAccountStatus, type EmailFolderNode, type EmailFolderPathResult, type EmailFoldersResult, type EmailMessage, type EmailMoveResult, type EmailOpenFolderResult } from '../../shared/email'
import {
  EMAIL_BATCH_REASON_MAX,
  EMAIL_BATCH_REQUEST_MAX,
  EMAIL_ORGANIZE_FOLDERS_MAX,
  EMAIL_ORGANIZE_MOVE_MAX,
  EMAIL_ORGANIZE_READ_MAX,
  EMAIL_ORGANIZE_ROUNDS_MAX,
  EMAIL_ORGANIZE_STAGES,
  EMAIL_ORGANIZE_STEP_ID,
  EMAIL_VERDICTS,
  emailUndoText,
  type EmailBatch,
  type EmailBatchGetResult,
  type EmailBatchItem,
  type EmailBatchTopic,
  type EmailBatchUndoResult,
  type EmailOrganizeEvent,
  type EmailOrganizeStage,
  type EmailOrganizeStateResult,
  type EmailOrganizeTopic,
  type EmailUndoError,
  type EmailVerdict,
} from '../../shared/email-organize'
import { EMAIL_CONVERSATIONS_FILE, EMAIL_FOLDERS_FILE, EMAIL_MOVE_FILE } from '../chat/sources'
import type { AssistantTool, ToolContext, ToolResult } from '../chat/tools'
import type { EmailFound } from './assistant-tools'
import type { EmailBatchStore } from './batches'
import { emailAddressLine, emailOneLine, emailRef, emailStamp, isPending, senderName, type EmailCache } from './export'
import type { ImapLocated } from './imap-client'
import { serverMessageId, serverMessageParts, type EmailMoveOptions } from './service'

/** Destinos recusados (N4, F4, D8): a Lixeira, o Spam, Enviados, Rascunhos e as pastas virtuais do Gmail. */
const FORBIDDEN_TARGET_USE: readonly string[] = ['\\Trash', '\\Junk', '\\Sent', '\\Drafts', '\\All', '\\Flagged', '\\Important']
/** Origens de onde não se move (a mensagem fica, e a referência volta `nao-movivel`). */
const FORBIDDEN_ORIGIN_USE: readonly string[] = ['\\Sent', '\\Drafts', '\\All', '\\Flagged', '\\Important']
/** Servidor sem `SPECIAL-USE`: a Lixeira e o Spam também pelo nome (a última parte do path). */
const TRASH_NAMES = /^(trash|deleted|deleted items|deleted messages|lixeira|lixo|itens exclu[ií]dos|itens eliminados|spam|junk|junk e-?mail|lixo eletr[oô]nico|bulk mail)$/i

export interface EmailOrganizeDeps {
  store: EmailBatchStore
  accounts(): EmailAccountStatus[]
  cached(): Promise<EmailCache[]>
  listFolders(accountId: string, options?: { fresh?: boolean }): Promise<EmailFoldersResult>
  openFolder(accountId: string, path: string): Promise<EmailOpenFolderResult>
  createFolder(accountId: string, parentPath: string | null, name: string): Promise<EmailFolderPathResult>
  moveMessages(accountId: string, fromPath: string, uids: readonly number[], toPath: string, options: EmailMoveOptions): Promise<EmailMoveResult & { uidValidity?: string | null }>
  locateMessages(accountId: string, path: string, uids: readonly number[], messageIds: readonly string[]): Promise<({ ok: true } & ImapLocated) | { ok: false; error: string }>
  locked(): boolean
  /** O estado inteiro do lote (o main não manda com o app bloqueado). */
  emit(event: EmailOrganizeEvent): void
  /** O cartão do lote na conversa: `done`, com a frase do Desfazer. */
  cardDone?(batch: EmailBatch, result: string): Promise<void>
  now?: () => number
  newId?: () => string
  log?: (message: string) => void
}

/** O que vem de `assistant-tools.ts`: achar uma referência e lembrar as do servidor. */
export interface EmailOrganizeLinks {
  find(ref: string): Promise<EmailFound | null>
  remember(found: EmailFound): void
}

export interface EmailOrganizer {
  tools: AssistantTool[]
  /** Ao abrir o app: o lote que ficou `running` (o app caiu no meio) vira `stopped`. */
  init(): Promise<void>
  /** O turno do chat terminou: os lotes dele fecham (`done` ou `stopped`); lote sem item nenhum sai. */
  endTurn(turn: { chatId: string; turnId: string }, outcome: 'done' | 'stopped'): Promise<void>
  undoBatch(batchId: string): Promise<EmailBatchUndoResult>
  /** `ler_email` leu estas mensagens no turno: os "lidos" do lote contam com elas (sem `informar_progresso` também). */
  noteRead(context: ToolContext | undefined, found: readonly EmailFound[]): Promise<void>
  state(): Promise<EmailOrganizeStateResult>
  get(batchId: string): Promise<EmailBatchGetResult>
  /** Os mesmos, pelos pedidos do IPC (validados aqui). */
  undo(request: unknown): Promise<EmailBatchUndoResult>
  batch(request: unknown): Promise<EmailBatchGetResult>
  /** A conta saiu: os lotes dela também. */
  forgetAccount(accountId: string): Promise<void>
}

const LOCKED: ToolResult = { file: null, label: 'Email indisponível: o app está bloqueado', note: 'O app está bloqueado: o email não está disponível agora.' }
const SCHEDULED: ToolResult = { file: null, label: 'Organizar o email: recusado', note: 'Recusado (agendada): mover e criar pasta só valem numa conversa do Assistente, com o pedido da pessoa.' }

const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((value) => value.replace(/\s+/g, ' '))
const folderPath = z
  .string()
  .min(1)
  .max(EMAIL_FOLDER_PATH_MAX)
  .refine((value) => !/[\r\n\0]/.test(value))
const ref = z.string().regex(EMAIL_REF_PATTERN)
const account = z.string().trim().min(3).max(320)
const topicSchema = z
  .object({
    emails: z.array(ref).min(1).max(50),
    assunto: line(300),
    veredito: z.enum(EMAIL_VERDICTS),
    motivo: line(EMAIL_BATCH_REASON_MAX),
    evidencia: line(EMAIL_BATCH_REASON_MAX),
    destino: folderPath.optional(),
  })
const conversationsSchema = z.object({ conta: account.optional(), pasta: folderPath.optional(), limite: z.number().int().min(1).max(EMAIL_ORGANIZE_READ_MAX).optional() })
const foldersSchema = z.object({ conta: account.optional() })
const createSchema = z.object({ conta: account.optional(), nome: z.string().trim().min(1).max(100), dentro_de: folderPath.optional() })
const moveSchema = z.object({ conta: account.optional(), destino: folderPath, assuntos: z.array(topicSchema.omit({ destino: true })).min(1).max(20) })
const progressSchema = z.object({
  etapa: z.enum(EMAIL_ORGANIZE_STAGES),
  lidos: z.number().int().min(0).max(100_000),
  total: z.number().int().min(0).max(100_000),
  decisoes: z.array(topicSchema).max(20).optional(),
})
const batchRequestSchema = z.object({ batchId: z.string().uuid() }).strict()

async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
  await chmod(file, 0o600)
}

const flatten = (nodes: readonly EmailFolderNode[]): EmailFolderNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)])
const lastName = (node: Pick<EmailFolderNode, 'path' | 'delimiter'>): string => (node.delimiter ? (node.path.split(node.delimiter).pop() ?? node.path) : node.path)

/** Por que a pasta não pode receber o que o agente move; `null` se pode. */
export function forbiddenTarget(node: Pick<EmailFolderNode, 'path' | 'delimiter' | 'specialUse' | 'noselect'>): string | null {
  if (node.noselect) return 'é só um nó da árvore (\\Noselect)'
  if (node.specialUse && FORBIDDEN_TARGET_USE.includes(node.specialUse)) return node.specialUse === '\\Trash' || node.specialUse === '\\Junk' ? 'é a Lixeira ou o Spam: o Assistente não apaga email' : `é uma pasta especial (${node.specialUse})`
  if (TRASH_NAMES.test(lastName(node).trim())) return 'é a Lixeira ou o Spam: o Assistente não apaga email'
  return null
}

/** O assunto sem "Re:", "Fwd:", "Enc:" (repetidos), em minúsculas. */
export function threadSubject(subject: string): string {
  let rest = subject.replace(/\s+/g, ' ').trim()
  for (;;) {
    const next = rest.replace(/^(re|res|fwd?|enc|tr|aw|wg)\s*(\[\d+\])?\s*:\s*/i, '')
    if (next === rest) break
    rest = next
  }
  return rest.toLocaleLowerCase('pt-BR')
}

interface ThreadMessage {
  ref: string
  message: EmailMessage
  /** De uma pasta de enviados (só leitura). */
  sent: boolean
  /** Da pasta listada e de onde se move. */
  movable: boolean
}

/** Conversas: pelo `References`/`In-Reply-To` e, nas mensagens sem eles, pelo assunto sem prefixo e os participantes. */
export function groupThreads(messages: readonly ThreadMessage[], own: readonly string[]): ThreadMessage[][] {
  const parent = messages.map((_, index) => index)
  const root = (index: number): number => {
    let at = index
    while (parent[at] !== at) {
      parent[at] = parent[parent[at] as number] as number
      at = parent[at] as number
    }
    return at
  }
  const join = (a: number, b: number): void => {
    const ra = root(a)
    const rb = root(b)
    if (ra !== rb) parent[ra] = rb
  }
  const mine = new Set(own.map((address) => address.toLowerCase()))
  const people = (message: EmailMessage): string =>
    [...new Set([...message.from, ...message.to, ...message.cc].map((item) => item.address.toLowerCase()).filter((address) => !mine.has(address)))].sort().join(',')
  const subjectKey = (message: EmailMessage): string => `${threadSubject(message.subject)}\n${people(message)}`
  const byId = new Map<string, number>()
  const bySubject = new Map<string, number>()
  messages.forEach((item, index) => {
    for (const id of [item.message.messageId, item.message.inReplyTo, ...item.message.references]) {
      if (!id) continue
      const known = byId.get(id)
      if (known === undefined) byId.set(id, index)
      else join(index, known)
    }
    const key = subjectKey(item.message)
    if (!bySubject.has(key)) bySubject.set(key, index)
  })
  messages.forEach((item, index) => {
    if (item.message.inReplyTo || item.message.references.length) return
    const known = bySubject.get(subjectKey(item.message))
    if (known !== undefined) join(index, known)
  })
  const groups = new Map<number, ThreadMessage[]>()
  messages.forEach((item, index) => {
    const key = root(index)
    groups.set(key, [...(groups.get(key) ?? []), item])
  })
  return [...groups.values()].map((group) => [...group].sort((a, b) => b.message.date - a.message.date)).sort((a, b) => (b[0]?.message.date ?? 0) - (a[0]?.message.date ?? 0))
}

interface Turn {
  chatId: string
  request: string
  /** Um lote por conta. */
  batches: Map<string, string>
  /** Mensagens movidas no turno (o teto de 200). */
  moved: number
  /** Mensagens que `ler_email` leu no turno, por conta (os "lidos" reais). */
  read: Map<string, Set<string>>
}

interface Live {
  etapa: EmailOrganizeStage
  /** Leitura por pasta (`listar_conversas`): as que entraram e as que ficaram de fora. */
  reads: Map<string, { entered: number; outOfLimit: number }>
  /** Assuntos só decididos: onde está a mensagem mais recente. */
  opens: Map<number, EmailOrganizeTopic['open']>
  /** Assuntos movidos: a mensagem mais recente (pela origem); depois de reiniciar, vale o primeiro item do assunto. */
  latest: Map<number, { fromPath: string; fromUid: number }>
  /** A conversa de cada assunto (os Message-IDs do fio): duas conversas de mesmo assunto ficam em duas linhas. */
  threads: Map<number, Set<string>>
}

type Origin = { path: string; uid: number; uidValidity: string }

/** Os códigos das mensagens que ficaram, com a frase do `MOVER-EMAILS.md`. */
const LEFT_REASONS = {
  'nao-encontrado': 'a referência não foi achada (liste ou busque de novo)',
  'nao-movivel': 'está numa pasta de onde não se move (Enviados, Rascunhos ou uma virtual)',
  'destino-proibido': 'já está na pasta de destino',
  'outra-conta': 'é de outra conta (um lote é de uma conta: chame de novo com a "conta" dela)',
  repetida: 'apareceu em mais de um assunto',
  limite: `passou do limite de ${EMAIL_ORGANIZE_MOVE_MAX} mensagens movidas por pedido`,
  parado: 'a pessoa clicou em Parar antes',
  falhou: 'o servidor recusou o mover',
  bloqueado: 'o app foi bloqueado no meio',
} as const
type LeftCode = keyof typeof LEFT_REASONS

export function createEmailOrganizer(deps: EmailOrganizeDeps, links: EmailOrganizeLinks): EmailOrganizer {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const turns = new Map<string, Turn>()
  const lives = new Map<string, Live>()
  /** Lotes com o Desfazer em curso. */
  const undoing = new Set<string>()
  const log = (message: string): void => deps.log?.(`[email-organizar] ${message}`)

  const liveOf = (batchId: string): Live => {
    let live = lives.get(batchId)
    if (!live) {
      live = { etapa: 'lendo', reads: new Map(), opens: new Map(), latest: new Map(), threads: new Map() }
      lives.set(batchId, live)
    }
    return live
  }

  const statusOf = (accountId: string): EmailAccountStatus | undefined => deps.accounts().find((status) => status.account.id === accountId)

  /** A conta pedida (pelo endereço) ou, sem ela, a única conta, ou a das referências. */
  async function pickAccount(conta: string | undefined, refs: readonly string[] = []): Promise<EmailAccountStatus | null> {
    const all = deps.accounts()
    if (conta) return all.find((status) => status.account.address.toLowerCase() === conta.toLowerCase()) ?? null
    if (all.length === 1) return all[0] ?? null
    for (const item of refs) {
      const found = await links.find(item)
      if (found) return statusOf(found.status.account.id) ?? null
    }
    return null
  }

  const accountMissing = (conta: string | undefined): ToolResult => ({
    file: null,
    label: 'Organizar o email: conta não encontrada',
    note: conta ? `Não há conta de email ${conta} no app.` : 'Há mais de uma conta de email: diga qual em "conta" (o endereço).',
  })

  // --- O lote e o que a tela vê -------------------------------------------------------------------------------------

  /** Onde a mensagem do item está agora (o clique da tela abre), ou `null` se o app não sabe. */
  function openOfItem(batch: EmailBatch, item: EmailBatchItem): EmailOrganizeTopic['open'] {
    const at = (mailbox: string, uidValidity: string | null, uid: number | null): EmailOrganizeTopic['open'] => {
      if (uid === null || uidValidity === null) return null
      return { accountId: batch.accountId, mailbox, id: isInbox({ mailbox }) ? String(uid) : serverMessageId(mailbox, uidValidity, uid) }
    }
    if (item.status === 'moved' || item.status === 'undo-failed') return at(item.toPath, item.toUidValidity, item.toUid)
    if (item.status === 'failed') return at(item.fromPath, item.fromUidValidity, item.fromUid)
    // De volta na origem: com o UID novo da volta, quando o servidor disse.
    if (item.status === 'undone') return at(item.fromPath, item.backUidValidity ?? null, item.backUid ?? null)
    return null
  }

  function viewOf(batch: EmailBatch): EmailOrganizeEvent {
    const live = liveOf(batch.id)
    const inPlace = batch.items.filter((item) => item.status === 'moved' || item.status === 'undo-failed')
    const byFolder = new Map<string, number>()
    for (const item of inPlace) byFolder.set(item.toPath, (byFolder.get(item.toPath) ?? 0) + 1)
    const topics: EmailOrganizeTopic[] = batch.topics.map((topic, index) => {
      const items = batch.items.filter((item) => item.topic === index)
      const status: EmailOrganizeTopic['status'] = items.some((item) => item.status !== 'pending' && item.status !== 'failed') ? 'movido' : items.some((item) => item.status === 'pending') ? 'decidindo' : 'decidido'
      const latest = live.latest.get(index)
      const first = (latest && items.find((item) => item.fromPath === latest.fromPath && item.fromUid === latest.fromUid)) || items[0]
      return { ...topic, status, open: first ? openOfItem(batch, first) : (live.opens.get(index) ?? null) }
    })
    return {
      batchId: batch.id,
      chatId: batch.chatId,
      accountId: batch.accountId,
      state: batch.state,
      etapa: live.etapa,
      read: batch.totals.read,
      total: batch.totals.total,
      outOfLimit: batch.totals.outOfLimit,
      moved: inPlace.length,
      byFolder: [...byFolder].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count || a.path.localeCompare(b.path, 'pt-BR')),
      topics,
    }
  }

  const announce = (batch: EmailBatch): void => {
    if (!deps.locked()) deps.emit(viewOf(batch))
  }

  /** "Organizando: 64 de 200 lidos, 18 movidos". */
  const progressLabel = (batch: EmailBatch): string => {
    const view = viewOf(batch)
    return `Organizando: ${view.read} de ${view.total} lidos, ${view.moved} movidos`
  }

  /** Troca o lote no arquivo (na fila do store) e devolve como ficou. */
  async function update(batchId: string, change: (batch: EmailBatch) => EmailBatch): Promise<EmailBatch | null> {
    return deps.store.mutate((batches) => {
      const at = batches.findIndex((batch) => batch.id === batchId)
      const current = batches[at]
      if (!current) return null
      const next = change(current)
      return { batches: batches.map((batch, index) => (index === at ? next : batch)), value: next }
    })
  }

  /** O turno do chat (criado na primeira ferramenta que precisa dele; sai em `endTurn`). */
  function turnOf(context: ToolContext): Turn {
    let turn = turns.get(context.turnId)
    if (!turn) {
      turn = { chatId: context.chatId, request: context.request, batches: new Map(), moved: 0, read: new Map() }
      turns.set(context.turnId, turn)
    }
    return turn
  }

  /** O lote do turno nesta conta (criado na primeira ferramenta que precisa dele). */
  async function batchFor(context: ToolContext, accountId: string): Promise<EmailBatch | null> {
    const turn = turnOf(context)
    const known = turn.batches.get(accountId)
    if (known) return (await deps.store.get(known)) ?? null
    const batch: EmailBatch = {
      id: newId(),
      accountId,
      chatId: context.chatId,
      startedAt: now(),
      endedAt: null,
      state: 'running',
      request: context.request.replace(/\s+/g, ' ').trim().slice(0, EMAIL_BATCH_REQUEST_MAX),
      totals: { read: 0, total: 0, outOfLimit: 0 },
      topics: [],
      items: [],
    }
    await deps.store.mutate((batches) => ({ batches: [batch, ...batches], value: null }))
    turn.batches.set(accountId, batch.id)
    liveOf(batch.id)
    return batch
  }

  /**
   * O assunto no lote: a mesma conversa de antes (algum Message-ID do fio em comum) é trocada, não repetida; duas
   * conversas com o mesmo assunto ficam em duas linhas. Sem nenhuma mensagem achada, vale o assunto. Devolve a posição.
   */
  function upsertTopic(batchId: string, topics: EmailBatchTopic[], topic: EmailBatchTopic, found: readonly EmailFound[]): number {
    const live = liveOf(batchId)
    const ids = new Set(found.flatMap((item) => [item.message.messageId, item.message.inReplyTo, ...item.message.references].filter((id): id is string => Boolean(id))))
    if (!ids.size) ids.add(`assunto:${threadSubject(topic.assunto)}`)
    const at = topics.findIndex((_, index) => [...(live.threads.get(index) ?? [])].some((id) => ids.has(id)))
    if (at === -1) {
      topics.push(topic)
      live.threads.set(topics.length - 1, ids)
      return topics.length - 1
    }
    topics[at] = { ...topic, count: Math.max(topic.count, topics[at]?.count ?? 0) }
    live.threads.set(at, new Set([...(live.threads.get(at) ?? []), ...ids]))
    return at
  }

  /** Os "lidos" do turno nesta conta: o que `ler_email` já leu. */
  const readByTools = (turnId: string, accountId: string): number => turns.get(turnId)?.read.get(accountId)?.size ?? 0

  const destinationOf = (veredito: EmailVerdict, destino: string | undefined): string | null => destino ?? (veredito === 'resolvido' ? 'Resolvidos' : veredito === 'pendente' ? 'Pendentes' : null)

  /** Quem mandou a mais recente das recebidas (o remetente da conversa). */
  const topicFrom = (found: readonly EmailFound[]): string => {
    const received = found.filter((item) => !isSent(item.message, item.status)).sort((a, b) => b.message.date - a.message.date)
    return senderName((received[0] ?? found[0])?.message.from[0]).slice(0, 500)
  }

  // --- listar_conversas ----------------------------------------------------------------------------------------------

  const conversations: AssistantTool = {
    name: 'listar_conversas',
    describe: `lista as conversas de uma pasta (o fio inteiro: recebidos e as suas respostas de Enviados, juntos), da mais recente para a mais antiga, com as referências "em-…" de cada mensagem (as recebidas marcadas "movível", as de Enviados "só leitura"). Campos: "conta" (o endereço, opcional com uma conta só), "pasta" (o path, padrão INBOX) e "limite" (1 a ${EMAIL_ORGANIZE_READ_MAX}, padrão ${EMAIL_ORGANIZE_READ_MAX}). Lê no máximo ${EMAIL_ORGANIZE_READ_MAX} mensagens: o arquivo diz quantas ficaram de fora, e a resposta tem de dizer isso à pessoa.`,
    pending: 'Lendo as conversas do email',
    step: 'Read',
    rounds: EMAIL_ORGANIZE_ROUNDS_MAX,
    stepId: EMAIL_ORGANIZE_STEP_ID,
    async run(args, folder, context) {
      if (deps.locked()) return LOCKED
      const parsed = conversationsSchema.safeParse(args)
      if (!parsed.success) return { file: null, label: 'Conversas do email: pedido inválido', note: 'Campos: "conta" (opcional), "pasta" (o path, opcional) e "limite" (1 a 200).' }
      const status = await pickAccount(parsed.data.conta)
      if (!status) return accountMissing(parsed.data.conta)
      const accountId = status.account.id
      const path = parsed.data.pasta ?? EMAIL_INBOX_MAILBOX
      const limit = parsed.data.limite ?? EMAIL_ORGANIZE_READ_MAX
      const pop3 = status.account.incoming.protocol === 'pop3'
      const caches = await deps.cached()
      const cache = caches.find((item) => item.status.account.id === accountId)
      const own = caches.map((item) => item.status.account.address)
      if (pop3 && !isInbox({ mailbox: path })) return { file: null, label: 'Conversas do email: conta POP3', note: `A conta ${status.account.address} é POP3: só a Caixa de Entrada (e os enviados do app); não há pastas nem mover.` }
      // A pasta: a INBOX pelo cache (as 200 do IDLE); outra, pelo servidor (as 200 mais recentes).
      let list: EmailMessage[]
      let total: number
      let entries: EmailFolderNode[] = []
      if (!pop3) {
        const folders = await deps.listFolders(accountId)
        if (!folders.ok) return { file: null, label: 'Conversas do email: servidor indisponível', note: 'O servidor não devolveu as pastas agora.' }
        entries = flatten(folders.folders)
      }
      const entry = entries.find((item) => item.path === path)
      if (!pop3 && !entry) return { file: null, label: 'Conversas do email: pasta não existe', note: `A pasta ${emailOneLine(path)} não existe nessa conta: veja listar_pastas.` }
      if (isInbox({ mailbox: path })) {
        list = [...(cache?.inbox ?? [])].sort((a, b) => b.date - a.date)
        total = Math.max(entry?.total ?? list.length, list.length)
      } else {
        const opened = await deps.openFolder(accountId, path)
        if (!opened.ok) return { file: null, label: 'Conversas do email: pasta indisponível', note: `O servidor não abriu a pasta ${emailOneLine(path)} agora.` }
        list = opened.messages
        total = Math.max(entry?.total ?? list.length, list.length)
      }
      if (deps.locked()) return LOCKED
      const taken = list.slice(0, limit)
      const outOfLimit = Math.max(0, total - taken.length)
      const sentEntry = entries.find((item) => item.specialUse === '\\Sent' && !item.noselect)
      const originMovable = !(entry?.specialUse && FORBIDDEN_ORIGIN_USE.includes(entry.specialUse)) && !entry?.noselect
      const allSent: EmailMessage[] = [...(cache?.sent ?? [])]
      const thread: ThreadMessage[] = []
      const fromServer = (message: EmailMessage, mailbox: string): string => {
        const item = emailRef(accountId, message.id, 'servidor')
        links.remember({ ref: item, status, message, mailbox, uid: message.uid, pending: false })
        return item
      }
      // As respostas que estão em Enviados: as do app e, no IMAP, as da pasta \Sent do servidor.
      if (sentEntry && sentEntry.path !== path) {
        const opened = await deps.openFolder(accountId, sentEntry.path)
        if (opened.ok) for (const message of opened.messages) if (!message.messageId || !allSent.some((item) => item.messageId === message.messageId)) allSent.push(message)
      }
      for (const message of taken) {
        const inSent = isSent(message, status) || entry?.specialUse === '\\Sent'
        const item = isInbox({ mailbox: path }) ? emailRef(accountId, message.id) : fromServer(message, path)
        thread.push({ ref: item, message, sent: inSent, movable: originMovable && !inSent })
      }
      for (const message of allSent) {
        if (thread.some((item) => item.message.messageId !== null && item.message.messageId === message.messageId)) continue
        const item = cache?.sent.includes(message) ? emailRef(accountId, `sent:${message.id}`) : fromServer(message, message.mailbox)
        thread.push({ ref: item, message, sent: true, movable: false })
      }
      // Só as conversas com alguma mensagem da pasta listada.
      const groups = groupThreads(thread, own).filter((group) => group.some((item) => taken.includes(item.message)))
      const pending = (message: EmailMessage): boolean => isPending(message, allSent, own, status)
      const lines = groups.map((group, index) => {
        const received = group.filter((item) => !item.sent)
        const last = group[0] as ThreadMessage
        const people = [...new Map(group.flatMap((item) => [...item.message.from, ...item.message.to, ...item.message.cc]).filter((item) => !own.some((mine) => mine.toLowerCase() === item.address.toLowerCase())).map((item) => [item.address.toLowerCase(), item])).values()]
        // O assunto da conversa é o da primeira mensagem (sem o "Re:" de quem respondeu).
        const subject = emailOneLine((group.at(-1) ?? last).message.subject || '(sem assunto)').replace(/"/g, "'")
        const parts = group.map((item) => `${item.ref} (${item.sent ? 'enviado' : `recebido de ${emailOneLine(senderName(item.message.from[0]))}`} ${emailStamp(item.message.date)}, ${item.movable ? 'movível' : 'só leitura'})`)
        const lastFrom = last.sent ? 'você' : emailOneLine(senderName(last.message.from[0]))
        const open = received.some((item) => pending(item.message))
        return `- conversa ${index + 1} · assunto: "${subject}" · participantes: ${people.map(emailAddressLine).join(', ') || 'só você'} · recebidos: ${received.length} · enviados: ${group.length - received.length} · última: ${emailStamp(last.message.date)}, de ${lastFrom}${open ? ' · tem recebido sem resposta sua' : ''} · mensagens: ${parts.join(', ')}`
      })
      const header = [
        `# Conversas da pasta ${emailOneLine(path)} (conta ${status.account.address})`,
        '',
        `A pasta tem ${total} mensagem(ns); entraram as ${taken.length} mais recentes${outOfLimit ? ` e ${outOfLimit} ficaram de fora pelo limite de ${EMAIL_ORGANIZE_READ_MAX}: diga isso na resposta` : ''}. ${groups.length} conversa(s), da mais recente para a mais antiga.`,
        ...(pop3 ? ['', 'Conta POP3: não há pastas no servidor, e nada se move.'] : []),
        '',
        'Para ler o fio inteiro de uma conversa, use ler_email com "emails" (até 20 referências). "Resolvido" é quando a conversa fechou o assunto (a outra pessoa confirmou, agradeceu ou não há mais nada a fazer), não só "respondido"; na dúvida, é "pendente". Só as "movível" podem ir para mover_emails.',
        '',
      ]
      await writeAtomic(join(folder, EMAIL_CONVERSATIONS_FILE), `${[...header, ...(lines.length ? lines : ['Nenhuma conversa nessa pasta.'])].join('\n')}\n`)
      if (!context) return { file: EMAIL_CONVERSATIONS_FILE, label: `Lendo as conversas do email (${groups.length})` }
      const batch = await batchFor(context, accountId)
      if (!batch) return { file: EMAIL_CONVERSATIONS_FILE, label: `Lendo as conversas do email (${groups.length})` }
      const live = liveOf(batch.id)
      live.etapa = 'lendo'
      live.reads.set(path, { entered: taken.length, outOfLimit })
      const sums = [...live.reads.values()].reduce((sum, item) => ({ entered: sum.entered + item.entered, outOfLimit: sum.outOfLimit + item.outOfLimit }), { entered: 0, outOfLimit: 0 })
      const saved = await update(batch.id, (current) => ({ ...current, totals: { read: Math.min(Math.max(current.totals.read, readByTools(context.turnId, accountId)), sums.entered), total: sums.entered, outOfLimit: sums.outOfLimit } }))
      if (saved) announce(saved)
      return { file: EMAIL_CONVERSATIONS_FILE, label: saved ? progressLabel(saved) : `Lendo as conversas do email (${groups.length})` }
    },
  }

  // --- listar_pastas -------------------------------------------------------------------------------------------------

  const folders: AssistantTool = {
    name: 'listar_pastas',
    describe: 'lista as pastas de cada conta IMAP (a árvore do servidor), com o path, a pasta especial, não lidas/total e se pode ser destino de mover_emails. Campo: "conta" (o endereço, opcional). Conta POP3 não tem pastas.',
    pending: 'Lendo as pastas do email',
    step: 'Read',
    rounds: EMAIL_ORGANIZE_ROUNDS_MAX,
    stepId: EMAIL_ORGANIZE_STEP_ID,
    async run(args, folder, context) {
      if (deps.locked()) return LOCKED
      const parsed = foldersSchema.safeParse(args)
      if (!parsed.success) return { file: null, label: 'Pastas do email: pedido inválido', note: 'Campo: "conta" (o endereço, opcional).' }
      const wanted = parsed.data.conta ? deps.accounts().filter((status) => status.account.address.toLowerCase() === parsed.data.conta?.toLowerCase()) : deps.accounts()
      if (!wanted.length) return accountMissing(parsed.data.conta)
      const lines = ['# Pastas do email', '']
      for (const status of wanted) {
        lines.push(`## Conta ${status.account.address}`, '')
        if (status.account.incoming.protocol === 'pop3') {
          lines.push('Conta POP3: não tem pastas no servidor e não move. Só a Caixa de Entrada e os enviados do app.', '')
          continue
        }
        const result = await deps.listFolders(status.account.id)
        if (!result.ok) {
          lines.push('O servidor não devolveu as pastas agora.', '')
          continue
        }
        const walk = (nodes: readonly EmailFolderNode[], depth: number): void => {
          for (const node of nodes) {
            const why = forbiddenTarget(node)
            const counts = node.total === null ? 'sem contagem' : `${node.unseen ?? 0} não lidas de ${node.total}`
            lines.push(`${'  '.repeat(depth)}- path: "${emailOneLine(node.path).replace(/"/g, "'")}" · nome: ${emailOneLine(node.name)}${node.specialUse ? ` · especial: ${node.specialUse}` : ''} · ${counts} · destino: ${why ? `não (${why})` : 'sim'}`)
            walk(node.children, depth + 1)
          }
        }
        walk(result.folders, 0)
        lines.push('')
      }
      lines.push('Para uma pasta nova (Resolvidos, Pendentes), use criar_pasta antes de mover.')
      await writeAtomic(join(folder, EMAIL_FOLDERS_FILE), `${lines.join('\n')}\n`)
      const batch = context ? [...(turns.get(context.turnId)?.batches.values() ?? [])][0] : undefined
      const saved = batch ? await deps.store.get(batch) : null
      return { file: EMAIL_FOLDERS_FILE, label: saved ? progressLabel(saved) : 'Lendo as pastas do email' }
    },
  }

  // --- criar_pasta ---------------------------------------------------------------------------------------------------

  const create: AssistantTool = {
    name: 'criar_pasta',
    describe: `cria uma pasta na conta IMAP (só cria: nunca renomeia nem apaga). Campos: "conta" (o endereço, opcional com uma conta só), "nome" e "dentro_de" (o path da pasta mãe, opcional). Pasta que já existe volta pronta, sem erro. Até ${EMAIL_ORGANIZE_FOLDERS_MAX} pastas por conversa.`,
    pending: 'Criando uma pasta no email',
    step: 'Read',
    changes: true,
    rounds: EMAIL_ORGANIZE_ROUNDS_MAX,
    stepId: EMAIL_ORGANIZE_STEP_ID,
    async run(args, _folder, context) {
      // N4, F4: só numa conversa do Assistente; uma tarefa agendada nunca cria pasta.
      if (!context?.chatId) return SCHEDULED
      if (deps.locked()) return LOCKED
      const parsed = createSchema.safeParse(args)
      if (!parsed.success) return { file: null, label: 'Criar pasta: pedido inválido', note: 'Campos: "conta" (opcional), "nome" e "dentro_de" (o path da pasta mãe, opcional).' }
      const status = await pickAccount(parsed.data.conta)
      if (!status) return accountMissing(parsed.data.conta)
      if (status.account.incoming.protocol === 'pop3') return { file: null, label: 'Criar pasta: conta POP3', note: 'Recusado (pop3): a conta POP3 não tem pastas no servidor.' }
      const name = parsed.data.nome
      const before = await deps.listFolders(status.account.id)
      const parent = parsed.data.dentro_de ?? null
      const existing = before.ok ? flatten(before.folders).find((node) => (parent ? node.path === `${parent}${node.delimiter ?? ''}${name}` : node.path === name)) : undefined
      if (!existing && (await deps.store.foldersCreated(context.chatId)) >= EMAIL_ORGANIZE_FOLDERS_MAX) return { file: null, label: 'Criar pasta: limite', note: `Recusado (limite): já foram criadas ${EMAIL_ORGANIZE_FOLDERS_MAX} pastas nesta conversa.` }
      const result = existing ? { ok: true as const, path: existing.path } : await deps.createFolder(status.account.id, parent, name)
      if (!result.ok) {
        const why = result.error === 'missing' ? 'a pasta mãe não existe' : result.error === 'invalid' ? 'nome inválido' : result.error === 'unavailable' ? 'o servidor não respondeu' : 'o servidor recusou'
        return { file: null, label: `Criar a pasta «${emailOneLine(name).slice(0, 60)}»: falhou`, note: `A pasta não foi criada (${result.error}): ${why}.` }
      }
      // Gravado com os lotes: o teto de 10 por conversa vale depois de reiniciar.
      if (!existing) await deps.store.addFolderCreated(context.chatId)
      log(existing ? 'pasta já existia' : 'pasta criada')
      const batch = [...(turns.get(context.turnId)?.batches.values() ?? [])][0]
      const saved = batch ? await deps.store.get(batch) : null
      return { file: null, ok: true, label: saved ? progressLabel(saved) : `Criando a pasta «${emailOneLine(name).slice(0, 60)}»`, note: `Pasta pronta${existing ? ' (já existia)' : ''}: use "destino": "${result.path.replace(/"/g, '\\"')}" em mover_emails.` }
    },
  }

  // --- mover_emails --------------------------------------------------------------------------------------------------

  /** A pasta de onde a mensagem sai, com o `UIDVALIDITY` dos UIDs; `null` se ela não se move (enviado do app). */
  async function originOf(found: EmailFound): Promise<Origin | null> {
    if (found.uid === null) return null
    if (found.mailbox === null) {
      if (!isInbox(found.message)) return null
      const cache = (await deps.cached()).find((item) => item.status.account.id === found.status.account.id)
      return cache?.uidValidity ? { path: EMAIL_INBOX_MAILBOX, uid: found.uid, uidValidity: cache.uidValidity } : null
    }
    const parts = serverMessageParts(found.message.id)
    return parts ? { path: found.mailbox, uid: found.uid, uidValidity: parts.uidValidity } : null
  }

  const move: AssistantTool = {
    name: 'mover_emails',
    describe: `move emails de pasta, por assunto, só quando a pessoa pediu nesta conversa para organizar ou mover. Campos: "conta" (o endereço, opcional com uma conta só), "destino" (o path de uma pasta que já existe: sem ela, chame criar_pasta antes; a Lixeira, o Spam, Enviados, Rascunhos e as pastas virtuais são recusados) e "assuntos": uma lista de 1 a 20 {"emails": [referências "em-…" movíveis, 1 a 50], "assunto", "veredito": "resolvido" | "pendente" | "outra", "motivo" (até 200 caracteres) e "evidencia" (até 200: o que mostra isso, ex.: "você respondeu em 12/11 e ele agradeceu")}. Na dúvida entre resolvido e pendente, é pendente. Até ${EMAIL_ORGANIZE_MOVE_MAX} mensagens por pedido; tudo o que move fica num lote que a pessoa desfaz com um clique.`,
    pending: 'Movendo emails',
    step: 'Read',
    changes: true,
    rounds: EMAIL_ORGANIZE_ROUNDS_MAX,
    stepId: EMAIL_ORGANIZE_STEP_ID,
    async run(args, folder, context) {
      // N4, F4: só numa conversa do Assistente; uma tarefa agendada nunca move.
      if (!context?.chatId) return SCHEDULED
      if (deps.locked()) return LOCKED
      const parsed = moveSchema.safeParse(args)
      if (!parsed.success) return { file: null, label: 'Mover emails: pedido inválido', note: 'Campos: "conta" (opcional), "destino" (o path) e "assuntos" (1 a 20, cada um com "emails", "assunto", "veredito", "motivo" e "evidencia").' }
      const { destino } = parsed.data
      const refs = parsed.data.assuntos.flatMap((topic) => topic.emails)
      const status = await pickAccount(parsed.data.conta, refs)
      if (!status) return accountMissing(parsed.data.conta)
      const accountId = status.account.id
      if (status.account.incoming.protocol === 'pop3') return { file: null, label: 'Mover emails: conta POP3', note: 'Recusado (pop3): a conta POP3 não tem pastas no servidor; nada foi movido.' }
      // O destino tem de estar no `LIST` (relido uma vez se faltar) e não pode ser a Lixeira, o Spam…
      let listed = await deps.listFolders(accountId)
      let target = listed.ok ? flatten(listed.folders).find((node) => node.path === destino) : undefined
      if (!target) {
        listed = await deps.listFolders(accountId, { fresh: true })
        target = listed.ok ? flatten(listed.folders).find((node) => node.path === destino) : undefined
      }
      if (!listed.ok) return { file: null, label: 'Mover emails: servidor indisponível', note: 'O servidor não devolveu as pastas agora; nada foi movido.' }
      if (!target) return { file: null, label: `Mover emails: a pasta «${emailOneLine(destino).slice(0, 60)}» não existe`, note: `Recusado (folder-missing): a pasta ${emailOneLine(destino)} não existe. Chame criar_pasta com esse nome antes e depois mover_emails de novo; nada foi movido.` }
      const forbidden = forbiddenTarget(target)
      if (forbidden) return { file: null, label: 'Mover emails: destino recusado', note: `Recusado (destino-proibido): ${emailOneLine(destino)} ${forbidden}. Nada foi movido.` }
      const entries = flatten(listed.folders)
      const batch = await batchFor(context, accountId)
      if (!batch) return { file: null, label: 'Mover emails: falhou', note: 'O lote não pôde ser gravado; nada foi movido.' }
      const turn = turns.get(context.turnId) as Turn
      const live = liveOf(batch.id)
      live.etapa = 'movendo'
      // Cada mensagem, conferida agora: a referência, a conta, a pasta de origem e o teto do turno.
      const left = parsed.data.assuntos.map(() => new Map<LeftCode, number>())
      const leave = (topic: number, code: LeftCode, count = 1): void => void left[topic]?.set(code, (left[topic]?.get(code) ?? 0) + count)
      const seen = new Set<string>()
      type Planned = { topic: number; found: EmailFound; origin: Origin }
      const planned: Planned[] = []
      const topicIndex: number[] = []
      let budget = EMAIL_ORGANIZE_MOVE_MAX - turn.moved
      const topics = [...batch.topics]
      for (const [index, asked] of parsed.data.assuntos.entries()) {
        const found: EmailFound[] = []
        for (const item of asked.emails) {
          if (seen.has(item)) {
            leave(index, 'repetida')
            continue
          }
          seen.add(item)
          const hit = await links.find(item)
          if (!hit) leave(index, 'nao-encontrado')
          else if (hit.status.account.id !== accountId) leave(index, 'outra-conta')
          else found.push(hit)
        }
        found.sort((a, b) => b.message.date - a.message.date)
        for (const hit of found) {
          const origin = await originOf(hit)
          const node = origin ? entries.find((entry) => entry.path === origin.path) : undefined
          if (!origin || !node || node.noselect || (node.specialUse !== null && FORBIDDEN_ORIGIN_USE.includes(node.specialUse))) leave(index, 'nao-movivel')
          else if (origin.path === destino) leave(index, 'destino-proibido')
          else if (budget <= 0) leave(index, 'limite')
          else {
            budget--
            planned.push({ topic: index, found: hit, origin })
          }
        }
        const position = upsertTopic(batch.id, topics, {
          assunto: asked.assunto,
          veredito: asked.veredito,
          destino,
          motivo: asked.motivo,
          evidencia: asked.evidencia,
          from: found.length ? topicFrom(found) : '',
          count: planned.filter((item) => item.topic === index).length,
        }, found)
        topicIndex[index] = position
        const newest = planned.find((item) => item.topic === index)
        if (newest) live.latest.set(position, { fromPath: newest.origin.path, fromUid: newest.origin.uid })
      }
      const withTopics = await update(batch.id, (current) => ({ ...current, topics }))
      if (withTopics) announce(withTopics)
      // Por pasta de origem (e `UIDVALIDITY`), em `MOVE` de até 500; "Parar" deixa o em curso terminar e não começa outro.
      const groups = new Map<string, Planned[]>()
      for (const item of planned) {
        const key = `${item.origin.path}\n${item.origin.uidValidity}`
        groups.set(key, [...(groups.get(key) ?? []), item])
      }
      const chunks: Planned[][] = []
      for (const group of groups.values()) for (let start = 0; start < group.length; start += EMAIL_MOVE_MAX) chunks.push(group.slice(start, start + EMAIL_MOVE_MAX))
      const moved = parsed.data.assuntos.map(() => 0)
      let stopped = false
      let lockedMidway = false
      let current: EmailBatch | null
      for (const chunk of chunks) {
        if (context.signal.aborted) stopped = true
        if (deps.locked()) lockedMidway = true
        if (stopped || lockedMidway) {
          for (const item of chunk) leave(item.topic, stopped ? 'parado' : 'bloqueado')
          continue
        }
        const first = chunk[0] as Planned
        // O registro vem antes do `MOVE`: um app que cai no meio deixa os itens `pending` para o Desfazer conferir.
        let offset = 0
        const pending = await update(batch.id, (value) => {
          offset = value.items.length
          const items: EmailBatchItem[] = chunk.map((item) => ({ messageId: item.found.message.messageId, fromPath: item.origin.path, fromUid: item.origin.uid, fromUidValidity: item.origin.uidValidity, toPath: destino, toUid: null, toUidValidity: null, status: 'pending', topic: topicIndex[item.topic] ?? 0 }))
          return { ...value, items: [...value.items, ...items] }
        })
        if (!pending) break
        announce(pending)
        const result = await deps.moveMessages(accountId, first.origin.path, chunk.map((item) => item.origin.uid), destino, { uidValidity: first.origin.uidValidity })
        if (result.ok) turn.moved += chunk.length
        else for (const item of chunk) leave(item.topic, 'falhou')
        if (result.ok) for (const item of chunk) moved[item.topic] = (moved[item.topic] ?? 0) + 1
        const toUids = new Map(result.ok ? result.moved.map((item) => [item.fromUid, item.toUid]) : [])
        current = await update(batch.id, (value) => ({
          ...value,
          items: value.items.map((item, at) => {
            if (at < offset || at >= offset + chunk.length) return item
            return result.ok ? { ...item, status: 'moved', toUid: toUids.get(item.fromUid) ?? null, toUidValidity: result.uidValidity ?? null } : { ...item, status: 'failed' }
          }),
        }))
        if (current) announce(current)
        log(result.ok ? `${chunk.length} mensagem(ns) movida(s)` : `mover recusado (${result.error})`)
      }
      // As contagens de cada assunto: as que foram (as que ficaram estão no arquivo).
      current = await update(batch.id, (value) => ({
        ...value,
        topics: value.topics.map((topic, index) => {
          const count = value.items.filter((item) => item.topic === index).length
          return topicIndex.includes(index) && count ? { ...topic, count } : topic
        }),
      }))
      if (current) announce(current)
      const lines = [
        `# Mover para ${emailOneLine(destino)} (conta ${status.account.address})`,
        '',
        `${moved.reduce((sum, count) => sum + count, 0)} mensagem(ns) movida(s) nesta chamada; ${turn.moved} no pedido inteiro (o limite é ${EMAIL_ORGANIZE_MOVE_MAX}). Tudo fica no lote, com Desfazer para a pessoa.${stopped ? ' A pessoa clicou em Parar: o que já foi movido fica, o resto não.' : ''}${lockedMidway ? ' O app foi bloqueado no meio: o resto não foi movido.' : ''}`,
        '',
        ...parsed.data.assuntos.map((asked, index) => {
          const reasons = [...(left[index] ?? new Map<LeftCode, number>())].map(([code, count]) => `${count} ficou(aram) (${code}: ${LEFT_REASONS[code]})`)
          return `- "${emailOneLine(asked.assunto).replace(/"/g, "'")}" (${asked.veredito}): ${moved[index] ?? 0} movida(s)${reasons.length ? `; ${reasons.join('; ')}` : ''}`
        }),
      ]
      await writeAtomic(join(folder, EMAIL_MOVE_FILE), `${lines.join('\n')}\n`)
      const final = current ?? (await deps.store.get(batch.id))
      const card: EmailBatchAction | null = final && final.items.length ? { id: `lote-${final.id.slice(0, 8)}`, kind: 'email-lote', status: 'proposed', result: null, batchId: final.id, accountId, account: status.account.address } : null
      return { file: EMAIL_MOVE_FILE, label: final ? progressLabel(final) : 'Movendo emails', ...(card ? { actions: [card] } : {}) }
    },
  }

  // --- informar_progresso --------------------------------------------------------------------------------------------

  const progress: AssistantTool = {
    name: 'informar_progresso',
    describe: `mostra à pessoa, ao vivo, em que pé está a organização (não move nada). Campos: "etapa" ("lendo", "decidindo" ou "movendo"), "lidos" e "total" (mensagens) e "decisoes" (0 a 20, como os "assuntos" de mover_emails, com "destino" opcional). Use a cada poucas conversas lidas, para a pessoa acompanhar.`,
    pending: 'Organizando o email',
    step: 'Read',
    rounds: EMAIL_ORGANIZE_ROUNDS_MAX,
    stepId: EMAIL_ORGANIZE_STEP_ID,
    async run(args, _folder, context) {
      if (deps.locked()) return LOCKED
      const parsed = progressSchema.safeParse(args)
      if (!parsed.success) return { file: null, label: 'Progresso: pedido inválido', note: 'Campos: "etapa", "lidos", "total" e "decisoes" (opcional).' }
      if (!context) return { file: null, ok: true, label: 'Organizando o email', note: 'Anotado.' }
      const decisions = parsed.data.decisoes ?? []
      const known = [...(turns.get(context.turnId)?.batches.keys() ?? [])]
      const status = known.length === 1 ? (statusOf(known[0] as string) ?? null) : await pickAccount(undefined, decisions.flatMap((item) => item.emails))
      if (!status) return { file: null, ok: true, label: 'Organizando o email', note: 'Anotado (sem conta definida: diga a conta nas próximas ferramentas).' }
      const batch = await batchFor(context, status.account.id)
      if (!batch) return { file: null, ok: true, label: 'Organizando o email', note: 'Anotado.' }
      const live = liveOf(batch.id)
      live.etapa = parsed.data.etapa
      const topics = [...batch.topics]
      for (const decision of decisions) {
        const found: EmailFound[] = []
        for (const item of decision.emails) {
          const hit = await links.find(item)
          if (hit && hit.status.account.id === status.account.id) found.push(hit)
        }
        found.sort((a, b) => b.message.date - a.message.date)
        const at = upsertTopic(batch.id, topics, { assunto: decision.assunto, veredito: decision.veredito, destino: destinationOf(decision.veredito, decision.destino), motivo: decision.motivo, evidencia: decision.evidencia, from: found.length ? topicFrom(found) : '', count: found.length }, found)
        const latest = found[0]
        if (latest) live.opens.set(at, { accountId: status.account.id, mailbox: latest.mailbox ?? (isInbox(latest.message) ? EMAIL_INBOX_MAILBOX : latest.message.mailbox), id: latest.message.id })
      }
      const saved = await update(batch.id, (current) => ({ ...current, topics, totals: { ...current.totals, read: Math.max(parsed.data.lidos, readByTools(context.turnId, status.account.id)), total: Math.max(parsed.data.total, current.totals.total) } }))
      if (saved) announce(saved)
      return { file: null, ok: true, label: saved ? progressLabel(saved) : 'Organizando o email', note: 'Progresso mostrado à pessoa. Continue.' }
    },
  }

  // --- Desfazer, estado e o fim do turno ------------------------------------------------------------------------------

  async function undoBatch(batchId: string): Promise<EmailBatchUndoResult> {
    if (deps.locked()) return { ok: false, error: 'unavailable' }
    const batch = await deps.store.get(batchId)
    if (!batch) return { ok: false, error: 'missing' }
    // Lote que ainda organiza não se desfaz: primeiro "Parar".
    if (batch.state === 'running' || undoing.has(batchId)) return { ok: false, error: 'busy' }
    const status = statusOf(batch.accountId)
    if (!status) return { ok: false, error: 'missing' }
    if (status.account.incoming.protocol === 'pop3') return { ok: false, error: 'pop3' }
    undoing.add(batchId)
    try {
      const listed = await deps.listFolders(batch.accountId, { fresh: true })
      if (!listed.ok) return { ok: false, error: listed.error === 'unavailable' ? 'unavailable' : 'server' }
      const entries = flatten(listed.folders)
      const exists = (path: string): boolean => entries.some((entry) => entry.path === path && !entry.noselect)
      // Os que podem estar no destino: movidos, `pending` (o app pode ter caído depois do `MOVE`) e os que falharam antes.
      const todo = batch.items.map((item, index) => ({ item, index })).filter(({ item }) => item.status === 'moved' || item.status === 'pending' || item.status === 'undo-failed')
      const outcome = new Map<number, { status: 'undone'; backUid: number | null; backUidValidity: string | null } | { status: 'undo-failed'; code: EmailUndoError } | { status: 'failed' }>()
      const fail = (index: number, code: EmailUndoError): void => void outcome.set(index, { status: 'undo-failed', code })
      const byTarget = new Map<string, typeof todo>()
      for (const entry of todo) byTarget.set(entry.item.toPath, [...(byTarget.get(entry.item.toPath) ?? []), entry])
      for (const [toPath, group] of byTarget) {
        // Pasta sumida (apagada ou renomeada fora): nada a fazer, e o app não a recria (D6).
        if (!exists(toPath)) {
          for (const { index } of group) fail(index, 'folder-missing')
          continue
        }
        const ready = group.filter(({ item, index }) => (exists(item.fromPath) ? true : (fail(index, 'origin-missing'), false)))
        if (!ready.length) continue
        const uids = ready.flatMap(({ item }) => (item.toUid !== null ? [item.toUid] : []))
        const ids = [...new Set(ready.flatMap(({ item }) => (item.messageId ? [item.messageId] : [])))]
        const located = await deps.locateMessages(batch.accountId, toPath, uids, ids)
        if (!located.ok) {
          for (const { index } of ready) fail(index, 'unavailable')
          continue
        }
        // Pelo UID novo, se o `UIDVALIDITY` do destino é o mesmo e ele ainda existe; senão pelo Message-ID.
        const taken = new Set<number>()
        const back = new Map<string, { uid: number; index: number; messageId: string | null }[]>()
        /** `pending` que não está no destino: o app pode ter caído antes do `MOVE`, e ela nunca saiu da origem. */
        const unsure: { item: EmailBatchItem; index: number }[] = []
        for (const { item, index } of ready) {
          let uid: number | null = null
          if (item.toUid !== null && item.toUidValidity === located.uidValidity && located.existing.includes(item.toUid) && !taken.has(item.toUid)) uid = item.toUid
          else if (item.messageId) uid = (located.byMessageId[item.messageId] ?? []).find((candidate) => !taken.has(candidate)) ?? null
          if (uid === null) {
            if (item.status === 'pending') unsure.push({ item, index })
            else fail(index, 'not-found')
            continue
          }
          taken.add(uid)
          back.set(item.fromPath, [...(back.get(item.fromPath) ?? []), { uid, index, messageId: item.messageId }])
        }
        // Procura na origem: achada lá, ela não chegou a ser movida (sem falha e sem "Tentar de novo").
        const byOrigin = new Map<string, typeof unsure>()
        for (const entry of unsure) byOrigin.set(entry.item.fromPath, [...(byOrigin.get(entry.item.fromPath) ?? []), entry])
        for (const [fromPath, list] of byOrigin) {
          const ids = [...new Set(list.flatMap(({ item }) => (item.messageId ? [item.messageId] : [])))]
          const home = await deps.locateMessages(batch.accountId, fromPath, list.map(({ item }) => item.fromUid), ids)
          for (const { item, index } of list) {
            const there = home.ok && ((item.messageId !== null && (home.byMessageId[item.messageId] ?? []).length > 0) || (item.messageId === null && item.fromUidValidity === home.uidValidity && home.existing.includes(item.fromUid)))
            if (there) outcome.set(index, { status: 'failed' })
            else fail(index, home.ok ? 'not-found' : 'unavailable')
          }
        }
        for (const [fromPath, list] of back) {
          for (let start = 0; start < list.length; start += EMAIL_MOVE_MAX) {
            const chunk = list.slice(start, start + EMAIL_MOVE_MAX)
            const result = await deps.moveMessages(batch.accountId, toPath, chunk.map((item) => item.uid), fromPath, { uidValidity: located.uidValidity, messageIds: chunk.flatMap((item) => (item.messageId ? [item.messageId] : [])) })
            const backUids = new Map(result.ok ? result.moved.map((moved) => [moved.fromUid, moved.toUid]) : [])
            for (const item of chunk) {
              if (result.ok) outcome.set(item.index, { status: 'undone', backUid: backUids.get(item.uid) ?? null, backUidValidity: result.uidValidity ?? null })
              else fail(item.index, result.error === 'unavailable' ? 'unavailable' : result.error === 'invalid' ? 'invalid' : result.error === 'missing' ? 'folder-missing' : 'server')
            }
          }
        }
      }
      const saved = await update(batchId, (value) => {
        const items = value.items.map((item, index): EmailBatchItem => {
          const done = outcome.get(index)
          if (!done) return item
          const { undoError: _gone, backUid: _uid, backUidValidity: _validity, ...rest } = item
          if (done.status === 'failed') return { ...rest, status: 'failed' }
          if (done.status === 'undone') return { ...rest, status: 'undone', ...(done.backUid !== null && done.backUidValidity !== null ? { backUid: done.backUid, backUidValidity: done.backUidValidity } : {}) }
          return { ...item, status: 'undo-failed', undoError: done.code }
        })
        const failedLeft = items.some((item) => item.status === 'undo-failed')
        return { ...value, items, state: failedLeft ? 'partial-undo' : 'undone', endedAt: value.endedAt ?? now() }
      })
      if (!saved) return { ok: false, error: 'missing' }
      announce(saved)
      const counts = new Map<EmailUndoError, number>()
      for (const item of saved.items) if (item.status === 'undo-failed' && item.undoError) counts.set(item.undoError, (counts.get(item.undoError) ?? 0) + 1)
      const failed = [...counts].map(([code, count]) => ({ code, count }))
      const undone = [...outcome.values()].filter((item) => item.status === 'undone').length
      log(`desfazer: ${undone} de volta, ${failed.reduce((sum, item) => sum + item.count, 0)} não`)
      const tried = saved.items.filter((item) => item.status === 'undone' || item.status === 'undo-failed')
      const text = emailUndoText(now(), { back: tried.filter((item) => item.status === 'undone').length, total: tried.length, toInbox: tried.every((item) => isInbox({ mailbox: item.fromPath })) })
      await deps.cardDone?.(saved, text).catch(() => undefined)
      return { ok: true, undone, failed }
    } finally {
      undoing.delete(batchId)
    }
  }

  const sameDay = (a: number, b: number): boolean => {
    const x = new Date(a)
    const y = new Date(b)
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  }

  return {
    tools: [conversations, folders, create, move, progress],

    async init() {
      // O app caiu no meio: o lote para, e os `pending` ficam para o Desfazer conferir pelo Message-ID.
      await deps.store.mutate((batches) => (batches.some((batch) => batch.state === 'running') ? { batches: batches.map((batch) => (batch.state === 'running' ? { ...batch, state: 'stopped', endedAt: now() } : batch)), value: null } : null))
    },

    async endTurn(turnRef, outcome) {
      const turn = turns.get(turnRef.turnId)
      if (!turn) return
      turns.delete(turnRef.turnId)
      for (const batchId of turn.batches.values()) {
        const empty = (await deps.store.get(batchId))?.items.length === 0
        if (empty) {
          // Só leu ou decidiu, sem mover nada: não vira lote (nem faixa de Desfazer).
          const closed = await deps.store.mutate((batches) => {
            const found = batches.find((batch) => batch.id === batchId)
            return found ? { batches: batches.filter((batch) => batch.id !== batchId), value: { ...found, state: 'done' as const, endedAt: now() } } : null
          })
          if (closed) announce(closed)
          lives.delete(batchId)
          continue
        }
        const saved = await update(batchId, (batch) => (batch.state === 'running' ? { ...batch, state: outcome === 'stopped' ? 'stopped' : 'done', endedAt: now() } : batch))
        if (saved) announce(saved)
      }
    },

    undoBatch,

    async noteRead(context, found) {
      if (!context || !found.length) return
      const turn = turnOf(context)
      for (const accountId of new Set(found.map((item) => item.status.account.id))) {
        const seen = turn.read.get(accountId) ?? new Set<string>()
        for (const item of found) if (item.status.account.id === accountId) seen.add(item.ref)
        turn.read.set(accountId, seen)
        const batchId = turn.batches.get(accountId)
        if (!batchId) continue
        const saved = await update(batchId, (batch) => ({ ...batch, totals: { ...batch.totals, read: Math.max(batch.totals.read, Math.min(seen.size, batch.totals.total || seen.size)) } }))
        if (saved) announce(saved)
      }
    },

    async state() {
      if (deps.locked()) return { ok: false, error: 'unavailable' }
      const batches = await deps.store.list()
      const running = batches.find((batch) => batch.state === 'running') ?? null
      return { ok: true, running: running ? viewOf(running) : null, today: batches.filter((batch) => sameDay(batch.startedAt, now())).map(viewOf) }
    },

    async get(batchId) {
      if (deps.locked()) return { ok: false, error: 'unavailable' }
      const batch = await deps.store.get(batchId)
      return batch ? { ok: true, batch, view: viewOf(batch) } : { ok: false, error: 'missing' }
    },

    async undo(request) {
      const parsed = batchRequestSchema.safeParse(request)
      return parsed.success ? undoBatch(parsed.data.batchId) : { ok: false, error: 'invalid' }
    },

    async batch(request) {
      const parsed = batchRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      if (deps.locked()) return { ok: false, error: 'unavailable' }
      const batch = await deps.store.get(parsed.data.batchId)
      return batch ? { ok: true, batch, view: viewOf(batch) } : { ok: false, error: 'missing' }
    },

    async forgetAccount(accountId) {
      await deps.store.mutate((batches) => (batches.some((batch) => batch.accountId === accountId) ? { batches: batches.filter((batch) => batch.accountId !== accountId), value: null } : null))
      for (const [turnId, turn] of turns) if (turn.batches.has(accountId)) turns.get(turnId)?.batches.delete(accountId)
    },
  }
}
