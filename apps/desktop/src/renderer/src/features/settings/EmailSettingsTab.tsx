import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EMAIL_NOTIFICATIONS_DESCRIPTION } from '@shared/settings-index'
import { useSettings } from '../../app/settingsStore'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { folderKey, useEmail } from '../email/emailStore'
import { breadcrumb } from '../email/folderTree'
import { accountLabel } from '../email/format'
import { MoveToPicker } from '../email/MoveToPicker'
import { EmailFoldersSection } from './EmailFoldersSection'
import { EmailPainelSection } from './EmailPainelSection'
import { EmailRulesSection } from './EmailRulesSection'
import { EmailSection } from './EmailSection'
import { EmailSignatureSection } from './EmailSignatureSection'
import { InvitesSection } from './InvitesSection'

// D8: a conta escolhida vale para Assinatura, Regras e Pastas e fica lembrada enquanto o app está aberto.
let rememberedAccount: string | null = null

/**
 * Configurações › Email (contrato 55, CA14 a CA22, telas 09 a 12): Contas, o seletor de conta, Assinatura, Regras,
 * Pastas e Avisos, nesta ordem; depois, o Painel (contrato 157) e Convites (contrato 63). Sem conta, só Contas, a nota e Avisos.
 */
export function EmailSettingsTab() {
  const accounts = useEmail((state) => state.accounts)
  const trees = useEmail((state) => state.trees)
  const inbox = useEmail((state) => state.folders)
  const notifications = useSettings((state) => state.settings.emailNotifications)
  const update = useSettings((state) => state.update)
  const [chosen, setChosen] = useState<string | null>(rememberedAccount)
  const list = accounts ?? []
  const status = list.find((item) => item.account.id === chosen) ?? list[0] ?? null
  const accountId = status?.account.id ?? null

  useEffect(() => {
    rememberedAccount = accountId
    // As pastas da conta escolhida (para o destino das regras e a lista de Pastas).
    if (accountId) void useEmail.getState().loadTree(accountId)
  }, [accountId])

  const tree = accountId ? trees[accountId] : undefined
  const pop3 = status ? status.account.incoming.protocol === 'pop3' || tree?.pop3 === true : false
  const nodes = tree?.nodes ?? []
  const hasTrash = (function find(items: typeof nodes): boolean {
    return items.some((node) => node.specialUse === '\\Trash' || find(node.children))
  })(nodes)
  const name = (path: string): string => breadcrumb(path, nodes)

  return (
    <>
      <EmailSection />
      {status ? (
        <>
          <div data-email-settings-account-picker className="-mt-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] bg-bg-sunken px-3 py-2">
            <label htmlFor="settings-email-account" className="text-13 text-text-muted">
              Assinatura, regras e pastas de
            </label>
            <select
              id="settings-email-account"
              data-email-settings-account-select
              value={status.account.id}
              onChange={(event) => setChosen(event.target.value)}
              className="no-drag h-8 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2.5 text-13 font-bold text-title"
            >
              {list.map((item) => (
                <option key={item.account.id} value={item.account.id}>
                  {accountLabel(
                    list.map((other) => other.account),
                    item.account,
                  )}
                </option>
              ))}
            </select>
            <span data-email-settings-account-address className="text-13 text-text">
              {status.account.address}
              {pop3 ? ' · POP3' : ''}
            </span>
          </div>
          <EmailSignatureSection key={`assinatura:${status.account.id}`} accountId={status.account.id} />
          <EmailRulesSection key={`regras:${status.account.id}`} accountId={status.account.id} pop3={pop3} hasTrash={hasTrash} name={name} inboxCount={inbox[folderKey(status.account.id, 'inbox')]?.length ?? 0} />
          <EmailFoldersSection key={`pastas:${status.account.id}`} accountId={status.account.id} pop3={pop3} />
        </>
      ) : (
        <Note id="email-settings-no-account" icon={Mail} role="status">
          Adicione uma conta para configurar assinatura, regras e pastas.
        </Note>
      )}
      <Section title="Avisos" anchor="avisos">
        <SettingRow name="Avisar quando chega email" nameId="settings-email-notifications" description={EMAIL_NOTIFICATIONS_DESCRIPTION}>
          <Switch checked={notifications} labelledBy="settings-email-notifications" onChange={(emailNotifications) => void update({ emailNotifications })} />
        </SettingRow>
      </Section>
      {/* Contrato 157 (D13): o Painel, entre Avisos e Convites (vale para todas as contas). */}
      <EmailPainelSection />
      {/* Contrato 63: os convites, no fim (vale para todas as contas). */}
      <InvitesSection />
      <MoveToPicker />
    </>
  )
}
