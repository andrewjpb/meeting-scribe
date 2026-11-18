// Avisos da gravação, derivados do estado da captura (função pura, sem DOM).
import { DEFAULT_BRAND_NAME } from '@shared/branding'
import type { PrivacyPane } from '@shared/ipc'
import type { CaptureState } from '../../audio/capture'

export interface Notice {
  id: string
  source: 'mic' | 'system' | null
  text: string
  /** Atalho para o painel de privacidade dos Ajustes do Sistema. */
  pane: PrivacyPane | null
}

/** `appName`: o nome da marca escolhida em Configurações (contrato 09). */
export function noticesFor(capture: CaptureState, appName: string = DEFAULT_BRAND_NAME): Notice[] {
  const notices: Notice[] = []

  // Microfone desligado de propósito (contrato 29): nenhum aviso de microfone ausente ou bloqueado.
  if (capture.mic === 'failed' && !capture.micOff) {
    notices.push(
      capture.failure.mic === 'denied'
        ? {
            id: 'mic-denied',
            source: 'mic',
            text: `O microfone está bloqueado para o ${appName}. Libere em Privacidade e Segurança, Microfone.`,
            pane: 'microphone',
          }
        : { id: 'mic-unavailable', source: 'mic', text: 'Nenhum microfone disponível. A gravação segue só com o áudio dos participantes.', pane: null },
    )
  }

  if (capture.system === 'failed') {
    notices.push({
      id: 'system-failed',
      source: 'system',
      text: 'Não foi possível captar o áudio dos participantes. Confira a permissão Gravação de Áudio do Sistema.',
      pane: 'audio-capture',
    })
  } else if (capture.phase !== 'stopping' && capture.phase !== 'stopped' && (capture.system === 'ended' || capture.silence.system !== 'ok')) {
    // Ao encerrar, a fonte termina e fica em silêncio por isso: não é falta de permissão.
    notices.push({
      id: 'system-silent',
      source: 'system',
      text: 'O áudio dos participantes não está chegando. Sem a permissão Gravação de Áudio do Sistema, o macOS entrega só silêncio.',
      pane: 'audio-capture',
    })
  }

  return notices
}
