import { KeyRound } from 'lucide-react'
import { useEffect, useState, type MouseEvent } from 'react'
import { ASSEMBLYAI_DASHBOARD_URL, type KeyCheck, type KeyStatus } from '@shared/assemblyai'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Note } from '../../design/Note'
import { RetryNotice } from '../live/Notices'
import { useApiKey } from './keyStore'

export const API_KEY_INPUT_ID = 'assemblyai-key'

type Tone = 'accent' | 'muted' | 'rec'

const TONE_TEXT: Record<Tone, string> = { accent: 'text-accent', muted: 'text-text-muted', rec: 'text-rec' }
const TONE_SQUARE: Record<Tone, string> = { accent: 'bg-accent', muted: 'bg-line-strong', rec: 'bg-rec' }

/** Linha de estado à direita do nome: nunca a chave, só os quatro últimos caracteres. */
export function keyStatusLine(status: KeyStatus | null, check: KeyCheck | null, busy: string | null): { tone: Tone; text: string } {
  const ending = status?.last4 ? ` · termina em ••••${status.last4}` : ''
  if (busy === 'saving' || busy === 'verifying') return { tone: 'muted', text: 'Verificando a chave…' }
  if (check === 'refused') return { tone: 'rec', text: 'Chave recusada pela AssemblyAI' }
  if (!status?.configured) return { tone: 'muted', text: 'Nenhuma chave salva' }
  if (check === 'valid') return { tone: 'accent', text: `Chave válida${ending}` }
  if (status.source === 'dev-env') return { tone: 'muted', text: `Chave do ambiente de desenvolvimento${ending}` }
  return { tone: 'muted', text: `Chave guardada${ending}` }
}

/** Chave da AssemblyAI: campo de senha, "Salvar" (o main confere antes de guardar) e "Remover" com confirmação. */
export function ApiKeyField() {
  const status = useApiKey((state) => state.status)
  const check = useApiKey((state) => state.check)
  const busy = useApiKey((state) => state.busy)
  const loadFailed = useApiKey((state) => state.loadFailed)
  const saveFailed = useApiKey((state) => state.saveFailed)
  const [draft, setDraft] = useState('')
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  useEffect(() => {
    void useApiKey.getState().load()
  }, [])

  const save = (): void => {
    const key = draft.trim()
    if (busy) return
    // Sem texto, "Salvar" leva ao campo (o botão fica sempre com cara de ação, como no mockup).
    if (!key) {
      document.getElementById(API_KEY_INPUT_ID)?.focus()
      return
    }
    void useApiKey
      .getState()
      .save(key)
      .then((result) => {
        // Recusada, inválida ou não guardada: o texto fica no campo para corrigir ou tentar de novo.
        if (result !== null && result !== 'refused' && result !== 'invalid') setDraft('')
      })
  }

  const openDashboard = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault()
    window.__scribeApi.send('scribe:open-key-dashboard', undefined)
  }

  const line = keyStatusLine(status, check, busy)
  const removable = status?.source === 'saved'

  return (
    <div
      className="flex flex-col gap-3 py-4"
      data-key-state={check ?? (status?.configured ? 'saved' : 'none')}
      data-setting-row
      data-setting-name="Chave da AssemblyAI"
      data-setting-description="Guardada cifrada neste Mac, protegida pelo Chaveiro do macOS."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={API_KEY_INPUT_ID} className="text-13 font-medium text-text">
          Chave da AssemblyAI
        </label>
        <p data-key-status className={`flex items-center gap-1.5 text-12 font-medium ${TONE_TEXT[line.tone]}`} aria-live="polite">
          <span aria-hidden="true" className={`size-1.5 shrink-0 ${TONE_SQUARE[line.tone]}`} />
          {line.text}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <TextField
          id={API_KEY_INPUT_ID}
          type="password"
          value={draft}
          onChange={setDraft}
          onEnter={save}
          placeholder={status?.configured ? 'Cole uma chave nova para substituir' : 'Cole a chave da sua conta'}
          describedBy="assemblyai-key-help"
        />
        {confirmingRemove ? (
          <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Confirmar remoção da chave">
            <p className="mr-1 text-13 text-text">Remover a chave?</p>
            <Button action="cancel-remove-key" variant="secondary" onClick={() => setConfirmingRemove(false)}>
              Cancelar
            </Button>
            <Button
              action="confirm-remove-key"
              variant="danger"
              disabled={busy !== null}
              onClick={() => {
                void useApiKey
                  .getState()
                  .remove()
                  .then(() => setConfirmingRemove(false))
              }}
            >
              Remover
            </Button>
          </div>
        ) : (
          <>
            <Button action="save-key" onClick={save} disabled={busy !== null}>
              Salvar
            </Button>
            {removable && (
              <Button action="remove-key" variant="danger" onClick={() => setConfirmingRemove(true)} disabled={busy !== null}>
                Remover
              </Button>
            )}
          </>
        )}
      </div>

      <p id="assemblyai-key-help" className="text-12 text-text-muted">
        Guardada cifrada neste Mac, protegida pelo Chaveiro do macOS.{' '}
        <a
          href={ASSEMBLYAI_DASHBOARD_URL}
          onClick={openDashboard}
          draggable={false}
          data-action="create-key"
          className="no-drag rounded-[var(--radius-control)] text-accent underline decoration-1 underline-offset-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
        >
          Criar chave
        </a>
      </p>

      {saveFailed && busy === null && <RetryNotice id="key-save-failed" text="Não foi possível guardar a chave." onRetry={save} />}
      {check === 'unverified' && busy === null && (
        <RetryNotice id="key-unverified" text="Não foi possível verificar agora. A chave foi guardada e será conferida de novo." onRetry={() => void useApiKey.getState().verify()} />
      )}
      {check === 'unavailable' && (
        <Note id="key-unavailable" icon={KeyRound} role="alert">
          O Chaveiro do macOS não está disponível agora, então a chave não foi guardada.
        </Note>
      )}
      {loadFailed && <RetryNotice id="key-load-failed" text="Não foi possível ler o estado da chave." onRetry={() => void useApiKey.getState().load()} />}
    </div>
  )
}
