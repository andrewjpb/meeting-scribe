import { useState } from 'react'
import { LOCK_PASSWORD_MAX, LOCK_PASSWORD_MIN, passwordLength, retryLabel, type LockResult } from '@shared/lock'
import { LOCK_AFTER_MINUTES, type LockAfterMinutes } from '@shared/settings-defaults'
import { useLock } from '../../app/lockStore'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Select, TextField } from '../../design/Field'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'

/** `aria-label` e âncora do bloco na aba "Geral". */
export const LOCK_SECTION = 'Bloqueio'
export const LOCK_ANCHOR = 'bloqueio'

const MINUTE_OPTIONS = LOCK_AFTER_MINUTES.map((value) => ({
  value: String(value),
  label: value === 0 ? 'Nunca' : value === 1 ? 'Depois de 1 minuto sem uso' : `Depois de ${value} minutos sem uso`,
}))

type FormMode = 'create' | 'change' | 'remove'

const SUCCESS: Record<FormMode, string> = { create: 'Senha criada.', change: 'Senha trocada.', remove: 'Senha removida.' }

/**
 * "Bloqueio" (contrato 22, CA1 e CA2), na aba "Geral": criar, trocar ou remover a senha do app (trocar e
 * remover pedem a atual), Touch ID quando o Mac tem, bloqueio por falta de uso, junto com o Mac e ao abrir.
 * A senha só passa por aqui a caminho do main; os campos são limpos a cada envio.
 */
export function LockSection() {
  const status = useLock((state) => state.status)
  const settings = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  const [mode, setMode] = useState<FormMode | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const open = (next: FormMode): void => {
    setDone(null)
    setMode(next)
  }

  return (
    <Section title={LOCK_SECTION} anchor={LOCK_ANCHOR} description="Cobre a janela com uma tela fosca. A gravação, a transcrição e as análises continuam.">
      <SettingRow name="Senha do app" description="Pedida para desbloquear. Fica só neste Mac, guardada como hash.">
        {status.hasPassword ? (
          <>
            <Button action="lock-password-change" variant="secondary" onClick={() => open('change')} disabled={mode !== null}>
              Trocar senha
            </Button>
            <Button action="lock-password-remove" variant="danger" onClick={() => open('remove')} disabled={mode !== null}>
              Remover senha
            </Button>
          </>
        ) : (
          <Button action="lock-password-create" variant="secondary" onClick={() => open('create')} disabled={mode !== null}>
            Criar senha
          </Button>
        )}
      </SettingRow>
      {mode && (
        <PasswordForm
          key={mode}
          mode={mode}
          onCancel={() => setMode(null)}
          onDone={() => {
            setDone(SUCCESS[mode])
            setMode(null)
          }}
        />
      )}
      {done && !mode && (
        <p role="status" data-lock-password-done className="py-3 text-13 text-text-muted">
          {done}
        </p>
      )}
      {status.touchIdAvailable && (
        <SettingRow
          name="Usar Touch ID"
          nameId="settings-lock-touch-id"
          description={status.hasPassword ? 'Desbloquear com a digital, sem digitar a senha.' : 'Crie a senha antes: o Touch ID é um atalho dela.'}
        >
          {/* Sem senha, o Touch ID não liga: não haveria como desbloquear se ele falhasse. */}
          <Switch
            checked={status.touchIdEnabled}
            disabled={!status.hasPassword}
            labelledBy="settings-lock-touch-id"
            onChange={(lockUseTouchId) => void update({ lockUseTouchId })}
          />
        </SettingRow>
      )}
      <SettingRow name="Bloquear sozinho" description="Depois de um tempo sem uso do app." htmlFor="settings-lock-after">
        <Select
          id="settings-lock-after"
          value={String(settings.lockAfterMinutes)}
          options={MINUTE_OPTIONS}
          onChange={(value) => void update({ lockAfterMinutes: Number(value) as LockAfterMinutes })}
        />
      </SettingRow>
      <SettingRow name="Bloquear quando o Mac bloquear a tela ou dormir" nameId="settings-lock-system" description="Junto com o bloqueio de tela do macOS.">
        <Switch checked={settings.lockOnSystemLock} labelledBy="settings-lock-system" onChange={(lockOnSystemLock) => void update({ lockOnSystemLock })} />
      </SettingRow>
      <SettingRow name="Pedir senha ao abrir" nameId="settings-lock-launch" description="O app abre já bloqueado.">
        <Switch checked={settings.lockOnLaunch} labelledBy="settings-lock-launch" onChange={(lockOnLaunch) => void update({ lockOnLaunch })} />
      </SettingRow>
    </Section>
  )
}

