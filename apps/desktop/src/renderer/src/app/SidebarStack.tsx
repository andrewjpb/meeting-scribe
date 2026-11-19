import { ChevronLeft, Mail, Settings, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { NavLink } from 'react-router'
import { settingsPath, SETTINGS_TABS } from '@shared/routes'
import { Icon } from '../design/Icon'
import { Shortcut } from '../design/Shortcut'
import { EmailNav } from '../features/email/EmailNav'
import { useEmail } from '../features/email/emailStore'
import { SETTINGS_TAB_LABELS } from '../features/settings/settingsTabs'
import { SIDEBAR_SLIDE_FALLBACK_MS, transitionOf, type SidebarLevel, type SidebarSection } from './sidebarLevels'

/** Para onde vai o foco depois da troca de nível: o cabeçalho-voltar do nível novo ou o item da seção na raiz. */
export type SidebarFocus = '[data-sidebar-back]' | `[data-nav="${SidebarSection}"]`

const LEVEL_LABELS: Record<SidebarLevel, string> = { root: 'Navegação principal', email: 'Email', configuracoes: 'Configurações' }
// A raiz é a lista dos itens, como o `<nav>` de antes; os níveis de seção arrumam o cabeçalho e a lista deles.
const LEVEL_CLASSES: Record<SidebarLevel, string> = { root: 'gap-0.5', email: '', configuracoes: '' }
const levelClass = (level: SidebarLevel, slide: string | null): string | undefined => [LEVEL_CLASSES[level], slide].filter(Boolean).join(' ') || undefined

interface Shown {
  current: SidebarLevel
  leaving: { level: SidebarLevel; transition: 'push' | 'pop' } | null
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Coluna do meio da barra lateral em pilha (contrato 65; contrato 66, o nível Configurações): a raiz ou o nível de uma seção, entre a marca e o rodapé, que
 * ficam parados. O nível vem pronto do `Sidebar` (sai da rota); aqui só o deslize: durante ele, o nível que sai fica no
 * DOM, inerte, até o `animationend` do que entra ou a reserva de tempo (com movimento reduzido a troca é instantânea e
 * nunca há dois níveis). `focusRef` é a marca posta pelo clique que trocou o nível, lida depois da troca.
 */
export function SidebarStack({ level, root, onBack, focusRef }: { level: SidebarLevel; root: ReactNode; onBack: () => void; focusRef: RefObject<SidebarFocus | null> }) {
  const [shown, setShown] = useState<Shown>({ current: level, leaving: null })
  const currentRef = useRef<HTMLElement>(null)

  // Nível novo: o anterior sai deslizando (o `matchMedia` é lido na troca, para valer o ajuste do sistema de agora).
  if (shown.current !== level) {
    const transition = transitionOf(shown.current, level)
    setShown({ current: level, leaving: transition && !reducedMotion() ? { level: shown.current, transition } : null })
  }

  // Reserva: com movimento reduzido no meio do deslize (ou a animação zerada) o `animationend` não chega. Trocar de nível
  // de novo, ou o `animationend`, cancela esta.
  useEffect(() => {
    if (!shown.leaving) return
    const timer = window.setTimeout(() => setShown((state) => ({ ...state, leaving: null })), SIDEBAR_SLIDE_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [shown.leaving])

  // O foco só se mexe quando o clique no sidebar pediu (navegação de fora não mexe).
  const { current, leaving } = shown
  useEffect(() => {
    const target = focusRef.current
    focusRef.current = null
    if (target) currentRef.current?.querySelector<HTMLElement>(target)?.focus({ preventScroll: true })
  }, [current, focusRef])

  const content = (item: SidebarLevel): ReactNode => {
    if (item === 'root') return root
    return item === 'email' ? <EmailLevel onBack={onBack} /> : <SettingsLevel onBack={onBack} />
  }
  const entering = (
    <nav
      key={current}
      ref={currentRef}
      data-sidebar-level={current}
      aria-label={LEVEL_LABELS[current]}
      className={levelClass(current, leaving && `side-level-${leaving.transition}-in`)}
      // O 2º clique de um duplo clique em "Email" ou "Configurações" (ou no cabeçalho-voltar) cai no nível que acabou de
      // entrar, no lugar do item clicado: abriria a pasta ou a aba que estiver ali. Com ou sem deslize, ele não vale.
      onClickCapture={(event) => {
        if (event.detail < 2) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setShown((state) => ({ ...state, leaving: null }))
      }}
    >
      {content(current)}
    </nav>
  )
  const exiting = leaving && (
    <nav key={leaving.level} data-sidebar-level={leaving.level} data-sidebar-leaving aria-label={LEVEL_LABELS[leaving.level]} aria-hidden="true" inert className={levelClass(leaving.level, `side-level-${leaving.transition}-out`)}>
      {content(leaving.level)}
    </nav>
  )
  // No `push` o nível novo cobre a raiz; no `pop` o que sai passa por cima da raiz que volta.
  return (
    <div data-sidebar-stack className={`side-stack -mx-3 mt-6 flex-1 px-3${leaving ? ' is-sliding' : ''}`}>
      {leaving?.transition === 'pop' ? [entering, exiting] : [exiting, entering]}
    </div>
  )
}

/** Nível Email: o cabeçalho-voltar parado em cima e as contas com as pastas, que rolam sozinhas. */
function EmailLevel({ onBack }: { onBack: () => void }) {
  const empty = useEmail((state) => state.accounts?.length === 0)
  const ref = useRef<HTMLDivElement>(null)

  // A pasta aberta à vista ao entrar (sem `scrollIntoView`, que rolaria a coluna cortada durante o deslize).
  useLayoutEffect(() => {
    const list = ref.current?.querySelector<HTMLElement>('[data-email-nav]')
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!list || !active) return
    const box = list.getBoundingClientRect()
    const item = active.getBoundingClientRect()
    if (item.top < box.top || item.bottom > box.bottom) list.scrollTop += item.top - box.top - (box.height - item.height) / 2
  }, [])

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <BackHeader icon={Mail} label="Email" onBack={onBack} />
      {empty && <p className="px-2.5 text-12 text-side-muted">Nenhuma conta de email ainda.</p>}
      <EmailNav />
    </div>
  )
}

/** O cabeçalho-voltar de um nível de seção: mostra a raiz sem navegar. */
function BackHeader({ icon, label, onBack }: { icon: LucideIcon; label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      data-sidebar-back
      aria-label={`${label}: voltar ao menu`}
      onClick={onBack}
      className="no-drag mb-2 flex h-10 shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-13 font-medium text-side-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-side-active"
    >
      <Icon icon={ChevronLeft} className="shrink-0" />
      <Icon icon={icon} className="shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/** Linha de aba: 30 px, sem ícone, recuada como as pastas do email; a aberta marcada pelo `NavLink`. */
const tabLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `flex h-[30px] min-w-0 shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] pr-2.5 pl-8 text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
    isActive ? 'bg-side-active font-medium text-side-text' : 'text-side-muted hover:text-side-text'
  }`

/**
 * Nível Configurações (contrato 66): o cabeçalho-voltar e uma linha por aba de `SETTINGS_TABS`, na ordem, com a dica
 * de ⌘1 a ⌘9 (o atalho é do `SettingsScreen`); só as linhas rolam.
 */
function SettingsLevel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader icon={Settings} label="Configurações" onBack={onBack} />
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {SETTINGS_TABS.map((tab, index) => {
          const shortcut = index < 9 ? index + 1 : null
          return (
            <NavLink key={tab} to={settingsPath(tab)} data-settings-tab-link={tab} draggable={false} aria-keyshortcuts={shortcut ? `Meta+${shortcut}` : undefined} className={tabLinkClass}>
              <span className="min-w-0 flex-1 truncate">{SETTINGS_TAB_LABELS[tab]}</span>
              {shortcut && <Shortcut keys={`⌘${shortcut}`} />}
            </NavLink>
          )
        })}
      </div>
    </div>
  )
}
