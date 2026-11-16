// `userData/lock.json` (contrato 22): o hash da senha, os erros seguidos, até quando dura a espera e se o app
// ficou bloqueado. Gravado de forma atômica (temporário + `rename`) com permissão 0600. Arquivo ausente ou
// inválido vale como "sem senha"; apagá-lo com o app fechado é o "Esqueci a senha" (CA5).
import { randomUUID } from 'node:crypto'
import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { passwordRecordSchema, type PasswordRecord } from './password'

export const LOCK_FILE = 'lock.json'
export const LOCK_VERSION = 1

export interface LockData {
  password: PasswordRecord | null
  /** Erros seguidos de senha; zera no desbloqueio. */
  failures: number
  /** Fim da espera (ms desde 1970), guardado para reiniciar o app não zerar. */
  retryAt: number | null
  /** O app estava bloqueado quando foi fechado (CA6). */
  locked: boolean
}

export const EMPTY_LOCK_DATA: Readonly<LockData> = Object.freeze({ password: null, failures: 0, retryAt: null, locked: false })

const fileSchema = z.object({
  version: z.literal(LOCK_VERSION),
  password: passwordRecordSchema.nullable().catch(null),
  failures: z.number().int().min(0).max(1_000_000).catch(0),
  retryAt: z.number().int().min(0).nullable().catch(null),
  locked: z.boolean().catch(false),
})

export interface LockStore {
  read(): Promise<LockData>
  write(data: LockData): Promise<void>
}

export function createFileLockStore({ dir }: { dir: string }): LockStore {
  const file = join(dir, LOCK_FILE)
  return {
    async read() {
      let raw: string
      try {
        raw = await readFile(file, 'utf8')
      } catch {
        return { ...EMPTY_LOCK_DATA }
      }
      try {
        const parsed = fileSchema.safeParse(JSON.parse(raw))
        if (parsed.success) return { password: parsed.data.password, failures: parsed.data.failures, retryAt: parsed.data.retryAt, locked: parsed.data.locked }
      } catch {
        // JSON quebrado: cai no aviso abaixo.
      }
      // Nada do conteúdo vai para o log.
      console.warn(`[lock] ${LOCK_FILE} inválido; vale como sem senha`)
      return { ...EMPTY_LOCK_DATA }
    },
    async write(data) {
      const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
      await writeFile(temp, `${JSON.stringify({ version: LOCK_VERSION, ...data }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      // `mode` só vale na criação e passa pela umask: o 0600 é garantido aqui.
      await chmod(temp, 0o600)
      await rename(temp, file)
    },
  }
}
