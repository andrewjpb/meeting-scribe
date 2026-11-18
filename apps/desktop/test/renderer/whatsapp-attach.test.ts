// A prévia do anexo no renderer (contrato 39): de vários arquivos soltos fica o primeiro aceito pelos bytes (a extensão
// não conta), a recusa do primeiro quando nenhum serve, a prévia presa à conversa em que foi montada (trocar de
// conversa a descarta) e o arrasto que só conta com arquivos.
import { describe, expect, it } from 'vitest'
import { attachErrorText, WHATSAPP_ATTACH_IMAGE_MAX, WHATSAPP_ATTACH_VIDEO_MAX } from '@shared/whatsapp-attach'
import { carriesFiles, chooseDropped, previewFor, type AttachPreview } from '../../src/renderer/src/features/whatsapp/attach'

const head = (bytes: number[]): Uint8Array => {
  const out = new Uint8Array(32)
  out.set(bytes)
  return out
}
const PNG = head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = head([0xff, 0xd8, 0xff, 0xe0])
const MP4 = head([0, 0, 0, 0x18, ...[...'ftypmp42'].map((char) => char.charCodeAt(0))])
const TEXT = new TextEncoder().encode('não sou imagem nenhuma, só texto')

describe('soltar arquivos: o primeiro aceito (CA1)', () => {
  it('pula o que não é imagem nem vídeo e fica com o primeiro válido', () => {
    expect(chooseDropped([{ size: 40, head: TEXT }, { size: 100, head: JPEG }, { size: 100, head: PNG }])).toEqual({ ok: true, index: 1, mime: 'image/jpeg', kind: 'image' })
    expect(chooseDropped([{ size: 100, head: MP4 }])).toEqual({ ok: true, index: 0, mime: 'video/mp4', kind: 'video' })
    // A imagem grande demais é pulada; o vídeo do mesmo tamanho passa.
    expect(chooseDropped([{ size: WHATSAPP_ATTACH_IMAGE_MAX + 1, head: PNG }, { size: WHATSAPP_ATTACH_IMAGE_MAX + 1, head: MP4 }])).toMatchObject({ ok: true, index: 1 })
  })

  it('nenhum serve: a recusa do primeiro; sem arquivos, nada', () => {
    expect(chooseDropped([{ size: 40, head: TEXT }, { size: WHATSAPP_ATTACH_VIDEO_MAX + 1, head: MP4 }])).toEqual({ ok: false, error: 'type' })
    expect(chooseDropped([{ size: WHATSAPP_ATTACH_VIDEO_MAX + 1, head: MP4 }])).toEqual({ ok: false, error: 'too-big', kind: 'video' })
    expect(chooseDropped([{ size: 0, head: PNG }])).toEqual({ ok: false, error: 'type' })
    expect(chooseDropped([])).toBeNull()
  })

  it('as mensagens de recusa dizem o tipo e o limite', () => {
    expect(attachErrorText('type')).toBe('Só dá para anexar imagem (JPG, PNG, WebP ou GIF) ou vídeo (MP4 ou MOV).')
    expect(attachErrorText('too-big', 'image')).toContain('16 MB')
    expect(attachErrorText('too-big', 'video')).toContain('64 MB')
  })

  it('o arrasto só conta com arquivos (texto ou link arrastado não abre a sobreposição)', () => {
    expect(carriesFiles(['Files'])).toBe(true)
    expect(carriesFiles(['text/plain', 'text/uri-list'])).toBe(false)
  })
})

describe('a prévia é da conversa em que foi montada (CA1)', () => {
  it('trocar de conversa descarta a prévia, sem enviar', () => {
    const preview: AttachPreview = { chatId: 'ana@s.whatsapp.net', name: 'foto.png', mime: 'image/png', kind: 'image', bytes: PNG, url: 'blob:x' }
    expect(previewFor(preview, 'ana@s.whatsapp.net')).toBe(preview)
    expect(previewFor(preview, 'bruno@s.whatsapp.net')).toBeNull()
    expect(previewFor(null, 'ana@s.whatsapp.net')).toBeNull()
  })
})
