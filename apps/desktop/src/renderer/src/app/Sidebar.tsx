import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { BrandLogo } from '../design/BrandLogo'
import { Icon } from '../design/Icon'
import { PermissionsBlock } from '../features/permissions/PermissionsBlock'
import { UpdateNotice } from '../features/settings/UpdateNotice'
import { useBranding } from './brandingStore'
import { LockButton } from './LockButton'
import { EMAIL_ROOT_PATH, FUNIL_ROOT_PATH, funilPath, REDES_ROOT_PATH, ROUTE_PATHS, TAREFAS_ROOT_PATH } from '@shared/routes'
import { whatsappInstalled } from '@shared/whatsapp'
import { useWhatsApp } from '../features/whatsapp/whatsappStore'
import { useEmail } from '../features/email/emailStore'
import { totalUnread, unreadBadge } from '../features/email/format'
import { redesUnreadTotal, useRedes } from '../features/redes/redesStore'
import { badgeVencidas } from '../features/tarefas/tarefasFormat'
import { useTarefas } from '../features/tarefas/tarefasStore'
import { useNotificacoes } from '../features/notificacoes/notificacoesSelectors'
import { APP_ROUTES, routeIdOf } from './routes'
import { activeNavId, isSidebarSection, lastEmailPath, lastRedesPath, levelFor, rememberEmailPath, rememberRedesPath, sectionOf, type SidebarSection } from './sidebarLevels'
import { SidebarStack, type SidebarFocus } from './SidebarStack'

// O item leva ao caminho da rota (Configurações sem a aba abre a última aberta; Email, contrato 65, à última pasta aberta;
// Redes, contrato 72, à última seção vista; Funil, contrato 112, a Oportunidades; Tarefas, contrato 123, à lista).
const ROOT_PATHS: Partial<Record<string, string>> = { email: EMAIL_ROOT_PATH, redes: REDES_ROOT_PATH, funil: FUNIL_ROOT_PATH, tarefas: TAREFAS_ROOT_PATH }
const NAV_ITEMS = APP_ROUTES.flatMap((route) => (route.nav ? [{ ...route.nav, id: route.id, path: ROOT_PATHS[route.id] ?? ROUTE_PATHS[route.id] }] : []))

/**
 * Barra lateral opaca em azul profundo: espaço dos botões da janela, marca (a escolhida em Configurações
 * ou a da LAP), a coluna em pilha (contrato 65: a raiz com os itens, o nível Email com as contas, contrato 66, o
 * nível Configurações com as abas, contrato 67, o nível Assistente com as conversas ou, contrato 72, o nível Redes com
 * as contas do Instagram) e, no rodapé,
 * "Bloquear", o aviso de versão nova e as permissões.
 */
export function Sidebar() {
  const branding = useBranding((state) => state.branding)
  // Contrato 24: "WhatsApp" só com o serviço instalado.
  const whatsapp = useWhatsApp((state) => (state.status ? whatsappInstalled(state.status.state) : false))
  const unread = useEmail((state) => totalUnread(state.accounts, state.folders))
  // Contrato 72: "Redes" só com uma conta conectada, ou com a rota aberta (o estado vazio leva a Configurações).
  const redesAccounts = useRedes((state) => state.state?.accounts.length ?? 0)
  const redesUnread = useRedes((state) => redesUnreadTotal(state.unread))
  // Contrato 123 (R1): as vencidas, da view que o `Shell` carrega e acompanha.
  const vencidas = useTarefas((state) => badgeVencidas(state.view))
  // Contrato 160: o total da tela Notificações (não lidas do WhatsApp + e-mails não lidos), pelo mesmo hook dela.
  const notificacoes = useNotificacoes().contagem.total
  const location = useLocation()
  const items = NAV_ITEMS.filter((item) => (item.id !== 'whatsapp' || whatsapp) && (item.id !== 'redes' || redesAccounts > 0 || sectionOf(location.pathname) === 'redes'))
  const navigate = useNavigate()
  // Contrato 65: o "voltar" mostra a raiz sem navegar e vale só para esta navegação (o `key` muda a cada uma).
  const [poppedKey, setPoppedKey] = useState<string | null>(null)
  const level = levelFor(location.pathname, poppedKey, location.key)
  const focusRef = useRef<SidebarFocus | null>(null)
  // O nível e o item marcado saem do mesmo padrão da seção (`sectionOf`).
  const activeId = activeNavId(location.pathname, routeIdOf(location.pathname))

  useEffect(() => {
    rememberEmailPath(location.pathname)
    rememberRedesPath(location.pathname)
  }, [location.pathname])

  // Item de seção: na seção, só mostra o nível de novo (rota, mensagem, aba e conversa abertas iguais); de fora, o Email
  // abre a última pasta aberta, Configurações, `/configuracoes`, que o `SettingsScreen` leva à última aba vista, e o
  // Assistente (contrato 67), `/assistente`, com a conversa que estava aberta no store; Redes (contrato 72), a última seção
  // vista (na primeira vez, as publicações da primeira conta).
  const openSection = (section: SidebarSection) => (event: MouseEvent): void => {
    event.preventDefault()
    focusRef.current = '[data-sidebar-back]'
    if (sectionOf(location.pathname) === section) setPoppedKey(null)
    else if (section === 'email') void navigate(lastEmailPath(useEmail.getState().accounts?.map((status) => status.account.id) ?? []))
    else if (section === 'assistente') void navigate(ROUTE_PATHS.assistente)
    else if (section === 'redes') void navigate(lastRedesPath(useRedes.getState().state?.accounts.map((account) => account.id) ?? []))
    // Contrato 112: o Funil abre sempre em Oportunidades.
    else if (section === 'funil') void navigate(funilPath('oportunidades'))
    else void navigate(ROUTE_PATHS.configuracoes)
  }
  const back = (): void => {
    if (level !== 'root') focusRef.current = `[data-nav="${level}"]`
    setPoppedKey(location.key)
  }

  const root = items.map((item) => {
    const active = activeId === item.id
    const badge = item.id === 'email' ? unreadBadge(unread) : item.id === 'redes' ? unreadBadge(redesUnread) : item.id === 'tarefas' ? vencidas : item.id === 'notificacoes' ? unreadBadge(notificacoes) : ''
    return (
      <Link
        key={item.id}
        to={item.path}
        data-nav={item.id}
        aria-current={active ? 'page' : undefined}
        draggable={false}
        onClick={isSidebarSection(item.id) ? openSection(item.id) : undefined}
        className={`flex h-[var(--side-row)] items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
          active ? 'bg-side-active text-side-text' : 'text-side-muted hover:text-side-text'
        }`}
      >
        <Icon icon={item.icon} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {badge && (
          <span data-nav-badge className="shrink-0 text-12 font-medium tabular text-side-text">
            {badge}
            <span className="sr-only">{item.id === 'redes' ? ' não lidos' : item.id === 'tarefas' ? ' vencidas' : item.id === 'notificacoes' ? ' por ler' : ' não lidas'}</span>
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
      {/*
       * Rodapé: "Bloquear" (contrato 22) e o aviso de versão nova (quando há) logo acima das permissões. O fio de cima
       * separa a lista do nível (conversas, contas) quando ela é longa; a coluna em pilha ocupa o resto, então o rodapé
       * fica no pé da barra em todos os níveis. Contrato 79: 126 px no total, com "Bloquear" e as permissões em linhas de 28.
       */}
      <div className="mt-1 flex flex-col border-t border-side-divider pt-1">
        <LockButton />
        <UpdateNotice />
        <PermissionsBlock />
      </div>
    </aside>
  )
}
