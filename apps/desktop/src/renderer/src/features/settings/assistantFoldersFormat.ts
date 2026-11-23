// Textos da Section "Pastas que o Assistente pode ler" (contrato 167). Sem DOM: testado em
// test/renderer/assistant-folders-format.test.ts.
import { ASSISTANT_FOLDERS_MAX, shortenHome, type FolderAddResult, type FolderRefusal } from '@shared/assistant-folders'

/** O aviso de cada motivo de recusa de `scribe:assistant-folder-add`. */
export const FOLDER_REFUSAL_TEXT: Readonly<Record<FolderRefusal, string>> = {
  sensivel: 'Pasta pessoal, Library ou do sistema não pode ser escolhida (muito ampla). Escolha uma pasta dentro dela.',
  oculta: 'Pastas ocultas não podem ser escolhidas.',
  repetida: 'Essa pasta já está na lista ou dentro de uma pasta da lista.',
  inexistente: 'Pasta não encontrada.',
  limite: `No máximo ${ASSISTANT_FOLDERS_MAX} pastas.`,
}

/** O aviso quando o main não abriu o diálogo (o canal rejeitou). */
export const FOLDER_ADD_FAILED_TEXT = 'Não foi possível abrir a janela de escolha de pasta.'

/** O aviso quando o main não removeu a pasta (o canal rejeitou ou devolveu `ok: false`). */
export const FOLDER_REMOVE_FAILED_TEXT = 'Não foi possível remover a pasta.'

/** Os avisos da resposta: um por motivo (na ordem em que aparecem) e, se a nova englobou outras, quantas saíram. */
export function folderAddNotices(result: Pick<FolderAddResult, 'refused' | 'replaced'>): string[] {
  const reasons = [...new Set(result.refused.map((item) => item.reason))]
  const notices = reasons.map((reason) => FOLDER_REFUSAL_TEXT[reason])
  if (result.replaced.length > 0) notices.push(`Pastas dentro dela foram substituídas: ${result.replaced.length}.`)
  return notices
}

/**
 * O caminho com a pasta pessoal encurtada (`~/Documents/…`). O renderer não sabe a pasta pessoal: no Mac ela é
 * `/Users/<nome>` (menos `/Users/Shared`, que é de todos).
 */
export function folderDisplayPath(path: string): string {
  const home = /^\/Users\/([^/]+)/.exec(path)
  if (!home || home[1] === 'Shared') return path
  return shortenHome(path, home[0])
}
