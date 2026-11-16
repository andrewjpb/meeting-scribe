// Área de transcrição da gravação (CA10 e CA11). Lê o estado ao vivo; sem chave mostra a frase do
// estado com o caminho para Configurações e "Ver exemplo"; com chave, só a coluna. O exemplo fica sob
// a etiqueta "Exemplo" e nunca entra no registro da reunião. Com o motor Claude CLI e o `claude` não
// encontrado (contrato 05, CA11), o aviso fica no topo da coluna e a transcrição segue sem tradução.
import { CloudOff, Languages } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { settingsPath, TRANSCRIPTION_ANCHOR } from '@shared/routes'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { useTranscription } from '../../transcription/store'
import { useRecording } from './recordingStore'
import { EXAMPLE_TRANSCRIPT } from './exampleTranscript'
import { TranscriptList, type TranscriptItem } from './TranscriptList'

export function TranscriptArea() {
  const status = useTranscription((state) => state.status)
  const segments = useTranscription((state) => state.segments)
  const retryTranslation = useTranscription((state) => state.retryTranslation)
  const claude = useTranscription((state) => state.claude)
  /** Clique no tempo de um item da análise (contrato 19): rola até o trecho. */
  const jump = useRecording((state) => state.jump)
  const navigate = useNavigate()
  const [showExample, setShowExample] = useState(false)

  // Eco do alto-falante (contrato 06): some da coluna, sem animação nem aviso. Só é marcado com a
  // configuração ligada.
  const items: TranscriptItem[] = segments.filter((segment) => !segment.echo).map(({ id, source, speaker, startMs, text, translation, partial, translationState }) => ({
    id,
    source,
    speaker,
    startMs,
    text,
    translation,
    partial,
    translationState,
  }))

  if (showExample) {
    return (
      <TranscriptList
        autoScroll
        bottomInset
        items={EXAMPLE_TRANSCRIPT.map<TranscriptItem>((segment) => ({ ...segment, partial: segment.partial ?? false, translationState: segment.translation ? 'done' : 'pending' }))}
        header={<ExampleHeader onHide={() => setShowExample(false)} />}
      />
    )
  }

  if (status === 'no-key') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-28">
        <div className="mx-auto grid w-full max-w-[680px] grid-cols-[64px_minmax(0,1fr)] pt-7" data-transcript-state="no-key">
          <CloudOff size={16} strokeWidth={1.5} strokeLinecap="square" aria-hidden="true" className="mt-0.5 text-text-faint" />
          <div>
            <p className="text-15 font-medium text-text">Adicione sua chave da AssemblyAI para transcrever.</p>
            <p className="mt-1 max-w-[460px] text-13 text-pretty text-text-muted">
              A gravação e a fita de níveis funcionam normalmente. Com a chave, cada fala aparece aqui durante a reunião.
            </p>
            <div className="mt-3 flex items-center gap-4">
              <button
                type="button"
                data-action="open-settings-from-transcript"
                onClick={() => void navigate(settingsPath('gravacao', TRANSCRIPTION_ANCHOR))}
                className="no-drag inline-flex h-10 items-center rounded-[var(--radius-control)] bg-accent px-4 text-13 font-medium text-on-accent transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:opacity-90"
              >
                Abrir Configurações
              </button>
              <button
                type="button"
                data-action="show-example"
                onClick={() => setShowExample(true)}
                className="no-drag rounded-[var(--radius-control)] text-13 font-medium text-accent underline decoration-1 underline-offset-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
              >
                Ver exemplo
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {claude === 'not-found' && (
        <Note
          id="claude-not-found"
          role="status"
          icon={Languages}
          className="mx-10 mt-4"
          action={
            <button type="button" data-action="open-settings-from-claude" className={NOTE_ACTION_CLASS} onClick={() => void navigate(settingsPath('claude'))}>
              Abrir Configurações
            </button>
          }
        >
          Claude CLI não encontrado. Ajuste em Configurações.
        </Note>
      )}
      <TranscriptList autoScroll bottomInset items={items} onRetryTranslation={retryTranslation} jumpTo={jump} />
    </>
  )
}

function ExampleHeader({ onHide }: { onHide: () => void }) {
  return (
    <div data-transcript-state="example" className="sticky top-0 z-10 grid grid-cols-[64px_minmax(0,1fr)] items-center border-b border-line bg-bg py-3">
      <span className="inline-flex h-[22px] w-fit items-center rounded-[var(--radius-control)] bg-bg-sunken px-1.5 text-12 font-medium text-text-muted">Exemplo</span>
      <div className="flex items-center justify-between gap-4">
        <p className="text-12 text-text-faint">Conversa fictícia, só para mostrar o formato. Não é salva.</p>
        <button
          type="button"
          data-action="hide-example"
          onClick={onHide}
          className="no-drag shrink-0 rounded-[var(--radius-control)] text-12 font-medium text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-text"
        >
          Ocultar
        </button>
      </div>
    </div>
  )
}
