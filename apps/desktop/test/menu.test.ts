import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { aboutPanelOptions, buildMenuTemplate, MENU_IDS } from '../src/main/menu'

function findItem(items: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions | undefined {
  for (const item of items) {
    if (item.id === id) return item
    if (Array.isArray(item.submenu)) {
      const found = findItem(item.submenu, id)
      if (found) return found
    }
  }
  return undefined
}

describe('menu do app', () => {
  const onNavigate = vi.fn()
  const onNewRecording = vi.fn()
  const onLock = vi.fn()
  const template = buildMenuTemplate({ appName: 'Meeting Scribe', onNavigate, onNewRecording, onLock, isDev: false })

  it('tem "Configurações…" com ⌘, levando à rota de configurações', () => {
    const item = findItem(template, MENU_IDS.settings)
    expect(item?.label).toBe('Configurações…')
    expect(item?.accelerator).toBe('CmdOrCtrl+,')
    ;(item?.click as () => void)()
    expect(onNavigate).toHaveBeenLastCalledWith('configuracoes')
  })

  it('tem "Nova gravação" com ⌘N, que inicia a gravação em vez de só navegar', () => {
    const item = findItem(template, MENU_IDS.newRecording)
    expect(item?.accelerator).toBe('CmdOrCtrl+N')
    onNavigate.mockClear()
    ;(item?.click as () => void)()
    expect(onNewRecording).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('tem "Bloquear <app>" com ⌘⇧L, desabilitado até haver senha ou Touch ID (contrato 22)', () => {
    const item = findItem(template, MENU_IDS.lock)
    expect(item?.label).toBe('Bloquear Meeting Scribe')
    expect(item?.accelerator).toBe('CmdOrCtrl+Shift+L')
    expect(item?.enabled).toBe(false)
    onNavigate.mockClear()
    ;(item?.click as () => void)()
    expect(onLock).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('só mostra recarregar e ferramentas do desenvolvedor em desenvolvimento', () => {
    const roles = (t: MenuItemConstructorOptions[]): string[] =>
      t.flatMap((i) => [i.role ?? '', ...(Array.isArray(i.submenu) ? roles(i.submenu) : [])])
    expect(roles(template)).not.toContain('toggleDevTools')
    expect(roles(buildMenuTemplate({ appName: 'x', onNavigate, onNewRecording, onLock, isDev: true }))).toContain('toggleDevTools')
  })

  it('o painel Sobre mostra o nome do app e a LAP como dona', () => {
    expect(aboutPanelOptions('Meeting Scribe', '0.1.0')).toMatchObject({
      applicationName: 'Meeting Scribe',
      applicationVersion: '0.1.0',
      copyright: '© 2026 LAP Software & Consultoria',
    })
  })
})
