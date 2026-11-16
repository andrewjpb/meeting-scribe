import { ImagePlus } from 'lucide-react'
import { useState } from 'react'
import { BRAND_LOGO_INVALID_MESSAGE, BRAND_TEXT_MAX, DEFAULT_BRAND_NAME } from '@shared/branding'
import type { SettingsPatch } from '@shared/settings-defaults'
import { useBranding } from '../../app/brandingStore'
import { useSettings } from '../../app/settingsStore'
import { BrandLogo } from '../../design/BrandLogo'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { brandFieldValue, brandNameChange, brandSubtitleChange, subtitleFieldValue } from './brandFields'

interface BrandTextRowProps {
  id: string
  name: string
  placeholder: string
  saved: string | null
  change: (draft: string, saved: string | null) => string | null | undefined
  patch: (value: string | null) => SettingsPatch
  /** Texto que o campo mostra para o valor gravado (padrão: o gravado, ou vazio). */
  shown?: (saved: string | null) => string
}

/**
 * Campo de texto que grava ao sair dele ou no Enter; recusado pelo main, volta ao texto gravado. Quem usa
 * passa `key` com o valor gravado: gravado em outra janela, o campo recomeça com o texto novo.
 */
function BrandTextRow({ id, name, placeholder, saved, change, patch, shown = brandFieldValue }: BrandTextRowProps) {
  const update = useSettings((state) => state.update)
  const [draft, setDraft] = useState(shown(saved))

  const commit = (): void => {
    const next = change(draft, saved)
    if (next === undefined) {
      setDraft(shown(saved))
      return
    }
    void update(patch(next)).then((ok) => setDraft(shown(ok ? next : saved)))
  }

  return (
    <SettingRow name={name} htmlFor={id}>
      <TextField id={id} value={draft} onChange={setDraft} onEnter={commit} onBlur={commit} placeholder={placeholder} maxLength={BRAND_TEXT_MAX} />
    </SettingRow>
  )
}

/**
 * "Marca" (contrato 09): nome, subtítulo e logo do app. O logo só muda pelo diálogo nativo do main
 * ("Escolher imagem…"), que confere a imagem e a guarda; a tela recebe só a data URL.
 */
export function BrandSection() {
  const brandName = useSettings((state) => state.settings.brandName)
  const brandSubtitle = useSettings((state) => state.settings.brandSubtitle)
  const brandLogo = useSettings((state) => state.settings.brandLogo)
  const logoDataUrl = useBranding((state) => state.branding.logoDataUrl)
  const [busy, setBusy] = useState(false)
  const [invalid, setInvalid] = useState(false)

  const choose = (): void => {
    if (busy) return
    setBusy(true)
    window.__scribeApi
      .invoke('scribe:brand-logo-choose')
      .then(
        ({ result, branding, settings }) => {
          setInvalid(result === 'invalid')
          if (result === 'chosen') {
            useSettings.setState({ settings, loaded: true })
            useBranding.setState({ branding })
          }
        },
        () => setInvalid(true),
      )
      .finally(() => setBusy(false))
  }

  const reset = (): void => {
    if (busy) return
    setBusy(true)
    setInvalid(false)
    window.__scribeApi
      .invoke('scribe:brand-logo-reset')
      .then(
        ({ branding, settings }) => {
          useSettings.setState({ settings, loaded: true })
          useBranding.setState({ branding })
        },
        () => undefined,
      )
      .finally(() => setBusy(false))
  }

  return (
    <Section title="Marca">
      <p className="text-12 text-text-muted">Aparece na barra lateral, no título da janela e no ícone do Dock. O nome no Finder e na pasta Aplicativos não muda.</p>
      <BrandTextRow
        key={`nome:${brandName ?? ''}:${brandName === null}`}
        id="brand-name"
        name="Nome do app"
        placeholder={DEFAULT_BRAND_NAME}
        saved={brandName}
        change={brandNameChange}
        patch={(value) => ({ brandName: value })}
      />
      <BrandTextRow
        key={`subtitulo:${brandSubtitle ?? ''}:${brandSubtitle === null}`}
        id="brand-subtitle"
        name="Subtítulo"
        // O campo já mostra "LAP Software" quando é o padrão; vazio quer dizer sem subtítulo.
        placeholder="Sem subtítulo"
        saved={brandSubtitle}
        shown={subtitleFieldValue}
        change={brandSubtitleChange}
        patch={(value) => ({ brandSubtitle: value })}
      />
      <SettingRow name="Logo">
        <div className="flex flex-wrap items-center gap-2">
          <span data-brand-logo-preview className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-side-bg">
            <BrandLogo dataUrl={logoDataUrl} />
          </span>
          <Button action="choose-brand-logo" variant="secondary" icon={ImagePlus} onClick={choose} disabled={busy}>
            Escolher imagem…
          </Button>
          {brandLogo !== null && (
            <Button action="reset-brand-logo" variant="secondary" onClick={reset} disabled={busy}>
              Usar o logo da LAP
            </Button>
          )}
        </div>
      </SettingRow>
      {invalid && (
        <p data-brand-logo-invalid role="alert" className="py-2 text-12 font-medium text-rec">
          {BRAND_LOGO_INVALID_MESSAGE}
        </p>
      )}
    </Section>
  )
}
