import { ChartNoAxesColumn, ChevronDown, ChevronRight, Images, MessageCircle, Plus, Send, type LucideIcon } from 'lucide-react'
import { useRef } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { INSTAGRAM_ANCHOR, REDES_SECTIONS, redesPath, settingsPath, type RedesSection, type SettingsNavigationState } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { ScrollFade } from '../../design/ScrollFade'
import { unreadBadge } from '../email/format'
import { INSTAGRAM_TOKEN_INPUT } from '../settings/InstagramSection'
import { InstagramGlyph } from './InstagramGlyph'
import { REDES_SECTION_LABELS } from './redesFormat'
import { redesUnreadTotal, useRedes } from './redesStore'

const SECTION_ICONS: Record<RedesSection, LucideIcon> = { publicacoes: Images, comentarios: MessageCircle, mensagens: Send, metricas: ChartNoAxesColumn }

/** Linha da conta: 28 px como as do Email (`--side-subrow`), com o glifo do Instagram e o @. */
const ROW = 'flex h-[var(--side-subrow)] min-w-0 shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]'
/** Linha de seção: 28 px, recuada 28 (`--side-indent`), com o ícone da seção; a aberta marcada pelo `NavLink`. */
const sectionClass = ({ isActive }: { isActive: boolean }): string =>
  `flex h-[var(--side-subrow)] min-w-0 items-center gap-2 rounded-[var(--radius-control)] pr-2.5 pl-[var(--side-indent)] text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
    isActive ? 'bg-side-active font-medium text-side-text' : 'text-side-muted hover:text-side-text'
  }`
const BADGE = 'shrink-0 text-12 font-medium tabular text-side-text'

/**
 * Nível Redes da barra lateral (contrato 72, R8): uma linha por conta (o glifo do Instagram e o @) com as seções dela
 * (Publicações, Comentários e Mensagens com os não lidos, Métricas). Com uma conta só, a linha não tem seta e as seções
 * ficam sempre à mostra; com duas ou mais, cada conta recolhe (nesta sessão) e a recolhida mostra a soma dos não lidos.
 * Só a lista rola; "Conectar conta…" fica preso no pé do nível e leva a Configurações › Contas › Instagram.
 */
export function RedesNav() {
  const accounts = useRedes((state) => state.state?.accounts ?? [])
  const unread = useRedes((state) => state.unread)
  const collapsed = useRedes((state) => state.collapsed)
  const toggle = useRedes((state) => state.toggleCollapsed)
  const navigate = useNavigate()
  const listRef = useRef<HTMLDivElement>(null)
  const single = accounts.length === 1

  const connect = (): void => {
    const state: SettingsNavigationState = { focus: INSTAGRAM_TOKEN_INPUT }
    void navigate(settingsPath('contas', INSTAGRAM_ANCHOR), { state })
  }

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={listRef} data-redes-nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {accounts.map((account) => {
            const open = single || !collapsed.includes(account.id)
            const groupId = `redes-nav-${account.id}`
            const total = redesUnreadTotal(unread, account.id)
            const name = `@${account.username}`
            return (
              <div key={account.id} data-redes-account-row={account.id} className="flex flex-col gap-0.5">
                {single ? (
                  <div data-redes-account-header={account.id} title={name} className={`${ROW} text-side-muted`}>
                    <InstagramGlyph className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-redes-account-toggle={account.id}
                    aria-expanded={open}
                    aria-controls={groupId}
                    title={name}
                    onClick={() => toggle(account.id)}
                    className={`${ROW} no-drag text-side-muted hover:text-side-text`}
                  >
                    <Icon icon={open ? ChevronDown : ChevronRight} className="shrink-0" />
                    <InstagramGlyph className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{name}</span>
                    {!open && total > 0 && (
                      <span data-redes-account-badge className={BADGE}>
                        {unreadBadge(total)}
                        <span className="sr-only"> não lidos</span>
                      </span>
                    )}
                  </button>
                )}
                {open && (
                  <ul id={groupId} className="flex flex-col gap-0.5">
                    {REDES_SECTIONS.map((section) => {
                      const count = section === 'comentarios' ? (unread[account.id]?.comments ?? 0) : section === 'mensagens' ? (unread[account.id]?.messages ?? 0) : 0
                      const counted = section === 'comentarios' || section === 'mensagens'
                      return (
                        <li key={section} className="flex flex-col">
                          <NavLink to={redesPath(account.id, section)} end draggable={false} data-redes-section={section} data-redes-section-account={account.id} className={sectionClass}>
                            <Icon icon={SECTION_ICONS[section]} className="shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{REDES_SECTION_LABELS[section]}</span>
                            {/* Os não lidos (73 e 74): o número fica no DOM vazio e escondido enquanto é zero. */}
                            {counted && (
                              <span data-redes-badge={section} hidden={count === 0} className={BADGE}>
                                {unreadBadge(count)}
                                <span className="sr-only"> não lidos</span>
                              </span>
                            )}
                          </NavLink>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
        <ScrollFade target={listRef} />
      </div>
      <button
        type="button"
        data-redes-connect-link
        onClick={connect}
        className={`${ROW} no-drag mt-1 text-side-muted hover:text-side-text`}
      >
        <Icon icon={Plus} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Conectar conta…</span>
      </button>
    </>
  )
}
