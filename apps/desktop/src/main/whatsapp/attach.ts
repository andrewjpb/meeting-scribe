// Contrato 39: o arquivo escolhido pelo clipe do campo do WhatsApp. O main lê do disco só o que a pessoa escolheu no
// seletor do macOS, recusa pelo tamanho (o limite do tipo) antes de ler tudo e confere o tipo pelos primeiros bytes; a
// extensão não conta. Nada é enviado daqui: o arquivo volta para a prévia da tela.
import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { attachKind, attachName, checkAttachment, sniffAttachment, WHATSAPP_ATTACH_HEAD, type WhatsAppAttachPickResult } from '../../shared/whatsapp-attach'

export async function readAttachment(path: string): Promise<WhatsAppAttachPickResult> {
  const info = await stat(path)
  if (!info.isFile() || info.size <= 0) return { ok: false, error: 'type' }
  const handle = await open(path, 'r')
  try {
    const head = new Uint8Array(WHATSAPP_ATTACH_HEAD)
    const { bytesRead } = await handle.read(head, 0, head.byteLength, 0)
    const checked = checkAttachment(head.subarray(0, bytesRead), { size: info.size })
    if (!checked.ok) return checked
    const bytes = new Uint8Array(info.size)
    const { bytesRead: total } = await handle.read(bytes, 0, info.size, 0)
    // O arquivo mudou entre a conferência e a leitura: recusa em vez de mandar outra coisa para a prévia.
    if (total !== info.size || sniffAttachment(bytes) !== checked.mime) return { ok: false, error: 'type' }
    return { ok: true, attachment: { name: attachName(basename(path)), mime: checked.mime, kind: attachKind(checked.mime), bytes } }
  } finally {
    await handle.close()
  }
}
