// Avisos da transcrição (CA8): reconexão em andamento naquela fonte, falha com "Tentar de novo" e
// chave recusada com o caminho para Configurações. A outra fonte segue; nunca modal. Com o motor Claude
// CLI, o processo que morreu duas vezes (contrato 05, CA7) avisa aqui; a gravação continua.
import { Download, TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { acpReady } from '@shared/acp'
import { ROUTE_PATHS } from '@shared/routes'
import { useAcp } from '../../app/acpStore'
import { useAgentLabel } from '../../app/agentLabel'
import { useSettings } from '../../app/settingsStore'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { useTranscription } from '../../transcription/store'
import type { SourceError } from '../../transcription/sink'

const SOURCE_NAME = { mic: 'do microfone', system: 'dos participantes' } as const

const ERROR_TEXT: Record<Exclude<SourceError, null>, string> = {
  'no-key': '',
  'key-rejected': 'A AssemblyAI recusou a chave. Confira a chave em Configurações.',
  network: 'A conexão com a AssemblyAI caiu.',
  server: 'A AssemblyAI não respondeu.',
  format: 'A AssemblyAI respondeu em formato inesperado.',
}

export function TranscriptionNotices() {
  const sources = useTranscription((state) => state.sources)
  const retrySource = useTranscription((state) => state.retrySource)
  const claude = useTranscription((state) => state.claude)
  const navigate = useNavigate()
  const settings = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  const acp = useAcp((state) => state.status)
  const agentLabel = useAgentLabel()
  const viaAgent = settings.translationEnabled && settings.translationEngine === 'claude-cli' && settings.claudeTransport === 'acp'
  useEffect(() => {
    if (viaAgent) void useAcp.getState().load()
  }, [viaAgent])

  const rows = (['mic', 'system'] as const).flatMap((source) => {
    const value = sources[source]
    if (!value) return []
    if (value.status === 'reconnecting') {
      return [
        <Note key={source} id={`transcription-reconnecting-${source}`} as="li" icon={TriangleAlert}>
          Reconectando a transcrição {SOURCE_NAME[source]}…
        </Note>,
      ]
    }
    if (value.status === 'failed' && value.error !== 'no-key') {
      const text = ERROR_TEXT[value.error ?? 'network']
      return [
        <Note
          key={source}
          id={`transcription-failed-${source}`}
          as="li"
          icon={TriangleAlert}
          action={
            value.error === 'key-rejected' ? (
              <button type="button" className={NOTE_ACTION_CLASS} onClick={() => void navigate(ROUTE_PATHS.configuracoes)}>
                Abrir Configurações
              </button>
            ) : (
              <button type="button" className={NOTE_ACTION_CLASS} onClick={() => retrySource(source)}>
                Tentar de novo
              </button>
            )
          }
        >
          {text} A transcrição {SOURCE_NAME[source]} parou.
        </Note>,
      ]
    }
    return []
  })

  // Contrato 17: sem o agente instalado, a tradução desta gravação vai pela linha de comando.
  if (viaAgent && acp && !acpReady(acp) && claude !== 'not-found') {
    rows.push(
      <Note
        key="acp-missing"
        id="acp-missing"
        as="li"
        icon={Download}
        action={
          acp.state === 'installing' ? undefined : (
            <button type="button" data-action="acp-install-from-recording" className={NOTE_ACTION_CLASS} onClick={() => void useAcp.getState().install()}>
              Instalar
            </button>
          )
        }
      >
        {acp.state === 'installing' ? `Instalando o agente do ${acp.label}… ${acp.progress}%` : `A tradução usa a linha de comando: o agente do ${acp.label} não está instalado.`}
      </Note>,
    )
  }

  if (claude === 'agent-failed') {
    rows.push(
      <Note
        key="claude"
        id="claude-agent-failed"
        as="li"
        icon={TriangleAlert}
        action={
          <button type="button" data-action="use-command-line" className={NOTE_ACTION_CLASS} onClick={() => void update({ claudeTransport: 'cli' })}>
            Usar a linha de comando
          </button>
        }
      >
        O agente do {agentLabel} não abriu. A transcrição continua sem tradução.
      </Note>,
    )
  }

  if (claude === 'stopped') {
    rows.push(
      <Note key="claude" id="claude-stopped" as="li" icon={TriangleAlert}>
        O Claude CLI parou. A transcrição continua sem tradução.
      </Note>,
    )
  }

  if (!rows.length) return null
  return (
    <ul aria-live="polite" className="mx-10 mt-4 flex flex-col gap-2">
      {rows}
    </ul>
  )
}
