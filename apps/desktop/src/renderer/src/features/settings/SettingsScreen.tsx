import { LANGUAGE_CODES, type ClaudeModel, type LanguageCode, type ThemeSetting, type TranslationEngine } from '@shared/settings-defaults'
import { useSettings } from '../../app/settingsStore'
import { Select } from '../../design/Field'
import { PageHeader } from '../../design/PageHeader'
import { Section } from '../../design/Section'
import { Segmented } from '../../design/Segmented'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { ApiKeyField } from './ApiKeyField'
import { BrandSection } from './BrandSection'
import { useAudioInputs } from './audioInputs'
import { ClaudeCliField } from './ClaudeCliField'
import { MeetingFilesSection } from './MeetingFilesSection'
import { micOptions, SYSTEM_DEFAULT } from './micOptions'
import { ModelPicker } from './ModelPicker'

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  pt: 'Português',
  en: 'Inglês',
  es: 'Espanhol',
  ja: 'Japonês',
  ko: 'Coreano',
  zh: 'Chinês',
}

const LANGUAGE_OPTIONS = LANGUAGE_CODES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] }))

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
]

const ENGINES: { value: TranslationEngine; label: string }[] = [
  { value: 'assemblyai', label: 'AssemblyAI' },
  { value: 'claude-cli', label: 'Claude CLI' },
]

const CLAUDE_MODELS: { value: ClaudeModel; label: string }[] = [
  { value: 'haiku', label: 'Haiku (mais rápido)' },
  { value: 'sonnet', label: 'Sonnet' },
]

/**
 * Configurações: coluna única de até 680 px. O título fica fora da área que rola, então a rolagem começa
 * abaixo da faixa arrastável de 52 px e nenhum controle passa por baixo dela. Cada mudança grava na hora.
 */
export function SettingsScreen() {
  const settings = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  const devices = useAudioInputs()
  const mics = micOptions(devices, settings.micDeviceId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-10 pt-7">
        <PageHeader title="Configurações" />
      </div>
      <div data-settings-scroll className="min-h-0 flex-1 overflow-y-auto px-10 pt-10 pb-12">
        <div className="flex w-full max-w-[680px] flex-col gap-10">
          <BrandSection />

          <Section title="Transcrição">
            <ApiKeyField />
          </Section>

          <Section title="Áudio">
            <SettingRow name="Microfone" description="Usado para a sua voz." htmlFor="settings-mic">
              <Select id="settings-mic" value={settings.micDeviceId ?? SYSTEM_DEFAULT} options={mics} onChange={(value) => void update({ micDeviceId: value === SYSTEM_DEFAULT ? null : value })} />
            </SettingRow>
            <SettingRow
              name="Cancelamento de eco"
              nameId="settings-echo"
              description="Ligue se usar alto-falante em vez de fone, para a fala dos participantes não entrar pelo seu microfone."
            >
              <Switch checked={settings.echoCancellation} labelledBy="settings-echo" onChange={(echoCancellation) => void update({ echoCancellation })} />
            </SettingRow>
            <SettingRow
              name="Remover eco do alto-falante"
              nameId="settings-remove-echo"
              description="Some com a fala dos participantes que vaza para o seu microfone quando você não usa fone."
            >
              <Switch checked={settings.removeEcho} labelledBy="settings-remove-echo" onChange={(removeEcho) => void update({ removeEcho })} />
            </SettingRow>
            <SettingRow
              name="Identificar quem fala"
              nameId="settings-identify-speakers"
              description="Separa os participantes por voz. Mais lento; desligado, as falas se dividem pelas pausas."
            >
              <Switch checked={settings.identifySpeakers} labelledBy="settings-identify-speakers" onChange={(identifySpeakers) => void update({ identifySpeakers })} />
            </SettingRow>
          </Section>

          <MeetingFilesSection />

          <Section title="Idiomas">
            <SettingRow name="Idioma falado" description="O idioma da reunião." htmlFor="settings-source">
              <Select id="settings-source" value={settings.sourceLanguage} options={LANGUAGE_OPTIONS} onChange={(sourceLanguage) => void update({ sourceLanguage })} />
            </SettingRow>
            <SettingRow name="Traduzir ao vivo" nameId="settings-translate" description="A tradução aparece abaixo de cada fala.">
              <Switch checked={settings.translationEnabled} labelledBy="settings-translate" onChange={(translationEnabled) => void update({ translationEnabled })} />
            </SettingRow>
            <SettingRow name="Traduzir para" htmlFor="settings-target">
              <Select id="settings-target" value={settings.targetLanguage} options={LANGUAGE_OPTIONS} onChange={(targetLanguage) => void update({ targetLanguage })} />
            </SettingRow>
          </Section>

          <Section title="Modelo de tradução">
            <SettingRow name="Traduzir com" nameId="settings-engine" description="O Claude CLI usa o claude instalado neste Mac, com a sua conta.">
              <Segmented
                value={settings.translationEngine}
                options={ENGINES}
                labelledBy="settings-engine"
                dataName="engine-option"
                onChange={(translationEngine) => void update({ translationEngine })}
              />
            </SettingRow>
            {settings.translationEngine === 'claude-cli' ? (
              <>
                <ClaudeCliField />
                <SettingRow name="Modelo" nameId="settings-claude-model">
                  <Segmented
                    value={settings.claudeModel}
                    options={CLAUDE_MODELS}
                    labelledBy="settings-claude-model"
                    dataName="claude-model-option"
                    onChange={(claudeModel) => void update({ claudeModel })}
                  />
                </SettingRow>
              </>
            ) : (
              <div className="mt-4">
                <ModelPicker />
              </div>
            )}
            <SettingRow name="Resumir ao encerrar" nameId="settings-summarize" description="Ao encerrar, o Claude lê a transcrição e escreve o resumo, as decisões e as tarefas.">
              <Switch checked={settings.summarizeOnStop} labelledBy="settings-summarize" onChange={(summarizeOnStop) => void update({ summarizeOnStop })} />
            </SettingRow>
            {/* O resumo usa o `claude` mesmo com a tradução pela AssemblyAI: o estado e o caminho dele ficam à mão. */}
            {settings.translationEngine !== 'claude-cli' && settings.summarizeOnStop && <ClaudeCliField />}
          </Section>

          <Section title="Aparência">
            <SettingRow name="Tema" nameId="settings-theme">
              <Segmented value={settings.theme} options={THEMES} labelledBy="settings-theme" dataName="theme-option" onChange={(theme) => void update({ theme })} />
            </SettingRow>
          </Section>
        </div>
      </div>
    </div>
  )
}
