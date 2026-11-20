import { CircleCheck, Info, KeyRound, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { EMAIL_POLL_MINUTES, EMAIL_SECURITY, type EmailAccountInput, type EmailAccountStatus, type EmailPollMinutes, type EmailProtocol, type EmailSecurity, type EmailTestResult, type EmailAutoconfig } from '@shared/email'
import { EMAIL_ACCOUNTS_DESCRIPTION, EMAIL_POLL_DESCRIPTION } from '@shared/settings-index'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { CONTROL_CLASS, Select, TextField } from '../../design/Field'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { Segmented } from '../../design/Segmented'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { useEmail } from '../email/emailStore'
import { accountLabel, accountStateLabel, isGmailAddress } from '../email/format'

const POLL_OPTIONS = EMAIL_POLL_MINUTES.map((value) => ({ value: String(value) as `${EmailPollMinutes}`, label: value === 60 ? '1 hora' : `${value} min` }))
const SECURITY_LABELS: Record<EmailSecurity, string> = { tls: 'TLS', starttls: 'STARTTLS', none: 'Nenhuma' }
const SECURITY_OPTIONS = EMAIL_SECURITY.map((value) => ({ value, label: SECURITY_LABELS[value] }))
const PROTOCOLS: { value: EmailProtocol; label: string }[] = [
  { value: 'imap', label: 'IMAP' },
  { value: 'pop3', label: 'POP3' },
]
const ADD_ERRORS = { invalid: 'Confira o endereço, a senha e os servidores.', duplicate: 'Esta conta já está no app.', encryption: 'O macOS não deixou cifrar a senha neste Mac.' } as const

/** O formulário de "Adicionar conta": o que a pessoa digitou (as portas ainda como texto). */
interface Form {
  address: string
  password: string
  name: string
  username: string
  protocol: EmailProtocol
  inHost: string
  inPort: string
  inSecurity: EmailSecurity
  outHost: string
  outPort: string
  outSecurity: EmailSecurity
  deleteFromServer: boolean
}

const emptyForm = (): Form => ({ address: '', password: '', name: '', username: '', protocol: 'imap', inHost: '', inPort: '993', inSecurity: 'tls', outHost: '', outPort: '465', outSecurity: 'tls', deleteFromServer: false })

/** O domínio do endereço, para o palpite de servidor quando o autoconfig não acha nada. */
const domainOf = (address: string): string => address.split('@')[1]?.trim().toLowerCase() ?? ''

function toInput(form: Form): EmailAccountInput {
  return {
    address: form.address.trim(),
    password: form.password,
    ...(form.name.trim() ? { name: form.name.trim() } : {}),
    ...(form.username.trim() ? { username: form.username.trim() } : {}),
    incoming: { protocol: form.protocol, host: form.inHost.trim(), port: Number(form.inPort), security: form.inSecurity },
    outgoing: { host: form.outHost.trim(), port: Number(form.outPort), security: form.outSecurity },
    ...(form.protocol === 'pop3' ? { deleteFromServer: form.deleteFromServer } : {}),
  }
}

function TextInput({ id, label, value, onChange, type = 'text', placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: 'text' | 'password'; placeholder?: string }) {
  return (
    <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
      <label htmlFor={id} className="text-12 font-medium text-text">
        {label}
      </label>
      <TextField id={id} type={type} value={value} onChange={onChange} {...(placeholder ? { placeholder } : {})} />
    </div>
  )
}

/** Um servidor (recebimento ou envio): nome, porta e segurança. */
function ServerFields({ prefix, title, host, port, security, onChange }: { prefix: string; title: string; host: string; port: string; security: EmailSecurity; onChange: (patch: { host?: string; port?: string; security?: EmailSecurity }) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-12 font-bold text-text-muted">{title}</legend>
      <div className="flex flex-wrap gap-3">
        <TextInput id={`${prefix}-host`} label="Servidor" value={host} onChange={(value) => onChange({ host: value })} placeholder="imap.exemplo.com" />
        <div className="flex w-24 flex-col gap-1.5">
          <label htmlFor={`${prefix}-port`} className="text-12 font-medium text-text">
            Porta
          </label>
          <input id={`${prefix}-port`} inputMode="numeric" value={port} onChange={(event) => onChange({ port: event.target.value.replace(/\D/g, '').slice(0, 5) })} className={`${CONTROL_CLASS} w-full px-3 tabular select-text`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefix}-security`} className="text-12 font-medium text-text">
            Segurança
          </label>
          <Select id={`${prefix}-security`} value={security} options={SECURITY_OPTIONS} onChange={(value) => onChange({ security: value })} />
        </div>
      </div>
    </fieldset>
  )
}

/** "IMAP · imap.gmail.com" ou "POP3 · a cada 5 min" (contrato 55, CA15). */
export function accountServerLine(account: EmailAccountStatus['account'], pollMinutes: EmailPollMinutes): string {
  return account.incoming.protocol === 'pop3' ? `POP3 · a cada ${pollMinutes === 60 ? '1 hora' : `${pollMinutes} min`}` : `IMAP · ${account.incoming.host}`
}

function AccountLine({ status, label }: { status: EmailAccountStatus; label: string }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const pollMinutes = useSettings((state) => state.settings.emailPollMinutes)
  const { account, state, error } = status
  const remove = (): void => {
    setBusy(true)
    void window.__scribeApi.invoke('scribe:email-remove-account', { accountId: account.id }).finally(() => {
      setBusy(false)
      setConfirm(false)
    })
  }
  return (
    <li data-email-settings-account={account.id} data-email-settings-state={state} className="flex flex-col gap-2 border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span aria-hidden="true" className={`mt-1.5 size-1.5 shrink-0 ${state === 'error' ? 'bg-rec' : state === 'connected' ? 'bg-accent' : 'bg-text-faint'}`} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate text-13 text-text">
              <span className="font-bold">{label}</span> {account.address}
            </p>
            <p data-email-settings-line className="truncate text-12 text-text-muted">
              {accountServerLine(account, pollMinutes)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span data-email-settings-status className={`text-12 ${state === 'error' ? 'text-rec' : 'text-text-muted'}`} aria-live="polite">
            {accountStateLabel(state, error)}
          </span>
          {!confirm && (
            <Button action="email-remove-account" variant="danger" onClick={() => setConfirm(true)}>
              Remover
            </Button>
          )}
        </div>
      </div>
      {confirm && (
        <Note
          id="email-remove-confirm"
          icon={TriangleAlert}
          role="alert"
          action={
            <div className="flex gap-2">
              <Button action="email-remove-confirm" variant="danger" onClick={remove} disabled={busy}>
                Remover
              </Button>
              <Button action="email-remove-cancel" variant="secondary" onClick={() => setConfirm(false)}>
                Cancelar
              </Button>
            </div>
          }
        >
          Remover {account.address} do app? As mensagens guardadas neste Mac saem; nada é apagado no servidor.
        </Note>
      )}
    </li>
  )
}

type Step = 'closed' | 'credentials' | 'servers'

/**
 * Configurações › Email › Contas (contrato 43, CA5; contrato 55, CA15: saiu da aba Contas para a aba Email): as contas
 * com o servidor e o estado de cada uma e "Remover" (com confirmação); "Adicionar conta" em dois passos: o email e a
 * senha (no Gmail, a dica da senha de app) e, depois do autoconfig, os servidores encontrados, com "Configuração
 * avançada" para editar e "Testar conexão" antes de adicionar. Mais o intervalo do POP3.
 */
export function EmailSection() {
  const accounts = useEmail((state) => state.accounts)
  const pollMinutes = useSettings((state) => state.settings.emailPollMinutes)
  const update = useSettings((state) => state.update)
  const [step, setStep] = useState<Step>('closed')
  const [form, setForm] = useState<Form>(emptyForm)
  const [advanced, setAdvanced] = useState(false)
  const [found, setFound] = useState<EmailAutoconfig['source'] | null>(null)
  const [busy, setBusy] = useState<'autoconfig' | 'test' | 'add' | null>(null)
  const [test, setTest] = useState<EmailTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Form>): void => {
    setForm((current) => ({ ...current, ...patch }))
    setTest(null)
  }

  const close = (): void => {
    setStep('closed')
    setForm(emptyForm())
    setAdvanced(false)
    setFound(null)
    setTest(null)
    setError(null)
  }

  const next = (): void => {
    if (!form.address.trim() || !form.password) {
      setError('Escreva o email e a senha.')
      return
    }
    setError(null)
    setBusy('autoconfig')
    void window.__scribeApi.invoke('scribe:email-autoconfig', { address: form.address.trim() }).then(
      (config) => {
        setBusy(null)
        if (config) {
          setFound(config.source)
          set({
            username: config.username === form.address.trim() ? '' : config.username,
            protocol: config.incoming.protocol,
            inHost: config.incoming.host,
            inPort: String(config.incoming.port),
            inSecurity: config.incoming.security,
            outHost: config.outgoing.host,
            outPort: String(config.outgoing.port),
            outSecurity: config.outgoing.security,
          })
          setAdvanced(false)
        } else {
          // Nada encontrado: os palpites de sempre, já abertos para editar.
          const domain = domainOf(form.address)
          setFound(null)
          set({ inHost: domain ? `imap.${domain}` : '', inPort: '993', inSecurity: 'tls', outHost: domain ? `smtp.${domain}` : '', outPort: '465', outSecurity: 'tls' })
          setAdvanced(true)
        }
        setStep('servers')
      },
      () => {
        setBusy(null)
        setError('Não foi possível procurar os servidores. Preencha na configuração avançada.')
        setAdvanced(true)
        setStep('servers')
      },
    )
  }

  const runTest = (): void => {
    setBusy('test')
    setTest(null)
    void window.__scribeApi.invoke('scribe:email-test', toInput(form)).then(
      (result) => {
        setBusy(null)
        setTest(result)
      },
      () => {
        setBusy(null)
        setTest({ ok: false, stage: 'incoming', error: 'Erro ao falar com o servidor.' })
      },
    )
  }

  const add = (): void => {
    setBusy('add')
    setError(null)
    void window.__scribeApi.invoke('scribe:email-add-account', toInput(form)).then(
      (result) => {
        setBusy(null)
        if (result.ok) close()
        else setError(ADD_ERRORS[result.error])
      },
      () => {
        setBusy(null)
        setError(ADD_ERRORS.invalid)
      },
    )
  }

  const testText = test ? (test.ok ? 'Conexão funcionando: recebimento e envio.' : test.stage === 'invalid' ? test.error : `${test.stage === 'incoming' ? 'Recebimento' : 'Envio'}: ${test.error}`) : null
  const summary = `${form.protocol.toUpperCase()} ${form.inHost}:${form.inPort} (${SECURITY_LABELS[form.inSecurity]}) e SMTP ${form.outHost}:${form.outPort} (${SECURITY_LABELS[form.outSecurity]})`

  return (
    <Section title="Contas">
      <div className="flex flex-col gap-2.5 py-3" data-setting-row data-setting-name="Contas de email" data-setting-description={EMAIL_ACCOUNTS_DESCRIPTION} data-email-settings>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-13 font-medium text-text">Contas de email</p>
            <p className="text-12 text-text-muted">{EMAIL_ACCOUNTS_DESCRIPTION}</p>
          </div>
          {step === 'closed' && (
            <div data-setting-control="end" className="flex shrink-0 items-center gap-2">
              <Button action="email-add-account" variant="secondary" onClick={() => setStep('credentials')}>
                Adicionar conta
              </Button>
            </div>
          )}
        </div>

        {accounts && accounts.length > 0 && (
          <ul data-email-settings-accounts className="flex flex-col rounded-[var(--radius-panel)] border border-line px-3">
            {accounts.map((status) => (
              <AccountLine key={status.account.id} status={status} label={accountLabel(accounts.map((item) => item.account), status.account)} />
            ))}
          </ul>
        )}

        {step !== 'closed' && (
          <div data-email-add-panel={step} className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-bg-sunken p-3">
            <div className="flex flex-wrap gap-3">
              <TextInput id="email-add-address" label="Email" value={form.address} onChange={(address) => set({ address })} placeholder="voce@empresa.com.br" />
              <TextInput id="email-add-password" label="Senha" type="password" value={form.password} onChange={(password) => set({ password })} />
            </div>
            {isGmailAddress(form.address) && (
              <Note id="email-gmail-hint" icon={KeyRound} role="status">
                No Gmail, use uma senha de app do Google (Conta Google › Segurança › Senhas de app), não a senha de sempre.
              </Note>
            )}

            {step === 'credentials' && (
              <div className="flex flex-wrap gap-2">
                <Button action="email-add-next" onClick={next} disabled={busy !== null}>
                  {busy === 'autoconfig' ? 'Procurando os servidores…' : 'Continuar'}
                </Button>
                <Button action="email-add-cancel" variant="secondary" onClick={close}>
                  Cancelar
                </Button>
              </div>
            )}

            {step === 'servers' && (
              <>
                <p data-email-autoconfig={found ?? 'manual'} className="text-12 text-text-muted">
                  {found ? `Servidores encontrados: ${summary}.` : 'Os servidores desta conta não foram encontrados sozinhos. Confira abaixo.'}
                </p>
                <div>
                  <button
                    type="button"
                    data-action="email-advanced"
                    aria-expanded={advanced}
                    onClick={() => setAdvanced(!advanced)}
                    className="no-drag text-13 font-medium text-accent underline decoration-1 underline-offset-3"
                  >
                    Configuração avançada
                  </button>
                </div>
                {advanced && (
                  <div data-email-advanced className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-3">
                      <TextInput id="email-add-name" label="Seu nome (no De:)" value={form.name} onChange={(name) => set({ name })} placeholder="Opcional" />
                      <TextInput id="email-add-username" label="Usuário" value={form.username} onChange={(username) => set({ username })} placeholder="O próprio email" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <p id="email-add-protocol" className="text-12 font-medium text-text">
                        Receber por
                      </p>
                      <Segmented
                        value={form.protocol}
                        options={PROTOCOLS}
                        labelledBy="email-add-protocol"
                        dataName="email-protocol-option"
                        onChange={(protocol) => set(protocol === 'pop3' ? { protocol, inPort: form.inSecurity === 'tls' ? '995' : '110' } : { protocol, inPort: form.inSecurity === 'tls' ? '993' : '143' })}
                      />
                    </div>
                    <ServerFields
                      prefix="email-add-in"
                      title="Recebimento"
                      host={form.inHost}
                      port={form.inPort}
                      security={form.inSecurity}
                      onChange={(patch) => set({ ...(patch.host !== undefined ? { inHost: patch.host } : {}), ...(patch.port !== undefined ? { inPort: patch.port } : {}), ...(patch.security ? { inSecurity: patch.security } : {}) })}
                    />
                    <ServerFields
                      prefix="email-add-out"
                      title="Envio (SMTP)"
                      host={form.outHost}
                      port={form.outPort}
                      security={form.outSecurity}
                      onChange={(patch) => set({ ...(patch.host !== undefined ? { outHost: patch.host } : {}), ...(patch.port !== undefined ? { outPort: patch.port } : {}), ...(patch.security ? { outSecurity: patch.security } : {}) })}
                    />
                    {form.protocol === 'pop3' && (
                      <div className="flex items-center gap-3">
                        <Switch checked={form.deleteFromServer} labelledBy="email-add-delete" onChange={(deleteFromServer) => set({ deleteFromServer })} />
                        <p id="email-add-delete" className="text-12 text-text">
                          Apagar do servidor depois de baixar
                        </p>
                      </div>
                    )}
                    {(form.inSecurity === 'none' || form.outSecurity === 'none') && (
                      <Note id="email-insecure" icon={Info} role="status">
                        Sem segurança, a senha e as mensagens passam sem proteção pela rede.
                      </Note>
                    )}
                  </div>
                )}
                {testText && (
                  <Note id={test?.ok ? 'email-test-ok' : 'email-test-error'} icon={test?.ok ? CircleCheck : TriangleAlert} role={test?.ok ? 'status' : 'alert'}>
                    {testText}
                  </Note>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button action="email-add-confirm" onClick={add} disabled={busy !== null}>
                    {busy === 'add' ? 'Adicionando…' : 'Adicionar conta'}
                  </Button>
                  <Button action="email-test" variant="secondary" onClick={runTest} disabled={busy !== null}>
                    {busy === 'test' ? 'Testando…' : 'Testar conexão'}
                  </Button>
                  <Button action="email-add-back" variant="secondary" onClick={() => setStep('credentials')} disabled={busy !== null}>
                    Voltar
                  </Button>
                  <Button action="email-add-cancel" variant="secondary" onClick={close}>
                    Cancelar
                  </Button>
                </div>
              </>
            )}
            {error && (
              <Note id="email-add-error" icon={TriangleAlert} role="alert">
                {error}
              </Note>
            )}
          </div>
        )}
      </div>
      <SettingRow name="Buscar emails novos a cada" description={EMAIL_POLL_DESCRIPTION} htmlFor="settings-email-poll">
        <Select id="settings-email-poll" value={String(pollMinutes) as `${EmailPollMinutes}`} options={POLL_OPTIONS} onChange={(value) => void update({ emailPollMinutes: Number(value) as EmailPollMinutes })} />
      </SettingRow>
    </Section>
  )
}
