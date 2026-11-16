// Marca do app no renderer (contrato 09): nome, subtítulo e logo (data URL) que o main devolve. Relê a
// cada mudança de nome, subtítulo ou logo nas configurações, então a barra lateral e o `document.title`
// mudam na hora, sem reiniciar.
import { useEffect } from 'react'
import { create } from 'zustand'
import { DEFAULT_BRAND_NAME, DEFAULT_BRAND_SUBTITLE, type BrandingInfo } from '@shared/branding'
import { useSettings } from './settingsStore'

interface BrandingState {
  branding: BrandingInfo
}

export const useBranding = create<BrandingState>()(() => ({
  branding: { name: DEFAULT_BRAND_NAME, subtitle: DEFAULT_BRAND_SUBTITLE, logoDataUrl: null },
}))

/** Pede a marca ao main. Falhou: fica a última que chegou (ou a padrão). */
export async function loadBranding(): Promise<void> {
  try {
    const branding = await window.__scribeApi.invoke('scribe:branding-get')
    useBranding.setState({ branding })
  } catch {
    // Mantém a marca atual; a próxima mudança gravada tenta de novo.
  }
}

/** Relê a marca quando nome, subtítulo ou logo mudam e mantém o `document.title` com o nome. */
export function useBrandingSync(): void {
  const brandName = useSettings((state) => state.settings.brandName)
  const brandSubtitle = useSettings((state) => state.settings.brandSubtitle)
  const brandLogo = useSettings((state) => state.settings.brandLogo)
  const name = useBranding((state) => state.branding.name)

  useEffect(() => {
    void loadBranding()
  }, [brandName, brandSubtitle, brandLogo])

  useEffect(() => {
    document.title = name
  }, [name])
}
