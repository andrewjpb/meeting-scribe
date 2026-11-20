// Contrato 62 (convites-agenda): o registro do app, `userData/email/invites.json` (D6, N3). Uma linha por convite
// visto, com a chave `accountId` + `uid` + `recurrenceId`; o `event` só existe quando o app gravou o evento, e é só ele
// que dá ao app o direito de atualizar ou tirar alguma coisa da agenda. Perder o arquivo tira poderes, nunca dá.
//
// Arquivo 0600, gravação atômica (temporário + `rename`, como o email-store) e todas as operações numa fila só: cada
// uma lê o que a anterior gravou. Leitura leniente: linha fora do esquema sai sozinha; arquivo ilegível vira
// `invites.json.invalid` e vale vazio. O log diz só a operação e a contagem, nunca título, UID ou endereço.
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { EMAIL_ACCOUNT_ID_PATTERN } from '../../shared/email'
import { EMAIL_DIR } from '../email/email-store'

export const INVITES_FILE = 'invites.json'
export const INVITES_MAX = 2000
/** Passou do teto: depois das linhas sem evento, saem as de evento que começou há mais que isto. */
export const INVITES_PAST_EVENT_MS = 30 * 86_400_000

const text = z.string().max(4096)
const partstatSchema = z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED'])

const eventRefSchema = z
  .object({
    eventIdentifier: text.nullable(),
    calendarItemIdentifier: text.min(1),
    externalIdentifier: text.nullable(),
    calendarId: text.min(1),
    title: text,
    start: text,
    end: text,
    allDay: z.boolean(),
    timeZone: text.nullable(),
    location: text.nullable(),
    url: text.nullable(),
    availability: z.enum(['busy', 'tentative']),
    occurrence: text.nullable(),
    sequence: z.number().int().nonnegative(),
    dtstamp: text.nullable(),
  })
  .strict()
export type InviteEventRef = z.infer<typeof eventRefSchema>

const recordSchema = z
  .object({
    accountId: z.string().regex(EMAIL_ACCOUNT_ID_PATTERN),
    uid: text.min(1),
    recurrenceId: text.nullable(),
    sequence: z.number().int().nonnegative(),
    dtstamp: text.nullable(),
    response: partstatSchema.nullable(),
    respondedAt: z.number().nullable(),
    messageId: text.nullable(),
    seenAt: z.number(),
    event: eventRefSchema.nullable(),
    merged: z.object({ calendarItemIdentifier: text, calendarTitle: text, sourceTitle: text }).strict().nullable(),
    mergedNotice: z.boolean(),
    removed: z.boolean(),
  })
  .strict()
export type InviteRecord = z.infer<typeof recordSchema>

export interface InviteKey {
  accountId: string
  uid: string
  recurrenceId: string | null
}

export interface InviteStore {
  get(key: InviteKey): Promise<InviteRecord | null>
  list(accountId?: string): Promise<InviteRecord[]>
  /** `fn` recebe a linha atual (ou `null`) e devolve a nova; `null` apaga. A chave é sempre a pedida. */
  update(key: InviteKey, fn: (current: InviteRecord | null) => InviteRecord | null): Promise<InviteRecord | null>
  /** Todas as linhas do UID na conta (a série e as ocorrências). */
  removeUid(accountId: string, uid: string): Promise<number>
  forgetAccount(accountId: string): Promise<number>
}

const sameKey = (record: InviteKey, key: InviteKey): boolean => record.accountId === key.accountId && record.uid === key.uid && record.recurrenceId === key.recurrenceId

/** Linha nova de um convite, sem resposta e sem evento. */
export function emptyRecord(key: InviteKey, version: { sequence: number; dtstamp: string | null }, now: number): InviteRecord {
  return { ...key, sequence: version.sequence, dtstamp: version.dtstamp, response: null, respondedAt: null, messageId: null, seenAt: now, event: null, merged: null, mergedNotice: false, removed: false }
}

