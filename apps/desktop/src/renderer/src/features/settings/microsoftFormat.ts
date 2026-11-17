// Textos da conta Microsoft e do bloco "Agenda" em Configurações › Contas (contrato 12). Funções puras, testadas à parte.
import type { MicrosoftAccountStatus, MicrosoftClientSaveError, OAuthErrorCode } from '@shared/accounts'
import type { CalendarLeadMinutes } from '@shared/settings-defaults'
import { otherAccountText } from './googleFormat'

export const MICROSOFT_HELP = 'Registre em entra.microsoft.com → Registros de aplicativo, como cliente público com http://localhost.'

/** Por que o login não deu certo; `null` quando não há o que dizer (a pessoa cancelou). */
export function microsoftSignInErrorText(error: OAuthErrorCode | null, email: string | null = null): string | null {
  switch (error) {
    case null:
    case 'cancelled':
      return null
    case 'timeout':
      return 'O login não terminou em 5 minutos. Tente de novo.'
    case 'state':
      return 'A volta do navegador não conferiu. Tente de novo.'
    case 'denied':
      return 'O acesso não foi permitido na Microsoft.'
    case 'network':
      return 'Sem conexão com a Microsoft agora. Tente de novo.'
    case 'invalid-client':
      return 'A Microsoft recusou o cadastro. Confira o ID do aplicativo e se ele permite fluxos de cliente público.'
    case 'other-account':
      return otherAccountText(email)
  }
}

export function microsoftClientSaveErrorText(error: MicrosoftClientSaveError): string {
  switch (error) {
    case 'invalid-id':
      return 'O ID do aplicativo tem o formato 00000000-0000-0000-0000-000000000000.'
    case 'unavailable':
      return 'O Chaveiro do macOS não está disponível agora, então o cadastro não foi guardado.'
    case 'failed':
      return 'Não foi possível guardar o cadastro.'
  }
}

/** Linha de apoio da conta Microsoft, sem nenhum segredo (só o ID mascarado). */
export function microsoftAccountLine(status: MicrosoftAccountStatus | null): string {
  if (!status) return ''
  if (status.state === 'signing-in') return 'Continue no navegador…'
  if (status.state === 'expired') return 'Sessão expirada. Entre de novo.'
  if (status.state === 'signed-in') return status.profile?.email ?? ''
  if (!status.client.configured) return 'Para avisar as reuniões da sua agenda do Outlook.'
  return `Cadastro ${status.client.clientId ?? ''}`.trim()
}

export const LEAD_OPTIONS: readonly { value: `${CalendarLeadMinutes}`; label: string }[] = [
  { value: '1', label: '1 min' },
  { value: '5', label: '5 min' },
  { value: '10', label: '10 min' },
]

/** Agendas marcadas: `null` (a pessoa não escolheu) é só a principal. */
export function isCalendarChosen(chosen: readonly string[] | null, id: string, primary: boolean): boolean {
  return chosen === null ? primary : chosen.includes(id)
}

/** Marca ou desmarca uma agenda; da escolha padrão parte das principais. */
export function toggleCalendar(chosen: readonly string[] | null, primaryIds: readonly string[], id: string, on: boolean): string[] {
  const base = chosen === null ? [...primaryIds] : [...chosen]
  const rest = base.filter((item) => item !== id)
  return on ? [...rest, id] : rest
}
