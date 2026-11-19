import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { BrandLogo } from '../design/BrandLogo'
import { Icon } from '../design/Icon'
import { PermissionsBlock } from '../features/permissions/PermissionsBlock'
import { UpdateNotice } from '../features/settings/UpdateNotice'
import { useBranding } from './brandingStore'
import { LockButton } from './LockButton'
import { EMAIL_ROOT_PATH, ROUTE_PATHS } from '@shared/routes'
import { whatsappInstalled } from '@shared/whatsapp'
import { useWhatsApp } from '../features/whatsapp/whatsappStore'
import { useEmail } from '../features/email/emailStore'
import { totalUnread, unreadBadge } from '../features/email/format'
import { APP_ROUTES, routeIdOf } from './routes'
import { activeNavId, isSidebarSection, lastEmailPath, levelFor, rememberEmailPath, sectionOf, type SidebarSection } from './sidebarLevels'
import { SidebarStack, type SidebarFocus } from './SidebarStack'

// O item leva ao caminho da rota (Configurações sem a aba abre a última aberta; Email, contrato 65, à última pasta aberta).
const NAV_ITEMS = APP_ROUTES.flatMap((route) => (route.nav ? [{ ...route.nav, id: route.id, path: route.id === 'email' ? EMAIL_ROOT_PATH : ROUTE_PATHS[route.id] }] : []))

/**
 * Barra lateral opaca em azul profundo: espaço dos botões da janela, marca (a escolhida em Configurações
 * ou a da LAP), a coluna em pilha (contrato 65: a raiz com os itens, o nível Email com as contas ou, contrato 66, o
 * nível Configurações com as abas) e, no rodapé,
 * "Bloquear", o aviso de versão nova e as permissões.
 */
export function Sidebar() {
  const branding = useBranding((state) => state.branding)
  // Contrato 24: "WhatsApp" só com o serviço instalado.
  const whatsapp = useWhatsApp((state) => (state.status ? whatsappInstalled(state.status.state) : false))
  const unread = useEmail((state) => totalUnread(state.accounts, state.folders))
  const items = NAV_ITEMS.filter((item) => item.id !== 'whatsapp' || whatsapp)
  const location = useLocation()
  const navigate = useNavigate()
  // Contrato 65: o "voltar" mostra a raiz sem navegar e vale só para esta navegação (o `key` muda a cada uma).
  const [poppedKey, setPoppedKey] = useState<string | null>(null)
  const level = levelFor(location.pathname, poppedKey, location.key)
  const focusRef = useRef<SidebarFocus | null>(null)
  // O nível e o item marcado saem do mesmo padrão da seção (`sectionOf`).
  const activeId = activeNavId(location.pathname, routeIdOf(location.pathname))

  useEffect(() => rememberEmailPath(location.pathname), [location.pathname])

  // Item de seção: na seção, só mostra o nível de novo (rota, mensagem e aba abertas iguais); de fora, o Email abre a
  // última pasta aberta e Configurações, `/configuracoes`, que o `SettingsScreen` leva à última aba vista.
  const openSection = (section: SidebarSection) => (event: MouseEvent): void => {
    event.preventDefault()
    focusRef.current = '[data-sidebar-back]'
    if (sectionOf(location.pathname) === section) setPoppedKey(null)
    else if (section === 'email') void navigate(lastEmailPath(useEmail.getState().accounts?.map((status) => status.account.id) ?? []))
    else void navigate(ROUTE_PATHS.configuracoes)
  }
  const back = (): void => {
    if (level !== 'root') focusRef.current = `[data-nav="${level}"]`
    setPoppedKey(location.key)
  }

  const root = items.map((item) => {
    const active = activeId === item.id
    const badge = item.id === 'email' ? unreadBadge(unread) : ''
    return (
      <Link
        key={item.id}
        to={item.path}
        data-nav={item.id}
        aria-current={active ? 'page' : undefined}
        draggable={false}
        onClick={isSidebarSection(item.id) ? openSection(item.id) : undefined}
        className={`flex h-10 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
          active ? 'bg-side-active text-side-text' : 'text-side-muted hover:text-side-text'
        }`}
      >
        <Icon icon={item.icon} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {badge && (
          <span data-nav-badge className="shrink-0 text-12 font-medium tabular text-side-text">
            {badge}
            <span className="sr-only"> não lidas</span>
          </span>
        )}
      </Link>
    )
  })

  return (
    <aside className="on-side flex w-[var(--sidebar-width)] shrink-0 flex-col bg-side-bg px-3 text-side-text">
      <div className="drag h-[var(--titlebar-height)] shrink-0" />
      <div className="drag flex items-center gap-2.5 px-2" data-brand>
        <BrandLogo dataUrl={branding.logoDataUrl} />
        <p className="flex min-w-0 flex-col gap-0.5">
          <span data-brand-name className="truncate text-15 font-bold tracking-[-0.2px]">
            {branding.name}
          </span>
          {branding.subtitle && (
            <span data-brand-subtitle className="caps truncate text-side-muted">
              {branding.subtitle}
            </span>
          )}
        </p>
      </div>
      <SidebarStack level={level} root={root} onBack={back} focusRef={focusRef} />
      {/* Rodapé: "Bloquear" (contrato 22) e o aviso de versão nova (quando há) logo acima das permissões. */}
      <div className="mt-auto flex flex-col">
        <LockButton />
        <UpdateNotice />
        <PermissionsBlock />
      </div>
    </aside>
  )
}
