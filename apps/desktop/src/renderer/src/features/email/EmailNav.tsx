import { ChevronDown, ChevronRight, Inbox, Send } from 'lucide-react'
import { NavLink } from 'react-router'
import { emailPath } from '@shared/routes'
import { useSettings } from '../../app/settingsStore'
import { Icon } from '../../design/Icon'
import { folderKey, useEmail } from './emailStore'
import { accountLabel, unreadBadge, unreadCount } from './format'

/** A mesma linha dos itens da navegação principal (`Sidebar`): 40 px, ícone 16 e rótulo 13. */
const ROW = 'flex h-10 min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]'
const linkClass = ({ isActive }: { isActive: boolean }): string => `${ROW} pl-8 ${isActive ? 'bg-side-active text-side-text' : 'text-side-muted hover:text-side-text'}`

/**
 * Contas de email na barra lateral (contrato 43, CA1), logo abaixo da navegação principal e no mesmo desenho dela: cada
 * conta pelo nome, com a seta que abre e fecha as pastas "Caixa de Entrada" (com as não lidas) e "Enviados". As
 * recolhidas ficam gravadas nas configurações (`emailCollapsed`). Sem conta, nada aparece.
 */
export function EmailNav() {
  const accounts = useEmail((state) => state.accounts)
  const folders = useEmail((state) => state.folders)
  const collapsed = useSettings((state) => state.settings.emailCollapsed)
  const update = useSettings((state) => state.update)
  if (!accounts?.length) return null
  const list = accounts.map((status) => status.account)

  const toggle = (id: string): void => {
    const next = collapsed.includes(id) ? collapsed.filter((item) => item !== id) : [...collapsed, id]
    // Só as contas que existem (uma removida não fica lembrada).
    void update({ emailCollapsed: next.filter((item) => list.some((account) => account.id === item)) })
  }

  return (
    <nav aria-label="Email" data-email-nav className="mt-4 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
      {accounts.map(({ account, state, error }) => {
        const open = !collapsed.includes(account.id)
        const label = accountLabel(list, account)
        const unread = unreadCount(folders[folderKey(account.id, 'inbox')])
        const groupId = `email-nav-${account.id}`
        return (
          <div key={account.id} data-email-account={account.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              data-email-account-toggle={account.id}
              aria-expanded={open}
              aria-controls={groupId}
              title={account.address}
              onClick={() => toggle(account.id)}
              className={`${ROW} text-side-muted hover:text-side-text`}
            >
              <Icon icon={open ? ChevronDown : ChevronRight} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
              {state === 'error' && (
                <span data-email-account-error title={error ?? 'Com problema'} className="size-1.5 shrink-0 bg-side-rec">
                  <span className="sr-only">Com problema</span>
                </span>
              )}
              {!open && unread > 0 && <span className="shrink-0 text-12 tabular text-side-text">{unreadBadge(unread)}</span>}
            </button>
            {open && (
              <div id={groupId} className="flex flex-col gap-0.5">
                <NavLink to={emailPath(account.id, 'inbox')} data-email-folder="inbox" data-email-folder-account={account.id} draggable={false} className={linkClass}>
                  <Icon icon={Inbox} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Caixa de Entrada</span>
                  {unread > 0 && (
                    <span data-email-unread-count className="shrink-0 text-12 font-medium tabular text-side-text">
                      {unreadBadge(unread)}
                      <span className="sr-only"> não lidas</span>
                    </span>
                  )}
                </NavLink>
                <NavLink to={emailPath(account.id, 'sent')} data-email-folder="sent" data-email-folder-account={account.id} draggable={false} className={linkClass}>
                  <Icon icon={Send} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Enviados</span>
                </NavLink>
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
