// Contrato 111 (R38): a proposta de IA de cada reunião em `meetings/<id>.funil.json`, ao lado do resumo, no padrão de
// `meetings/summaries.ts`: gravação atômica (temporário + `rename`, `0o600`) em fila; arquivo inválido ao ler (ou de
// outra reunião) vale como "sem proposta". Apagado junto com a reunião (quem chama é o 113).
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FunilPropostaArquivo } from '../../shared/funil-proposta'
import { funilPropostaArquivoSchema } from '../../shared/funil-proposta-schema'

export const FUNIL_PROPOSTA_SUFFIX = '.funil.json'

export interface FunilProposalStore {
  get(meetingId: string): Promise<FunilPropostaArquivo | null>
  save(arquivo: FunilPropostaArquivo): Promise<void>
  remove(meetingId: string): Promise<void>
}

/** Mesma regra de id da transcrição e do resumo: nada de barra, ponto ou caminho relativo. */
export function funilPropostaPath(meetingsDir: string, meetingId: string): string | null {
  return meetingId.length > 0 && meetingId.length <= 200 && /^[\w-]+$/.test(meetingId) ? join(meetingsDir, `${meetingId}${FUNIL_PROPOSTA_SUFFIX}`) : null
}

/** `meetingsDir`: a pasta `userData/meetings`. */
export function createFunilProposalStore({ meetingsDir }: { meetingsDir: string }): FunilProposalStore {
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  return {
    save: (arquivo) =>
      serial(async () => {
        const data = funilPropostaArquivoSchema.parse(arquivo)
        const file = funilPropostaPath(meetingsDir, data.meetingId)
        if (!file) throw new Error('id de reunião inválido')
        await mkdir(meetingsDir, { recursive: true })
        const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
        await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temp, file)
      }),

    get: (meetingId) =>
      serial(async () => {
        const file = funilPropostaPath(meetingsDir, meetingId)
        if (!file) return null
        let raw: string
        try {
          raw = await readFile(file, 'utf8')
        } catch {
          return null
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = undefined
        }
        const result = funilPropostaArquivoSchema.safeParse(parsed)
        // Proposta de outra reunião copiada por cima também não vale.
        if (!result.success || result.data.meetingId !== meetingId) {
          console.warn(`[funil] ${file} inválido; a reunião fica sem proposta`)
          return null
        }
        return result.data
      }),

    remove: (meetingId) =>
      serial(async () => {
        const file = funilPropostaPath(meetingsDir, meetingId)
        if (file) await rm(file, { force: true })
      }),
  }
}
