// Etiquetas da barra de controles: par de idiomas e id curto do modelo de tradução.
import { effectiveTranslationModel, type AppSettings } from '@shared/settings-defaults'

type LabelSettings = Pick<AppSettings, 'sourceLanguage' | 'targetLanguage' | 'translationEnabled' | 'translationModel' | 'translationEngine' | 'claudeModel'>

/** `PT → EN`; sem tradução, só o idioma de origem. */
export function languagePairLabel(settings: LabelSettings): string {
  const source = settings.sourceLanguage.toUpperCase()
  return settings.translationEnabled ? `${source} → ${settings.targetLanguage.toUpperCase()}` : source
}

/**
 * Id sem o prefixo do provedor (`anthropic/claude-x` -> `claude-x`); com o Claude CLI, `claude-cli:haiku`;
 * sem tradução, nenhum.
 */
export function modelLabel(settings: LabelSettings): string | null {
  if (!settings.translationEnabled) return null
  const model = effectiveTranslationModel(settings)
  return model.split('/').pop() ?? model
}
