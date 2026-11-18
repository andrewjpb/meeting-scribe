// Contrato 39: a lógica da prévia do anexo, sem tela. Soltar vários arquivos fica com o primeiro aceito (pelos primeiros
// bytes, não pela extensão); a prévia é de uma conversa só e some ao trocar de conversa, sem enviar nada.
import { checkAttachment, type WhatsAppAttachError, type WhatsAppAttachKind, type WhatsAppAttachMime, type WhatsAppAttachment } from '@shared/whatsapp-attach'

/** Um arquivo solto na conversa: o tamanho e o começo dele (o resto só é lido se ele for o escolhido). */
export interface DroppedFile {
  size: number
  head: Uint8Array
}

export type DropChoice = { ok: true; index: number; mime: WhatsAppAttachMime; kind: WhatsAppAttachKind } | { ok: false; error: WhatsAppAttachError; kind?: WhatsAppAttachKind | undefined }

/** O primeiro arquivo aceito; nenhum aceito, a recusa do primeiro (`null` sem arquivo nenhum). */
export function chooseDropped(files: readonly DroppedFile[]): DropChoice | null {
  let first: DropChoice | null = null
  for (const [index, file] of files.entries()) {
    const checked = checkAttachment(file.head, { size: file.size })
    if (checked.ok) return { ok: true, index, mime: checked.mime, kind: checked.kind }
    first ??= checked
  }
  return first
}

/** A prévia montada: o arquivo, a conversa dela e o object URL da miniatura (revogado ao descartar). */
export interface AttachPreview extends WhatsAppAttachment {
  chatId: string
  url: string
}

/** A prévia só vale na conversa em que foi montada. */
export const previewFor = (preview: AttachPreview | null, chatId: string): AttachPreview | null => (preview?.chatId === chatId ? preview : null)

/** Quantos arquivos soltos de uma vez são olhados (o resto é ignorado). */
export const DROP_FILES_MAX = 10

/** Arrastando arquivos (não texto nem um link de dentro da página). */
export const carriesFiles = (types: readonly string[]): boolean => types.includes('Files')
