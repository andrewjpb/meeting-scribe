import { useEffect, useState } from 'react'
import type { MeetingFolder } from '@shared/meetings'
import { rereadWhenUnlocked } from '../../app/lockStore'

export interface MeetingFoldersView {
  folders: MeetingFolder[]
  /** A pasta criada, ou `null` (nome vazio ou falha). */
  create: (name: string) => Promise<MeetingFolder | null>
  rename: (id: string, name: string) => Promise<MeetingFolder | null>
  remove: (id: string) => Promise<boolean>
}

/** Pastas de reuniões (contrato 28), lidas do main ao abrir a lista; cada mudança atualiza o estado na hora. */
export function useMeetingFolders(): MeetingFoldersView {
  const [folders, setFolders] = useState<MeetingFolder[]>([])

  useEffect(() => {
    let alive = true
    let reread: (() => void) | null = null
    const read = (): void => {
      window.__scribeApi.invoke('scribe:folders-list').then(
        (list) => {
          if (alive) setFolders(list)
        },
        (error: unknown) => {
          // Bloqueado (contrato 22): lê de novo ao desbloquear; outra falha deixa a barra só com "Todas".
          if (alive) reread = rereadWhenUnlocked(error, read)
        },
      )
    }
    read()
    return () => {
      alive = false
      reread?.()
    }
  }, [])

  const create = async (name: string): Promise<MeetingFolder | null> => {
    const folder = await window.__scribeApi.invoke('scribe:folders-create', { name }).catch(() => null)
    if (folder) setFolders((current) => [...current, folder])
    return folder
  }

  const rename = async (id: string, name: string): Promise<MeetingFolder | null> => {
    const folder = await window.__scribeApi.invoke('scribe:folders-rename', { id, name }).catch(() => null)
    if (folder) setFolders((current) => current.map((item) => (item.id === folder.id ? folder : item)))
    return folder
  }

  const remove = async (id: string): Promise<boolean> => {
    const removed = await window.__scribeApi.invoke('scribe:folders-delete', { id }).catch(() => false)
    if (removed) setFolders((current) => current.filter((item) => item.id !== id))
    return removed
  }

  return { folders, create, rename, remove }
}
