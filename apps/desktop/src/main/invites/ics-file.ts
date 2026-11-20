// Contrato 62 (convites-agenda, CA15): o `.ics` temporário do "Abrir no app de agenda" (D9, N8, N9, R8). O arquivo vai
// para `userData/tmp/invite-<16 hex aleatórios>.ics` (pasta 0700, arquivo 0600; o nome nunca vem do email) e quem
// importa é o Calendário, ou o app de agenda do Linux. Os temporários saem no início do serviço e ao sair do app.
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const INVITE_TMP_DIR = 'tmp'
const TMP_FILE = /^invite-[0-9a-f]{16}\.ics$/

/** Grava o `.ics` e devolve o caminho. */
export async function writeInviteIcs(root: string, content: string): Promise<string> {
  const dir = join(root, INVITE_TMP_DIR)
  const file = join(dir, `invite-${randomBytes(8).toString('hex')}.ics`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  try {
    await writeFile(file, content, { mode: 0o600 })
    await chmod(file, 0o600)
  } catch (error) {
    await rm(file, { force: true }).catch(() => undefined)
    throw error
  }
  return file
}

/** Apaga todo `userData/tmp/invite-*.ics`; nada mais da pasta. */
export async function cleanInviteIcs(root: string): Promise<void> {
  const dir = join(root, INVITE_TMP_DIR)
  const names = await readdir(dir).catch(() => [] as string[])
  await Promise.all(names.filter((name) => TMP_FILE.test(name)).map((name) => rm(join(dir, name), { force: true }).catch(() => undefined)))
}
