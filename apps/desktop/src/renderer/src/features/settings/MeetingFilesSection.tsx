import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AudioFolderInfo } from '@shared/meeting-files'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'

/**
 * "Arquivos da reunião" (contrato 07): ligado por padrão, grava o áudio e a transcrição de cada reunião
 * numa pasta do Mac. A pasta só muda pelo diálogo nativo do main ("Escolher pasta…"); a tela mostra o
 * caminho que o main devolve, encurtado com `~`.
 */
export function MeetingFilesSection() {
  const saveToFolder = useSettings((state) => state.settings.saveToFolder)
  const audioFolder = useSettings((state) => state.settings.audioFolder)
  const update = useSettings((state) => state.update)
  const [folder, setFolder] = useState<AudioFolderInfo | null>(null)

  // Relê sempre que a pasta gravada muda (inclusive escolhida em outra janela).
  useEffect(() => {
    let alive = true
    window.__scribeApi.invoke('scribe:audio-folder').then(
      (info) => {
        if (alive) setFolder(info)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [audioFolder])

  const choose = (): void => {
    window.__scribeApi.invoke('scribe:audio-folder-choose').then(
      ({ chosen, folder: next, settings }) => {
        setFolder(next)
        if (chosen) useSettings.setState({ settings, loaded: true })
      },
      () => undefined,
    )
  }

  return (
    <Section title="Arquivos da reunião">
      <SettingRow
        name="Salvar áudio e transcrição numa pasta"
        nameId="settings-save-folder"
        description="Para cada reunião: um arquivo de áudio (você e os participantes) e a transcrição em texto. Avise as pessoas antes de gravar."
      >
        <Switch checked={saveToFolder} labelledBy="settings-save-folder" onChange={(value) => void update({ saveToFolder: value })} />
      </SettingRow>
      {saveToFolder && (
        <SettingRow name="Pasta" description={folder?.display ?? ' '}>
          <Button action="choose-folder" variant="secondary" icon={FolderOpen} onClick={choose}>
            Escolher pasta…
          </Button>
        </SettingRow>
      )}
    </Section>
  )
}
