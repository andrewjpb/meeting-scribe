// Histórico do atendimento no WhatsApp (contrato 138): `userData/whatsapp/atendimento-log.jsonl`, uma linha JSON por
// evento, `0o600`. Nunca leva texto de mensagem nem instruções do agente: só a ação, a conversa, o agente, o id da
// mensagem e um motivo curto. Ficam os 5.000 eventos mais recentes: a leitura que encontra mais compacta o arquivo
// (temporário + `rename`) e a gravação compacta quando passa do teto com folga, para não reescrever a cada evento.
// Linha que não passa no esquema é ignorada na leitura. Fila serial, como os stores. Sem Electron.
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { z } from 'zod'
import { ATENDIMENTO_LOG_FILE, ATENDIMENTO_LOG_LIST_DEFAULT, ATENDIMENTO_LOG_MAX, type AtendimentoLogEntry, type AtendimentoLogListResult } from '../../../shared/atendimento'
import { atendimentoLogEntrySchema, atendimentoLogListRequestSchema } from '../../../shared/atendimento-schema'

/** Quantos eventos além do teto a gravação tolera antes de compactar. */
const LOG_SLACK = 100

export interface AtendimentoLog {
  /** Acrescenta um evento; `false` se a entrada não passa no esquema (nada é gravado). */
  append(entry: AtendimentoLogEntry): Promise<boolean>
  /** Os 5.000 mais recentes, do mais antigo para o mais recente (compacta o arquivo se houver mais). */
  read(): Promise<AtendimentoLogEntry[]>
  /** `scribe:atendimento-log-list`: do mais recente para o mais antigo, `limit` padrão 200 (até 1.000), `chatId` filtra. */
  list(request: unknown): Promise<AtendimentoLogListResult>
}

export interface AtendimentoLogOptions {
  /** `userData/whatsapp`. */
  dir: string
}

const codigo = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined)

/** A linha validada sem as chaves opcionais ausentes. */
function toEntry({ messageId, reason, ...entry }: z.output<typeof atendimentoLogEntrySchema>): AtendimentoLogEntry {
  return { ...entry, ...(messageId === undefined ? {} : { messageId }), ...(reason === undefined ? {} : { reason }) }
}

export function createAtendimentoLog({ dir }: AtendimentoLogOptions): AtendimentoLog {
  const file = join(dir, ATENDIMENTO_LOG_FILE)
  let queue: Promise<unknown> = Promise.resolve()
  /** Linhas no arquivo, depois da primeira leitura. */
  let lines: number | null = null

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function readAll(): Promise<{ entries: AtendimentoLogEntry[]; lines: number }> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (codigo(error) !== 'ENOENT') throw error
      return { entries: [], lines: 0 }
    }
    const rows = raw.split('\n').filter((row) => row.trim() !== '')
    const entries: AtendimentoLogEntry[] = []
    for (const row of rows) {
      let parsed: unknown
      try {
        parsed = JSON.parse(row) as unknown
      } catch {
        continue
      }
      const entry = atendimentoLogEntrySchema.safeParse(parsed)
      if (entry.success) entries.push(toEntry(entry.data))
    }
    return { entries, lines: rows.length }
  }

  async function compact(entries: AtendimentoLogEntry[]): Promise<void> {
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''), { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
    lines = entries.length
  }

  /** Lê e, se o arquivo passou do teto (ou tem linha ruim além dele), deixa só os mais recentes. */
  async function load(): Promise<AtendimentoLogEntry[]> {
    const all = await readAll()
    lines = all.lines
    if (all.lines <= ATENDIMENTO_LOG_MAX) return all.entries
    const kept = all.entries.slice(-ATENDIMENTO_LOG_MAX)
    await compact(kept)
    return kept
  }

  return {
    append: (entry) =>
      serial(async () => {
        const parsed = atendimentoLogEntrySchema.safeParse(entry)
        if (!parsed.success) return false
        await mkdir(dir, { recursive: true })
        if (lines === null) lines = (await readAll()).lines
        await appendFile(file, `${JSON.stringify(toEntry(parsed.data))}\n`, { encoding: 'utf8', mode: 0o600 })
        lines += 1
        if (lines > ATENDIMENTO_LOG_MAX + LOG_SLACK) await load()
        return true
      }),

    read: () => serial(load),

    list: (request) =>
      serial(async (): Promise<AtendimentoLogListResult> => {
        const parsed = atendimentoLogListRequestSchema.safeParse(request)
        if (!parsed.success) return { ok: false, error: 'invalid' }
        const limit = parsed.data?.limit ?? ATENDIMENTO_LOG_LIST_DEFAULT
        const chatId = parsed.data?.chatId
        const entries = await load()
        const out: AtendimentoLogEntry[] = []
        for (let index = entries.length - 1; index >= 0 && out.length < limit; index -= 1) {
          const entry = entries[index]
          if (entry && (chatId === undefined || entry.chatId === chatId)) out.push(entry)
        }
        return { ok: true, entries: out }
      }),
  }
}
