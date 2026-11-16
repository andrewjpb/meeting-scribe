// Atualização pelo GitHub Releases (contrato 14). Sem conta de desenvolvedor Apple o app não se substitui
// sozinho: o main avisa, baixa o `.dmg`, confere o SHA-256 e abre; a pessoa arrasta para Aplicativos.

/** Nome do `.dmg` publicado no release (o mesmo que `scripts/pack.sh` gera). */
export function updateAssetName(version: string): string {
  return `LAP-Reunioes-${version}-arm64.dmg`
}

/** Repositório do app, aberto no navegador pela aba "Sobre" (contrato 18); o main só abre `https://`. */
export const REPOSITORY_URL = 'https://github.com/andrewjpb/meeting-scribe'

/** Notas do release mostradas em Configurações: texto simples, até 2 000 caracteres. */
export const UPDATE_NOTES_MAX = 2000

export const UPDATE_HASH_MISMATCH_MESSAGE = 'O arquivo baixado não confere. Tente de novo.'
export const UPDATE_DOWNLOAD_FAILED_MESSAGE = 'Não foi possível baixar a atualização. Tente de novo.'
export const UPDATE_INSTALL_INSTRUCTION = 'Arraste o LAP Reuniões para Aplicativos e substitua. Depois abra de novo.'
export const UPDATE_QUIT_BLOCKED_MESSAGE = 'Termine a gravação antes.'

export type UpdateDownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; percent: number }
  | { phase: 'failed'; message: string }
  /** Baixado, conferido e aberto no Finder: falta a pessoa arrastar para Aplicativos. */
  | { phase: 'ready' }

export interface UpdateState {
  currentVersion: string
  checking: boolean
  /** Última consulta que o GitHub respondeu (ISO); erro e falta de internet não contam. */
  lastCheckedAt: string | null
  /** Versão maior que a atual, com asset e `.sha256` no release. */
  available: { version: string; notes: string } | null
  download: UpdateDownloadState
}
