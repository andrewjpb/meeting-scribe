import { Fingerprint, LockOpen } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { LOCK_FORGOT_TEXT, LOCK_STORAGE_ERROR_TEXT, retryLabel, TOUCH_ID_FAILED_TEXT } from '@shared/lock'
import { formatElapsed } from '../audio/clock'
import { BrandLogo } from '../design/BrandLogo'
import { Button } from '../design/Button'
import { TextField } from '../design/Field'
import { useElapsed } from '../features/live/useElapsed'
import { useRecording } from '../features/live/recordingStore'
import { useBranding } from './brandingStore'
import { useLock } from './lockStore'

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), a[href]'

/**
 * Camada de bloqueio (contrato 22, CA3): cobre a janela inteira com o conteúdo desfocado e escurecido
 * (`.lock-layer` em base.css; opaca com transparência ou movimento reduzidos) e, no centro, a marca, a senha,
 * "Desbloquear" e "Usar Touch ID". Durante a gravação, só a linha "Gravando · 12:34". O resto do app fica
 * `inert` (App.tsx) e o teclado não passa daqui: os atalhos das telas de trás não disparam.
 */
export function LockScreen() {
  const locked = useLock((state) => state.status.locked)
  if (!locked) return null
  return <LockLayer />
}

function LockLayer() {
  const status = useLock((state) => state.status)
  const retryUntil = useLock((state) => state.retryUntil)
  const unlock = useLock((state) => state.unlock)
  const touchId = useLock((state) => state.touchId)
  const branding = useBranding((state) => state.branding)
  const layerRef = useRef<HTMLDivElement>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const remaining = useRemaining(retryUntil)
  const waiting = remaining > 0

  // Teclas não passam da camada para as telas de trás (barra de espaço, ⌘⇧N, ⌘⇧A, ⌘1…⌘7): o `body` corta a
  // propagação antes dos ouvintes da janela. O que a camada trata (Tab, Enter) já foi tratado pelo React.
  useEffect(() => {
    const stop = (event: KeyboardEvent): void => event.stopPropagation()
    const types = ['keydown', 'keyup', 'keypress'] as const
    for (const type of types) document.body.addEventListener(type, stop)
    return () => {
      for (const type of types) document.body.removeEventListener(type, stop)
    }
  }, [])

  // Foco entra na camada e não sai dela; se escapar (clique no vazio), volta.
  useEffect(() => {
    const layer = layerRef.current
    layer?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onFocus = (event: FocusEvent): void => {
      if (layer && event.target instanceof Node && !layer.contains(event.target)) layer.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])

  // A espera acabou: o campo volta e recebe o foco.
  useEffect(() => {
    if (!waiting && status.hasPassword) document.getElementById('lock-password')?.focus()
  }, [waiting, status.hasPassword])

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const items = [...(layerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const first = items[0]
    const last = items.at(-1)
    if (!first || !last) return
    const index = items.indexOf(document.activeElement as HTMLElement)
    event.preventDefault()
    const next = event.shiftKey ? (index <= 0 ? last : items[index - 1]) : index === -1 || index === items.length - 1 ? first : items[index + 1]
    next?.focus()
  }

  const submit = async (): Promise<void> => {
    if (busy || waiting || password === '') return
    setBusy(true)
    const result = await unlock(password)
    setBusy(false)
    setPassword('')
    if (result === 'wrong') setError('Senha incorreta')
    else if (result === 'wait') setError(null)
    else if (result !== 'ok') setError('Não foi possível desbloquear. Tente de novo.')
  }

  const askTouchId = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const result = await touchId()
    setBusy(false)
    if (result !== 'ok') setError(TOUCH_ID_FAILED_TEXT)
  }

  return (
    <div
      ref={layerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      data-lock-screen
      onKeyDown={trapTab}
      className="lock-layer no-drag fixed inset-0 z-[100] flex items-center justify-center px-6"
    >
      {/* A janela continua arrastável pela faixa de cima, como no resto do app. */}
      <div aria-hidden="true" className="drag absolute inset-x-0 top-0 h-[var(--titlebar-height)]" />
      <div data-lock-card className="no-drag relative flex w-full max-w-[380px] flex-col gap-4 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-8">
        <div className="flex items-center gap-2.5">
          <BrandLogo dataUrl={branding.logoDataUrl} />
          <span className="truncate text-15 font-bold text-title">{branding.name}</span>
        </div>
        <h1 id="lock-title" className="text-20 leading-[26px] font-bold text-title">
          {branding.name} está bloqueado
        </h1>
        <RecordingLine />
        {status.storageError && (
          <p role="status" data-lock-storage-error className="text-12 text-text-muted">
            {LOCK_STORAGE_ERROR_TEXT}
          </p>
        )}
        {status.hasPassword && (
          <div className="flex flex-col gap-3">
            <label htmlFor="lock-password" className="text-13 font-medium text-text">
              Senha
            </label>
            <div className="flex">
              <TextField
                id="lock-password"
                type="password"
                value={password}
                onChange={(value) => {
                  setPassword(value)
                  if (error) setError(null)
                }}
                onEnter={() => void submit()}
                maxLength={256}
                disabled={waiting}
                describedBy={error ? 'lock-error' : waiting ? 'lock-wait' : undefined}
              />
            </div>
            {waiting && (
              <p id="lock-wait" role="status" data-lock-wait className="tabular text-13 text-text-muted">
                Muitas tentativas. Tente de novo em {retryLabel(remaining)}.
              </p>
            )}
            <Button action="unlock" icon={LockOpen} onClick={() => void submit()} disabled={busy || waiting || password === ''}>
              Desbloquear
            </Button>
          </div>
        )}
        {status.touchIdEnabled && (
          <Button action="unlock-touch-id" variant="secondary" icon={Fingerprint} onClick={() => void askTouchId()} disabled={busy}>
            Usar Touch ID
          </Button>
        )}
        {error && (
          <p id="lock-error" role="alert" data-lock-error className="text-13 text-rec">
            {error}
          </p>
        )}
        <button
          type="button"
          data-action="lock-forgot"
          aria-expanded={forgot}
          onClick={() => setForgot((open) => !open)}
          className="no-drag self-start rounded-[var(--radius-control)] text-13 font-medium text-accent underline decoration-1 underline-offset-3 hover:text-title"
        >
          Esqueci a senha
        </button>
        {forgot && (
          <p data-lock-forgot className="text-12 text-text-muted">
            {LOCK_FORGOT_TEXT}
          </p>
        )}
      </div>
    </div>
  )
}

/** "Gravando · 12:34" (ou "Pausado") durante a gravação: nenhum texto da reunião. */
function RecordingLine() {
  const session = useRecording((state) => state.session)
  const phase = useRecording((state) => state.capture?.phase ?? 'idle')
  const elapsed = useElapsed(session?.clock ?? null, phase === 'recording')
  if (!session || (phase !== 'recording' && phase !== 'paused')) return null
  return (
    <p data-lock-recording className="flex items-center gap-2 text-13 text-text-muted">
      <span aria-hidden="true" className={`size-2 shrink-0 ${phase === 'recording' ? 'rec-pulse bg-rec' : 'bg-text-faint'}`} />
      <span className="tabular">
        {phase === 'recording' ? 'Gravando' : 'Pausado'} · {formatElapsed(elapsed)}
      </span>
    </p>
  )
}

/** Milissegundos até o fim da espera, relidos a cada segundo. */
function useRemaining(until: number): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, until - Date.now()))
  useEffect(() => {
    const read = (): number => {
      const left = Math.max(0, until - Date.now())
      setRemaining(left)
      return left
    }
    if (read() === 0) return
    const timer = setInterval(() => {
      if (read() === 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [until])
  return remaining
}
