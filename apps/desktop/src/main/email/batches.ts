// Contrato 56 (CA8): os lotes do agente que organiza o email, em `userData/email/batches.json` (0600, gravação atômica,
// fila própria). Cada `mover_emails` grava os itens como `pending` antes do `MOVE` e `moved` (com o UID novo do
// `COPYUID`) depois; o Desfazer só depende deste arquivo e do servidor, então vale depois de reiniciar. Ficam os 20 lotes
// mais recentes e no máximo 7 dias (D4); a conta removida leva os dela. Nada de corpo de email aqui: só o assunto e o
// remetente da conversa, o que o cartão e o painel mostram. Arquivo ausente ou inválido vale como vazio. Ao lado dos
// lotes, quantas pastas o agente criou em cada conversa (o teto de 10 vale depois de reiniciar).
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { EMAIL_ACCOUNT_ID_PATTERN, EMAIL_FOLDER_PATH_MAX } from '../../shared/email'
import { EMAIL_BATCH_DAYS, EMAIL_BATCH_REASON_MAX, EMAIL_BATCH_REQUEST_MAX, EMAIL_BATCHES_MAX, EMAIL_VERDICTS, type EmailBatch } from '../../shared/email-organize'

export const EMAIL_BATCHES_FILE = 'batches.json'
const VERSION = 1
const DAY_MS = 86_400_000
/** Itens num lote: o teto do turno (200) com folga para o que um arquivo antigo trouxer. */
const ITEMS_MAX = 1000
const TOPICS_MAX = 500

const path = z.string().min(1).max(EMAIL_FOLDER_PATH_MAX)
const uidValidity = z.string().max(40)
const topicSchema = z
  .object({
    assunto: z.string().max(500),
    veredito: z.enum(EMAIL_VERDICTS),
    destino: path.nullable(),
    motivo: z.string().max(EMAIL_BATCH_REASON_MAX),
    evidencia: z.string().max(EMAIL_BATCH_REASON_MAX),
    from: z.string().max(500),
    count: z.number().int().min(0).max(ITEMS_MAX),
  })
  .strict()
const itemSchema = z
  .object({
    messageId: z.string().max(1000).nullable(),
    fromPath: path,
    fromUid: z.number().int().positive(),
    fromUidValidity: uidValidity,
    toPath: path,
    toUid: z.number().int().positive().nullable(),
    toUidValidity: uidValidity.nullable(),
    status: z.enum(['pending', 'moved', 'failed', 'undone', 'undo-failed']),
    undoError: z.enum(['not-found', 'folder-missing', 'origin-missing', 'server', 'unavailable', 'invalid']).optional(),
    topic: z.number().int().min(0).max(TOPICS_MAX),
    backUid: z.number().int().positive().optional(),
    backUidValidity: uidValidity.optional(),
  })
  .strict()
const batchSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().regex(EMAIL_ACCOUNT_ID_PATTERN),
    chatId: z.string().min(1).max(200),
    startedAt: z.number(),
    endedAt: z.number().nullable(),
    state: z.enum(['running', 'stopped', 'done', 'undone', 'partial-undo']),
    request: z.string().max(EMAIL_BATCH_REQUEST_MAX),
    totals: z.object({ read: z.number().int().min(0), total: z.number().int().min(0), outOfLimit: z.number().int().min(0) }).strict(),
    topics: z.array(topicSchema).max(TOPICS_MAX),
    items: z.array(itemSchema).max(ITEMS_MAX),
  })
  .strict()
const fileSchema = z.object({ version: z.literal(VERSION), batches: z.array(z.unknown()), folders: z.record(z.string().max(200), z.number().int().min(0).max(1000)).optional() })
/** Conversas com a contagem de pastas guardada (as mais recentes ficam). */
const FOLDER_CHATS_MAX = 500

export interface EmailBatchStore {
  list(): Promise<EmailBatch[]>
  get(id: string): Promise<EmailBatch | null>
  /**
   * Lê, aplica `fn` e grava, na mesma vez da fila (com o corte dos 20 e dos 7 dias). `fn` recebe a lista inteira, da mais
   * recente para a mais antiga, e devolve a nova (ou `null`: nada é gravado).
   */
  mutate<T>(fn: (batches: EmailBatch[]) => { batches: EmailBatch[]; value: T } | null): Promise<T | null>
  /** Quantas pastas o agente já criou nesta conversa do chat. */
  foldersCreated(chatId: string): Promise<number>
  /** Mais uma pasta criada na conversa. */
  addFolderCreated(chatId: string): Promise<void>
}

/** Os 20 mais recentes, dos últimos 7 dias; o que ainda roda nunca sai. */
export function pruneBatches(batches: readonly EmailBatch[], now: number): EmailBatch[] {
  const sorted = [...batches].sort((a, b) => b.startedAt - a.startedAt)
  const fresh = sorted.filter((batch) => batch.state === 'running' || batch.startedAt >= now - EMAIL_BATCH_DAYS * DAY_MS)
  const kept: EmailBatch[] = []
  for (const batch of fresh) if (batch.state === 'running' || kept.length < EMAIL_BATCHES_MAX) kept.push(batch)
  return kept
}

export function createEmailBatchStore(root: string, now: () => number = Date.now): EmailBatchStore {
  const file = join(root, EMAIL_BATCHES_FILE)
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function readAll(): Promise<{ batches: EmailBatch[]; folders: Record<string, number> }> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      return { batches: [], folders: {} }
    }
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) return { batches: [], folders: {} }
    // Um lote quebrado não leva os outros.
    const batches = parsed.data.batches.flatMap((item) => {
      const batch = batchSchema.safeParse(item)
      return batch.success ? [batch.data] : []
    })
    return { batches, folders: parsed.data.folders ?? {} }
  }
  const read = async (): Promise<EmailBatch[]> => (await readAll()).batches

  async function write(batches: EmailBatch[], folders?: Record<string, number>): Promise<void> {
    const kept = folders ?? (await readAll()).folders
    await mkdir(root, { recursive: true, mode: 0o700 })
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify({ version: VERSION, batches, ...(Object.keys(kept).length ? { folders: kept } : {}) })}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
    await chmod(file, 0o600)
  }

  return {
    list: () => serial(async () => pruneBatches(await read(), now())),
    get: (id) => serial(async () => pruneBatches(await read(), now()).find((batch) => batch.id === id) ?? null),
    mutate: (fn) =>
      serial(async () => {
        const result = fn(pruneBatches(await read(), now()))
        if (!result) return null
        await write(pruneBatches(result.batches, now()))
        return result.value
      }),
    foldersCreated: (chatId) => serial(async () => (await readAll()).folders[chatId] ?? 0),
    addFolderCreated: (chatId) =>
      serial(async () => {
        const { batches, folders } = await readAll()
        const { [chatId]: before = 0, ...rest } = folders
        // A conversa mexida por último fica no fim; acima do teto, as mais antigas saem.
        const next = Object.entries({ ...rest, [chatId]: before + 1 }).slice(-FOLDER_CHATS_MAX)
        await write(pruneBatches(batches, now()), Object.fromEntries(next))
      }),
  }
}
