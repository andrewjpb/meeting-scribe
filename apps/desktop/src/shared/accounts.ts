// Contas (contrato 11): o que o renderer vê da conta Google e do envio ao Google Drive. Nenhum segredo passa
// por aqui: a chave secreta do cliente e os tokens ficam cifrados no main; o renderer recebe só se o cadastro
// existe, o ID do cliente com o meio mascarado, o nome, o e-mail e a foto (data URL).

/** Erros do login (`accounts/oauth.ts`). */
export const OAUTH_ERRORS = ['cancelled', 'timeout', 'state', 'denied', 'network', 'invalid-client'] as const
export type OAuthErrorCode = (typeof OAUTH_ERRORS)[number]

/** `expired`: o Google recusou a renovação (`invalid_grant`); nada local foi apagado, só falta entrar de novo. */
export type AccountState = 'signed-out' | 'signing-in' | 'signed-in' | 'expired'

export interface AccountProfile {
  name: string
  email: string
  /** Foto baixada no main, até 256 px, como data URL; `null` sem foto. */
  photo: string | null
}

export interface GoogleAccountStatus {
  /** Cadastro do cliente OAuth: só se existe e o ID com o meio mascarado. */
  client: { configured: boolean; clientId: string | null }
  state: AccountState
  profile: AccountProfile | null
  /** Por que o último login não deu certo nesta execução; `null` depois de um login bom. */
  error: OAuthErrorCode | null
}

export type GoogleClientSaveError = 'invalid-id' | 'invalid-secret' | 'unavailable' | 'failed'
export type GoogleClientSaveResult = { ok: true; status: GoogleAccountStatus } | { ok: false; error: GoogleClientSaveError; status: GoogleAccountStatus }

/** Pasta do app na raiz do Drive. */
export const DRIVE_ROOT_FOLDER_NAME = 'LAP Reuniões'

/**
 * Tipos de arquivo que vão para o Drive. Tipo novo (o vídeo do contrato 20) entra aqui e em
 * `main/google/drive-files.ts`, que diz de onde ele sai.
 */
export const DRIVE_FILE_KINDS = ['audio', 'transcript', 'summary'] as const
export type DriveFileKind = (typeof DRIVE_FILE_KINDS)[number]

/**
 * Motivo curto do erro: `session` (entrar de novo na conta), `missing` (arquivo sumiu da pasta), `quota` (Drive
 * cheio), `refused` (o Drive recusou o envio), `server` (o Drive não respondeu; tenta sozinho de novo).
 */
export type DriveErrorReason = 'session' | 'missing' | 'quota' | 'refused' | 'server'

/** Estado de uma reunião no Drive, para a aba "Áudio" do detalhe e o ícone da lista. */
export type DriveMeetingStatus =
  | { state: 'hidden' }
  | { state: 'uploading'; percent: number }
  | { state: 'done' }
  | { state: 'offline' }
  | { state: 'error'; reason: DriveErrorReason }

export const DRIVE_ERROR_TEXT: Readonly<Record<DriveErrorReason, string>> = {
  session: 'entre de novo na conta Google',
  missing: 'arquivo não encontrado',
  quota: 'sem espaço no Drive',
  refused: 'o Drive recusou o envio',
  server: 'o Drive não respondeu',
}

/** Pasta no Drive, aberta no navegador ("Abrir no Drive"). */
export const DRIVE_FOLDER_URL_PREFIX = 'https://drive.google.com/drive/folders/'

/** ID de pasta do Drive: letras, números, `-` e `_`. */
export const DRIVE_ID_PATTERN = /^[\w-]{1,200}$/

/** `123456789012-abc….apps.googleusercontent.com` vira `123456•••rcontent.com`. */
export function maskClientId(clientId: string): string {
  if (clientId.length <= 18) return `${clientId.slice(0, 3)}•••`
  return `${clientId.slice(0, 6)}•••${clientId.slice(-12)}`
}
