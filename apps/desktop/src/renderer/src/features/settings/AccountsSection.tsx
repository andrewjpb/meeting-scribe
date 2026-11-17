import { KeyRound, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { accountLine, clientSaveErrorText, DRIVE_HELP, GOOGLE_HELP, signInErrorText } from './googleFormat'
import { useGoogle, watchGoogleState } from './googleStore'

export const GOOGLE_CLIENT_ID_INPUT = 'google-client-id'
export const GOOGLE_CLIENT_SECRET_INPUT = 'google-client-secret'

/**
 * Configurações › Contas (contrato 11): o bloco "Google". Sem cadastro, "Configurar…" abre o painel com o ID e a
 * chave secreta do cliente (que vão ao main e nunca voltam); com cadastro, "Entrar com Google" abre o navegador;
 * logado, a foto, o nome, o e-mail, "Sair" e o interruptor "Guardar no Google Drive". Contrato 12: quem entrou antes
 * da agenda vê "Permitir acesso à agenda" (o consentimento só com o escopo que falta). A Microsoft fica no bloco
 * seguinte (`MicrosoftSection`).
 */
export function AccountsSection() {
  const status = useGoogle((state) => state.status)
  const busy = useGoogle((state) => state.busy)
  const loadFailed = useGoogle((state) => state.loadFailed)
  const saveToDrive = useSettings((state) => state.settings.saveToDrive)
  const update = useSettings((state) => state.update)
  const [configuring, setConfiguring] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void useGoogle.getState().load()
    return watchGoogleState()
  }, [])

  const save = (): void => {
    if (busy) return
    if (!clientId.trim()) {
      document.getElementById(GOOGLE_CLIENT_ID_INPUT)?.focus()
      return
    }
    if (!clientSecret.trim()) {
      document.getElementById(GOOGLE_CLIENT_SECRET_INPUT)?.focus()
      return
    }
    void useGoogle
      .getState()
      .saveClient(clientId.trim(), clientSecret.trim())
      .then((error) => {
        if (error) {
          setSaveError(clientSaveErrorText(error))
          return
        }
        // Guardado: os campos se esvaziam (a chave não fica na tela) e o painel fecha.
        setSaveError(null)
        setClientId('')
        setClientSecret('')
        setConfiguring(false)
      })
  }

  const cancelConfigure = (): void => {
    setConfiguring(false)
    setSaveError(null)
    setClientId('')
    setClientSecret('')
  }

  const state = status?.state ?? 'signed-out'
  const connected = state === 'signed-in' || state === 'expired'
  const configured = status?.client.configured ?? false
  const errorText = signInErrorText(status?.error ?? null, status?.profile?.email ?? null)
  const profile = connected ? status?.profile : null

  return (
    <Section title="Google">
      <div
        className="flex flex-col gap-3 py-4"
        data-setting-row
        data-setting-name="Conta Google"
        data-setting-description="Entrar com a conta Google para guardar as reuniões no Drive."
        data-google-state={status ? (configured ? state : 'unconfigured') : 'loading'}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            {profile?.photo && <img data-google-photo src={profile.photo} alt="" width={32} height={32} draggable={false} className="size-8 shrink-0 rounded-[var(--radius-control)] object-cover" />}
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="truncate text-13 font-medium text-text" data-google-name>
                {profile?.name || 'Conta Google'}
              </p>
              <p className={`truncate text-12 ${state === 'expired' ? 'text-rec' : 'text-text-muted'}`} data-google-line aria-live="polite">
                {connected && state === 'expired' && profile?.email ? `${profile.email} · ${accountLine(status)}` : accountLine(status)}
              </p>
            </div>
          </div>
          <div data-setting-control className="flex shrink-0 flex-wrap items-center gap-2">
            {status && !configured && !configuring && (
              <Button action="google-configure" variant="secondary" onClick={() => setConfiguring(true)}>
                Configurar…
              </Button>
            )}
            {configured && state === 'signed-out' && !configuring && (
              <>
                <Button action="google-configure" variant="secondary" onClick={() => setConfiguring(true)}>
                  Configurar…
                </Button>
                <Button action="google-sign-in" onClick={() => void useGoogle.getState().signIn()}>
                  Entrar com Google
                </Button>
              </>
            )}
            {state === 'signing-in' && (
              <Button action="google-sign-in-cancel" variant="secondary" onClick={() => void useGoogle.getState().cancel()}>
                Cancelar
              </Button>
            )}
            {state === 'expired' && (
              <Button action="google-sign-in" onClick={() => void useGoogle.getState().signIn()}>
                Entrar com Google
              </Button>
            )}
            {state === 'signed-in' && !status?.calendar && (
              <Button action="google-calendar-grant" variant="secondary" onClick={() => void useGoogle.getState().grantCalendar()}>
                Permitir acesso à agenda
              </Button>
            )}
            {connected && (
              <Button action="google-sign-out" variant="secondary" disabled={busy !== null} onClick={() => void useGoogle.getState().signOut()}>
                Sair
              </Button>
            )}
          </div>
        </div>

        {configuring && (
          <div data-google-client-panel className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-bg-sunken p-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={GOOGLE_CLIENT_ID_INPUT} className="text-12 font-medium text-text">
                ID do cliente
              </label>
              <TextField id={GOOGLE_CLIENT_ID_INPUT} value={clientId} onChange={setClientId} onEnter={save} placeholder="…apps.googleusercontent.com" describedBy="google-client-help" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={GOOGLE_CLIENT_SECRET_INPUT} className="text-12 font-medium text-text">
                Chave secreta do cliente
              </label>
              <TextField id={GOOGLE_CLIENT_SECRET_INPUT} type="password" value={clientSecret} onChange={setClientSecret} onEnter={save} describedBy="google-client-help" />
            </div>
            <p id="google-client-help" className="text-12 text-text-muted">
              {GOOGLE_HELP} Os dois ficam cifrados neste Mac, protegidos pelo Chaveiro do macOS.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button action="google-client-save" onClick={save} disabled={busy !== null}>
                Salvar
              </Button>
              <Button action="google-client-cancel" variant="secondary" onClick={cancelConfigure}>
                Cancelar
              </Button>
            </div>
            {saveError && (
              <Note id="google-client-error" icon={KeyRound} role="alert">
                {saveError}
              </Note>
            )}
          </div>
        )}

        {errorText && !configuring && state !== 'signing-in' && (
          <Note id="google-sign-in-error" icon={TriangleAlert} role="alert">
            {errorText}
          </Note>
        )}
        {loadFailed && (
          <Note id="google-load-failed" icon={TriangleAlert} role="alert">
            Não foi possível ler o estado da conta Google.
          </Note>
        )}
      </div>
      {connected && (
        <SettingRow name="Guardar no Google Drive" nameId="settings-save-drive" description={DRIVE_HELP}>
          <Switch checked={saveToDrive} labelledBy="settings-save-drive" onChange={(value) => void update({ saveToDrive: value })} />
        </SettingRow>
      )}
    </Section>
  )
}
