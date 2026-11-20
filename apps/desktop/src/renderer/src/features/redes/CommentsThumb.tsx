import { Image as ImageGlyph } from 'lucide-react'
import { useEffect } from 'react'
import { Icon } from '../../design/Icon'
import { useRedes } from './redesStore'

/**
 * Contrato 73: a miniatura de uma mídia com comentário, 40×40. O main baixa a imagem da Meta para `thumbs/` na
 * atualização e devolve a data URL pelo mesmo canal do 72 (`scribe:redes-media-thumb`); a tela nunca pede a URL remota (a
 * CSP recusa). Sem miniatura, o quadrado com o ícone de imagem.
 */
export function CommentsThumb({ path }: { path: string | null }) {
  const url = useRedes((state) => (path ? state.thumbs[path] : null))
  useEffect(() => {
    if (path && url === undefined) useRedes.getState().thumbnail(path)
  })
  if (url) return <img src={url} alt="" draggable={false} data-redes-comments-thumb className="size-10 shrink-0 rounded-[var(--radius-control)] object-cover" />
  return (
    <span aria-hidden="true" data-redes-comments-thumb-placeholder className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-text-muted">
      <Icon icon={ImageGlyph} />
    </span>
  )
}
