import { Film, Image as ImageGlyph } from 'lucide-react'
import { useEffect } from 'react'
import { Icon } from '../../design/Icon'
import { useRedes } from './redesStore'

/**
 * Contrato 72: a miniatura de uma mídia da fila ou do editor. Imagem: a miniatura que o main faz da cópia salva (ou do
 * arquivo escolhido no diálogo), como data URL; enquanto não chega, ou para vídeo, o ícone sobre `--bg-sunken`.
 */
export function MediaThumb({ path, kind, size, label }: { path: string; kind: 'imagem' | 'video'; size: 36 | 96; label?: string }) {
  const url = useRedes((state) => (kind === 'imagem' ? state.thumbs[path] : null))
  // Sem resposta ainda (ou depois de uma falha passageira), pede de novo; o store limita as tentativas.
  useEffect(() => {
    if (kind === 'imagem' && url === undefined) useRedes.getState().thumbnail(path)
  })
  const box = size === 36 ? 'size-9' : 'size-24'
  if (url) return <img src={url} alt={label ?? ''} draggable={false} data-redes-thumb className={`${box} shrink-0 rounded-[var(--radius-control)] object-cover`} />
  return (
    <span role={label ? 'img' : undefined} aria-label={label} data-redes-thumb-placeholder className={`${box} flex shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-text-muted`}>
      <Icon icon={kind === 'video' ? Film : ImageGlyph} />
    </span>
  )
}
