// CA2: URL da conexão de streaming.
import { describe, expect, it } from 'vitest'
import { buildStreamingUrl, SAMPLE_RATE, SPEECH_MODEL, STREAMING_WS_URL } from '../../src/renderer/src/transcription/url'
import { DEFAULT_SETTINGS } from '../../src/shared/settings-defaults'

const params = (url: string): URLSearchParams => new URL(url).searchParams

const settings = { ...DEFAULT_SETTINGS }

describe('buildStreamingUrl (CA2)', () => {
  it('leva token, taxa, modelo, turnos formatados e o idioma de origem', () => {
    const url = buildStreamingUrl({ token: 'tok-123', source: 'mic', settings })
    expect(url.startsWith(`${STREAMING_WS_URL}?`)).toBe(true)
    const query = params(url)
    expect(query.get('token')).toBe('tok-123')
    expect(query.get('sample_rate')).toBe(String(SAMPLE_RATE))
    expect(query.get('speech_model')).toBe(SPEECH_MODEL)
    expect(query.get('format_turns')).toBe('true')
    expect(query.get('language_codes')).toBe('pt')
    expect(SAMPLE_RATE).toBe(16_000)
    expect(SPEECH_MODEL).toBe('universal-3-6-pro')
  })

  it('diarização desligada por padrão: nenhuma fonte leva speaker_labels', () => {
    for (const source of ['mic', 'system'] as const) {
      const query = params(buildStreamingUrl({ token: 't', source, settings }))
      expect(query.get('speaker_labels')).toBeNull()
      expect(query.get('speaker_labels_revision_interval_ms')).toBeNull()
    }
  })

  it('com "Identificar quem fala" ligado, diarização só na fonte do sistema', () => {
    const on = { ...settings, identifySpeakers: true }
    expect(params(buildStreamingUrl({ token: 't', source: 'mic', settings: on })).get('speaker_labels')).toBeNull()
    expect(params(buildStreamingUrl({ token: 't', source: 'system', settings: on })).get('speaker_labels')).toBe('true')
    // Sem isso, a única revisão de falante seria a do fim da sessão, que chega depois do Terminate.
    expect(params(buildStreamingUrl({ token: 't', source: 'system', settings: on })).get('speaker_labels_revision_interval_ms')).toBe('300000')
  })

  it('tradução ligada: llm_gateway com modelo e instrução que nomeia os dois idiomas e usa {{turn}} uma vez', () => {
    const gateway = params(buildStreamingUrl({ token: 't', source: 'system', settings })).get('llm_gateway')
    expect(gateway).not.toBeNull()
    const parsed = JSON.parse(gateway as string) as { model: string; prompt: string }
    expect(parsed.model).toBe(DEFAULT_SETTINGS.translationModel)
    expect(parsed.prompt).toContain('Portuguese')
    expect(parsed.prompt).toContain('English')
    expect(parsed.prompt).not.toContain('Spanish')
    expect(parsed.prompt.split('{{turn}}')).toHaveLength(2)
    // Só o texto final do turno é traduzido pelo servidor; a instrução pede apenas a tradução.
    expect(parsed.prompt).toMatch(/translation only/i)
  })

  it('outros idiomas aparecem por extenso; tradução desligada não manda llm_gateway', () => {
    const gateway = params(
      buildStreamingUrl({ token: 't', source: 'mic', settings: { ...settings, sourceLanguage: 'ja', targetLanguage: 'zh' } }),
    ).get('llm_gateway')
    expect(JSON.parse(gateway as string).prompt).toContain('Japanese')
    expect(JSON.parse(gateway as string).prompt).toContain('Chinese')
    expect(params(buildStreamingUrl({ token: 't', source: 'mic', settings: { ...settings, translationEnabled: false } })).get('llm_gateway')).toBeNull()
  })

  it('parâmetros extras (test:aai) vão para a URL depois dos padrões, sem trocar o token', () => {
    const query = params(
      buildStreamingUrl({ token: 'tok-1', source: 'mic', settings, extraParams: { min_turn_silence: 100, max_turn_silence: 640, mode: 'min_latency', token: 'outro' } }),
    )
    expect(query.get('min_turn_silence')).toBe('100')
    expect(query.get('max_turn_silence')).toBe('640')
    expect(query.get('mode')).toBe('min_latency')
    expect(query.get('token')).toBe('tok-1')
    expect(query.get('speech_model')).toBe(SPEECH_MODEL)
  })

  it('sem parâmetros extras, a URL do app não muda', () => {
    expect(buildStreamingUrl({ token: 't', source: 'system', settings, extraParams: {} })).toBe(buildStreamingUrl({ token: 't', source: 'system', settings }))
  })

  it('motor Claude CLI com tradução ligada: sem llm_gateway; o resto da URL igual ao do motor AssemblyAI (contrato 05, CA3)', () => {
    const claude = { ...settings, translationEngine: 'claude-cli' as const }
    for (const source of ['mic', 'system'] as const) {
      const query = params(buildStreamingUrl({ token: 't', source, settings: claude }))
      expect(query.get('llm_gateway')).toBeNull()
      const withGateway = params(buildStreamingUrl({ token: 't', source, settings }))
      withGateway.delete('llm_gateway')
      expect(query.toString()).toBe(withGateway.toString())
    }
    // A diarização segue a opção, com qualquer motor.
    expect(params(buildStreamingUrl({ token: 't', source: 'system', settings: { ...claude, identifySpeakers: true } })).get('speaker_labels')).toBe('true')
  })

  it('motor AssemblyAI (padrão): a URL do contrato 04 não muda', () => {
    expect(DEFAULT_SETTINGS.translationEngine).toBe('assemblyai')
    const gateway = params(buildStreamingUrl({ token: 't', source: 'mic', settings: { ...settings, translationEngine: 'assemblyai' } })).get('llm_gateway')
    expect(JSON.parse(gateway as string).model).toBe(DEFAULT_SETTINGS.translationModel)
  })
})
