// Menu do app em pt-BR. Itens que navegam mandam o id da rota ao renderer pelo `onNavigate`;
// "Nova gravação" inicia a captura, então tem handler próprio. "Bloquear" (contrato 22) bloqueia o app.
import type { AboutPanelOptionsOptions, MenuItemConstructorOptions } from 'electron'
import type { RouteId } from '../shared/routes'

export interface MenuHandlers {
  appName: string
  onNavigate: (route: RouteId) => void
  onNewRecording: () => void
  onLock: () => void
  isDev: boolean
}

export const MENU_IDS = { settings: 'settings', newRecording: 'new-recording', lock: 'lock' } as const

/** Atalho de "Bloquear" (contrato 22, CA2): ⌘⇧L. */
export const LOCK_ACCELERATOR = 'CmdOrCtrl+Shift+L'

/** Painel "Sobre" (item `about` do menu): o app é da LAP Software & Consultoria. */
export function aboutPanelOptions(appName: string, version: string): AboutPanelOptionsOptions {
  return { applicationName: appName, applicationVersion: version, copyright: '© 2026 LAP Software & Consultoria' }
}

export function buildMenuTemplate({ appName, onNavigate, onNewRecording, onLock, isDev }: MenuHandlers): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions[] = isDev
    ? [{ role: 'reload', label: 'Recarregar' }, { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' }, { type: 'separator' }]
    : []

  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `Sobre o ${appName}` },
        { type: 'separator' },
        {
          id: MENU_IDS.settings,
          label: 'Configurações…',
          accelerator: 'CmdOrCtrl+,',
          click: () => onNavigate('configuracoes'),
        },
        {
          id: MENU_IDS.lock,
          label: `Bloquear ${appName}`,
          accelerator: LOCK_ACCELERATOR,
          // Habilitado só com senha ou Touch ID (o main troca `enabled` a cada mudança do bloqueio).
          enabled: false,
          click: () => onLock(),
        },
        { type: 'separator' },
        { role: 'services', label: 'Serviços' },
        { type: 'separator' },
        { role: 'hide', label: `Ocultar ${appName}` },
        { role: 'hideOthers', label: 'Ocultar outros' },
        { role: 'unhide', label: 'Mostrar tudo' },
        { type: 'separator' },
        { role: 'quit', label: `Encerrar ${appName}` },
      ],
    },
    {
      label: 'Arquivo',
      submenu: [
        {
          id: MENU_IDS.newRecording,
          label: 'Nova gravação',
          accelerator: 'CmdOrCtrl+N',
          click: () => onNewRecording(),
        },
        { type: 'separator' },
        { role: 'close', label: 'Fechar janela' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [...view, { role: 'togglefullscreen', label: 'Tela cheia' }],
    },
    {
      role: 'window',
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Trazer tudo para a frente' },
      ],
    },
  ]
}