interface PasswordFormProps {
  mode: FormMode
  onCancel: () => void
  onDone: () => void
}

/** Campos de "Criar senha", "Trocar senha" e "Remover senha", dentro do bloco (nunca modal). */
function PasswordForm({ mode, onCancel, onDone }: PasswordFormProps) {
  const setPassword = useLock((state) => state.setPassword)
  const removePassword = useLock((state) => state.removePassword)
  const retryUntil = useLock((state) => state.retryUntil)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const asksCurrent = mode !== 'create'
  const asksNext = mode !== 'remove'

  const message = (result: LockResult): string => {
    if (result === 'wrong') return 'Senha atual incorreta.'
    if (result === 'wait') return `Muitas tentativas. Tente de novo em ${retryLabel(retryUntil - Date.now())}.`
    if (result === 'invalid') return `A senha precisa ter de ${LOCK_PASSWORD_MIN} a ${LOCK_PASSWORD_MAX} caracteres.`
    return 'Não foi possível salvar. Tente de novo.'
  }

  const submit = async (): Promise<void> => {
    if (busy) return
    if (asksNext) {
      const length = passwordLength(next)
      if (length < LOCK_PASSWORD_MIN || length > LOCK_PASSWORD_MAX) return setError(`A senha precisa ter de ${LOCK_PASSWORD_MIN} a ${LOCK_PASSWORD_MAX} caracteres.`)
      if (next !== confirm) return setError('As duas senhas não são iguais.')
    }
    if (asksCurrent && current === '') return setError('Digite a senha atual.')
    setBusy(true)
    const result = mode === 'remove' ? await removePassword(current) : await setPassword(asksCurrent ? current : null, next)
    setBusy(false)
    setCurrent('')
    if (result === 'ok') return onDone()
    setError(message(result))
  }

  const field = (id: string, label: string, value: string, onChange: (value: string) => void) => (
    <div className="grid grid-cols-[minmax(0,1fr)_var(--settings-control-width)] items-center gap-x-6">
      <label htmlFor={id} className="text-13 font-medium text-text">
        {label}
      </label>
      <div className="flex">
        <TextField
          id={id}
          type="password"
          value={value}
          onChange={(text) => {
            onChange(text)
            if (error) setError(null)
          }}
          onEnter={() => void submit()}
          maxLength={256}
          describedBy={error ? 'lock-form-error' : undefined}
        />
      </div>
    </div>
  )

  return (
    <div data-lock-password-form={mode} className="flex flex-col gap-2.5 py-3">
      {asksCurrent && field('lock-current', 'Senha atual', current, setCurrent)}
      {asksNext && field('lock-next', 'Nova senha', next, setNext)}
      {asksNext && field('lock-confirm', 'Confirmar a senha', confirm, setConfirm)}
      {asksNext && <p className="text-12 text-text-muted">De {LOCK_PASSWORD_MIN} a {LOCK_PASSWORD_MAX} caracteres.</p>}
      {error && (
        <p id="lock-form-error" role="alert" data-lock-form-error className="text-13 text-rec">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button action="lock-password-cancel" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button action="lock-password-save" variant={mode === 'remove' ? 'danger' : 'primary'} onClick={() => void submit()} disabled={busy}>
          {mode === 'create' ? 'Criar senha' : mode === 'change' ? 'Trocar senha' : 'Remover senha'}
        </Button>
      </div>
    </div>
  )
}
