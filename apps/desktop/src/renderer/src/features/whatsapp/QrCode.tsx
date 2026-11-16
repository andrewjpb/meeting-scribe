import { useMemo } from 'react'
import { encodeQr } from './qr'

/**
 * QR code do pareamento (contrato 24, CA2), desenhado pelo app a partir do texto do serviço: um caminho SVG só,
 * escuro sobre branco nos dois temas (`--qr-dark`, `--qr-light`), com a margem de 4 módulos que a norma pede.
 */
export function QrCode({ text, size = 232 }: { text: string; size?: number }) {
  const { path, modules } = useMemo(() => {
    const matrix = encodeQr(text, 'M')
    let d = ''
    matrix.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`
      }),
    )
    return { path: d, modules: matrix.length }
  }, [text])
  const box = modules + 8
  return (
    <svg data-whatsapp-qr data-qr-modules={modules} role="img" aria-label="QR code para conectar o WhatsApp" width={size} height={size} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" className="shrink-0">
      <rect width={box} height={box} fill="var(--qr-light)" />
      <path d={path} fill="var(--qr-dark)" />
    </svg>
  )
}