/** O teto (CA3): primeiro as linhas sem evento vistas há mais tempo, depois as de evento passado há mais de 30 dias. */
function prune(records: InviteRecord[], now: number): { kept: InviteRecord[]; dropped: number } {
  if (records.length <= INVITES_MAX) return { kept: records, dropped: 0 }
  let excess = records.length - INVITES_MAX
  const drop = new Set<InviteRecord>()
  for (const record of records.filter((item) => item.event === null).sort((a, b) => a.seenAt - b.seenAt)) {
    if (excess <= 0) break
    drop.add(record)
    excess--
  }
  if (excess > 0) {
    const startOf = (record: InviteRecord): number => Date.parse(record.event?.start ?? '')
    const past = records.filter((item) => item.event !== null && Number.isFinite(startOf(item)) && startOf(item) < now - INVITES_PAST_EVENT_MS).sort((a, b) => startOf(a) - startOf(b))
    for (const record of past) {
      if (excess <= 0) break
      drop.add(record)
      excess--
    }
  }
  return { kept: records.filter((item) => !drop.has(item)), dropped: drop.size }
}

export function createInviteStore(root: string, now: () => number = Date.now, log: (message: string) => void = () => undefined): InviteStore {
  const dir = join(root, EMAIL_DIR)
  const file = join(dir, INVITES_FILE)
  let queue: Promise<unknown> = Promise.resolve()
  let counter = 0

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function load(): Promise<InviteRecord[]> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      parsed = null
    }
    const shape = z.object({ version: z.literal(1), invites: z.array(z.unknown()) }).safeParse(parsed)
    if (!shape.success) {
      const invalid = `${file}.invalid`
      await rename(file, invalid).catch(() => undefined)
      await chmod(invalid, 0o600).catch(() => undefined)
      log('[convites] registro ilegível: guardado como invites.json.invalid, vale vazio')
      return []
    }
    const records: InviteRecord[] = []
    let skipped = 0
    for (const item of shape.data.invites) {
      const row = recordSchema.safeParse(item)
      if (!row.success || records.some((other) => sameKey(other, row.data))) {
        skipped++
        continue
      }
      records.push(row.data)
    }
    if (skipped) log(`[convites] registro: ${skipped} linha(s) fora do formato ignorada(s)`)
    return records
  }

  async function save(records: InviteRecord[]): Promise<void> {
    const { kept, dropped } = prune(records, now())
    if (dropped) log(`[convites] registro: ${dropped} linha(s) antiga(s) saíram pelo teto`)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const temp = `${file}.tmp-${process.pid}-${++counter}`
    try {
      await writeFile(temp, `${JSON.stringify({ version: 1, invites: kept })}\n`, { mode: 0o600 })
      await chmod(temp, 0o600)
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true })
      log('[convites] registro: falha ao gravar')
      throw error
    }
  }

  const removeWhere = (match: (record: InviteRecord) => boolean): Promise<number> =>
    serial(async () => {
      const records = await load()
      const kept = records.filter((record) => !match(record))
      const removed = records.length - kept.length
      if (removed) await save(kept)
      return removed
    })

  return {
    get: (key) => serial(async () => (await load()).find((record) => sameKey(record, key)) ?? null),
    list: (accountId) => serial(async () => (await load()).filter((record) => accountId === undefined || record.accountId === accountId)),
    update: (key, fn) =>
      serial(async () => {
        const records = await load()
        const index = records.findIndex((record) => sameKey(record, key))
        const current = index === -1 ? null : (records[index] ?? null)
        const next = fn(current)
        if (next === null) {
          if (index === -1) return null
          records.splice(index, 1)
        } else {
          // Uma linha fora do esquema sairia na leitura seguinte (e com ela o direito sobre o evento): recusada aqui.
          const row = recordSchema.parse({ ...next, accountId: key.accountId, uid: key.uid, recurrenceId: key.recurrenceId })
          if (index === -1) records.push(row)
          else records[index] = row
        }
        await save(records)
        return next === null ? null : (records.find((record) => sameKey(record, key)) ?? null)
      }),
    removeUid: (accountId, uid) => removeWhere((record) => record.accountId === accountId && record.uid === uid),
    async forgetAccount(accountId) {
      const removed = await removeWhere((record) => record.accountId === accountId)
      if (removed) log(`[convites] registro: ${removed} linha(s) de uma conta removida saíram`)
      return removed
    },
  }
}
