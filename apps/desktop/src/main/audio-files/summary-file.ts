// Resumo na pasta da reunião (contrato 08, CA8): `<mesmo nome> - resumo.md`, ao lado do áudio e da
// transcrição que o contrato 07 escreveu. Só com "Salvar áudio e transcrição numa pasta" ligado e a
// reunião com arquivo na pasta. Escrita em `.part` (`wx`, não segue link plantado) e `rename` por cima:
// gerar de novo substitui o arquivo. Nunca escreve fora da pasta do arquivo da reunião.
import { rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { Meeting } from '../../shared/meetings'
import { summaryMarkdown, type MeetingSummary } from '../../shared/meeting-summary'
import { insideFolder, PART_SUFFIX } from './names'

export const SUMMARY_FILE_SUFFIX = ' - resumo.md'

/** Nome do áudio ou da transcrição da reunião sem a extensão: `2026-11-15 14h05 - Planejamento`. */
const FILE_PATTERN = /^(.+)\.(m4a|webm|md)$/i

/** Pasta e nome do resumo, a partir do arquivo que a reunião já tem na pasta; `null` sem arquivo. */
export function summaryFileTarget(meeting: Pick<Meeting, 'audioPath' | 'transcriptPath'>): { folder: string; name: string } | null {
  for (const path of [meeting.audioPath, meeting.transcriptPath]) {
    const match = path ? FILE_PATTERN.exec(basename(path)) : null
    if (path && match?.[1]) return { folder: dirname(path), name: `${match[1]}${SUMMARY_FILE_SUFFIX}` }
  }
  return null
}

/**
 * Escreve o resumo na pasta da reunião. Devolve o caminho escrito, ou `null` quando não há pasta (opção
 * desligada ou reunião sem arquivo) ou a escrita falhou; nunca rejeita.
 */
export async function writeSummaryFile(meeting: Meeting, summary: MeetingSummary, saveToFolder: boolean): Promise<string | null> {
  if (!saveToFolder) return null
  const target = summaryFileTarget(meeting)
  if (!target) return null
  let temp: string | null = null
  try {
    const path = insideFolder(target.folder, target.name)
    temp = insideFolder(target.folder, `${target.name}${PART_SUFFIX}`)
    // Um `.part` velho (app fechado no meio de uma escrita) impediria o `wx`.
    await rm(temp, { force: true })
    await writeFile(temp, summaryMarkdown(meeting, summary), { encoding: 'utf8', flag: 'wx' })
    await rename(temp, path)
    return path
  } catch {
    if (temp) await rm(temp, { force: true }).catch(() => undefined)
    return null
  }
}
