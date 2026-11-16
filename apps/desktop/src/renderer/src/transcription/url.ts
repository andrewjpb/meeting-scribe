// URL da conexão de streaming (CA2). A autenticação vai pelo token temporário na query; a chave nunca
// sai do main. O JSON do `llm_gateway` leva o modelo escolhido e a instrução de tradução — só quando a
// tradução está ligada, e só turnos finais são traduzidos pelo servidor. Com o motor Claude CLI
// (contrato 05) a conexão não leva `llm_gateway`: quem traduz é o `claude` local, no main.
import type { AppSettings } from '../../../shared/settings-defaults'
import { translationPrompt, type TranscriptSource } from '../../../shared/transcription'

export const STREAMING_WS_URL = 'wss://streaming.assemblyai.com/v3/ws'
export const SAMPLE_RATE = 16_000
export const SPEECH_MODEL = 'universal-3-6-pro'

export type TranslationSettings = Pick<AppSettings, 'sourceLanguage' | 'targetLanguage' | 'translationEnabled' | 'translationModel' | 'translationEngine' | 'identifySpeakers'>

export interface StreamUrlInput {
  token: string
  source: TranscriptSource
  settings: TranslationSettings
  /**
   * Parâmetros extras da conexão, aplicados por último (o app não usa; o `test:aai` mede variações de
   * latência com eles). `token` não pode ser trocado por aqui.
   */
  extraParams?: Readonly<Record<string, string | number | boolean>>
}

export function buildStreamingUrl({ token, source, settings, extraParams }: StreamUrlInput): string {
  const params = new URLSearchParams({
    token,
    sample_rate: String(SAMPLE_RATE),
    speech_model: SPEECH_MODEL,
    format_turns: 'true',
    language_codes: settings.sourceLanguage,
  })
  // Diarização só faz sentido no áudio dos participantes: no microfone o falante é sempre você. Fica
  // desligada por padrão: com ela os trechos do sistema chegavam atrasados e falas se perdiam (15/11/2026).
  if (source === 'system' && settings.identifySpeakers) {
    params.set('speaker_labels', 'true')
    // Revisão de falante no meio da sessão (mínimo 120 s; a recomendação da AssemblyAI é 300 s). Sem
    // isto só haveria a revisão do fim da sessão, que chega depois do Terminate e se perde ao fechar.
    params.set('speaker_labels_revision_interval_ms', '300000')
  }
  if (settings.translationEnabled && settings.translationEngine !== 'claude-cli') {
    params.set(
      'llm_gateway',
      JSON.stringify({
        model: settings.translationModel,
        prompt: translationPrompt(settings.sourceLanguage, settings.targetLanguage),
      }),
    )
  }
  for (const [name, value] of Object.entries(extraParams ?? {})) {
    if (name !== 'token') params.set(name, String(value))
  }
  return `${STREAMING_WS_URL}?${params.toString()}`
}
