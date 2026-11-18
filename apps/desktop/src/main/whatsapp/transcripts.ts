// Transcrições dos áudios do WhatsApp (contrato 37), guardadas em `userData/whatsapp/transcripts.json` para não
// transcrever (nem mandar à AssemblyAI) o mesmo áudio duas vezes. Uma entrada por mensagem (`<conversa>\n<id>`), até
// 500, as mais novas ficam. Escrita atômica, 0600; o arquivo é lido com zod e, estragado, é descartado. Sai no
// "Remover" e no "Sair da conta", junto com as mensagens de que veio.
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { WHATSAPP_TRANSCRIPT_MAX } from '../../shared/whatsapp'
import { WHATSAPP_PATHS } from './install'

export const TRANSCRIPTS_FILE = WHATSAPP_PATHS.transcripts
export const TRANSCRIPTS_MAX = 500

const fileSchema = z.record(z.string().max(500), z.object({ at: z.number().int().nonnegative(), text: z.string().max(WHATSAPP_TRANSCRIPT_MAX) }))
type TranscriptsFile = z.infer<typeof fileSchema>

export interface TranscriptsCache {
  get(chatId: string, messageId: string): Promise<string | null>
  /** Guarda o texto (cortado em 20 000 caracteres) e devolve o que ficou guardado. */
  set(chatId: string, messageId: string, text: string): Promise<string>
  /** O arquivo foi apagado ("Sair da conta", "Remover"): esquece o que estava lido. */
  forget(): void
}

const keyOf = (chatId: string, messageId: string): string => `${chatId}\n${messageId}`

/** O texto como fica guardado: sem espaço nas pontas e até 20 000 caracteres. */
export const clipTranscript = (text: string): string => text.trim().slice(0, WHATSAPP_TRANSCRIPT_MAX)

export function createTranscriptsCache(file: string, now: () => number = Date.now): TranscriptsCache {
  /** O arquivo lido uma vez; cada "Transcrever" atualiza a cópia junto com o disco. */
  let loaded: TranscriptsFile | null = null
  async function read(): Promise<TranscriptsFile> {
    if (loaded) return loaded
    try {
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
      loaded = parsed.success ? parsed.data : {}
    } catch {
      loaded = {}
    }
    return loaded
  }

  // Uma gravação de cada vez: duas transcrições terminando juntas não se apagam.
  let queue: Promise<unknown> = Promise.resolve()

  return {
    async get(chatId, messageId) {
      return (await read())[keyOf(chatId, messageId)]?.text ?? null
    },

    set(chatId, messageId, text) {
      const clipped = clipTranscript(text)
      const task = queue.then(async () => {
        const all = { ...(await read()), [keyOf(chatId, messageId)]: { at: now(), text: clipped } }
        const kept = Object.fromEntries(
          Object.entries(all)
            .sort(([, a], [, b]) => b.at - a.at)
            .slice(0, TRANSCRIPTS_MAX),
        )
        await mkdir(dirname(file), { recursive: true, mode: 0o700 })
        const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
        await writeFile(temp, `${JSON.stringify(kept)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temp, file)
        await chmod(file, 0o600)
        loaded = kept
        return clipped
      })
      queue = task.catch(() => undefined)
      return task
    },

    forget() {
      loaded = null
    },
  }
}
