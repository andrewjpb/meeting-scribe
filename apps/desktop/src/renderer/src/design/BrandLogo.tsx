import { LapSymbol } from './LapSymbol'

/**
 * Logo do app (contrato 09): o logo próprio escolhido em Configurações, recebido do main como data URL
 * PNG, ou o símbolo da LAP. 28 px por padrão, como no topo da barra lateral.
 */
export function BrandLogo({ dataUrl, size = 28 }: { dataUrl: string | null; size?: number }) {
  if (!dataUrl) return <LapSymbol size={size} />
  return (
    <img
      src={dataUrl}
      alt="Logo"
      width={size}
      height={size}
      draggable={false}
      data-brand-logo
      className="block shrink-0 rounded-[var(--radius-control)] object-contain"
      style={{ width: size, height: size }}
    />
  )
}
