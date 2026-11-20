// Estado de tela do email que a barra lateral e a lista dividem (contrato 55): o que está sendo arrastado, o seletor
// "Mover para…" aberto e o erro do último mover (a nota acima da lista, CA10).
import { create } from 'zustand'
import type { EmailRouteFolder } from '@shared/routes'
import { folderKey, useEmail } from './emailStore'
import { moveErrorText } from './moveTargets'

export interface DragPayload {
  accountId: string
  from: EmailRouteFolder
  fromPath: string
  ids: string[]
  pop3: boolean
}

/**
 * O seletor "Mover para…" (CA7): as mensagens e, se veio de um botão, onde ele está (o seletor abre embaixo). Com
 * `choose`, o mesmo seletor só escolhe a pasta (o destino de uma regra, CA18), sem mover nada.
 */
export interface PickerRequest {
  accountId: string
  from: EmailRouteFolder
  fromPath: string
  ids: string[]
  anchor: { top: number; right: number } | null
  choose?: { title: string; current: string | null; disabled: readonly string[]; onChoose: (path: string) => void } | undefined
}

interface EmailUiState {
  drag: DragPayload | null
  picker: PickerRequest | null
  /** A nota do mover que falhou, por lista (`folderKey`). */
  moveError: { key: string; text: string } | null
  setDrag: (drag: DragPayload | null) => void
  openPicker: (request: PickerRequest) => void
  closePicker: () => void
  clearMoveError: () => void
}

export const useEmailUi = create<EmailUiState>()((set) => ({
  drag: null,
  picker: null,
  moveError: null,
  setDrag: (drag) => set({ drag }),
  openPicker: (picker) => set({ picker }),
  closePicker: () => set({ picker: null }),
  clearMoveError: () => set({ moveError: null }),
}))

/** Move e, se o servidor recusar, deixa a frase do erro acima da lista de origem. */
export async function moveMessages(accountId: string, from: EmailRouteFolder, ids: readonly string[], toPath: string): Promise<boolean> {
  const key = folderKey(accountId, from)
  useEmailUi.getState().clearMoveError()
  const result = await useEmail.getState().move(accountId, from, ids, toPath)
  if (!result.ok && result.total > 0) useEmailUi.setState({ moveError: { key, text: moveErrorText(result.error, result.moved, result.total) } })
  return result.ok
}
