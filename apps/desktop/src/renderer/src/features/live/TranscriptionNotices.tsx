// Avisos da transcrição (CA8): reconexão em andamento naquela fonte, falha com "Tentar de novo" e
// chave recusada com o caminho para Configurações. A outra fonte segue; nunca modal. Com o motor Claude
// CLI, o processo que morreu duas vezes (contrato 05, CA7) avisa aqui; a gravação continua.
import { TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
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
