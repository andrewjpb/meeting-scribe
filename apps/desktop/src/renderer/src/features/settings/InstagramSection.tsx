import { KeyRound, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { INSTAGRAM_PREREQUISITE, INSTAGRAM_SECTION_DESCRIPTION, INSTAGRAM_TOKEN_DESCRIPTION } from '@shared/settings-index'
import { INSTAGRAM_ANCHOR } from '@shared/routes'
import type { RedesAccount } from '@shared/redes'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { LapSymbol } from '../../design/LapSymbol'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { accountLine, REDES_STATE_LABELS } from '../redes/redesFormat'
import { useRedes, watchRedes } from '../redes/redesStore'

export const INSTAGRAM_TOKEN_INPUT = 'redes-instagram-token'

/** Os 4 passos no painel da Meta (artboard 01 do mockup redes-instagram). */
const STEPS = [
  <>
    Em <b className="font-medium text-title">developers.facebook.com</b>, abra o seu app do tipo Business e adicione o produto <b className="font-medium text-title">Instagram</b>.
  </>,
  <>
    Em <b className="font-medium text-title">Funções do app › Testadores do Instagram</b>, adicione a conta e aceite o convite no Instagram (Configurações › Apps e sites).
  </>,
  <>
    Em <b className="font-medium text-title">Instagram › API setup with Instagram login › Generate token</b>, clique em Generate token ao lado da conta e entre com ela.
  </>,
  <>Copie o token (começa com IGAA) e cole acima. Ele vale 60 dias; o app renova sozinho enquanto estiver em uso.</>,
]

/**
 * Configurações › Contas (contrato 69, R2): a seção "Instagram". O token colado vai ao main, que confere no `/me` e
 * guarda só cifrado; o campo limpa depois de conectar e o token não volta para a tela. Cada conta conectada mostra a
 * foto, o @, o tipo, os seguidores e a validade do token, com "Renovar agora" e "Remover" (confirmação na linha).
 */
export function InstagramSection() {
  const accounts = useRedes((state) => state.state?.accounts ?? null)
  const busy = useRedes((state) => state.busy)
  const loadFailed = useRedes((state) => state.loadFailed)
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void useRedes.getState().load()
    return watchRedes()
  }, [])

  const connecting = busy?.kind === 'connect'
  const connect = (): void => {
    if (busy || !token.trim()) {
      document.getElementById(INSTAGRAM_TOKEN_INPUT)?.focus()
      return
    }
    void useRedes
      .getState()
      .connect(token.trim())
      .then((result) => {
        if (result.ok) {
          setToken('')
          setError(null)
        } else setError(result.error)
      })
  }

  return (
    <Section title="Instagram" description={INSTAGRAM_SECTION_DESCRIPTION} anchor={INSTAGRAM_ANCHOR}>
      <div data-setting-row data-setting-name="Token de acesso" data-setting-description={INSTAGRAM_TOKEN_DESCRIPTION} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
          <label htmlFor={INSTAGRAM_TOKEN_INPUT} className="text-13 font-medium text-text">
            Token de acesso
          </label>
          <p id="redes-instagram-token-help" className="text-12 text-text-muted">
            {INSTAGRAM_TOKEN_DESCRIPTION}
          </p>
        </div>
        <div data-setting-control="end" className="flex min-w-0 flex-[1_1_380px] items-center gap-2">
          <TextField
            id={INSTAGRAM_TOKEN_INPUT}
            type="password"
            value={token}
            onChange={(value) => {
              setToken(value)
              if (error) setError(null)
            }}
            onEnter={connect}
            placeholder="Cole o token aqui"
            describedBy="redes-instagram-token-help"
            disabled={connecting}
            data={{ 'data-redes-token': '' }}
          />
          <Button action="redes-connect" data={{ 'data-redes-connect': '' }} onClick={connect} disabled={busy !== null || !token.trim()}>
            {connecting ? 'Conectando…' : 'Conectar'}
          </Button>
        </div>
      </div>

      {error && (
        <div data-redes-error className="py-3">
          <Note id="redes-connect-error" icon={TriangleAlert} role="alert">
            {error}
          </Note>
        </div>
      )}

      <div data-redes-help className="flex flex-col gap-3 bg-bg-sunken py-4">
        <Note id="redes-instagram-prerequisite" icon={KeyRound}>
          {INSTAGRAM_PREREQUISITE}
        </Note>
        <p className="text-13 font-medium text-text">Como gerar o token</p>
        <ol className="flex flex-col gap-2">
          {STEPS.map((step, index) => (
            <li key={index} className="flex gap-3 text-13 text-text">
              <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-bg-raised text-12 font-medium text-title tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 text-pretty">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {accounts?.map((account) => <AccountRow key={account.id} account={account} />)}

      {loadFailed && (
        <div className="py-3">
          <Note id="redes-load-failed" icon={TriangleAlert} role="alert">
            Não foi possível ler as contas do Instagram.
          </Note>
        </div>
      )}
    </Section>
  )
}

function AccountRow({ account }: { account: RedesAccount }) {
  const busy = useRedes((state) => state.busy)
  const [confirming, setConfirming] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const refreshing = busy?.kind === 'refresh' && busy.accountId === account.id
  const problem = account.state === 'expirada' || account.state === 'erro'
  // Só a foto já baixada pelo main (data URL): a CSP não deixa a tela pedir imagem fora do app.
  const photo = account.pictureUrl?.startsWith('data:image/') ? account.pictureUrl : null

  const refresh = (): void => {
    void useRedes
      .getState()
      .refresh(account.id)
      .then((result) => setRefreshError(result.ok ? null : result.error))
  }

  return (
    <div data-redes-account={account.id} className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {photo ? <img src={photo} alt="" width={40} height={40} draggable={false} className="size-10 shrink-0 rounded-[var(--radius-control)] object-cover" /> : <LapSymbol size={40} />}
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate text-13 text-text">
              {account.name && <span className="font-medium">{account.name} </span>}
              <span className={account.name ? 'text-text-muted' : 'font-medium'}>@{account.username}</span>
            </p>
            <p className="truncate text-12 text-text-muted" data-redes-account-line>
              {accountLine(account)}
              {problem && account.error && (
                <>
                  {' · '}
                  <span className="text-rec">{account.error}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div data-setting-control="end" className="flex shrink-0 flex-wrap items-center gap-2">
          <span data-redes-account-state={account.state} className={`text-13 font-medium ${problem ? 'text-rec' : account.state === 'conectada' ? 'text-live' : 'text-text-muted'}`}>
            {REDES_STATE_LABELS[account.state]}
          </span>
          {!confirming && (
            <>
              <Button action="redes-refresh" data={{ 'data-redes-refresh': account.id }} variant="secondary" onClick={refresh} disabled={busy !== null || account.state === 'expirada'}>
                {refreshing ? 'Renovando…' : 'Renovar agora'}
              </Button>
              <Button action="redes-remove" data={{ 'data-redes-remove': account.id }} variant="danger" onClick={() => setConfirming(true)} disabled={busy !== null}>
                Remover
              </Button>
            </>
          )}
        </div>
      </div>

      {confirming && (
        <div data-redes-remove-ask className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[var(--radius-panel)] border border-line bg-bg-sunken px-4 py-3">
          <p className="min-w-0 flex-[1_1_320px] text-13 text-text">
            Remover @{account.username}? Publicações, comentários e mensagens guardados neste Mac serão apagados.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button action="redes-remove-confirm" data={{ 'data-redes-remove-confirm': account.id }} variant="danger" disabled={busy !== null} onClick={() => void useRedes.getState().remove(account.id)}>
              Sim
            </Button>
            <Button action="redes-remove-cancel" variant="secondary" onClick={() => setConfirming(false)}>
              Não
            </Button>
          </div>
        </div>
      )}

      {refreshError && !confirming && (
        <Note id="redes-refresh-error" icon={TriangleAlert} role="alert">
          {refreshError}
        </Note>
      )}
    </div>
  )
}
