// Contrato 43: os arquivos escolhidos pelo clipe do composer do email. O main lê do disco só o que a pessoa escolheu no
// seletor do macOS e recusa pelo tamanho antes de ler (o limite vale para a soma). Nada é enviado daqui: os arquivos
// voltam para a lista de anexos do composer, e saem só no clique em "Enviar".
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { EMAIL_ATTACH_MAX_BYTES, EMAIL_ATTACH_MAX_FILES, EMAIL_ATTACH_NAME_MAX, type EmailAttachPickResult } from '../../shared/email'

/** Nome do anexo: o do arquivo, sem caractere de controle e no limite (a extensão fica). */
export function attachmentName(path: string): string {
  const name = [...basename(path)].filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f).join('') || 'anexo'
  if (name.length <= EMAIL_ATTACH_NAME_MAX) return name
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : ''
  return `${name.slice(0, EMAIL_ATTACH_NAME_MAX - extension.length)}${extension}`
}

/** Lê os arquivos escolhidos; `already` é o que o composer já tem anexado (o limite vale para tudo junto). */
export async function readEmailAttachments(paths: readonly string[], already = 0): Promise<EmailAttachPickResult> {
  const chosen = paths.slice(0, EMAIL_ATTACH_MAX_FILES)
  const infos = await Promise.all(chosen.map((path) => stat(path)))
  if (infos.some((info) => !info.isFile())) return { ok: false, error: 'unreadable' }
  const total = infos.reduce((sum, info) => sum + info.size, already)
  if (total > EMAIL_ATTACH_MAX_BYTES) return { ok: false, error: 'too-big' }
  const attachments = await Promise.all(chosen.map(async (path) => ({ name: attachmentName(path), bytes: new Uint8Array(await readFile(path)) })))
  return { ok: true, attachments }
}
