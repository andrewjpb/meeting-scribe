// Textos da conta Google em Configurações › Contas (contrato 11). Funções puras, testadas à parte.
import type { GoogleAccountStatus, GoogleClientSaveError, OAuthErrorCode } from '@shared/accounts'

export const GOOGLE_HELP = 'Crie em console.cloud.google.com → Clientes → App para computador.'
export const DRIVE_HELP = 'Depois de cada reunião, o áudio, a transcrição e o resumo vão para a pasta "LAP Reuniões" do seu Drive.'

/**
 * Por que o login não deu certo; `null` quando não há o que dizer (a pessoa cancelou). `email`: a conta conectada,
 * para "Permitir acesso à agenda" feito com outra conta (contrato 12).
 */
export function signInErrorText(error: OAuthErrorCode | null, email: string | null = null): string | null {
  switch (error) {
    case null:
    case 'cancelled':
      return null
    case 'timeout':
      return 'O login não terminou em 5 minutos. Tente de novo.'
    case 'state':
      return 'A volta do navegador não conferiu. Tente de novo.'
    case 'denied':
      return 'O acesso não foi permitido no Google.'
    case 'network':
      return 'Sem conexão com o Google agora. Tente de novo.'
    case 'invalid-client':
      return 'O Google recusou o cadastro. Confira o ID do cliente e a chave secreta.'
    case 'other-account':
      return otherAccountText(email)
  }
}

export function clientSaveErrorText(error: GoogleClientSaveError): string {
  switch (error) {
    case 'invalid-id':
      return 'O ID do cliente termina em .apps.googleusercontent.com.'
    case 'invalid-secret':
      return 'Chave secreta em formato inválido.'
    case 'unavailable':
      return 'O Chaveiro do macOS não está disponível agora, então o cadastro não foi guardado.'
    case 'failed':
      return 'Não foi possível guardar o cadastro.'
  }
}

/** Linha de apoio da conta: o que fazer agora, sem nenhum segredo (só o ID mascarado). */
export function accountLine(status: GoogleAccountStatus | null): string {
  if (!status) return ''
  if (status.state === 'signing-in') return 'Continue no navegador…'
  if (status.state === 'expired') return 'Sessão expirada. Entre de novo.'
  if (status.state === 'signed-in') return status.profile?.email ?? ''
  if (!status.client.configured) return 'Para guardar as reuniões no seu Google Drive.'
  return `Cadastro ${status.client.clientId ?? ''}`.trim()
}

/** "Permitir acesso à agenda" voltou com outra conta (contrato 12): nada mudou. */
export function otherAccountText(email: string | null): string {
  return email ? `Escolha a mesma conta (${email}) para liberar a agenda.` : 'Escolha a mesma conta para liberar a agenda.'
}
