import { Film, X } from 'lucide-react'
import { mediaSizeLabel } from '@shared/whatsapp'
import { Icon } from '../../design/Icon'
import type { AttachPreview } from './attach'

/**
 * Contrato 39: a prévia do anexo acima do campo, que vira a legenda. Miniatura da imagem ou o primeiro quadro do vídeo
 * (com o selo "vídeo"), nome e tamanho, e o X que descarta. Só mostra: nada é enviado sem o clique em "Enviar".
 */
export function AttachCard({ preview, onDiscard, sending }: { preview: AttachPreview; onDiscard: () => void; sending: boolean }) {
  const video = preview.kind === 'video'
  return (
    <div data-wa-attach={preview.kind} className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-bg-sunken p-2">
      <span className="relative flex size-16 shrink-0 overflow-hidden rounded-[var(--radius-control)] border border-line bg-bg-raised">
        {video ? (
          <>
            <video data-wa-attach-thumb src={preview.url} muted playsInline preload="metadata" className="size-full object-cover" />
            <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-bg-raised px-1 text-12 text-title">
              <Icon icon={Film} size={14} />
              vídeo
            </span>
          </>
        ) : (
          <img data-wa-attach-thumb src={preview.url} alt="" className="size-full object-cover" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span data-wa-attach-name className="truncate text-13 font-medium text-title">
          {preview.name}
        </span>
        <span data-wa-attach-size className="text-12 text-text-muted tabular">
          {[video ? 'vídeo' : 'imagem', mediaSizeLabel(preview.bytes.byteLength)].filter(Boolean).join(' · ')}
        </span>
        <span className="text-12 text-text-faint">O texto abaixo vai como legenda. Esc descarta.</span>
      </span>
      <button
        type="button"
        data-action="whatsapp-attach-discard"
        aria-label="Descartar o anexo"
        title="Descartar"
        onClick={onDiscard}
        disabled={sending}
        className="no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-raised hover:text-title disabled:opacity-50"
      >
        <Icon icon={X} size={16} />
      </button>
    </div>
  )
}
