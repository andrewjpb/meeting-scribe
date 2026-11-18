import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { FOLDER_NAME_MAX, type MeetingFolder } from '@shared/meetings'
import { Icon } from '../../design/Icon'
import { INLINE_INPUT, MENU_BUTTON, MENU_ITEM, MENU_PANEL, useInlineMenu } from './menu'

interface MoveMenuProps {
  folderId: string | null
  folders: readonly MeetingFolder[]
  onMove: (folderId: string | null) => void
  /** "Nova pasta…": cria e já move a reunião para ela. */
  onMoveToNew: (name: string) => void
}

/**
 * "…" da linha (contrato 28, CA4), fora do link da linha: "Mover para…" com as pastas, "Fora de pasta" quando a
 * reunião está numa e "Nova pasta…" (campo no próprio menu: Enter cria e move, Esc cancela).
 */
export function MoveMenu({ folderId, folders, onMove, onMoveToNew }: MoveMenuProps) {
  const [mode, setMode] = useState<'idle' | 'menu' | 'new'>('idle')
  const [name, setName] = useState('')
  const { button, menu, onBlur, onKeyDown } = useInlineMenu(mode === 'menu', () => setMode((current) => (current === 'menu' ? 'idle' : current)))
  const targets = folders.filter((folder) => folder.id !== folderId)

  const move = (target: string | null): void => {
    setMode('idle')
    onMove(target)
  }
  const createAndMove = (): void => {
    const value = name.trim()
    setMode('idle')
    setName('')
    if (value) onMoveToNew(value)
  }

  return (
    <div onBlur={onBlur} onKeyDown={mode === 'menu' ? onKeyDown : undefined} className="relative shrink-0 pt-3 pr-1">
      <button
        ref={button}
        type="button"
        data-meeting-menu
        aria-label="Mais ações da reunião"
        aria-haspopup="menu"
        aria-expanded={mode === 'menu'}
        onClick={() => setMode(mode === 'idle' ? 'menu' : 'idle')}
        className={MENU_BUTTON}
      >
        <Icon icon={MoreHorizontal} />
      </button>
      {mode === 'menu' && (
        <div ref={menu} role="menu" aria-label="Mover para" className={MENU_PANEL}>
          <p aria-hidden="true" className="px-3 pt-1 pb-1.5 text-12 text-text-muted">
            Mover para…
          </p>
          {targets.map((folder) => (
            <button key={folder.id} type="button" role="menuitem" tabIndex={-1} data-move-to={folder.id} onClick={() => move(folder.id)} className={`${MENU_ITEM} text-text`}>
              <span className="truncate">{folder.name}</span>
            </button>
          ))}
          {folderId !== null && (
            <button type="button" role="menuitem" tabIndex={-1} data-move-to="none" onClick={() => move(null)} className={`${MENU_ITEM} text-text`}>
              Fora de pasta
            </button>
          )}
          <button type="button" role="menuitem" tabIndex={-1} data-action="move-new-folder" onClick={() => setMode('new')} className={`${MENU_ITEM} text-accent`}>
            Nova pasta…
          </button>
        </div>
      )}
      {mode === 'new' && (
        <div className={`${MENU_PANEL} px-2 py-2`}>
          <input
            // Campo aberto pelo próprio clique em "Nova pasta…": o foco vai para ele.
            autoFocus
            data-move-new-folder-input
            aria-label="Nome da nova pasta"
            placeholder="Nome da pasta"
            value={name}
            maxLength={FOLDER_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              setMode('idle')
              setName('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                createAndMove()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setMode('idle')
                setName('')
                button.current?.focus()
              }
            }}
            className={INLINE_INPUT}
          />
        </div>
      )}
    </div>
  )
}
