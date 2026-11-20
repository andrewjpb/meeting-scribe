import { FolderPlus, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { FOLDER_NAME_MAX, type MeetingFolder } from '@shared/meetings'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import type { FolderFilter } from './folders'
import { INLINE_INPUT, MENU_BUTTON, MENU_ITEM, MENU_PANEL, useInlineMenu } from './menu'

interface FolderBarProps {
  folders: readonly MeetingFolder[]
  counts: ReadonlyMap<string, number>
  selected: FolderFilter
  onSelect: (filter: FolderFilter) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

// Opção da barra no traço do `Segmented`: contorno --line-strong; a marcada em bloco --title.
const CHIP = 'no-drag inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-13 whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]'
const chipClass = (active: boolean): string => `${CHIP} ${active ? 'border-title bg-title font-medium text-bg' : 'border-line-strong bg-bg-raised text-text hover:bg-bg-sunken'}`

/**
 * Barra de pastas da lista (contrato 28, CA3): "Todas", uma opção por pasta com quantas reuniões tem e "Nova pasta"
 * (campo na própria barra: Enter cria, Esc cancela). A pasta selecionada ganha o "…" com "Renomear" (na própria
 * opção) e "Excluir pasta" (com confirmação; as reuniões ficam, fora de pasta).
 */
export function FolderBar({ folders, counts, selected, onSelect, onCreate, onRename, onDelete }: FolderBarProps) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [mode, setMode] = useState<'idle' | 'menu' | 'rename' | 'confirm'>('idle')
  const [renameTo, setRenameTo] = useState('')
  const { button, menu, onBlur, onKeyDown } = useInlineMenu(mode === 'menu', () => setMode((current) => (current === 'menu' ? 'idle' : current)))
  const current = folders.find((folder) => folder.id === selected) ?? null

  const create = (): void => {
    const name = newName.trim()
    setCreating(false)
    setNewName('')
    if (name) onCreate(name)
  }
  const rename = (): void => {
    const name = renameTo.trim()
    setMode('idle')
    if (current && name && name !== current.name) onRename(current.id, name)
  }
  const select = (filter: FolderFilter): void => {
    setMode('idle')
    onSelect(filter)
  }

  return (
    <div className="max-w-[820px] pb-5">
      <div data-folders role="group" aria-label="Pastas" className="flex flex-wrap items-center gap-2">
        <button type="button" data-folder="all" aria-pressed={selected === 'all'} onClick={() => select('all')} className={chipClass(selected === 'all')}>
          Todas
        </button>
        {folders.map((folder) => {
          const active = folder.id === selected
          if (active && mode === 'rename') {
            return (
              <input
                key={folder.id}
                // Campo aberto pelo próprio clique em "Renomear": o foco vai para ele.
                autoFocus
                data-folder-rename-input
                aria-label="Novo nome da pasta"
                value={renameTo}
                maxLength={FOLDER_NAME_MAX}
                onChange={(event) => setRenameTo(event.target.value)}
                onFocus={(event) => event.target.select()}
                onBlur={rename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    rename()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setMode('idle')
                  }
                }}
                className={`${INLINE_INPUT} w-48`}
              />
            )
          }
          const option = (
            <button key={folder.id} type="button" data-folder={folder.id} aria-pressed={active} onClick={() => select(folder.id)} className={chipClass(active)}>
              <span className="max-w-[220px] truncate">{folder.name}</span>
              <span className={`text-12 tabular ${active ? 'opacity-80' : 'text-text-muted'}`}>{counts.get(folder.id) ?? 0}</span>
            </button>
          )
          if (!active) return option
          return (
            <span key={folder.id} className="relative flex items-center" onBlur={onBlur} onKeyDown={onKeyDown}>
              {option}
              <button
                ref={button}
                type="button"
                data-action="folder-menu"
                aria-label="Mais ações da pasta"
                aria-haspopup="menu"
                aria-expanded={mode === 'menu'}
                onClick={() => setMode(mode === 'menu' ? 'idle' : 'menu')}
                className={MENU_BUTTON}
              >
                <Icon icon={MoreHorizontal} />
              </button>
              {mode === 'menu' && (
                <div ref={menu} role="menu" aria-label="Ações da pasta" className={MENU_PANEL}>
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    data-action="rename-folder"
                    onClick={() => {
                      setRenameTo(folder.name)
                      setMode('rename')
                    }}
                    className={`${MENU_ITEM} text-text`}
                  >
                    Renomear
                  </button>
                  <button type="button" role="menuitem" tabIndex={-1} data-action="delete-folder" onClick={() => setMode('confirm')} className={`${MENU_ITEM} text-rec`}>
                    Excluir pasta
                  </button>
                </div>
              )}
            </span>
          )
        })}
        {creating ? (
          <input
            // Campo aberto pelo próprio clique em "Nova pasta": o foco vai para ele.
            autoFocus
            data-new-folder-input
            aria-label="Nome da nova pasta"
            placeholder="Nome da pasta"
            value={newName}
            maxLength={FOLDER_NAME_MAX}
            onChange={(event) => setNewName(event.target.value)}
            onBlur={() => {
              setCreating(false)
              setNewName('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                create()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setCreating(false)
                setNewName('')
              }
            }}
            className={`${INLINE_INPUT} w-48`}
          />
        ) : (
          <button
            type="button"
            data-action="new-folder"
            onClick={() => setCreating(true)}
            className="no-drag inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-13 font-medium text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken"
          >
            <Icon icon={FolderPlus} size={14} />
            Nova pasta
          </button>
        )}
      </div>
      {mode === 'confirm' && current && (
        <div data-folder-confirm className="mt-3 flex flex-wrap items-center gap-3 border-l-2 border-line-strong pl-3">
          <p className="text-13 text-text">
            Excluir a pasta "{current.name}"? As reuniões dela continuam na lista, só saem da pasta.
          </p>
          <div className="flex gap-2">
            <Button
              action="confirm-delete-folder"
              variant="danger"
              onClick={() => {
                setMode('idle')
                onDelete(current.id)
              }}
            >
              Excluir pasta
            </Button>
            <Button action="cancel-delete-folder" variant="secondary" onClick={() => setMode('idle')}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
