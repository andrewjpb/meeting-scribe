import { KeyRound, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { WHATSAPP_NOTIFICATIONS_DESCRIPTION, WHATSAPP_ONLY_PEOPLE_DESCRIPTION } from '@shared/settings-index'
import { WHATSAPP_FIXED_WARNING, WHATSAPP_PAIR_HINT, whatsappStateLabel, type WhatsAppPairing } from '@shared/whatsapp'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { whatsappErrorText } from '../whatsapp/format'
import { QrCode } from '../whatsapp/QrCode'
import { RiskPanel } from '../whatsapp/RiskPanel'
import { useWhatsApp } from '../whatsapp/whatsappStore'

export const WHATSAPP_PHONE_INPUT = 'whatsapp-phone'
/** Intervalo em que o QR é pedido de novo (o WhatsApp troca o código a cada ~20 s). */
const PAIR_POLL_MS = 3000

type Panel = 'risk-install' | 'risk-pair' | 'pairing' | 'remove' | null

/** QR (ou código por número) depois da tela de risco; fecha sozinho quando conecta. */
function PairingPanel({ onClose }: { onClose: () => void }) {
  const [pairing, setPairing] = useState<WhatsAppPairing | null>(null)
  const [failed, setFailed] = useState(false)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const closed = useRef(false)

  useEffect(() => {
    closed.current = false
    const ask = (): void => {
      void window.__scribeApi.invoke('scribe:whatsapp-pair', {}).then(
        (result) => {
          if (closed.current) return
          if ('error' in result) setFailed(true)
          else {
            setFailed(false)
            setPairing(result)
          }
        },
        () => setFailed(true),
      )
    }
    ask()
    const timer = setInterval(ask, PAIR_POLL_MS)
    return () => {
      closed.current = true
      clearInterval(timer)
    }
  }, [])

  const askCode = (): void => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 8) {
      document.getElementById(WHATSAPP_PHONE_INPUT)?.focus()
      return
    }
    void window.__scribeApi.invoke('scribe:whatsapp-pair', { phone: digits }).then(
      (result) => setCode('error' in result ? null : result.code),
      () => setCode(null),
    )
  }

  return (
    <section data-whatsapp-pairing aria-label="Conectar o WhatsApp" className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-line bg-bg-sunken p-4">
      <div className="flex flex-wrap items-start gap-6">
        {pairing?.qr ? <QrCode text={pairing.qr} /> : <div data-whatsapp-qr-loading className="size-[232px] shrink-0 rounded-[var(--radius-control)] bg-bg-raised" />}
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-3">
          <p data-whatsapp-pair-hint className="text-13 font-medium text-text">
            {WHATSAPP_PAIR_HINT}
          </p>
          <p className="text-12 text-text-muted">Aponte a câmera do celular para o QR code. Ele se renova sozinho enquanto esta tela estiver aberta.</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={WHATSAPP_PHONE_INPUT} className="text-12 font-medium text-text">
              Ou conecte pelo número
            </label>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-0 flex-[1_1_160px]">
                <TextField id={WHATSAPP_PHONE_INPUT} value={phone} onChange={setPhone} onEnter={askCode} placeholder="+55 11 91234-5678" />
              </div>
              <Button action="whatsapp-pair-code" variant="secondary" onClick={askCode}>
                Pedir código
              </Button>
            </div>
            {code && (
              <p className="text-13 text-text">
                Digite no celular, em Aparelhos conectados › Conectar com número de telefone:{' '}
                <span data-whatsapp-pair-code className="font-bold tracking-[0.14em] text-title tabular">
                  {code}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>
      {failed && (
        <Note id="whatsapp-pair-failed" icon={TriangleAlert} role="alert">
          Não foi possível pedir o QR code ao serviço. Confira se ele está ligado.
        </Note>
      )}
      <div className="flex flex-wrap gap-2">
        <Button action="whatsapp-pair-close" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </section>
  )
}

/**
 * Configurações › Contas (contrato 24): o bloco "WhatsApp". Mostra o estado do serviço local, instala (depois do
 * aviso de risco), liga e desliga, pareia (o aviso de novo, antes de qualquer QR code), sai da conta e remove. O
 * aviso fixo fica sempre à vista; o recurso é experimental e fica desligado até a pessoa instalar.
 */
export function WhatsAppSection() {
  const status = useWhatsApp((state) => state.status)
  const loadFailed = useWhatsApp((state) => state.loadFailed)
  const [panel, setPanel] = useState<Panel>(null)
  const notifications = useSettings((state) => state.settings.whatsappNotifications)
  const notifyGroups = useSettings((state) => state.settings.whatsappNotifyGroups)
  const update = useSettings((state) => state.update)

  const state = status?.state ?? 'not-installed'
  const busy = status?.busy ?? null
  const invoke = (channel: 'scribe:whatsapp-start' | 'scribe:whatsapp-stop' | 'scribe:whatsapp-logout' | 'scribe:whatsapp-remove' | 'scribe:whatsapp-install'): void => {
    void window.__scribeApi.invoke(channel).then(
      (next) => useWhatsApp.setState({ status: next }),
      () => undefined,
    )
  }

  // Conectou (ou o serviço parou) com o QR aberto: o painel fecha, e o próximo pareamento passa pela tela de risco.
  if (panel === 'pairing' && status && state !== 'pairing' && state !== 'disconnected') setPanel(null)

  const closePairing = (): void => {
    window.__scribeApi.send('scribe:whatsapp-pair-cancel', undefined)
    setPanel(null)
  }

  const accept = (purpose: 'install' | 'pair'): void => {
    void window.__scribeApi.invoke('scribe:whatsapp-risk-accept', { purpose }).then(
      (next) => {
        useWhatsApp.setState({ status: next })
        if (purpose === 'install') {
          setPanel(null)
          invoke('scribe:whatsapp-install')
        } else setPanel('pairing')
      },
      () => setPanel(null),
    )
  }

  const errorText = whatsappErrorText(status?.error ?? null)
  const canPair = state === 'pairing' || state === 'disconnected'
  const running = state === 'pairing' || state === 'connected' || state === 'disconnected' || state === 'banned'

  return (
    <Section title="WhatsApp">
      <div
        className="flex flex-col gap-3 py-4"
        data-setting-row
        data-setting-name="WhatsApp"
        data-setting-description="Ler as suas conversas e enviar mensagens só com o seu clique. Experimental."
        data-whatsapp-state={status ? state : 'loading'}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate text-13 font-medium text-text">WhatsApp</p>
            <p className={`truncate text-12 ${state === 'banned' ? 'text-rec' : 'text-text-muted'}`} data-whatsapp-line aria-live="polite">
              {status ? whatsappStateLabel(status) : 'Não instalado'}
              {status?.progress ? ` · ${status.progress}` : ''}
            </p>
          </div>
          {/* Bloco composto, como o da conta Google: os botões não entram na coluna fixa das linhas de configuração. */}
          <div data-whatsapp-controls className="flex shrink-0 flex-wrap items-center gap-2">
            {state === 'not-installed' && panel === null && (
              <Button action="whatsapp-install" variant="secondary" disabled={busy !== null} onClick={() => setPanel('risk-install')}>
                Instalar
              </Button>
            )}
            {state === 'stopped' && (
              <Button action="whatsapp-start" disabled={busy !== null} onClick={() => invoke('scribe:whatsapp-start')}>
                {busy === 'starting' ? 'Ligando…' : 'Ligar'}
              </Button>
            )}
            {canPair && panel === null && (
              <Button action="whatsapp-pair" disabled={busy !== null} onClick={() => setPanel('risk-pair')}>
                Parear
              </Button>
            )}
            {(state === 'connected' || state === 'banned') && (
              <Button action="whatsapp-logout" variant="secondary" disabled={busy !== null} onClick={() => invoke('scribe:whatsapp-logout')}>
                Sair da conta
              </Button>
            )}
            {running && (
              <Button action="whatsapp-stop" variant="secondary" disabled={busy !== null} onClick={() => invoke('scribe:whatsapp-stop')}>
                Desligar
              </Button>
            )}
            {(state === 'stopped' || state === 'banned') && panel === null && (
              <Button action="whatsapp-remove" variant="danger" disabled={busy !== null} onClick={() => setPanel('remove')}>
                Remover
              </Button>
            )}
          </div>
        </div>

        <Note id="whatsapp-warning" icon={TriangleAlert}>
          {WHATSAPP_FIXED_WARNING}
        </Note>

        {panel === 'risk-install' && <RiskPanel confirmLabel="Instalar" confirmAction="whatsapp-install-confirm" onConfirm={() => accept('install')} onCancel={() => setPanel(null)} />}
        {panel === 'risk-pair' && <RiskPanel confirmLabel="Mostrar QR code" confirmAction="whatsapp-show-qr" onConfirm={() => accept('pair')} onCancel={() => setPanel(null)} />}
        {panel === 'pairing' && <PairingPanel onClose={closePairing} />}
        {panel === 'remove' && (
          <div data-whatsapp-remove-confirm className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-bg-sunken p-4">
            <p className="text-13 text-text">Remover o WhatsApp deste Mac? O ambiente Python, a sessão e as mensagens guardadas são apagados.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                action="whatsapp-remove-confirm"
                variant="danger"
                onClick={() => {
                  setPanel(null)
                  invoke('scribe:whatsapp-remove')
                }}
              >
                Remover
              </Button>
              <Button action="whatsapp-remove-cancel" variant="secondary" onClick={() => setPanel(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {errorText && (
          <Note id="whatsapp-error" icon={KeyRound} role="alert">
            {errorText}
          </Note>
        )}
        {loadFailed && (
          <Note id="whatsapp-load-failed" icon={TriangleAlert} role="alert">
            Não foi possível ler o estado do WhatsApp.
          </Note>
        )}
      </div>
      {/* Contrato 40: as notificações do macOS a cada mensagem recebida; "Só pessoas" deixa os grupos de fora. */}
      <SettingRow name="Notificações do WhatsApp" nameId="settings-whatsapp-notifications" description={WHATSAPP_NOTIFICATIONS_DESCRIPTION}>
        <Switch checked={notifications} labelledBy="settings-whatsapp-notifications" onChange={(whatsappNotifications) => void update({ whatsappNotifications })} />
      </SettingRow>
      {notifications && (
        <SettingRow name="Só pessoas (sem grupos)" nameId="settings-whatsapp-only-people" description={WHATSAPP_ONLY_PEOPLE_DESCRIPTION}>
          <Switch checked={!notifyGroups} labelledBy="settings-whatsapp-only-people" onChange={(onlyPeople) => void update({ whatsappNotifyGroups: !onlyPeople })} />
        </SettingRow>
      )}
    </Section>
  )
}
