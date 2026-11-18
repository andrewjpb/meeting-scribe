import { KeyRound, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { microsoftAccountLine, microsoftClientSaveErrorText, microsoftSignInErrorText, MICROSOFT_HELP } from './microsoftFormat'
import { useMicrosoft, watchMicrosoftState } from './microsoftStore'

export const MICROSOFT_CLIENT_ID_INPUT = 'microsoft-client-id'

/**
 * Configurações › Contas (contrato 12, CA1): o bloco "Microsoft". Sem cadastro, "Configurar…" abre o painel com o
 * "ID do aplicativo (cliente)" do Microsoft Entra (vai ao main, cifrado, e nunca volta inteiro); com cadastro,
 * "Entrar com Microsoft" abre o navegador; logado, a foto, o nome, o e-mail e "Sair".
 */
export function MicrosoftSection() {
  const status = useMicrosoft((state) => state.status)
  const busy = useMicrosoft((state) => state.busy)
  const loadFailed = useMicrosoft((state) => state.loadFailed)
  const [configuring, setConfiguring] = useState(false)
  const [clientId, setClientId] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void useMicrosoft.getState().load()
    return watchMicrosoftState()
  }, [])

  const save = (): void => {
    if (busy) return
    if (!clientId.trim()) {
      document.getElementById(MICROSOFT_CLIENT_ID_INPUT)?.focus()
      return
    }
    void useMicrosoft
      .getState()
      .saveClient(clientId.trim())
      .then((error) => {
        if (error) {
          setSaveError(microsoftClientSaveErrorText(error))
          return
        }
        setSaveError(null)
        setClientId('')
        setConfiguring(false)
      })
  }

  const cancelConfigure = (): void => {
    setConfiguring(false)
    setSaveError(null)
    setClientId('')
  }

  const state = status?.state ?? 'signed-out'
  const connected = state === 'signed-in' || state === 'expired'
  const configured = status?.client.configured ?? false
  const errorText = microsoftSignInErrorText(status?.error ?? null, status?.profile?.email ?? null)
  const profile = connected ? status?.profile : null

  return (
    <Section title="Microsoft">
      <div
        className="flex flex-col gap-3 py-4"
        data-setting-row
        data-setting-name="Conta Microsoft"
        data-setting-description="Entrar com a conta Microsoft para ler a agenda do Outlook."
        data-microsoft-state={status ? (configured ? state : 'unconfigured') : 'loading'}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            {profile?.photo && <img data-microsoft-photo src={profile.photo} alt="" width={32} height={32} draggable={false} className="size-8 shrink-0 rounded-[var(--radius-control)] object-cover" />}
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="truncate text-13 font-medium text-text" data-microsoft-name>
                {profile?.name || 'Conta Microsoft'}
              </p>
              <p className={`truncate text-12 ${state === 'expired' ? 'text-rec' : 'text-text-muted'}`} data-microsoft-line aria-live="polite">
                {state === 'expired' && profile?.email ? `${profile.email} · ${microsoftAccountLine(status)}` : microsoftAccountLine(status)}
              </p>
            </div>
          </div>
          <div data-setting-control="end" className="flex shrink-0 flex-wrap items-center gap-2">
            {status && state === 'signed-out' && !configuring && (
              <Button action="microsoft-configure" variant="secondary" onClick={() => setConfiguring(true)}>
                Configurar…
              </Button>
            )}
            {configured && state === 'signed-out' && !configuring && (
              <Button action="microsoft-sign-in" onClick={() => void useMicrosoft.getState().signIn()}>
                Entrar com Microsoft
              </Button>
            )}
            {state === 'signing-in' && (
              <Button action="microsoft-sign-in-cancel" variant="secondary" onClick={() => void useMicrosoft.getState().cancel()}>
                Cancelar
              </Button>
            )}
            {state === 'expired' && (
              <Button action="microsoft-sign-in" onClick={() => void useMicrosoft.getState().signIn()}>
                Entrar com Microsoft
              </Button>
            )}
            {connected && (
              <Button action="microsoft-sign-out" variant="secondary" disabled={busy !== null} onClick={() => void useMicrosoft.getState().signOut()}>
                Sair
              </Button>
            )}
          </div>
        </div>

        {configuring && (
          <div data-microsoft-client-panel className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-bg-sunken p-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={MICROSOFT_CLIENT_ID_INPUT} className="text-12 font-medium text-text">
                ID do aplicativo (cliente)
              </label>
              <TextField id={MICROSOFT_CLIENT_ID_INPUT} value={clientId} onChange={setClientId} onEnter={save} placeholder="00000000-0000-0000-0000-000000000000" describedBy="microsoft-client-help" />
            </div>
            <p id="microsoft-client-help" className="text-12 text-text-muted">
              {MICROSOFT_HELP} Não precisa de chave secreta. O ID fica cifrado neste Mac, protegido pelo Chaveiro do macOS.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button action="microsoft-client-save" onClick={save} disabled={busy !== null}>
                Salvar
              </Button>
              <Button action="microsoft-client-cancel" variant="secondary" onClick={cancelConfigure}>
                Cancelar
              </Button>
            </div>
            {saveError && (
              <Note id="microsoft-client-error" icon={KeyRound} role="alert">
                {saveError}
              </Note>
            )}
          </div>
        )}

        {errorText && !configuring && state !== 'signing-in' && (
          <Note id="microsoft-sign-in-error" icon={TriangleAlert} role="alert">
            {errorText}
          </Note>
        )}
        {loadFailed && (
          <Note id="microsoft-load-failed" icon={TriangleAlert} role="alert">
            Não foi possível ler o estado da conta Microsoft.
          </Note>
        )}
      </div>
    </Section>
  )
}
