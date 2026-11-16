import { NavLink } from 'react-router'
import { BrandLogo } from '../design/BrandLogo'
import { Icon } from '../design/Icon'
import { PermissionsBlock } from '../features/permissions/PermissionsBlock'
import { UpdateNotice } from '../features/settings/UpdateNotice'
import { useBranding } from './brandingStore'
import { LockButton } from './LockButton'
import { ROUTE_PATHS } from '@shared/routes'
import { whatsappInstalled } from '@shared/whatsapp'
import { useWhatsApp } from '../features/whatsapp/whatsappStore'
import { APP_ROUTES } from './routes'

// O item leva ao caminho da rota (Configurações sem a aba abre a última aberta) e fica ativo nas sub-rotas dela.
const NAV_ITEMS = APP_ROUTES.flatMap((route) => (route.nav ? [{ ...route.nav, id: route.id, path: ROUTE_PATHS[route.id] }] : []))

/**
 * Barra lateral opaca em azul profundo: espaço dos botões da janela, marca (a escolhida em Configurações
 * ou a da LAP), navegação e, no rodapé, "Bloquear", o aviso de versão nova e as permissões.
 */
export function Sidebar() {
  const branding = useBranding((state) => state.branding)
  // Contrato 24: "WhatsApp" só com o serviço instalado.
  const whatsapp = useWhatsApp((state) => (state.status ? whatsappInstalled(state.status.state) : false))
  const items = NAV_ITEMS.filter((item) => item.id !== 'whatsapp' || whatsapp)
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
      <nav aria-label="Navegação principal" className="mt-6 flex flex-col gap-0.5">
        {items.map((item) => (
          <NavLink
            key={item.id}
            to={item.path}
            end={item.path === ROUTE_PATHS.reunioes}
            data-nav={item.id}
            draggable={false}
            className={({ isActive }) =>
              `flex h-10 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
                isActive ? 'bg-side-active text-side-text' : 'text-side-muted hover:text-side-text'
              }`
            }
          >
            <Icon icon={item.icon} className="shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      {/* Rodapé: "Bloquear" (contrato 22) e o aviso de versão nova (quando há) logo acima das permissões. */}
      <div className="mt-auto flex flex-col">
        <LockButton />
        <UpdateNotice />
        <PermissionsBlock />
      </div>
    </aside>
  )
}
