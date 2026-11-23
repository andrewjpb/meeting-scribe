import { Folder, FolderOpen, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { folderLabel } from '@shared/assistant-folders'
import { ASSISTANT_FOLDERS_NAME } from '@shared/settings-index'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { FOLDER_ADD_FAILED_TEXT, FOLDER_REMOVE_FAILED_TEXT, folderAddNotices, folderDisplayPath } from './assistantFoldersFormat'

const HELP =
  'O Assistente só lê; nunca altera, move ou apaga. Pastas ocultas, a pasta pessoal inteira e as do sistema não podem ser escolhidas. Em cada conversa, ligue a fonte Pastas no painel Contexto.'

/**
 * "Pastas que o Assistente pode ler" (contrato 167, mockups 01 e 02). A lista só muda pelo main (o diálogo nativo de
 * `scribe:assistant-folder-add` e `scribe:assistant-folder-remove` com o id); a tela mostra `settings.assistant.folders`,
 * que volta pelo `scribe:settings-changed`. As recusas viram avisos abaixo do bloco, que somem ao adicionar com sucesso ou
 * ao sair da aba (`active`).
 */
export function AssistantFoldersSection({ active }: { active: boolean }) {
  const folders = useSettings((state) => state.settings.assistant.folders)
  const [adding, setAdding] = useState(false)
  const [notices, setNotices] = useState<string[]>([])

  // Saiu da aba (ou abriu a busca): os avisos somem. Ajuste no próprio render, sem efeito.
  const [wasActive, setWasActive] = useState(active)
  if (active !== wasActive) {
    setWasActive(active)
    if (!active) setNotices([])
  }

  const add = (): void => {
    setAdding(true)
    window.__scribeApi.invoke('scribe:assistant-folder-add').then(
      (result) => setNotices(folderAddNotices(result)),
      () => setNotices([FOLDER_ADD_FAILED_TEXT]),
    ).finally(() => setAdding(false))
  }
  const remove = (id: string): void => {
    window.__scribeApi.invoke('scribe:assistant-folder-remove', { id }).then(
      ({ ok }) => setNotices(ok ? [] : [FOLDER_REMOVE_FAILED_TEXT]),
      () => setNotices([FOLDER_REMOVE_FAILED_TEXT]),
    )
  }

  return (
    <div id="settings-assistant-folders" data-settings-assistant-folders className="flex flex-col gap-2">
      <Section title={ASSISTANT_FOLDERS_NAME} description={HELP}>
        {folders.length === 0 ? (
          <p className="py-3 text-13 text-text-muted">Nenhuma pasta escolhida</p>
        ) : (
          folders.map((folder) => (
            <div key={folder.id} data-assistant-folder-id={folder.id} className="flex min-h-11 items-center gap-3 py-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-text-muted">
                <Icon icon={Folder} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <p className="truncate text-13 font-medium text-text">{folderLabel(folder.path)}</p>
                <p className="truncate text-12 text-text-muted" title={folder.path}>
                  {folderDisplayPath(folder.path)}
                </p>
              </div>
              <Button variant="secondary" action="assistant-folder-remove" onClick={() => remove(folder.id)}>
                Remover
              </Button>
            </div>
          ))
        )}
        <div data-setting-row data-setting-name={ASSISTANT_FOLDERS_NAME} className="flex min-h-11 flex-wrap items-center gap-3 py-2">
          <Button variant="secondary" icon={FolderOpen} action="assistant-folder-add" data={{ 'data-assistant-folder-add': '' }} disabled={adding} onClick={add}>
            Adicionar pasta…
          </Button>
          <span className="text-12 text-text-faint">Abre a janela do Mac para escolher.</span>
        </div>
      </Section>
      {notices.length > 0 && (
        <div data-assistant-folder-refused className="flex flex-col gap-1">
          {notices.map((text) => (
            <Note key={text} id="assistant-folder-refused" icon={TriangleAlert} role="alert">
              {text}
            </Note>
          ))}
        </div>
      )}
    </div>
  )
}
